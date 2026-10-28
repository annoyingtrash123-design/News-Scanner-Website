mod checker;
mod core;
mod defaults;
mod mailer;
mod server;
mod store;

use std::sync::{Arc, Mutex};

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
    if let Err(e) = rt.block_on(run()) {
        eprintln!("\nNews Scanner could not start: {e:#}");
        pause_on_error();
        std::process::exit(1);
    }
}

/// On a double-click launch the window would vanish instantly; give people time to read errors.
fn pause_on_error() {
    if cfg!(windows) {
        eprintln!("Press Enter to close this window.");
        let _ = std::io::stdin().read_line(&mut String::new());
    }
}

async fn run() -> anyhow::Result<()> {
    let mut host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let mut port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7878);
    let mut open_browser = true;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--no-open" => open_browser = false,
            "--host" => host = args.next().ok_or_else(|| anyhow::anyhow!("--host needs a value"))?,
            "--port" => port = args.next().and_then(|p| p.parse().ok()).ok_or_else(|| anyhow::anyhow!("--port needs a number"))?,
            "-h" | "--help" => {
                println!("News Scanner\n\nOptions:\n  --host <addr>   Listen address (default 127.0.0.1; use 0.0.0.0 on a server). Env: HOST\n  --port <n>      Port (default 7878, next free port if busy). Env: PORT\n  --no-open       Do not open the browser\n\nEnv: APP_PASSWORD (require a password), NEWS_SCANNER_DATA_DIR (data folder)");
                return Ok(());
            }
            other => anyhow::bail!("Unknown option: {other} (try --help)"),
        }
    }

    let path = store::data_file()?;
    let mut data = store::Data::load(&path);
    let now = checker::now_string();
    defaults::seed(&mut data, &now);
    if data.last_seen_at.is_none() {
        data.last_seen_at = Some(now); // first launch: nothing counts as new yet
    }
    if let Err(e) = data.save(&path) {
        eprintln!("Could not save data: {e}");
    }
    let app_password = std::env::var("APP_PASSWORD").ok().filter(|p| !p.is_empty()).map(Arc::new);
    let loopback_only = matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1");
    let app = store::App {
        data: Arc::new(Mutex::new(data)),
        path: Arc::new(path.clone()),
        run_lock: Arc::new(tokio::sync::Mutex::new(())),
        status: Arc::new(Mutex::new(store::RunStatus::default())),
        client: checker::build_client(),
        app_password,
        loopback_only,
    };

    let mut listener = None;
    for p in port..=port.saturating_add(50) {
        if let Ok(l) = tokio::net::TcpListener::bind((host.as_str(), p)).await {
            listener = Some(l);
            break;
        }
    }
    let listener = listener.ok_or_else(|| anyhow::anyhow!("no free port found near {port} on {host}"))?;
    let bound = listener.local_addr()?.port();
    let shown_host = if loopback_only || host == "0.0.0.0" || host == "::" { if host == "localhost" { "localhost" } else { "127.0.0.1" } } else { host.as_str() };
    let url = format!("http://{shown_host}:{bound}");

    println!("News Scanner is running at {url} \u{2014} keep this window open.");
    println!("Your data is stored in {}", path.display());
    if !loopback_only {
        println!("Listening on {host}:{bound} (reachable from other machines).");
        if app.app_password.is_none() {
            println!("WARNING: no APP_PASSWORD set - anyone who can reach this address can use the app.");
        }
    }

    tokio::spawn(checker::scheduler(app.clone()));
    if open_browser {
        let u = url.clone();
        tokio::task::spawn_blocking(move || {
            if open::that(&u).is_err() {
                println!("Could not open a browser automatically; open {u} yourself.");
            }
        });
    }
    axum::serve(listener, server::router(app)).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    }).await?;
    Ok(())
}
