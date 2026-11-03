//! Classification of failed checks into plain-English reasons, and the retry policy.
//! Nothing here evades bot protection: blocked responses (401/403/412) are never retried.
use std::time::Duration;

/// Per-request timeout in seconds.
pub const TIMEOUT_SECS: u64 = 35;
/// Pause before the single retry of a transient failure.
pub const RETRY_DELAY: Duration = Duration::from_secs(3);
/// A 429 is retried only when the server asks for a wait of at most this many seconds.
pub const MAX_RETRY_AFTER_SECS: u64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Blocked,
    Server,
    Tls,
    Timeout,
    Dns,
    Connection,
    NoText,
    NotFound,
    Other,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorKind::Blocked => "blocked",
            ErrorKind::Server => "server",
            ErrorKind::Tls => "tls",
            ErrorKind::Timeout => "timeout",
            ErrorKind::Dns => "dns",
            ErrorKind::Connection => "connection",
            ErrorKind::NoText => "no_text",
            ErrorKind::NotFound => "not_found",
            ErrorKind::Other => "other",
        }
    }
}

/// A failed fetch/check with everything needed to classify, retry and describe it.
#[derive(Clone, Debug)]
pub struct FetchError {
    pub kind: ErrorKind,
    /// Raw technical message (stored as `lastError`).
    pub raw: String,
    pub status: Option<u16>,
    /// Parsed `Retry-After` (seconds), if the server sent one.
    pub retry_after: Option<u64>,
    pub attempts: u8,
}

impl FetchError {
    pub fn new(kind: ErrorKind, raw: impl Into<String>) -> Self {
        FetchError { kind, raw: raw.into(), status: None, retry_after: None, attempts: 1 }
    }
    /// Error for a non-success HTTP status.
    pub fn http(status: u16, retry_after: Option<u64>) -> Self {
        FetchError { kind: kind_for_status(status), raw: format!("HTTP {status}"), status: Some(status), retry_after, attempts: 1 }
    }
    /// Error from a lower-level failure message (reqwest / OS / TLS), classified by its text.
    pub fn from_message(raw: impl Into<String>, detail: &str) -> Self {
        let raw = raw.into();
        let kind = kind_for_message(detail);
        FetchError::new(kind, raw)
    }
    /// Error from a message produced by our own page processing (e.g. "No text found on page").
    pub fn from_process(msg: &str) -> Self {
        let kind = if msg.to_ascii_lowercase().starts_with("no text found") { ErrorKind::NoText } else { ErrorKind::Other };
        FetchError::new(kind, msg)
    }
    pub fn challenge() -> Self {
        FetchError::new(ErrorKind::Blocked, "Bot-challenge page (e.g. \"Just a moment...\")")
    }
}

pub fn kind_for_status(status: u16) -> ErrorKind {
    match status {
        401 | 403 | 412 | 429 => ErrorKind::Blocked,
        404 | 410 => ErrorKind::NotFound,
        500..=599 => ErrorKind::Server,
        _ => ErrorKind::Other,
    }
}

/// Classify a low-level error message (the whole source chain, any case).
pub fn kind_for_message(msg: &str) -> ErrorKind {
    let m = msg.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| m.contains(n));
    if has(&["unknownissuer", "certificate", "handshake", "close_notify", "tls", "ssl", "schannel", "invalid peer", "peer is incompatible", "decrypt"]) {
        ErrorKind::Tls
    } else if has(&["timed out", "timeout", "os error 10060", "os error 110)"]) {
        ErrorKind::Timeout
    } else if has(&["dns", "lookup address", "name resolution", "no such host", "os error 11001", "os error 11002", "os error 11004", "name or service not known", "nodename nor servname"]) {
        ErrorKind::Dns
    } else if has(&["connection reset", "connection refused", "connection closed", "connection aborted", "broken pipe", "unexpected eof", "unexpected end of file", "channel closed", "incomplete message", "os error 10054", "os error 10053", "os error 10061", "os error 104)", "os error 111)", "error trying to connect", "connection error"]) {
        ErrorKind::Connection
    } else {
        ErrorKind::Other
    }
}

/// Is this a temporary DNS failure (worth one retry), as opposed to "no such host"?
fn is_temporary_dns(m: &str) -> bool {
    m.contains("temporary failure") || m.contains("os error 11002") || m.contains("try again") || m.contains("eai_again")
}

/// Decide whether (and after how long) to retry once. `None` = do not retry.
pub fn retry_delay(e: &FetchError) -> Option<Duration> {
    if e.attempts >= 2 {
        return None;
    }
    let m = e.raw.to_ascii_lowercase();
    match e.kind {
        // Never retry bot-protection responses, except a polite 429 with a short Retry-After.
        ErrorKind::Blocked => match (e.status, e.retry_after) {
            (Some(429), Some(s)) if s <= MAX_RETRY_AFTER_SECS => Some(Duration::from_secs(s)),
            _ => None,
        },
        ErrorKind::Server => matches!(e.status, Some(502 | 503 | 504 | 520 | 522 | 524)).then_some(RETRY_DELAY),
        ErrorKind::Timeout => Some(RETRY_DELAY),
        ErrorKind::Dns => is_temporary_dns(&m).then_some(RETRY_DELAY),
        ErrorKind::Tls => (m.contains("close_notify") || m.contains("unexpected eof") || m.contains("unexpected end of file")).then_some(RETRY_DELAY),
        ErrorKind::Connection => (!m.contains("refused") && !m.contains("os error 10061") && !m.contains("os error 111)")).then_some(RETRY_DELAY),
        ErrorKind::NoText | ErrorKind::NotFound | ErrorKind::Other => None,
    }
}

/// Parse a `Retry-After` header value given in seconds (HTTP-date form is ignored).
pub fn parse_retry_after(v: &str) -> Option<u64> {
    v.trim().parse::<u64>().ok()
}

/// Friendly, plain-English message shown to the user.
pub fn friendly(e: &FetchError) -> String {
    let tried = if e.attempts >= 2 { " (tried twice)" } else { "" };
    let http = e.status.map(|s| format!(" (HTTP {s})")).unwrap_or_default();
    match e.kind {
        ErrorKind::Blocked => {
            let what = if e.status.is_some() { http } else { " (bot-challenge page)".to_string() };
            format!("Blocked by the site's bot protection or paywall{what}. Try the Chrome extension, which uses your own browser.")
        }
        ErrorKind::Server => format!("The site's own server returned an error{http} — usually temporary or the site is down{tried}."),
        ErrorKind::Tls => format!("Secure connection failed (certificate/handshake){tried}."),
        ErrorKind::Timeout => format!("Timed out after {TIMEOUT_SECS}s{tried}."),
        ErrorKind::Dns => format!("Couldn't look up the site's address (DNS) — check your internet connection{tried}."),
        ErrorKind::Connection => format!("Connection was cut off by the site{tried}."),
        ErrorKind::NoText => "Page loaded but had no readable text — it probably needs JavaScript, which the scanner doesn't run.".to_string(),
        ErrorKind::NotFound => format!("Page not found{http} — the address may have changed or been removed."),
        ErrorKind::Other => e.raw.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_codes() {
        for s in [401, 403, 412, 429] { assert_eq!(kind_for_status(s), ErrorKind::Blocked, "{s}"); }
        for s in [404, 410] { assert_eq!(kind_for_status(s), ErrorKind::NotFound); }
        for s in [500, 502, 503, 520, 524, 599] { assert_eq!(kind_for_status(s), ErrorKind::Server); }
        assert_eq!(kind_for_status(400), ErrorKind::Other);
        assert_eq!(kind_for_status(418), ErrorKind::Other);
    }

    #[test]
    fn messages() {
        let k = kind_for_message;
        assert_eq!(k("invalid peer certificate: UnknownIssuer"), ErrorKind::Tls);
        assert_eq!(k("received fatal alert: HandshakeFailure"), ErrorKind::Tls);
        assert_eq!(k("peer closed connection without sending TLS close_notify"), ErrorKind::Tls);
        assert_eq!(k("An existing connection was forcibly closed by the remote host. (os error 10054)"), ErrorKind::Connection);
        assert_eq!(k("This is usually a temporary error during hostname resolution (os error 11002)"), ErrorKind::Dns);
        assert_eq!(k("DNS lookup failed for x.org: failed to lookup address information"), ErrorKind::Dns);
        assert_eq!(k("Timed out after 35s"), ErrorKind::Timeout);
        assert_eq!(k("operation timed out"), ErrorKind::Timeout);
        assert_eq!(k("tcp connect error: Connection refused (os error 111)"), ErrorKind::Connection);
        assert_eq!(k("something odd"), ErrorKind::Other);
        assert_eq!(FetchError::from_process("No text found on page").kind, ErrorKind::NoText);
        assert_eq!(FetchError::from_process("Selector matched nothing: .x").kind, ErrorKind::Other);
        assert_eq!(FetchError::challenge().kind, ErrorKind::Blocked);
    }

    fn msg(raw: &str) -> FetchError { FetchError::from_message(raw, raw) }

    #[test]
    fn retry_transient_only() {
        let d = |e: &FetchError| retry_delay(e);
        for s in [502, 503, 504, 520, 522, 524] { assert_eq!(d(&FetchError::http(s, None)), Some(RETRY_DELAY), "{s}"); }
        for s in [500, 501, 404, 410, 400] { assert_eq!(d(&FetchError::http(s, None)), None, "{s}"); }
        for s in [401, 403, 412] { assert_eq!(d(&FetchError::http(s, Some(1))), None, "{s}"); }
        assert_eq!(d(&msg("Timed out after 35s")), Some(RETRY_DELAY));
        assert_eq!(d(&msg("forcibly closed by the remote host (os error 10054)")), Some(RETRY_DELAY));
        assert_eq!(d(&msg("Connection refused (os error 111)")), None);
        assert_eq!(d(&msg("temporary hostname resolution failure (os error 11002)")), Some(RETRY_DELAY));
        assert_eq!(d(&msg("No such host is known. (os error 11001)")), None);
        assert_eq!(d(&msg("peer closed connection without sending TLS close_notify")), Some(RETRY_DELAY));
        assert_eq!(d(&msg("invalid peer certificate: UnknownIssuer")), None);
        assert_eq!(d(&msg("received fatal alert: HandshakeFailure")), None);
        assert_eq!(d(&FetchError::from_process("No text found on page")), None);
        assert_eq!(d(&FetchError::challenge()), None);
    }

    #[test]
    fn retry_429_needs_short_retry_after() {
        assert_eq!(retry_delay(&FetchError::http(429, None)), None);
        assert_eq!(retry_delay(&FetchError::http(429, Some(61))), None);
        assert_eq!(retry_delay(&FetchError::http(429, Some(60))), Some(Duration::from_secs(60)));
        assert_eq!(retry_delay(&FetchError::http(429, Some(5))), Some(Duration::from_secs(5)));
        assert_eq!(parse_retry_after(" 7 "), Some(7));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
    }

    #[test]
    fn retry_only_once() {
        let mut e = FetchError::http(503, None);
        e.attempts = 2;
        assert_eq!(retry_delay(&e), None);
    }

    #[test]
    fn friendly_messages() {
        let mut e = FetchError::http(403, None);
        assert!(friendly(&e).starts_with("Blocked by the site's bot protection or paywall (HTTP 403). Try the Chrome extension"));
        e = FetchError::http(520, None);
        assert_eq!(friendly(&e), "The site's own server returned an error (HTTP 520) — usually temporary or the site is down.");
        e.attempts = 2;
        assert!(friendly(&e).ends_with("the site is down (tried twice)."));
        let mut t = msg("Timed out after 35s");
        t.attempts = 2;
        assert_eq!(friendly(&t), "Timed out after 35s (tried twice).");
        assert!(friendly(&msg("UnknownIssuer")).starts_with("Secure connection failed"));
        assert!(friendly(&FetchError::from_process("No text found on page")).contains("needs JavaScript"));
        assert_eq!(friendly(&FetchError::from_process("Selector matched nothing: .x")), "Selector matched nothing: .x");
    }
}
