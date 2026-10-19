# News Scanner (desktop app)

News Scanner watches web pages for you. When a page changes, or a new document (PDF, Word, Excel...) appears on it, you get an email.

It is a single program. No installation, no account, nothing else to set up.

## Get started

1. Open the **Releases** page of this repository and download the file for your computer under "News Scanner (latest build)":
   - Windows: `news-scanner-windows-x64.zip`
   - Mac with Apple chip (M1/M2/M3...): `news-scanner-macos-arm64.tar.gz`
   - Mac with Intel chip: `news-scanner-macos-x64.tar.gz`
   - Linux: `news-scanner-linux-x64.tar.gz`
2. Unpack it and **double-click `news-scanner`**.
3. A small window opens showing the address (like `http://127.0.0.1:7878`) and your web browser opens News Scanner. If it does not, copy that address into your browser.
4. Paste a page address, press **Watch**. The first check only records what is on the page; you are alerted about changes after that.

### "Unidentified developer" / "Windows protected your PC"

The app is not signed with a paid certificate, so your computer warns you the first time.

- **Mac:** right-click (or Control-click) `news-scanner` and choose **Open**, then **Open** again. If it still refuses, open System Settings, Privacy & Security, and click "Open Anyway". If macOS says the file is "damaged", run `xattr -d com.apple.quarantine news-scanner` in Terminal once.
- **Windows:** in the blue SmartScreen box click **More info**, then **Run anyway**.
- **Linux:** you may need to mark it runnable first: `chmod +x news-scanner`.

## Getting email alerts

Open the **Settings** section in the app and fill in:

- **Notification email:** where alerts go.
- Your mail provider's SMTP details. For **Gmail**:
  - Host `smtp.gmail.com`, port `465`, security **TLS**
  - Username: your Gmail address
  - Password: an **app password**, not your normal password. Create one in your Google Account under Security, 2-Step Verification, App passwords (2-Step Verification must be on).
  - From: your Gmail address
- Press **Save**, then **Send test email**.

Without email settings the app still tracks changes and lists them under "Recent updates"; it just cannot email you.

## Important: it only checks while it is running

Checks happen while the program (the little window) is open, by default every 30 minutes (change it in Settings). If you close it or shut down your computer, nothing is checked until you start it again, though it catches up as soon as it launches.

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

Your watches, settings (including the email password) and history are stored in one file, `news-scanner-data.json`, in `NewsScanner` inside your user data folder (Windows: `%APPDATA%`, Mac: `~/Library/Application Support`, Linux: `~/.local/share`). The email password is saved there in plain text, so only use an app password.

## Building from source

```
cd app
cargo build --release     # binary in app/target/release/
cargo test
```
