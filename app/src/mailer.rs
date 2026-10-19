//! Email building (port of mailer.js) and SMTP sending via lettre.
use crate::core::*;
use crate::store::{Settings, Watch};
use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub struct Mail {
    pub subject: String,
    pub text: String,
    pub html: String,
}

pub fn host_of(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_else(|| url.to_string())
}

pub fn build_change_email(watch: &Watch, diff: &Diff, at: &str) -> Mail {
    let name = if watch.label.is_empty() { host_of(&watch.url) } else { watch.label.clone() };
    let when = chrono::DateTime::parse_from_rfc3339(at)
        .map(|d| d.to_utc().format("%a, %d %b %Y %H:%M:%S GMT").to_string())
        .unwrap_or_else(|_| at.to_string());
    let docs = &diff.new_documents;
    let subject = if docs.is_empty() { format!("Update detected: {name}") } else { format!("New document: {name}") };
    let nothing = docs.is_empty() && diff.new_links.is_empty() && diff.added_text.is_empty();

    let mut parts: Vec<String> = vec![
        format!("{} on {name}", if docs.is_empty() { "A change was detected" } else { "New documents" }),
        format!("URL: {}", watch.url),
        format!("Time: {when}"),
        String::new(),
    ];
    if !docs.is_empty() {
        let l: Vec<String> = docs
            .iter()
            .map(|d| format!("- [{}] {}\n  {}", d.ext.to_uppercase(), if d.text.is_empty() { &d.href } else { &d.text }, d.href))
            .collect();
        parts.push(format!("New documents:\n{}\n", l.join("\n")));
    }
    if !diff.new_links.is_empty() {
        let l: Vec<String> = diff.new_links.iter().map(|l| format!("- {}\n  {}", if l.text.is_empty() { &l.href } else { &l.text }, l.href)).collect();
        parts.push(format!("New links:\n{}\n", l.join("\n")));
    }
    if !diff.added_text.is_empty() {
        let l: Vec<String> = diff.added_text.iter().map(|t| format!("- {t}")).collect();
        parts.push(format!("Added text:\n{}\n", l.join("\n")));
    }
    if nothing {
        parts.push("The page content changed, but no new links or text lines could be isolated (content may have been removed or reordered).\n".into());
    }
    let text = parts.join("\n");

    let li = |s: String| format!("<li style=\"margin:0 0 6px\">{s}</li>");
    let badge = |ext: &str| {
        format!("<span style=\"display:inline-block;background:#2563eb;color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-right:6px\">{}</span>", escape_html(&ext.to_uppercase()))
    };
    let mut body = String::new();
    if !docs.is_empty() {
        let items: String = docs
            .iter()
            .map(|d| {
                li(format!(
                    "{}<a href=\"{h}\" style=\"color:#2563eb;font-weight:600\">{t}</a><br><span style=\"color:#78716c;font-size:12px;word-break:break-all\">{h}</span>",
                    badge(&d.ext),
                    h = escape_html(&d.href),
                    t = escape_html(if d.text.is_empty() { &d.href } else { &d.text })
                ))
            })
            .collect();
        body += &format!("<div style=\"background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin:0 0 8px\"><h3 style=\"font-size:15px;margin:0 0 8px\">New documents</h3><ul style=\"padding-left:0;list-style:none;margin:0;font-size:14px\">{items}</ul></div>");
    }
    if !diff.new_links.is_empty() {
        let items: String = diff.new_links.iter().map(|l| li(format!("<a href=\"{}\" style=\"color:#2563eb\">{}</a>", escape_html(&l.href), escape_html(if l.text.is_empty() { &l.href } else { &l.text })))).collect();
        body += &format!("<h3 style=\"font-size:14px;margin:16px 0 8px\">New links</h3><ul style=\"padding-left:18px;margin:0;font-size:14px\">{items}</ul>");
    }
    if !diff.added_text.is_empty() {
        let items: String = diff.added_text.iter().map(|t| li(escape_html(t))).collect();
        body += &format!("<h3 style=\"font-size:14px;margin:16px 0 8px\">Added text</h3><ul style=\"padding-left:18px;margin:0;font-size:14px\">{items}</ul>");
    }
    if nothing {
        body += "<p style=\"font-size:14px;color:#57534e\">The page content changed, but no new links or text lines could be isolated (content may have been removed or reordered).</p>";
    }
    let html = format!(
        "<!doctype html><html><body style=\"margin:0;background:#f5f5f4;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917\">\
<div style=\"max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:24px\">\
<h2 style=\"margin:0 0 4px;font-size:18px\">{title}</h2><p style=\"margin:0 0 16px;color:#57534e\">{name}</p>\
<p style=\"margin:0 0 4px;font-size:14px\"><a href=\"{url}\" style=\"color:#2563eb\">{url}</a></p>\
<p style=\"margin:0 0 16px;font-size:13px;color:#78716c\">{when}</p>{body}\
<p style=\"margin:24px 0 0;font-size:12px;color:#a8a29e\">Sent by News Scanner</p></div></body></html>",
        title = if docs.is_empty() { "Update detected" } else { "New documents" },
        name = escape_html(&name),
        url = escape_html(&watch.url),
        when = escape_html(&when),
    );
    Mail { subject, text, html }
}

pub fn smtp_configured(s: &Settings) -> bool {
    !s.smtp.host.trim().is_empty()
}

pub async fn send_mail(s: &Settings, to: &str, mail: Mail) -> Result<(), String> {
    if to.trim().is_empty() {
        return Err("No notification email set".into());
    }
    if !smtp_configured(s) {
        return Err("SMTP is not configured".into());
    }
    let smtp = &s.smtp;
    let from_str = if smtp.from.trim().is_empty() { smtp.username.trim() } else { smtp.from.trim() };
    let from: Mailbox = from_str.parse().map_err(|_| format!("Invalid 'from' address: \"{from_str}\" (set a From address in Settings)"))?;
    let to: Mailbox = to.trim().parse().map_err(|_| "Invalid notification email".to_string())?;
    let msg = Message::builder()
        .from(from)
        .to(to)
        .subject(mail.subject)
        .multipart(MultiPart::alternative_plain_html(mail.text, mail.html))
        .map_err(|e| e.to_string())?;

    let host = smtp.host.trim();
    let builder = match smtp.security.as_str() {
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host).map_err(|e| e.to_string())?,
        "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host),
        _ => AsyncSmtpTransport::<Tokio1Executor>::relay(host).map_err(|e| e.to_string())?,
    };
    let mut builder = builder.port(smtp.port).timeout(Some(std::time::Duration::from_secs(30)));
    if !smtp.username.is_empty() {
        builder = builder.credentials(Credentials::new(smtp.username.clone(), smtp.password.clone()));
    }
    builder.build().send(msg).await.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w() -> Watch {
        Watch { id: "1".into(), url: "https://a.org/x".into(), label: String::new(), selector: String::new(), documents_only: false, created_at: "t".into() }
    }

    #[test]
    fn subject_and_badge() {
        let d = Diff { new_documents: vec![Doc { href: "https://a.org/r.pdf".into(), text: "<R>".into(), ext: "pdf".into() }], ..Default::default() };
        let m = build_change_email(&w(), &d, "2026-01-01T00:00:00Z");
        assert_eq!(m.subject, "New document: a.org");
        assert!(m.html.contains("PDF"));
        assert!(m.html.contains("&lt;R&gt;"));
        assert!(m.text.contains("[PDF]"));
        let m2 = build_change_email(&w(), &Diff::default(), "2026-01-01T00:00:00Z");
        assert_eq!(m2.subject, "Update detected: a.org");
    }
}
