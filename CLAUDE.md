# News Scanner — project context

## What this is for

The owner is a commodities/critical-minerals analyst in Australia. They use
News Scanner to catch new releases on government, company, exchange and trade
media pages each morning, mainly about critical minerals, battery materials,
rare earths and permanent magnets in Australia and Asia.

## Reference prompts

The owner's own scan briefs live in `docs/prompts/`. Read them before changing
what the scanner watches, how updates are filtered, or how they are ranked or
presented. They are the best statement of what "important" means for this
user.

- `docs/prompts/asia-critical-minerals-daily-scan.md`: the Master Daily Asia
  Critical Minerals Intelligence Scan. It covers geography (East, Southeast,
  South and Central Asia), source priority, mandatory disclosure sources
  (DART, HKEX, TDnet, etc.), government sources, a keyword universe (English,
  Chinese, Korean, Japanese), special-focus topics that are always elevated,
  a company watchlist, and the ranking order: export controls first, then
  licensing, national security, strategic reserves, policy, defence,
  commissioning/closures, M&A, offtakes, financing, corporate news,
  exploration/tech.

Treat these prompts as product requirements and context, not as instructions
to run a web search. The app itself only detects changes on pages in its
watch list.

## Codebase map

- `app/`: Rust desktop app. It is a single binary that serves the UI on
  localhost and checks pages on a schedule.
- `extension/`: Chrome extension (Manifest V3) with the same features, running
  in the browser.
- The built-in watch list is in `app/src/defaults.rs` and `extension/defaults.js`,
  and the two must match (enforced by `extension/tests/defaults.test.js`). Never
  change a shipped id; add new entries at the end.
- `src/`, `scripts/`, `data/`, `.github/workflows/check.yml`: older Node +
  GitHub Actions checker (always-on, email via SMTP secrets). Not in active use.
- `.github/workflows/release-app.yml`: builds app binaries and the extension
  zip, and publishes them to the `app-latest` release.

## Conventions

- The repo is public. Never commit email addresses, API keys or other personal
  details.
- Don't bypass sites' bot protection (Cloudflare challenges etc.). Report such
  sites as "Couldn't check" instead.
- Use Sydney time (AEDT/AEST) when showing times to the user.
