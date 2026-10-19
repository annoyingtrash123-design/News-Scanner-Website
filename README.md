# News Scanner

Watches web pages and emails you when they change, with a special alert when new documents (PDF, Word, Excel, ...) are linked. It runs for free on GitHub: a scheduled GitHub Action checks your pages every ~30 minutes, and a small website (GitHub Pages) lets you manage the list. No server needed.

## Setup (about 10 minutes)

1. **Make the repo public.** GitHub Pages and unlimited Action minutes are free for public repos. Note that your watchlist (`data/watchlist.json`) is then visible to anyone. Private repos need a paid plan for Pages; alternatively keep it private and just open `public/index.html` from your computer.
2. **Add email secrets.** Repo -> Settings -> Secrets and variables -> Actions -> New repository secret. Gmail example (create an app password at myaccount.google.com/apppasswords):

   | Secret | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_SECURE` | `true` |
   | `SMTP_USER` | `you@gmail.com` |
   | `SMTP_PASS` | your 16-character app password |
   | `MAIL_FROM` | `News Scanner <you@gmail.com>` |
   | `NOTIFY_EMAIL` | (optional) fallback recipient; you can also set it on the website |

3. **Enable Pages.** Settings -> Pages -> Source: **GitHub Actions**. Then run Actions -> "Deploy site" -> Run workflow (it also runs on every push to `public/`). Your site is at `https://<owner>.github.io/<repo>/`.
4. **Create a token.** GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate. Resource: **only this repository**. Permissions: **Contents: Read and write** and **Actions: Read and write**.
5. **Open the site**, enter `owner/name` and the token (stored only in your browser, sent only to api.github.com), then add URLs. Set your notification email under Settings.

## How it works

- `data/watchlist.json` is edited by the website. `data/state.json` is written only by the Action (it commits it back with `[skip ci]`).
- The first check of a page is a silent baseline; emails are sent only for later changes.
- New links to `.pdf .doc .docx .xls .xlsx .csv .ppt .pptx .odt .ods .rtf .zip` are listed first in the email ("New document: ..."). With "Only alert on new documents" on, other changes are stored silently.
- After you add a page or press "Check now", the Action takes a few minutes; the site refreshes itself every 2 minutes.

## Notes

- GitHub's cron can be delayed 5-15 minutes. Scheduled workflows pause after 60 days without repo activity; the state commits count as activity, so this normally never happens.
- Government sites often have rotating banners or dates that cause false alerts. Use the CSS selector (Advanced) to watch only the list of releases, e.g. `#releases-list`.
- Private/local addresses are refused (SSRF protection).

## Local run / development

```bash
npm install
cp .env.example .env      # optional; without SMTP_HOST emails are printed to the console
npm run check             # or: node scripts/check.js <watch-id>
npm test
```
