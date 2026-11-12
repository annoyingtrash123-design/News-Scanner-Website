//! RSS 2.0 / Atom / RSS 1.0 (RDF) feed detection and parsing, mapped into the page content model.
//! Mirrored by the feed functions in extension/lib.js; keep the two in step.
use crate::core::{normalize, sha256_hex, Content, Link};
use quick_xml::events::Event;
use quick_xml::Reader;
use url::Url;

/// The message shown for anything that is not a readable feed.
pub const FEED_ERROR: &str = "Feed could not be read";
const MAX_ITEMS: usize = 200;
const MAX_DESC_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct FeedItem {
    pub id: String,
    pub title: String,
    pub link: String,
    pub published: String,
    pub summary: String,
}

// ---------- detection ----------

/// Local name of the first element, skipping the XML declaration, comments, doctype and a BOM.
pub fn sniff_root(body: &str) -> Option<String> {
    let mut s = body.trim_start_matches('\u{feff}').trim_start();
    loop {
        if !s.starts_with('<') {
            return None;
        }
        if s.starts_with("<?") {
            s = s[s.find("?>")? + 2..].trim_start();
        } else if s.starts_with("<!--") {
            s = s[s.find("-->")? + 3..].trim_start();
        } else if s.starts_with("<!") {
            // <!DOCTYPE ...> possibly with an internal subset in [...]
            let end = match (s.find('['), s.find('>')) {
                (Some(b), Some(g)) if b < g => b + s[b..].find("]>")? + 2,
                (_, Some(g)) => g + 1,
                _ => return None,
            };
            s = s[end..].trim_start();
        } else {
            let rest = &s[1..];
            let end = rest.find(|c: char| c.is_whitespace() || c == '>' || c == '/')?;
            let name = &rest[..end];
            if name.is_empty() {
                return None;
            }
            return Some(name.rsplit(':').next().unwrap_or(name).to_string());
        }
    }
}

fn is_feed_root(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "rss" | "feed" | "rdf")
}

/// True if the response is a feed: by content type (rss / atom / generic xml, but not xhtml pages)
/// or by its root element (<rss>, <feed>, <rdf:RDF>).
pub fn is_feed(content_type: &str, body: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("rss") || ct.contains("atom") {
        return true;
    }
    let root = sniff_root(body);
    if root.as_deref().is_some_and(is_feed_root) {
        return true;
    }
    ct.contains("xml") && !ct.contains("xhtml") && !root.is_some_and(|r| r.eq_ignore_ascii_case("html"))
}

// ---------- tiny XML tree ----------

#[derive(Debug, Default)]
struct El {
    /// Local name (prefix removed), as DOMParser's localName.
    name: String,
    /// Qualified name as written.
    qname: String,
    attrs: Vec<(String, String)>,
    kids: Vec<Node>,
}
#[derive(Debug)]
enum Node {
    El(El),
    Text(String),
}

impl El {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn text(&self) -> String {
        let mut out = String::new();
        fn go(e: &El, out: &mut String) {
            for k in &e.kids {
                match k {
                    Node::Text(t) => out.push_str(t),
                    Node::El(c) => go(c, out),
                }
            }
        }
        go(self, &mut out);
        out
    }
    fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a El> {
        self.kids.iter().filter_map(move |k| match k {
            Node::El(e) if e.name == name => Some(e),
            _ => None,
        })
    }
}

fn local(q: &str) -> String {
    q.rsplit(':').next().unwrap_or(q).to_string()
}

fn parse_xml(xml: &str) -> Result<El, String> {
    let mut reader = Reader::from_str(xml);
    let mut stack: Vec<El> = Vec::new();
    let mut root: Option<El> = None;
    let make = |e: &quick_xml::events::BytesStart| -> Result<El, String> {
        let qname = String::from_utf8_lossy(e.name().as_ref()).into_owned();
        let mut attrs = Vec::new();
        for a in e.attributes() {
            let a = a.map_err(|e| e.to_string())?;
            let k = String::from_utf8_lossy(a.key.as_ref()).into_owned();
            let v = a.unescape_value().map(|c| c.into_owned()).unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
            attrs.push((k, v));
        }
        Ok(El { name: local(&qname), qname, attrs, kids: Vec::new() })
    };
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) => stack.push(make(&e)?),
            Event::Empty(e) => {
                let el = make(&e)?;
                match stack.last_mut() {
                    Some(p) => p.kids.push(Node::El(el)),
                    None if root.is_none() => root = Some(el),
                    None => return Err("multiple roots".into()),
                }
            }
            Event::End(_) => {
                let el = stack.pop().ok_or("unbalanced end tag")?;
                match stack.last_mut() {
                    Some(p) => p.kids.push(Node::El(el)),
                    None if root.is_none() => root = Some(el),
                    None => return Err("multiple roots".into()),
                }
            }
            Event::Text(t) => {
                // Unknown entities (e.g. &nbsp;) are kept as written; clean_text decodes the common ones.
                let s = t.unescape().map(|c| c.into_owned()).unwrap_or_else(|_| String::from_utf8_lossy(&t).into_owned());
                if let Some(p) = stack.last_mut() {
                    p.kids.push(Node::Text(s));
                }
            }
            Event::CData(c) => {
                if let Some(p) = stack.last_mut() {
                    p.kids.push(Node::Text(String::from_utf8_lossy(&c).into_owned()));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("unclosed element".into());
    }
    root.ok_or_else(|| "no root element".into())
}

// ---------- text cleanup ----------

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let decoded = tail.find(';').filter(|&e| e <= 10).and_then(|e| {
            let name = &tail[1..e];
            let ch = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                "ndash" => Some('\u{2013}'),
                "mdash" => Some('\u{2014}'),
                "hellip" => Some('\u{2026}'),
                "rsquo" => Some('\u{2019}'),
                "lsquo" => Some('\u{2018}'),
                "rdquo" => Some('\u{201d}'),
                "ldquo" => Some('\u{201c}'),
                _ => name.strip_prefix('#').and_then(|n| {
                    let code = match n.strip_prefix(['x', 'X']) {
                        Some(h) => u32::from_str_radix(h, 16).ok(),
                        None => n.parse().ok(),
                    };
                    code.and_then(char::from_u32)
                }),
            };
            ch.map(|c| (c, e + 1))
        });
        match decoded {
            Some((c, used)) => {
                out.push(c);
                rest = &tail[used..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

const BLOCK_TAGS: [&str; 16] = ["p", "br", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "table", "blockquote"];

/// Remove HTML tags (block-level tags become spaces), decode common entities, collapse whitespace.
pub fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let next = tail[1..].chars().next();
        let tag_like = next.is_some_and(|c| c.is_ascii_alphabetic() || c == '/' || c == '!');
        match (tag_like, tail.find('>')) {
            (true, Some(end)) => {
                let inner = tail[1..end].trim_start_matches('/');
                let name: String = inner.chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
                if BLOCK_TAGS.contains(&name.as_str()) {
                    out.push(' ');
                }
                rest = &tail[end + 1..];
            }
            _ => {
                out.push('<');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    normalize(&decode_entities(&out))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max - 3).collect();
        format!("{}...", t.trim_end())
    }
}

// ---------- parsing ----------

fn collect_items<'a>(e: &'a El, out: &mut Vec<&'a El>) {
    for k in &e.kids {
        if let Node::El(c) = k {
            if c.name == "item" || c.name == "entry" {
                out.push(c);
            } else {
                collect_items(c, out);
            }
        }
    }
}

fn first_text(item: &El, names: &[&str]) -> String {
    for n in names {
        for c in item.children(n) {
            let t = c.text();
            if !t.trim().is_empty() {
                return t.trim().to_string();
            }
        }
    }
    String::new()
}

fn resolve(base: Option<&Url>, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    let u = match base {
        Some(b) => b.join(href).ok()?,
        None => Url::parse(href).ok()?,
    };
    matches!(u.scheme(), "http" | "https").then(|| u.to_string())
}

fn item_link(item: &El, base: Option<&Url>) -> Option<String> {
    // Atom: <link href>, preferring rel=alternate (or no rel); skip self/edit/enclosure/etc. unless nothing else.
    let mut fallback: Option<String> = None;
    for l in item.children("link") {
        if let Some(h) = l.attr("href") {
            let rel = l.attr("rel").unwrap_or("alternate");
            if rel == "alternate" {
                if let Some(u) = resolve(base, h) {
                    return Some(u);
                }
            } else if !matches!(rel, "self" | "edit" | "replies" | "enclosure" | "related") && fallback.is_none() {
                fallback = resolve(base, h);
            }
        } else if l.qname == "link" {
            // RSS: <link>text</link>
            if let Some(u) = resolve(base, &l.text()) {
                return Some(u);
            }
        }
    }
    if fallback.is_some() {
        return fallback;
    }
    // RSS: a permalink guid.
    for g in item.children("guid") {
        if g.attr("isPermaLink") != Some("false") {
            if let Some(u) = resolve(base, &g.text()) {
                return Some(u);
            }
        }
    }
    // RSS 1.0: rdf:about on the item.
    item.attr("rdf:about").and_then(|a| resolve(base, a))
}

/// Parse an RSS 2.0, Atom or RSS 1.0 document. Relative links are resolved against `base`.
pub fn parse_feed(xml: &str, base: &str) -> Result<Vec<FeedItem>, String> {
    let root = parse_xml(xml.trim_start_matches('\u{feff}')).map_err(|_| FEED_ERROR.to_string())?;
    if !is_feed_root(&root.name) {
        return Err(FEED_ERROR.into());
    }
    let base = Url::parse(base).ok();
    let mut found = Vec::new();
    collect_items(&root, &mut found);
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for it in found {
        let title = strip_html(&first_text(it, &["title"]));
        let link = item_link(it, base.as_ref()).unwrap_or_default();
        let id = first_text(it, &["guid", "id"]);
        let summary = truncate(&strip_html(&first_text(it, &["description", "summary", "encoded", "content"])), MAX_DESC_CHARS);
        if title.is_empty() && link.is_empty() {
            continue;
        }
        let key = if !id.is_empty() { id.clone() } else if !link.is_empty() { link.clone() } else { title.clone() };
        if !seen.insert(key) {
            continue;
        }
        let published = first_text(it, &["pubDate", "updated", "published", "date"]);
        items.push(FeedItem { id, title, link, published, summary });
        if items.len() >= MAX_ITEMS {
            break;
        }
    }
    if items.is_empty() {
        return Err(FEED_ERROR.into());
    }
    Ok(items)
}

/// Map a feed into the page content model. The hash covers only the item list (ids/links + titles),
/// so feed metadata such as <lastBuildDate> never counts as a change.
pub fn feed_content(xml: &str, base: &str) -> Result<Content, String> {
    let items = parse_feed(xml, base)?;
    let mut lines = Vec::new();
    let mut links: Vec<Link> = Vec::new();
    let mut hash_src = String::new();
    for it in &items {
        if !it.title.is_empty() {
            lines.push(it.title.clone());
        }
        if !it.summary.is_empty() {
            lines.push(it.summary.clone());
        }
        if !it.link.is_empty() && !links.iter().any(|l| l.href == it.link) {
            links.push(Link { href: it.link.clone(), text: it.title.chars().take(200).collect() });
        }
        let key = if !it.id.is_empty() { &it.id } else { &it.link };
        hash_src.push_str(&format!("{key}\t{}\n", it.title));
    }
    let text = normalize(&lines.join(" "));
    Ok(Content { text, lines, links, hash: sha256_hex(&hash_src) })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const RSS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>Mining News</title><link>https://a.org/</link><lastBuildDate>Mon, 02 Nov 2026 01:00:00 +0000</lastBuildDate>
<atom:link href="https://a.org/feed/" rel="self" type="application/rss+xml"/>
<item><title><![CDATA[Lithium &amp; rare earths: Lynas expands]]></title><link>https://a.org/news/lynas</link><guid isPermaLink="false">a-1</guid><pubDate>Mon, 02 Nov 2026 00:00:00 +0000</pubDate>
<description><![CDATA[<p>Lynas will <b>double</b> output.</p><p>More&nbsp;soon.</p>]]></description></item>
<item><title>Annual report</title><link>/files/report.pdf</link><guid>https://a.org/files/report.pdf</guid><description>Escaped &lt;i&gt;html&lt;/i&gt; here &amp;amp; there</description></item>
<item><title>Guid only</title><guid isPermaLink="true">https://a.org/news/guid-only</guid></item>
</channel></rss>"#;

    const ATOM: &str = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><updated>2026-11-02T00:00:00Z</updated>
<entry><title type="html">Export controls &lt;b&gt;tighten&lt;/b&gt;</title><id>tag:a.org,2026:1</id>
<link rel="self" href="https://a.org/atom/1"/><link rel="alternate" href="/news/controls"/><updated>2026-11-02T01:00:00Z</updated><summary>Short summary</summary></entry>
<entry><title>No alternate</title><id>tag:a.org,2026:2</id><link href="https://a.org/news/two"/></entry></feed>"#;

    const RDF: &str = r#"<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://a.org/"><title>R</title></channel>
<item rdf:about="https://a.org/rdf/1"><title>RDF one</title><link>https://a.org/rdf/1</link><description>Desc one</description><dc:date>2026-11-02</dc:date></item>
<item><title>RDF two</title><link>rdf/2</link></item></rdf:RDF>"#;

    #[test]
    fn detects_feeds() {
        assert!(is_feed("application/rss+xml; charset=utf-8", ""));
        assert!(is_feed("application/atom+xml", "garbage"));
        assert!(is_feed("text/xml", RSS));
        assert!(is_feed("text/html", RSS)); // plain URL that returns a feed
        assert!(is_feed("", ATOM));
        assert!(is_feed("text/html", "\u{feff}<!-- c --><rdf:RDF xmlns:rdf='x'></rdf:RDF>"));
        assert!(!is_feed("text/html", "<!DOCTYPE html><html><body>hi</body></html>"));
        assert!(!is_feed("application/xhtml+xml", "<html xmlns='x'><body/></html>"));
        assert!(is_feed("application/xml", "<oops")); // xml content type but unreadable: reported as a feed error
    }

    #[test]
    fn rss_items() {
        let items = parse_feed(RSS, "https://a.org/feed/").unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].title, "Lithium & rare earths: Lynas expands");
        assert_eq!(items[0].link, "https://a.org/news/lynas");
        assert_eq!(items[0].summary, "Lynas will double output. More soon.");
        assert_eq!(items[0].published, "Mon, 02 Nov 2026 00:00:00 +0000");
        assert_eq!(items[1].link, "https://a.org/files/report.pdf"); // relative link resolved
        assert_eq!(items[1].summary, "Escaped html here & there");
        assert_eq!(items[2].link, "https://a.org/news/guid-only"); // permalink guid
    }

    #[test]
    fn atom_items() {
        let items = parse_feed(ATOM, "https://a.org/atom").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Export controls tighten");
        assert_eq!(items[0].link, "https://a.org/news/controls"); // alternate preferred over self
        assert_eq!(items[0].id, "tag:a.org,2026:1");
        assert_eq!(items[0].published, "2026-11-02T01:00:00Z");
        assert_eq!(items[0].summary, "Short summary");
        assert_eq!(items[1].link, "https://a.org/news/two");
    }

    #[test]
    fn rdf_items() {
        let items = parse_feed(RDF, "https://a.org/index.rdf").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].summary, "Desc one");
        assert_eq!(items[0].published, "2026-11-02");
        assert_eq!(items[1].link, "https://a.org/rdf/2");
    }

    #[test]
    fn long_descriptions_are_truncated() {
        let xml = format!("<rss><channel><item><title>T</title><link>https://a.org/1</link><description>{}</description></item></channel></rss>", "word ".repeat(200));
        let items = parse_feed(&xml, "https://a.org/").unwrap();
        assert!(items[0].summary.chars().count() <= MAX_DESC_CHARS);
        assert!(items[0].summary.ends_with("..."));
    }

    #[test]
    fn malformed_or_wrong_documents_are_errors() {
        for bad in ["<rss><channel><item><title>x</rss>", "not xml at all", "", "<html><body>hi</body></html>", "<rss><channel></channel></rss>", "<rss></channel></rss>"] {
            assert_eq!(parse_feed(bad, "https://a.org/").unwrap_err(), FEED_ERROR, "{bad}");
        }
    }

    #[test]
    fn content_model() {
        let c = feed_content(RSS, "https://a.org/feed/").unwrap();
        assert_eq!(c.links.len(), 3);
        assert_eq!(c.links[0], Link { href: "https://a.org/news/lynas".into(), text: "Lithium & rare earths: Lynas expands".into() });
        assert!(c.lines.contains(&"Lynas will double output. More soon.".to_string()));
        assert!(c.lines.contains(&"Annual report".to_string()));
        assert!(!c.text.is_empty());
    }

    #[test]
    fn hash_ignores_feed_metadata_but_not_items() {
        let a = feed_content(RSS, "https://a.org/").unwrap().hash;
        let b = feed_content(&RSS.replace("01:00:00 +0000</lastBuildDate>", "09:30:00 +0000</lastBuildDate>"), "https://a.org/").unwrap().hash;
        assert_eq!(a, b);
        let c = feed_content(&RSS.replace("<title>Annual report</title>", "<title>Annual report 2</title>"), "https://a.org/").unwrap().hash;
        assert_ne!(a, c);
    }
}
