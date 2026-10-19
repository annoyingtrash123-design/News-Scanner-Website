//! Pure logic: text extraction, link/document classification, diffing, SSRF checks.
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

pub const DOC_EXTS: [&str; 12] = [
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "odt", "ods", "rtf", "zip",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct Link {
    pub href: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Doc {
    pub href: String,
    pub text: String,
    pub ext: String,
}

#[derive(Debug, Default)]
pub struct Content {
    pub text: String,
    pub lines: Vec<String>,
    pub links: Vec<Link>,
    pub hash: String,
}

#[derive(Debug, Default, PartialEq)]
pub struct Diff {
    pub new_documents: Vec<Doc>,
    pub new_links: Vec<Link>,
    pub added_text: Vec<String>,
}

pub fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

const IGNORED: [&str; 6] = ["script", "style", "noscript", "svg", "iframe", "template"];
const BLOCKS: [&str; 24] = [
    "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "dd", "dt",
    "blockquote", "ul", "ol", "table", "header", "footer", "nav", "main", "aside", "br",
];

fn walk(el: ElementRef, out: &mut String) {
    for child in el.children() {
        if let Some(t) = child.value().as_text() {
            out.push_str(t);
        } else if let Some(ce) = ElementRef::wrap(child) {
            let name = ce.value().name();
            if IGNORED.contains(&name) {
                continue;
            }
            walk(ce, out);
            if BLOCKS.contains(&name) {
                out.push('\n');
            } else if name == "td" || name == "th" {
                out.push(' ');
            }
        }
    }
}

fn inside_ignored(el: ElementRef) -> bool {
    el.ancestors()
        .filter_map(ElementRef::wrap)
        .any(|a| IGNORED.contains(&a.value().name()))
}

/// Extract visible text + absolute links, optionally limited to a CSS selector.
pub fn extract_content(html: &str, selector: Option<&str>, base: &str) -> Result<Content, String> {
    let doc = Html::parse_document(html);
    let sel_str = selector.map(str::trim).filter(|s| !s.is_empty());
    let scopes: Vec<ElementRef> = if let Some(s) = sel_str {
        let sel = Selector::parse(s).map_err(|_| format!("Invalid CSS selector: {s}"))?;
        let found: Vec<_> = doc.select(&sel).collect();
        if found.is_empty() {
            return Err(format!("Selector matched nothing: {s}"));
        }
        found
    } else {
        let body = Selector::parse("body").unwrap();
        vec![doc.select(&body).next().unwrap_or_else(|| doc.root_element())]
    };

    let mut raw = String::new();
    for s in &scopes {
        if !IGNORED.contains(&s.value().name()) {
            walk(*s, &mut raw);
            raw.push('\n');
        }
    }
    let lines: Vec<String> = raw.split('\n').map(normalize).filter(|l| !l.is_empty()).collect();
    let text = normalize(&lines.join(" "));

    let a_sel = Selector::parse("a[href]").unwrap();
    let base_url = Url::parse(base).ok();
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for s in &scopes {
        let own = (s.value().name() == "a" && s.value().attr("href").is_some()).then_some(*s);
        for a in own.into_iter().chain(s.select(&a_sel)) {
            if inside_ignored(a) {
                continue;
            }
            let href = a.value().attr("href").unwrap_or("").trim();
            let lower = href.to_ascii_lowercase();
            if href.is_empty()
                || lower.starts_with("javascript:")
                || lower.starts_with("mailto:")
                || lower.starts_with("tel:")
                || href.starts_with('#')
            {
                continue;
            }
            let abs = match &base_url {
                Some(b) => b.join(href),
                None => Url::parse(href),
            };
            let Ok(abs) = abs else { continue };
            let abs = abs.to_string();
            if !seen.insert(abs.clone()) {
                continue;
            }
            let mut t = String::new();
            walk(a, &mut t);
            let t: String = normalize(&t).chars().take(200).collect();
            links.push(Link { href: abs, text: t });
        }
    }
    let hash = sha256_hex(&text);
    Ok(Content { text, lines, links, hash })
}

/// Split lines into sentence-ish units (split after . ! ? when followed by an uppercase/digit/quote).
pub fn split_units(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        let chars: Vec<(usize, char)> = line.char_indices().collect();
        let mut start = 0usize;
        for i in 1..chars.len() {
            let (bi, c) = chars[i];
            if c.is_whitespace() && matches!(chars[i - 1].1, '.' | '!' | '?') {
                // find next non-space char
                if let Some(&(ni, nc)) = chars[i..].iter().find(|(_, c)| !c.is_whitespace()) {
                    if nc.is_ascii_uppercase() || nc.is_ascii_digit() || matches!(nc, '"' | '\'' | '(') {
                        let part = normalize(&line[start..bi]);
                        if part.chars().count() >= 3 {
                            out.push(part);
                        }
                        start = ni;
                    }
                }
            }
        }
        let part = normalize(&line[start..]);
        if part.chars().count() >= 3 {
            out.push(part);
        }
    }
    out
}

/// Lowercase extension (no dot) if the URL path ends in a document type.
pub fn document_ext(href: &str) -> Option<String> {
    let path = match Url::parse(href) {
        Ok(u) => u.path().to_string(),
        Err(_) => href.split(['?', '#']).next().unwrap_or("").to_string(),
    };
    let seg = path.rsplit('/').next().unwrap_or("").to_lowercase();
    let (_, ext) = seg.rsplit_once('.')?;
    DOC_EXTS.contains(&ext).then(|| ext.to_string())
}

pub fn compute_diff(
    prev_lines: &[String],
    prev_links: &[Link],
    curr_lines: &[String],
    curr_links: &[Link],
    cap: usize,
) -> Diff {
    let known: HashSet<&str> = prev_links.iter().map(|l| l.href.as_str()).collect();
    let fresh: Vec<&Link> = curr_links.iter().filter(|l| !known.contains(l.href.as_str())).collect();
    let new_documents = fresh
        .iter()
        .filter_map(|l| {
            document_ext(&l.href).map(|ext| Doc { href: l.href.clone(), text: l.text.clone(), ext })
        })
        .take(50)
        .collect();
    let new_links = fresh
        .iter()
        .filter(|l| document_ext(&l.href).is_none())
        .take(cap)
        .map(|l| (*l).clone())
        .collect();
    let prev_units: HashSet<String> = split_units(prev_lines).into_iter().collect();
    let mut seen = HashSet::new();
    let mut added_text = Vec::new();
    for u in split_units(curr_lines) {
        if prev_units.contains(&u) || !seen.insert(u.clone()) {
            continue;
        }
        added_text.push(if u.chars().count() > 300 {
            format!("{}...", u.chars().take(297).collect::<String>())
        } else {
            u
        });
        if added_text.len() >= cap {
            break;
        }
    }
    Diff { new_documents, new_links, added_text }
}

pub fn summarize_diff(d: &Diff) -> String {
    let mut bits = Vec::new();
    let plural = |n: usize| if n > 1 { "s" } else { "" };
    let nd = d.new_documents.len();
    if nd > 0 {
        bits.push(format!("{nd} new document{}", plural(nd)));
    }
    let nl = d.new_links.len();
    if nl > 0 {
        bits.push(format!("{nl} new link{}", plural(nl)));
    }
    let nt = d.added_text.len();
    if nt > 0 {
        bits.push(format!("{nt} added text item{}", plural(nt)));
    }
    if bits.is_empty() {
        "Content changed".into()
    } else {
        bits.join(", ")
    }
}

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ---------- SSRF guard ----------

fn blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || o[0] == 0
        || o[0] >= 224
        || (o[0] == 100 && (64..=127).contains(&o[1]))
}

fn blocked_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return blocked_v4(v4);
    }
    let first = ip.segments()[0];
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // unique local
        || (first & 0xffc0) == 0xfe80 // link local
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => blocked_v4(v),
        IpAddr::V6(v) => blocked_v6(v),
    }
}

fn is_blocked_name(h: &str) -> bool {
    let h = h.to_ascii_lowercase();
    let h = h.trim_end_matches('.');
    h.is_empty() || h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h.ends_with(".internal")
}

/// Validate and normalize a watch URL (scheme + obviously-local hosts). DNS is checked at fetch time.
pub fn validate_url(input: &str) -> Result<Url, String> {
    let mut u = Url::parse(input.trim()).map_err(|_| "Invalid URL".to_string())?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return Err("URL must start with http:// or https://".into());
    }
    let blocked = match u.host() {
        None => true,
        Some(Host::Domain(d)) => is_blocked_name(d),
        Some(Host::Ipv4(ip)) => is_blocked_ip(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => is_blocked_ip(IpAddr::V6(ip)),
    };
    if blocked {
        return Err("That address is not allowed".into());
    }
    u.set_fragment(None);
    Ok(u)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_documents() {
        assert_eq!(document_ext("https://x.org/a/Report.PDF?dl=1").as_deref(), Some("pdf"));
        assert_eq!(document_ext("https://x.org/a/data.xlsx#p").as_deref(), Some("xlsx"));
        assert_eq!(document_ext("https://x.org/a/b.zip").as_deref(), Some("zip"));
        assert_eq!(document_ext("https://x.org/pdf"), None);
        assert_eq!(document_ext("https://x.org/page.html"), None);
        assert_eq!(document_ext("https://x.org/dir.pdf/index"), None);
        assert_eq!(document_ext("/rel/file.docx").as_deref(), Some("docx"));
    }

    fn l(h: &str) -> Link {
        Link { href: h.into(), text: "t".into() }
    }

    #[test]
    fn diff_finds_new_docs_links_text() {
        let pl = vec!["Hello world. Old news here.".to_string()];
        let cl = vec!["Hello world. Old news here. Brand new item.".to_string()];
        let d = compute_diff(
            &pl,
            &[l("https://a.org/old.pdf")],
            &cl,
            &[l("https://a.org/old.pdf"), l("https://a.org/new.pdf"), l("https://a.org/news/2")],
            20,
        );
        assert_eq!(d.new_documents.len(), 1);
        assert_eq!(d.new_documents[0].ext, "pdf");
        assert_eq!(d.new_links.len(), 1);
        assert_eq!(d.new_links[0].href, "https://a.org/news/2");
        assert_eq!(d.added_text, vec!["Brand new item.".to_string()]);
        assert_eq!(summarize_diff(&d), "1 new document, 1 new link, 1 added text item");
    }

    #[test]
    fn splits_sentences() {
        let u = split_units(&["One thing. Two things! three lower".to_string()]);
        assert_eq!(u, vec!["One thing.", "Two things! three lower"]);
    }

    #[test]
    fn ssrf_ip_checks() {
        for s in ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.5", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"] {
            assert!(is_blocked_ip(s.parse().unwrap()), "{s} should be blocked");
        }
        for s in ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "172.32.0.1"] {
            assert!(!is_blocked_ip(s.parse().unwrap()), "{s} should be allowed");
        }
    }

    #[test]
    fn url_validation() {
        assert!(validate_url("https://example.com/a#frag").unwrap().fragment().is_none());
        for bad in ["ftp://example.com", "http://localhost:3000", "http://foo.local/", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "not a url", "http://192.168.1.1/"] {
            assert!(validate_url(bad).is_err(), "{bad}");
        }
    }

    const HTML: &str = r##"<html><head><style>.x{}</style><script>var a=1;</script></head><body>
      <header><a href="/home">Home</a></header>
      <div id="list"><p>First   item</p><p>Second item</p><a href="files/r.pdf">Report</a>
        <a href="mailto:a@b.c">mail</a><a href="#top">top</a><svg><text>ICON</text></svg></div>
      <div class="other"><p>Unrelated</p></div></body></html>"##;

    #[test]
    fn extracts_whole_page() {
        let c = extract_content(HTML, None, "https://a.org/news/").unwrap();
        assert!(c.text.contains("First item Second item"));
        assert!(!c.text.contains("var a"));
        assert!(!c.text.contains("ICON"));
        assert!(c.text.contains("Unrelated"));
        let hrefs: Vec<_> = c.links.iter().map(|l| l.href.as_str()).collect();
        assert_eq!(hrefs, vec!["https://a.org/home", "https://a.org/news/files/r.pdf"]);
        assert_eq!(c.hash.len(), 64);
    }

    #[test]
    fn extracts_with_selector() {
        let c = extract_content(HTML, Some("#list"), "https://a.org/news/").unwrap();
        assert!(c.text.contains("Second item"));
        assert!(!c.text.contains("Unrelated"));
        assert_eq!(c.links.len(), 1);
        assert_eq!(c.lines[0], "First item");
        assert!(extract_content(HTML, Some(".nope"), "https://a.org/").unwrap_err().contains("matched nothing"));
        assert!(extract_content(HTML, Some("##bad"), "https://a.org/").unwrap_err().contains("Invalid CSS"));
    }
}
