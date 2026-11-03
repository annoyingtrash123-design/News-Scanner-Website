# News Scanner – Chrome extension

Checks the built-in list of 37 news and announcement pages (plus any you add) while Chrome is open, and shows what changed: new documents, new links and new text. No login, no server, no email.

## Install on a personal laptop

1. Download **news-scanner-chrome-extension.zip** from the **app-latest** release on GitHub and unzip it somewhere permanent (Chrome loads it from that folder, so don't delete it).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Pin the News Scanner icon (puzzle-piece menu, then the pin). Click the icon any time to open the full-page view.

## Using it

- The **first run is a baseline**: it records what each page looks like now. Updates appear from the next check onward.
- Chrome must be open for checks to happen. It checks about every 30 minutes (change under Sites > Settings, 15 to 1440 minutes) and shortly after Chrome starts. The icon badge shows the number of unread updates.
- **Check all now** runs a check immediately. A Chrome notification summarises new items (can be switched off in Settings).
- **Sites behind bot protection** show under "Couldn't check". Open the site once in Chrome, then press **Check all now** – the extension reuses your own browser cookies. It never tries to bypass protection.
- Pages that only show content with JavaScript can't be scanned and are reported as such.
- Add your own sites on the Sites tab (optionally limit to part of a page with a CSS selector, or alert only on new documents).
- All data stays in this Chrome profile (`chrome.storage.local`). Nothing is sent anywhere except the requests to the sites themselves.

## Development

```
node --test tests/*.test.js      # defaults parity with app/src/defaults.rs + pure logic tests
node tools/make-icons.js         # regenerate icons/
```

`lib.js` holds the pure logic (extraction, diff, noise filter), `background.js` the scheduler and storage, `offscreen.js` the fetch + DOM parsing, `ui.*` the page.
