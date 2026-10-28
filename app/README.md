# News Scanner (desktop app)

News Scanner watches web pages for you. When a page changes, or a new document (PDF, Word, Excel...) appears on it, it shows up under "New since your last visit". Email alerts are optional.

It is a single program. No installation, no account, nothing else to set up.

## Your morning routine

1. Double-click `news-scanner`. Your browser opens News Scanner (or copy the address shown in the window into your browser).
2. Wait for the scan. It starts by itself a couple of seconds after launch and checks all sites a few at a time; a thin "Checking 12 of 37..." line shows progress. You can also press **Check all now**.
3. Read **New since your last visit** on the **Updates** tab: new documents first, then new links, then a few added-text excerpts, grouped by site.
4. Press **Mark all as read**. Next time only newer items appear. The browser tab title shows the count, e.g. "(5) News Scanner".

The **Sites** tab lists every watched site by category, with status, a filter box, **Copy list** and **Export CSV**. A built-in list of about 37 government and company news pages is added on first launch; remove any you do not want (removed ones do not come back) or add your own. **Settings > Reset to built-in list** re-adds any built-in sites you removed.

Notes:

- The very first run only records a baseline of each page, so the first morning shows nothing new.
- Sites with bot protection or JavaScript-only pages may fail to load. They appear under **Couldn't check** (with the reason) on the Updates tab and in the Sites tab.
- Trivial changes (dates, times, "5 minutes ago", very short text) are ignored; an update is only reported for new documents, new links or meaningful new text.
- No login, no account and no email setup are needed.

### "Unidentified developer" / "Windows protected your PC"

The app is not signed with a paid certificate, so your computer warns you the first time.

- **Mac:** right-click (or Control-click) `news-scanner` and choose **Open**, then **Open** again. If it still refuses, open System Settings, Privacy & Security, and click "Open Anyway". If macOS says the file is "damaged", run `xattr -d com.apple.quarantine news-scanner` in Terminal once.
- **Windows:** in the blue SmartScreen box click **More info**, then **Run anyway**.
- **Linux:** you may need to mark it runnable first: `chmod +x news-scanner`.

## Getting email alerts (optional)

Open **Settings > Email alerts (optional)** on the Sites tab and fill in:

- **Notification email:** where alerts go.
- Your mail provider's SMTP details. For **Gmail**:
  - Host `smtp.gmail.com`, port `465`, security **TLS**
  - Username: your Gmail address
  - Password: an **app password**, not your normal password. Create one in your Google Account under Security, 2-Step Verification, App passwords (2-Step Verification must be on).
  - From: your Gmail address
- Press **Save**, then **Send test email**.

Without email settings the app works the same; it just does not email you.

## Important: it only checks while it is running

Checks happen while the program (the little window) is open, on launch and then by default every 30 minutes (change it in Settings). If you close it or shut down your computer, nothing is checked until you start it again, though it catches up as soon as it launches.

- Leave it running, or add it to your computer's startup programs (Windows: Win+R, `shell:startup`, put a shortcut there; Mac: System Settings, General, Login Items).
- For always-on checking, run it on a server or an always-on machine:
  `./news-scanner --host 0.0.0.0 --no-open`
  and open `http://<server-address>:7878`. Since this makes the app reachable by others, **set a password**: start it with the environment variable `APP_PASSWORD=your-secret`.

## Options

| Option / variable | Meaning |
| --- | --- |
| `--host 0.0.0.0` or `HOST` | Listen on all network interfaces (default: only this computer) |
| `--port 8080` or `PORT` | Preferred port (default 7878; next free port is used if busy) |
| `--no-open` | Do not open the browser automatically |
| `APP_PASSWORD` | Require this password to use the app |
| `NEWS_SCANNER_DATA_DIR` | Where to keep the data file |

Your data lives in one file, `news-scanner-data.json`, in a `NewsScanner` folder (Windows: `%APPDATA%\NewsScanner`). It holds your watches, settings (including the email password) and history. Other systems: Mac `~/Library/Application Support`, Linux `~/.local/share`. The email password, if you set one, is saved there in plain text, so only use an app password.

## Building from source

```
cd app
cargo build --release     # binary in app/target/release/
cargo test
```
