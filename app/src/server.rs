//! HTTP API, static UI, and optional password gate.
use crate::checker::{now_string, run_checks};
use crate::core::validate_url;
use crate::mailer;
use crate::store::{App, Settings, Watch};
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{delete, get, post};
use axum::{Form, Json, Router};
use hmac::{Hmac, Mac};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

#[derive(RustEmbed)]
#[folder = "web/"]
struct Assets;

pub struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}
fn err<T>(code: StatusCode, msg: impl Into<String>) -> Result<T, ApiError> {
    Err(ApiError(code, msg.into()))
}

pub fn router(app: App) -> Router {
    Router::new()
        .route("/api/watches", get(list_watches).post(add_watch))
        .route("/api/watches/:id", delete(remove_watch))
        .route("/api/watches/:id/check", post(check_one))
        .route("/api/check-all", post(check_all))
        .route("/api/events", get(list_events))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/test-email", post(test_email))
        .route("/login", get(login_page).post(login_submit))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app)
}

// ---------- guard: host/origin checks + optional password ----------

fn token_for(password: &str) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(password.as_bytes()).expect("hmac key");
    m.update(b"news-scanner-session");
    hex::encode(m.finalize().into_bytes())
}
fn token_valid(password: &str, token: &str) -> bool {
    let Ok(bytes) = hex::decode(token) else { return false };
    let mut m = Hmac::<Sha256>::new_from_slice(password.as_bytes()).expect("hmac key");
    m.update(b"news-scanner-session");
    m.verify_slice(&bytes).is_ok()
}
fn cookie_token(h: &HeaderMap) -> Option<String> {
    let c = h.get(header::COOKIE)?.to_str().ok()?;
    c.split(';').find_map(|p| p.trim().strip_prefix("ns_auth=").map(String::from))
}
fn host_is_loopback(host: &str) -> bool {
    let h = host.rsplit_once(':').filter(|(a, b)| !a.ends_with(']') || b.chars().all(|c| c.is_ascii_digit()) && a.contains(']')).map_or(host, |(a, _)| a);
    let h = if host.starts_with('[') { host.split(']').next().unwrap_or("").trim_start_matches('[') } else { h };
    matches!(h, "localhost" | "127.0.0.1" | "::1")
}

async fn guard(State(app): State<App>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    // DNS-rebinding protection when only listening locally.
    if app.loopback_only && !host_is_loopback(host) {
        return (StatusCode::FORBIDDEN, "Forbidden host").into_response();
    }
    // CSRF: browser-sent cross-origin state changes are refused.
    if !matches!(*req.method(), axum::http::Method::GET | axum::http::Method::HEAD) {
        if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            let auth = origin.split_once("://").map_or(origin, |(_, a)| a);
            if auth != host {
                return (StatusCode::FORBIDDEN, "Cross-origin request refused").into_response();
            }
        }
    }
    if let Some(pw) = &app.app_password {
        let path = req.uri().path();
        let open = path == "/login" || path == "/style.css";
        let authed = cookie_token(headers).is_some_and(|t| token_valid(pw, &t));
        if !open && !authed {
            if path.starts_with("/api/") {
                return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Login required" }))).into_response();
            }
            return Redirect::to("/login").into_response();
        }
    }
    next.run(req).await
}

const LOGIN_HTML: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>News Scanner - Login</title><link rel="stylesheet" href="/style.css"></head><body><main><header><h1>News Scanner</h1><p class="sub">Enter the password to continue.</p></header><form method="post" action="/login" class="stack"><input type="password" name="password" placeholder="Password" autofocus required aria-label="Password"><div class="row"><button class="primary" type="submit">Log in</button><span class="msg err">__ERR__</span></div></form></main></body></html>"#;

async fn login_page() -> Html<String> {
    Html(LOGIN_HTML.replace("__ERR__", ""))
}

#[derive(Deserialize)]
struct LoginForm {
    password: String,
}
async fn login_submit(State(app): State<App>, Form(f): Form<LoginForm>) -> Response {
    match &app.app_password {
        Some(pw) if token_valid(pw, &token_for(&f.password)) => (
            [(header::SET_COOKIE, format!("ns_auth={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000", token_for(pw)))],
            Redirect::to("/"),
        )
            .into_response(),
        Some(_) => (StatusCode::UNAUTHORIZED, Html(LOGIN_HTML.replace("__ERR__", "Wrong password"))).into_response(),
        None => Redirect::to("/").into_response(),
    }
}

// ---------- static ----------

async fn static_file(uri: Uri) -> Response {
    let p = uri.path().trim_start_matches('/');
    let p = if p.is_empty() { "index.html" } else { p };
    match Assets::get(p) {
        Some(f) => {
            let ct = match p.rsplit('.').next().unwrap_or("") {
                "html" => "text/html; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "js" => "text/javascript; charset=utf-8",
                "svg" => "image/svg+xml",
                _ => "application/octet-stream",
            };
            ([(header::CONTENT_TYPE, ct), (header::CACHE_CONTROL, "no-cache")], f.data.into_owned()).into_response()
        }
        None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

// ---------- watches ----------

fn watch_view(d: &crate::store::Data, w: &Watch) -> Value {
    let s = d.state.get(&w.id).cloned().unwrap_or_default();
    json!({
        "id": w.id, "url": w.url, "label": w.label, "selector": w.selector,
        "documentsOnly": w.documents_only, "createdAt": w.created_at,
        "lastChecked": s.last_checked, "lastChanged": s.last_changed,
        "lastStatus": s.last_status, "lastError": s.last_error,
    })
}

async fn list_watches(State(app): State<App>) -> Json<Value> {
    Json(app.read(|d| Value::Array(d.watches.iter().map(|w| watch_view(d, w)).collect())))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewWatch {
    url: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    selector: String,
    #[serde(default)]
    documents_only: bool,
}

async fn add_watch(State(app): State<App>, Json(b): Json<NewWatch>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let url = validate_url(&b.url).map_err(|e| ApiError(StatusCode::BAD_REQUEST, e))?.to_string();
    let selector = b.selector.trim().to_string();
    if !selector.is_empty() && scraper::Selector::parse(&selector).is_err() {
        return err(StatusCode::BAD_REQUEST, "Invalid CSS selector");
    }
    let label: String = b.label.trim().chars().take(100).collect();
    let w = Watch {
        id: uuid::Uuid::new_v4().simple().to_string(),
        url,
        label,
        selector,
        documents_only: b.documents_only,
        created_at: now_string(),
    };
    let created = app.with_data(|d| {
        if d.watches.iter().any(|x| x.url == w.url && x.selector == w.selector) {
            return None;
        }
        d.watches.push(w.clone());
        Some(())
    });
    if created.is_none() {
        return err(StatusCode::CONFLICT, "You are already watching that page");
    }
    let id = w.id.clone();
    let a2 = app.clone();
    tokio::spawn(async move { run_checks(&a2, Some(vec![id])).await });
    Ok((StatusCode::CREATED, Json(app.read(|d| watch_view(d, &w)))))
}

async fn remove_watch(State(app): State<App>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let found = app.with_data(|d| {
        let n = d.watches.len();
        d.watches.retain(|w| w.id != id);
        d.state.remove(&id);
        d.watches.len() != n
    });
    if !found {
        return err(StatusCode::NOT_FOUND, "Unknown watch");
    }
    Ok(Json(json!({ "ok": true })))
}

async fn check_one(State(app): State<App>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    if !app.read(|d| d.watches.iter().any(|w| w.id == id)) {
        return err(StatusCode::NOT_FOUND, "Unknown watch");
    }
    run_checks(&app, Some(vec![id.clone()])).await;
    app.read(|d| d.watches.iter().find(|w| w.id == id).map(|w| Json(watch_view(d, w))))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Unknown watch".into()))
}

async fn check_all(State(app): State<App>) -> (StatusCode, Json<Value>) {
    tokio::spawn(async move { run_checks(&app, None).await });
    (StatusCode::ACCEPTED, Json(json!({ "ok": true })))
}

async fn list_events(State(app): State<App>) -> Json<Value> {
    Json(app.read(|d| serde_json::to_value(&d.events).unwrap_or(json!([]))))
}

// ---------- settings ----------

fn settings_view(s: &Settings) -> Value {
    json!({
        "notifyEmail": s.notify_email,
        "intervalMinutes": s.interval_minutes,
        "smtp": {
            "host": s.smtp.host, "port": s.smtp.port, "security": s.smtp.security,
            "username": s.smtp.username, "from": s.smtp.from,
            "passwordSet": !s.smtp.password.is_empty(),
        }
    })
}

async fn get_settings(State(app): State<App>) -> Json<Value> {
    Json(app.read(|d| settings_view(&d.settings)))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SmtpIn {
    host: String,
    port: Option<u16>,
    security: String,
    username: String,
    password: String,
    from: String,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SettingsIn {
    notify_email: String,
    smtp: SmtpIn,
    interval_minutes: Option<u32>,
}

async fn put_settings(State(app): State<App>, Json(b): Json<SettingsIn>) -> Result<Json<Value>, ApiError> {
    let email = b.notify_email.trim().to_string();
    if !email.is_empty() && !email.contains('@') {
        return err(StatusCode::BAD_REQUEST, "Notification email looks invalid");
    }
    let security = if b.smtp.security.is_empty() { "tls".to_string() } else { b.smtp.security.clone() };
    if !["tls", "starttls", "none"].contains(&security.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Security must be tls, starttls or none");
    }
    let interval = b.interval_minutes.unwrap_or(30);
    if !(5..=10080).contains(&interval) {
        return err(StatusCode::BAD_REQUEST, "Check interval must be between 5 and 10080 minutes");
    }
    let out = app.with_data(|d| {
        let s = &mut d.settings;
        s.notify_email = email;
        s.interval_minutes = interval;
        s.smtp.host = b.smtp.host.trim().to_string();
        s.smtp.port = b.smtp.port.unwrap_or(465);
        s.smtp.security = security;
        s.smtp.username = b.smtp.username.trim().to_string();
        s.smtp.from = b.smtp.from.trim().to_string();
        if !b.smtp.password.is_empty() {
            s.smtp.password = b.smtp.password.clone();
        }
        settings_view(s)
    });
    Ok(Json(out))
}

async fn test_email(State(app): State<App>) -> Result<Json<Value>, ApiError> {
    let s = app.read(|d| d.settings.clone());
    if s.notify_email.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "Set and save a notification email first");
    }
    if !mailer::smtp_configured(&s) {
        return err(StatusCode::BAD_REQUEST, "Fill in and save the SMTP settings first");
    }
    let mail = mailer::Mail {
        subject: "News Scanner test email".into(),
        text: "This is a test email from News Scanner. Email alerts are working.".into(),
        html: "<p>This is a test email from <b>News Scanner</b>. Email alerts are working.</p>".into(),
    };
    mailer::send_mail(&s, &s.notify_email, mail).await.map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hosts_and_tokens() {
        assert!(host_is_loopback("127.0.0.1:7878"));
        assert!(host_is_loopback("localhost"));
        assert!(host_is_loopback("[::1]:7878"));
        assert!(!host_is_loopback("evil.com:7878"));
        assert!(!host_is_loopback("127.0.0.1.evil.com"));
        assert!(token_valid("pw", &token_for("pw")));
        assert!(!token_valid("pw", &token_for("other")));
        assert!(!token_valid("pw", "zz"));
    }
}
