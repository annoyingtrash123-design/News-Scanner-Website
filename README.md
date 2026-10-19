# News Scanner

A tiny self-hosted web app. You enter page URLs (government press-release pages, document libraries, news indexes). The server re-checks them on a schedule and emails you when the content changes, listing the new links and the added text.

- Node.js 20+, Express, nodemailer, cheerio, dotenv. No database: state lives in `data/db.json`.
- First check of a page is a silent baseline. Emails are only sent for later changes.
- Optional password login, optional per-watch CSS selector.

## Quick start

```bash
npm install
cp .env.example .env     # then edit it
npm start                # http://localhost:3000
npm test
```

If `SMTP_HOST` is empty, emails are printed to the server console instead of sent, so you can try everything without mail set up.

## Configuration (.env)

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `CHECK_INTERVAL_MINUTES` | How often all watches are checked (default 30) |
| `APP_PASSWORD` | If set, the UI/API require login (signed cookie). If empty, the app is open. |
| `SESSION_SECRET` | Optional cookie-signing secret (defaults to a key derived from `APP_PASSWORD`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Mail server |
| `MAIL_FROM` | From header, e.g. `"News Scanner <you@gmail.com>"` |
| `NOTIFY_EMAIL` | Default recipient; can be overridden in the Settings section of the UI |
| `DATA_DIR` | Folder for `db.json` (default `./data`) |

### Gmail example

Turn on 2-step verification, create an App Password at https://myaccount.google.com/apppasswords, then:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=abcdefghijklmnop
MAIL_FROM="News Scanner <you@gmail.com>"
NOTIFY_EMAIL=you@gmail.com
```

Use the "Send test email" button in Settings to confirm.

## Deployment

Anything that runs Node or Docker works (Render, Railway, Fly.io, a VPS).

```bash
docker build -t news-scanner .
docker run -d --env-file .env -p 3000:3000 -v news-scanner-data:/app/data news-scanner
```

- **Persistent disk required.** Mount a volume at `/app/data` (or set `DATA_DIR`), otherwise your watches vanish on every redeploy. On Render/Railway/Fly attach a disk/volume to that path.
- Run a single instance only (the JSON file and scheduler are not designed for multiple replicas).
- Set `APP_PASSWORD` for any public deployment, and serve over HTTPS (the cookie is marked `Secure` when the request arrives over HTTPS or `X-Forwarded-Proto: https`).
- Free tiers that sleep when idle will not run the scheduler while asleep. Use an always-on instance.

## Tips for government and news sites

- Use the **CSS selector** (under "Advanced") to watch only the list of releases or documents, e.g. `#main-content .release-list` or `table.documents`. This avoids false alerts from "last updated" dates, visitor counters, rotating banners or timestamps in headers and footers.
- Open the page, right-click the list, choose Inspect, and copy a stable `id` or class for the container.
- Pages that build their list with JavaScript will not work, since only the server-delivered HTML is fetched. Look for an RSS feed or a "print"/archive view of the same list instead.
- Some sites block automated requests (you will see `HTTP 403` on the watch). Try a different page URL or a longer check interval.
- Choose a modest interval (30+ minutes) to be polite to public servers.

## How it works

1. Fetch the page (browser-like User-Agent, 20s timeout, redirects followed up to 5 hops).
2. Remove script/style/noscript/svg/iframe, take the selector's text (or `<body>`), collapse whitespace, collect absolute links, hash the text with SHA-256.
3. If the hash differs from the stored one, compare against the previous snapshot: links not seen before, and sentences/lines not seen before (max 20 each). An event is logged (last 100 kept) and an email is sent.
4. Fetch errors are shown on the watch (red dot) and never emailed.

Private and local addresses (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, IPv6 loopback/private) are rejected, including after DNS resolution and on every redirect hop.

## API

`GET/POST /api/watches`, `DELETE /api/watches/:id`, `POST /api/watches/:id/check`, `GET /api/events`, `GET/PUT /api/settings`, `POST /api/test-email`, `POST /api/login`, `POST /api/logout`.
