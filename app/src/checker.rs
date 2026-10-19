//! Fetch + check logic (port of checker.js) and the sequential run loop.
use crate::core::*;
use crate::mailer;
use crate::store::{App, Event, Watch, WatchState};

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_STORED_LINES: usize = 1000;
const MAX_LINKS: usize = 1500;

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .gzip(true)
        .build()
        .expect("http client")
}

/// Validate URL and make sure the host resolves only to public addresses.
async fn assert_public(url: &str) -> Result<url::Url, String> {
    let u = validate_url(url)?;
    if let Some(url::Host::Domain(d)) = u.host() {
        let port = u.port_or_known_default().unwrap_or(80);
        let addrs: Vec<_> = tokio::net::lookup_host((d, port))
            .await
            .map_err(|e| format!("DNS lookup failed for {d}: {e}"))?
            .collect();
        if addrs.is_empty() {
            return Err(format!("DNS lookup failed for {d}"));
        }
        if addrs.iter().any(|a| is_blocked_ip(a.ip())) {
            return Err("Host resolves to a disallowed address".into());
        }
    }
    Ok(u)
}

/// GET with manual redirects (each hop SSRF-checked). Returns (html, final_url).
pub async fn fetch_page(client: &reqwest::Client, url: &str) -> Result<(String, String), String> {
    let mut current = url.to_string();
    for _ in 0..6 {
        let u = assert_public(&current).await?;
        let res = client
            .get(u.clone())
            .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() { "Timed out after 20s".to_string() } else { format!("Request failed: {}", root_cause(&e)) }
            })?;
        let status = res.status();
        if status.is_redirection() {
            if let Some(loc) = res.headers().get("location").and_then(|v| v.to_str().ok()) {
                current = u.join(loc).map_err(|_| "Bad redirect".to_string())?.to_string();
                continue;
            }
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let bytes = res.bytes().await.map_err(|e| format!("Read failed: {}", root_cause(&e)))?;
        if bytes.len() > MAX_BYTES {
            return Err("Page too large".into());
        }
        return Ok((String::from_utf8_lossy(&bytes).into_owned(), current));
    }
    Err("Too many redirects".into())
}

fn root_cause(e: &dyn std::error::Error) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(s) = cur.source() {
        cur = s;
    }
    cur.to_string()
}

pub struct Outcome {
    pub entry: WatchState,
    pub event: Option<Event>,
    pub diff: Option<Diff>,
}

/// Pure part of a check: compare freshly fetched HTML against the previous state.
pub fn process(watch: &Watch, prev: &WatchState, html: &str, final_url: &str, now: &str) -> Result<Outcome, String> {
    let sel = (!watch.selector.trim().is_empty()).then_some(watch.selector.as_str());
    let content = extract_content(html, sel, final_url)?;
    if content.text.is_empty() {
        return Err("No text found on page".into());
    }
    let lines: Vec<String> = content.lines.iter().take(MAX_STORED_LINES).cloned().collect();
    let links: Vec<Link> = content.links.iter().take(MAX_LINKS).cloned().collect();
    let mut entry = prev.clone();
    entry.last_checked = Some(now.into());
    entry.last_status = Some("ok".into());
    entry.last_error = None;
    entry.last_hash = Some(content.hash.clone());
    entry.lines = lines.clone();
    entry.links = links.clone();

    match &prev.last_hash {
        None => return Ok(Outcome { entry, event: None, diff: None }), // baseline
        Some(h) if *h == content.hash => return Ok(Outcome { entry, event: None, diff: None }),
        _ => {}
    }
    let diff = compute_diff(&prev.lines, &prev.links, &lines, &links, 20);
    if watch.documents_only && diff.new_documents.is_empty() {
        return Ok(Outcome { entry, event: None, diff: Some(diff) }); // stored, but no alert
    }
    entry.last_changed = Some(now.into());
    let event = Event {
        watch_id: watch.id.clone(),
        url: watch.url.clone(),
        label: watch.label.clone(),
        at: now.into(),
        summary: summarize_diff(&diff),
        new_documents: diff.new_documents.clone(),
    };
    Ok(Outcome { entry, event: Some(event), diff: Some(diff) })
}

pub fn now_string() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Check one watch. Never fails: errors are recorded in the state entry.
pub async fn check_watch(client: &reqwest::Client, watch: &Watch, prev: &WatchState) -> Outcome {
    let now = now_string();
    let res = match fetch_page(client, &watch.url).await {
        Ok((html, final_url)) => process(watch, prev, &html, &final_url, &now),
        Err(e) => Err(e),
    };
    res.unwrap_or_else(|e| {
        let mut entry = prev.clone();
        entry.last_checked = Some(now);
        entry.last_status = Some("error".into());
        entry.last_error = Some(e);
        Outcome { entry, event: None, diff: None }
    })
}

/// Check the given watches (or all) one after another. Runs never overlap.
pub async fn run_checks(app: &App, only: Option<Vec<String>>) {
    let _guard = app.run_lock.lock().await;
    let watches: Vec<Watch> = app.read(|d| {
        d.watches.iter().filter(|w| only.as_ref().map_or(true, |ids| ids.contains(&w.id))).cloned().collect()
    });
    for w in watches {
        let prev = app.read(|d| d.state.get(&w.id).cloned()).unwrap_or_default();
        let out = check_watch(&app.client, &w, &prev).await;
        let kept = app.with_data(|d| {
            if !d.watches.iter().any(|x| x.id == w.id) {
                return false; // removed while checking
            }
            d.state.insert(w.id.clone(), out.entry.clone());
            if let Some(ev) = &out.event {
                d.events.insert(0, ev.clone());
                d.events.truncate(100);
            }
            true
        });
        if !kept {
            continue;
        }
        if let (Some(ev), Some(diff)) = (&out.event, &out.diff) {
            let settings = app.read(|d| d.settings.clone());
            if settings.notify_email.trim().is_empty() || settings.smtp.host.trim().is_empty() {
                println!("Change detected on {} ({}). Email not sent: notification email / SMTP not configured.", w.url, ev.summary);
            } else {
                let mail = mailer::build_change_email(&w, diff, &ev.at);
                match mailer::send_mail(&settings, &settings.notify_email, mail).await {
                    Ok(()) => println!("Emailed update for {}", w.url),
                    Err(e) => eprintln!("Could not send email for {}: {e}", w.url),
                }
            }
        }
    }
}

/// Background scheduler: waits for the configured interval between full runs.
pub async fn scheduler(app: App) {
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
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
        Watch { id: "w1".into(), url: "https://a.org/news".into(), label: "A".into(), selector: String::new(), documents_only: docs_only, created_at: "t".into() }
    }
    const P1: &str = "<body><p>Hello world.</p><a href='/a.pdf'>A</a></body>";
    const P2: &str = "<body><p>Hello world. Something new here.</p><a href='/a.pdf'>A</a><a href='/b.pdf'>B</a></body>";
    const P3: &str = "<body><p>Hello world. Only text changed.</p><a href='/a.pdf'>A</a></body>";

    #[test]
    fn baseline_then_change() {
        let w = watch(false);
        let base = process(&w, &WatchState::default(), P1, &w.url, "t1").unwrap();
        assert!(base.event.is_none());
        let same = process(&w, &base.entry, P1, &w.url, "t2").unwrap();
        assert!(same.event.is_none());
        let ch = process(&w, &base.entry, P2, &w.url, "t3").unwrap();
        let ev = ch.event.unwrap();
        assert_eq!(ev.new_documents.len(), 1);
        assert_eq!(ev.new_documents[0].href, "https://a.org/b.pdf");
        assert_eq!(ch.entry.last_changed.as_deref(), Some("t3"));
    }

    #[test]
    fn documents_only_gating() {
        let w = watch(true);
        let base = process(&w, &WatchState::default(), P1, &w.url, "t1").unwrap();
        let text_only = process(&w, &base.entry, P3, &w.url, "t2").unwrap();
        assert!(text_only.event.is_none());
        assert!(text_only.entry.last_changed.is_none());
        assert_ne!(text_only.entry.last_hash, base.entry.last_hash); // state still advances
        let with_doc = process(&w, &base.entry, P2, &w.url, "t3").unwrap();
        assert!(with_doc.event.is_some());
    }

    #[test]
    fn selector_errors() {
        let mut w = watch(false);
        w.selector = ".missing".into();
        assert!(process(&w, &WatchState::default(), P1, &w.url, "t").is_err());
    }
}
