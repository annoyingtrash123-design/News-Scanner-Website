//! Fetch + check logic and the bounded-concurrency run loop.
use crate::core::*;
use crate::errors::*;
use crate::mailer;
use crate::store::{App, Event, Watch, WatchState};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// At most this many pages are fetched at once.
pub const MAX_CONCURRENT: usize = 4;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_ACCEPT: &str = "text/html,application/xhtml+xml,*/*;q=0.8";
const FEED_ACCEPT: &str = "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8";
const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_STORED_LINES: usize = 1000;
const MAX_LINKS: usize = 1500;

pub fn build_client() -> reqwest::Client {
    let b = reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .gzip(true);
    // Windows/macOS: use the OS certificate store and TLS stack (fetches missing intermediate
    // certificates, supports older servers). Linux keeps rustls.
    #[cfg(any(windows, target_os = "macos"))]
    let b = b.use_native_tls();
    b.build().expect("http client")
}

/// Validate URL and make sure the host resolves only to public addresses.
async fn assert_public(url: &str) -> Result<url::Url, FetchError> {
    let u = validate_url(url).map_err(|e| FetchError::new(ErrorKind::Other, e))?;
    if let Some(url::Host::Domain(d)) = u.host() {
        let port = u.port_or_known_default().unwrap_or(80);
        let addrs: Vec<_> = tokio::net::lookup_host((d, port))
            .await
            .map_err(|e| FetchError::new(ErrorKind::Dns, format!("DNS lookup failed for {d}: {e}")))?
            .collect();
        if addrs.is_empty() {
            return Err(FetchError::new(ErrorKind::Dns, format!("DNS lookup failed for {d}")));
        }
        if addrs.iter().any(|a| is_blocked_ip(a.ip())) {
            return Err(FetchError::new(ErrorKind::Other, "Host resolves to a disallowed address"));
        }
    }
    Ok(u)
}

/// Full source chain of an error, for classification.
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur: &dyn std::error::Error = e;
    while let Some(s) = cur.source() {
        out.push_str(": ");
        out.push_str(&s.to_string());
        cur = s;
    }
    out
}

fn looks_complete(body: &[u8]) -> bool {
    let tail = &body[body.len().saturating_sub(2048)..];
    String::from_utf8_lossy(tail).to_ascii_lowercase().contains("</html")
}

/// One GET attempt with manual redirects (each hop SSRF-checked). Returns (body, final_url, content_type).
async fn fetch_once(client: &reqwest::Client, url: &str, feed: bool) -> Result<(String, String, String), FetchError> {
    let mut current = url.to_string();
    for _ in 0..6 {
        let u = assert_public(&current).await?;
        let mut res = client
            .get(u.clone())
            .header("Accept", if feed { FEED_ACCEPT } else { PAGE_ACCEPT })
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    FetchError::new(ErrorKind::Timeout, format!("Timed out after {TIMEOUT_SECS}s"))
                } else {
                    FetchError::from_message(format!("Request failed: {}", root_cause(&e)), &error_chain(&e))
                }
            })?;
        let status = res.status();
        let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        if status.is_redirection() {
            if let Some(loc) = res.headers().get("location").and_then(|v| v.to_str().ok()) {
                current = u.join(loc).map_err(|_| FetchError::new(ErrorKind::Other, "Bad redirect"))?.to_string();
                continue;
            }
        }
        if !status.is_success() {
            let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(parse_retry_after);
            return Err(FetchError::http(status.as_u16(), retry_after));
        }
        // Read the body in chunks so that a server closing the TLS connection without
        // close_notify after sending the whole page still counts as success.
        let mut bytes: Vec<u8> = Vec::new();
        loop {
            match res.chunk().await {
                Ok(Some(c)) => {
                    bytes.extend_from_slice(&c);
                    if bytes.len() > MAX_BYTES {
                        return Err(FetchError::new(ErrorKind::Other, "Page too large"));
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    if e.is_timeout() {
                        return Err(FetchError::new(ErrorKind::Timeout, format!("Timed out after {TIMEOUT_SECS}s")));
                    }
                    let chain = error_chain(&e);
                    if chain.contains("close_notify") && looks_complete(&bytes) {
                        break;
                    }
                    return Err(FetchError::from_message(format!("Read failed: {}", root_cause(&e)), &chain));
                }
            }
        }
        return Ok((String::from_utf8_lossy(&bytes).into_owned(), current, content_type));
    }
    Err(FetchError::new(ErrorKind::Other, "Too many redirects"))
}

/// Fetch with at most one retry of a transient failure (see `errors::retry_delay`).
/// Runs inside the caller's per-host slot, so the retry never overlaps another request to the host.
pub async fn fetch_page(client: &reqwest::Client, url: &str, feed: bool) -> Result<(String, String, String), FetchError> {
    match fetch_once(client, url, feed).await {
        Err(e) => match retry_delay(&e) {
            Some(wait) => {
                tokio::time::sleep(wait).await;
                fetch_once(client, url, feed).await.map_err(|mut e2| {
                    e2.attempts = 2;
                    e2
                })
            }
            None => Err(e),
        },
        ok => ok,
    }
}

fn root_cause(e: &dyn std::error::Error) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(s) = cur.source() {
        cur = s;
    }
    cur.to_string()
}

/// True if the page title is a known bot-challenge interstitial.
pub fn is_challenge_page(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let Some(i) = lower.find("<title") else { return false };
    let rest = &lower[i..];
    let end = rest.find("</title").unwrap_or(rest.len().min(300));
    let title = &rest[..end];
    title.contains("just a moment") || title.contains("attention required")
}

pub struct Outcome {
    pub entry: WatchState,
    pub event: Option<Event>,
    pub diff: Option<Diff>,
}

/// Pure part of a check: compare a freshly fetched page or feed against the previous state.
/// `body` is the page HTML or feed XML; feeds are detected by `content_type` or root element.
pub fn process(watch: &Watch, prev: &WatchState, body: &str, final_url: &str, content_type: &str, now: &str) -> Result<Outcome, String> {
    let content = if crate::feed::is_feed(content_type, body) {
        crate::feed::feed_content(body, final_url)?
    } else {
        let sel = (!watch.selector.trim().is_empty()).then_some(watch.selector.as_str());
        let c = extract_content(body, sel, final_url)?;
        if c.text.is_empty() {
            return Err("No text found on page".into());
        }
        c
    };
    let source = watch.source_url().to_string();
    // State saved before `source_url` existed always came from the page URL.
    let prev_source = prev.source_url.clone().or_else(|| prev.last_hash.as_ref().map(|_| watch.url.clone()));
    let new_source = prev_source.as_deref().is_some_and(|p| p != source);
    let lines: Vec<String> = content.lines.iter().take(MAX_STORED_LINES).cloned().collect();
    let links: Vec<Link> = content.links.iter().take(MAX_LINKS).cloned().collect();
    let mut entry = prev.clone();
    entry.last_checked = Some(now.into());
    entry.last_status = Some("ok".into());
    entry.last_error = None;
    entry.error_kind = None;
    entry.error_message = None;
    entry.last_hash = Some(content.hash.clone());
    entry.source_url = Some(source);
    entry.lines = lines.clone();
    entry.links = links.clone();

    if new_source {
        return Ok(Outcome { entry, event: None, diff: None }); // fetched source changed: new baseline, no event
    }
    match &prev.last_hash {
        None => return Ok(Outcome { entry, event: None, diff: None }), // baseline
        Some(h) if *h == content.hash => return Ok(Outcome { entry, event: None, diff: None }),
        _ => {}
    }
    let diff = compute_diff(&prev.lines, &prev.links, &lines, &links, 20);
    if watch.documents_only && diff.new_documents.is_empty() {
        return Ok(Outcome { entry, event: None, diff: Some(diff) }); // stored, but no alert
    }
    if diff.new_documents.is_empty() && diff.new_links.is_empty() && diff.added_text.is_empty() {
        return Ok(Outcome { entry, event: None, diff: Some(diff) }); // only noise (dates, counters...)
    }
    entry.last_changed = Some(now.into());
    let event = Event {
        watch_id: watch.id.clone(),
        url: watch.url.clone(),
        label: watch.label.clone(),
        at: now.into(),
        summary: summarize_diff(&diff),
        new_documents: diff.new_documents.clone(),
        new_links: diff.new_links.clone(),
        added_text: diff.added_text.clone(),
        matched_topics: Vec::new(),
        matched_companies: Vec::new(),
        matched_focus: Vec::new(),
        relevance: String::new(),
        item_matches: Vec::new(),
        kw_version: 0,
    };
    let mut event = event;
    crate::keywords::apply(&mut event);
    Ok(Outcome { entry, event: Some(event), diff: Some(diff) })
}

pub fn now_string() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Check one watch. Never fails: errors are recorded in the state entry.
pub async fn check_watch(client: &reqwest::Client, watch: &Watch, prev: &WatchState) -> Outcome {
    let now = now_string();
    let is_feed_src = watch.source_url() != watch.url;
    let res = match fetch_page(client, watch.source_url(), is_feed_src).await {
        Ok((body, _, ct)) if !crate::feed::is_feed(&ct, &body) && is_challenge_page(&body) => Err(FetchError::challenge()),
        Ok((body, final_url, ct)) => process(watch, prev, &body, &final_url, &ct, &now).map_err(|m| FetchError::from_process(&m)),
        Err(e) => Err(e),
    };
    res.unwrap_or_else(|e| {
        let mut entry = prev.clone();
        entry.last_checked = Some(now);
        entry.last_status = Some("error".into());
        entry.error_kind = Some(e.kind.as_str().into());
        entry.error_message = Some(friendly(&e));
        entry.last_error = Some(e.raw);
        Outcome { entry, event: None, diff: None }
    })
}

/// Run `f` over every item with at most `limit` running at once and at most one at a time
/// per host key. Returns when all are finished.
pub async fn for_each_bounded<I, F, Fut>(items: Vec<(String, I)>, limit: usize, f: F)
where
    I: Send + 'static,
    F: Fn(I) -> Fut + Clone + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let global = Arc::new(Semaphore::new(limit.max(1)));
    let mut hosts: HashMap<String, Arc<Semaphore>> = HashMap::new();
    let mut set = JoinSet::new();
    for (host, item) in items {
        let host_sem = hosts.entry(host).or_insert_with(|| Arc::new(Semaphore::new(1))).clone();
        let global = global.clone();
        let f = f.clone();
        set.spawn(async move {
            // Host first, so a task queued behind a busy host never hogs a global slot.
            let _h = host_sem.acquire_owned().await;
            let _g = global.acquire_owned().await;
            f(item).await;
        });
    }
    while set.join_next().await.is_some() {}
}

fn host_key(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase())).unwrap_or_default()
}

async fn check_and_store(app: &App, w: Watch) {
    let prev = app.read(|d| d.state.get(&w.id).cloned()).unwrap_or_default();
    let out = check_watch(&app.client, &w, &prev).await;
    let kept = app.with_data(|d| {
        if !d.watches.iter().any(|x| x.id == w.id) {
            return false; // removed while checking
        }
        d.state.insert(w.id.clone(), out.entry.clone());
        if let Some(ev) = &out.event {
            d.events.insert(0, ev.clone());
            d.events.truncate(300);
        }
        true
    });
    if !kept {
        return;
    }
    if let (Some(ev), Some(diff)) = (&out.event, &out.diff) {
        let settings = app.read(|d| d.settings.clone());
        // Email is optional: stay silent when it is not configured.
        if !settings.notify_email.trim().is_empty() && mailer::smtp_configured(&settings) {
            let mail = mailer::build_change_email(&w, diff, &ev.at);
            match mailer::send_mail(&settings, &settings.notify_email, mail).await {
                Ok(()) => println!("Emailed update for {}", w.url),
                Err(e) => eprintln!("Could not send email for {}: {e}", w.url),
            }
        }
    }
}

/// Check the given watches (or all) with bounded concurrency. Runs never overlap.
pub async fn run_checks(app: &App, only: Option<Vec<String>>) {
    let _guard = app.run_lock.lock().await;
    let full = only.is_none();
    let watches: Vec<Watch> = app.read(|d| {
        d.watches.iter().filter(|w| only.as_ref().map_or(true, |ids| ids.contains(&w.id))).cloned().collect()
    });
    if full {
        let st = crate::store::RunStatus {
            running: true,
            done: 0,
            total: watches.len(),
            started_at: Some(now_string()),
            finished_at: None,
        };
        *app.status.lock().unwrap_or_else(|e| e.into_inner()) = st.clone();
        app.with_data(|d| d.last_run = Some(st));
    }
    let items: Vec<(String, Watch)> = watches.into_iter().map(|w| (host_key(w.source_url()), w)).collect();
    let app2 = app.clone();
    for_each_bounded(items, MAX_CONCURRENT, move |w| {
        let app = app2.clone();
        async move {
            check_and_store(&app, w).await;
            if full {
                app.status.lock().unwrap_or_else(|e| e.into_inner()).done += 1;
            }
        }
    })
    .await;
    if full {
        let st = {
            let mut st = app.status.lock().unwrap_or_else(|e| e.into_inner());
            st.running = false;
            st.finished_at = Some(now_string());
            st.clone()
        };
        app.with_data(|d| d.last_run = Some(st));
    }
}

/// Background scheduler: full check shortly after launch, then every configured interval.
pub async fn scheduler(app: App) {
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    loop {
        run_checks(&app, None).await;
        let started = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
            let mins = app.read(|d| d.settings.interval_minutes).max(1) as u64;
            if started.elapsed() >= std::time::Duration::from_secs(mins * 60) {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(docs_only: bool) -> Watch {
        Watch { id: "w1".into(), url: "https://a.org/news".into(), label: "A".into(), selector: String::new(), documents_only: docs_only, category: String::new(), feed_url: None, created_at: "t".into() }
    }
    const P1: &str = "<body><p>Hello world.</p><a href='/a.pdf'>A</a></body>";
    const P2: &str = "<body><p>Hello world. Something new here.</p><a href='/a.pdf'>A</a><a href='/b.pdf'>B</a></body>";
    const P3: &str = "<body><p>Hello world. Only text changed.</p><a href='/a.pdf'>A</a></body>";

    #[test]
    fn baseline_then_change() {
        let w = watch(false);
        let base = process(&w, &WatchState::default(), P1, &w.url, "text/html", "t1").unwrap();
        assert!(base.event.is_none());
        let same = process(&w, &base.entry, P1, &w.url, "text/html", "t2").unwrap();
        assert!(same.event.is_none());
        let ch = process(&w, &base.entry, P2, &w.url, "text/html", "t3").unwrap();
        let ev = ch.event.unwrap();
        assert_eq!(ev.new_documents.len(), 1);
        assert_eq!(ev.new_documents[0].href, "https://a.org/b.pdf");
        assert_eq!(ch.entry.last_changed.as_deref(), Some("t3"));
    }

    #[test]
    fn documents_only_gating() {
        let w = watch(true);
        let base = process(&w, &WatchState::default(), P1, &w.url, "text/html", "t1").unwrap();
        let text_only = process(&w, &base.entry, P3, &w.url, "text/html", "t2").unwrap();
        assert!(text_only.event.is_none());
        assert!(text_only.entry.last_changed.is_none());
        assert_ne!(text_only.entry.last_hash, base.entry.last_hash); // state still advances
        let with_doc = process(&w, &base.entry, P2, &w.url, "text/html", "t3").unwrap();
        assert!(with_doc.event.is_some());
    }

    #[test]
    fn noise_only_change_makes_no_event_but_updates_state() {
        let w = watch(false);
        let a = "<body><p>Hello world, this is a long enough sentence.</p><p>Updated 3 minutes ago</p></body>";
        let b = "<body><p>Hello world, this is a long enough sentence.</p><p>Updated 9 minutes ago</p><p>Monday, 12 March 2025</p></body>";
        let base = process(&w, &WatchState::default(), a, &w.url, "text/html", "t1").unwrap();
        let ch = process(&w, &base.entry, b, &w.url, "text/html", "t2").unwrap();
        assert!(ch.event.is_none());
        assert!(ch.entry.last_changed.is_none());
        assert_ne!(ch.entry.last_hash, base.entry.last_hash);
        assert!(ch.entry.lines.iter().any(|l| l.contains("9 minutes")));
        // meaningful text does create an event
        let c = "<body><p>Hello world, this is a long enough sentence.</p><p>Minister announces a brand new funding program</p></body>";
        let ev = process(&w, &ch.entry, c, &w.url, "text/html", "t3").unwrap().event.unwrap();
        assert_eq!(ev.added_text.len(), 1);
    }

    #[tokio::test]
    async fn bounded_concurrency_global_and_per_host() {
        use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
        let total = Arc::new(AtomicUsize::new(0));
        let max_total = Arc::new(AtomicUsize::new(0));
        let per: Arc<HashMap<String, (AtomicUsize, AtomicUsize)>> = Arc::new(
            ["a", "b", "c"].iter().map(|h| (h.to_string(), (AtomicUsize::new(0), AtomicUsize::new(0)))).collect(),
        );
        let done = Arc::new(AtomicUsize::new(0));
        let items: Vec<(String, String)> = (0..18).map(|i| { let h = ["a", "b", "c"][i % 3].to_string(); (h.clone(), h) }).collect();
        let (t, mt, p, d) = (total.clone(), max_total.clone(), per.clone(), done.clone());
        for_each_bounded(items, 4, move |h| {
            let (t, mt, p, d) = (t.clone(), mt.clone(), p.clone(), d.clone());
            async move {
                let n = t.fetch_add(1, SeqCst) + 1;
                mt.fetch_max(n, SeqCst);
                let (cur, max) = &p[&h];
                let c = cur.fetch_add(1, SeqCst) + 1;
                max.fetch_max(c, SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                cur.fetch_sub(1, SeqCst);
                t.fetch_sub(1, SeqCst);
                d.fetch_add(1, SeqCst);
            }
        })
        .await;
        assert_eq!(done.load(SeqCst), 18);
        assert!(max_total.load(SeqCst) <= 4);
        assert!(max_total.load(SeqCst) >= 2, "should run in parallel across hosts");
        for (_, (_, max)) in per.iter() {
            assert_eq!(max.load(SeqCst), 1, "never two at once on one host");
        }
    }

    #[test]
    fn new_events_are_scored() {
        let w = watch(false);
        let base = process(&w, &WatchState::default(), P1, &w.url, "text/html", "t1").unwrap();
        let p = "<body><p>Hello world.</p><a href='/a.pdf'>A</a><a href='/news/1'>China tightens rare earth export controls</a><a href='/news/2'>Local council approves bike lane</a></body>";
        let ev = process(&w, &base.entry, p, &w.url, "text/html", "t2").unwrap().event.unwrap();
        assert_eq!(ev.relevance, "high");
        assert_eq!(ev.kw_version, crate::keywords::KW_VERSION);
        assert!(ev.matched_topics.contains(&"Rare earths".to_string()));
        let m = ev.item_matches.iter().find(|m| m.kind == "link").unwrap();
        assert_eq!(ev.new_links[m.index].text, "China tightens rare earth export controls");
        assert!(ev.item_matches.iter().all(|m| m.kind != "link" || m.index == 0 || ev.new_links[m.index].text.contains("rare earth")));
    }

    #[test]
    fn challenge_pages_and_complete_bodies() {
        assert!(is_challenge_page("<html><head><title>Just a moment...</title></head>"));
        assert!(is_challenge_page("<TITLE>Attention Required! | Cloudflare</TITLE>"));
        assert!(!is_challenge_page("<html><title>Ministry news</title><body>just a moment of silence</body>"));
        assert!(looks_complete(b"<html><body>x</body></HTML>\n"));
        assert!(!looks_complete(b"<html><body>x"));
    }

    const FEED1: &str = r#"<?xml version="1.0"?><rss version="2.0"><channel><title>N</title><lastBuildDate>Mon, 02 Nov 2026 01:00:00 GMT</lastBuildDate>
<item><title>China tightens rare earth export controls</title><link>https://a.org/news/1</link><guid>g1</guid><description>&lt;p&gt;Beijing announced new limits.&lt;/p&gt;</description></item></channel></rss>"#;

    fn feed_watch() -> Watch {
        let mut w = watch(false);
        w.feed_url = Some("https://a.org/feed/".into());
        w
    }

    #[test]
    fn feed_build_date_alone_is_not_a_change() {
        let w = feed_watch();
        let base = process(&w, &WatchState::default(), FEED1, "https://a.org/feed/", "application/rss+xml", "t1").unwrap();
        assert!(base.event.is_none());
        assert_eq!(base.entry.source_url.as_deref(), Some("https://a.org/feed/"));
        let bumped = FEED1.replace("01:00:00 GMT", "07:45:00 GMT");
        let same = process(&w, &base.entry, &bumped, "https://a.org/feed/", "application/rss+xml", "t2").unwrap();
        assert!(same.event.is_none());
        assert_eq!(same.entry.last_hash, base.entry.last_hash);
        assert!(same.entry.last_changed.is_none());
    }

    #[test]
    fn new_feed_item_is_an_event_with_a_new_link() {
        let w = feed_watch();
        let base = process(&w, &WatchState::default(), FEED1, "https://a.org/feed/", "text/xml", "t1").unwrap();
        let two = FEED1.replace("</channel>", "<item><title>Lynas signs heavy rare earths offtake</title><link>/news/2</link><guid>g2</guid></item><item><title>Annual report</title><link>https://a.org/r.pdf</link><guid>g3</guid></item></channel>");
        let ev = process(&w, &base.entry, &two, "https://a.org/feed/", "text/xml", "t2").unwrap().event.unwrap();
        assert_eq!(ev.new_links.len(), 1);
        assert_eq!(ev.new_links[0], Link { href: "https://a.org/news/2".into(), text: "Lynas signs heavy rare earths offtake".into() });
        assert_eq!(ev.new_documents.len(), 1); // document links in feeds still count as documents
        assert_eq!(ev.new_documents[0].ext, "pdf");
        assert_eq!(ev.url, "https://a.org/news"); // the event points at the site, not the feed
        assert_eq!(ev.relevance, "high"); // scoring works on feed titles
    }

    #[test]
    fn plain_url_that_returns_a_feed_is_parsed_as_a_feed() {
        let w = watch(false);
        let base = process(&w, &WatchState::default(), FEED1, &w.url, "text/html", "t1").unwrap();
        assert_eq!(base.entry.links.len(), 1);
        assert_eq!(base.entry.links[0].href, "https://a.org/news/1");
    }

    #[test]
    fn malformed_feed_is_an_error() {
        let w = feed_watch();
        let e = process(&w, &WatchState::default(), "<rss><channel><item><title>x", "https://a.org/feed/", "application/rss+xml", "t").err().unwrap();
        assert_eq!(e, "Feed could not be read");
        assert_eq!(FetchError::from_process(&e).kind.as_str(), "other");
    }

    #[test]
    fn switching_source_is_a_new_baseline() {
        let w = watch(false);
        let base = process(&w, &WatchState::default(), P1, &w.url, "text/html", "t1").unwrap();
        assert_eq!(base.entry.source_url.as_deref(), Some("https://a.org/news"));
        // page -> feed: different content, but no event; stored as the new baseline
        let fw = feed_watch();
        let sw = process(&fw, &base.entry, FEED1, "https://a.org/feed/", "application/rss+xml", "t2").unwrap();
        assert!(sw.event.is_none());
        assert!(sw.entry.last_changed.is_none());
        assert_eq!(sw.entry.source_url.as_deref(), Some("https://a.org/feed/"));
        // next change on the feed is reported normally
        let two = FEED1.replace("</channel>", "<item><title>New offtake announced by Lynas</title><link>/news/9</link><guid>g9</guid></item></channel>");
        assert!(process(&fw, &sw.entry, &two, "https://a.org/feed/", "application/rss+xml", "t3").unwrap().event.is_some());
        // state saved before source_url existed counts as coming from the page URL
        let mut legacy = base.entry.clone();
        legacy.source_url = None;
        assert!(process(&w, &legacy, P2, &w.url, "text/html", "t4").unwrap().event.is_some());
        assert!(process(&fw, &legacy, FEED1, "https://a.org/feed/", "application/rss+xml", "t4").unwrap().event.is_none());
    }

    #[test]
    fn selector_errors() {
        let mut w = watch(false);
        w.selector = ".missing".into();
        assert!(process(&w, &WatchState::default(), P1, &w.url, "text/html", "t").is_err());
    }
}
