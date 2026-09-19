# dia-ry

A calm photo diary that installs on an iPhone home screen. Plain HTML, CSS and
JavaScript — no framework, no build step, no server, no account. Everything you
write stays in the browser's own database on the device.

![home](docs/home.png)

## What it does

- **Notes and entries.** A note is a page (a day, a place, a mood). Inside it,
  entries stack up on a timeline with the time in the left margin, exactly like
  a paper diary.
- **Photos.** Pick as many as you like per entry. They are compressed on the
  device (1800px long edge) with a separate thumbnail, so scrolling stays fast
  and years of photos still fit.
- **Rich text.** Bold, italic, underline, strikethrough, highlight, bullets and
  quotes. Pasted text comes in clean.
- **Search** across every title, place and word you have written.
- **Themes.** Six palettes, light / dark / follow-system, and a text-size slider.
- **Offline.** Works with no signal once installed.
- **Backups.** One tap produces a `.zip` holding `diary.json` plus every photo
  as an ordinary `.jpg`. Restore merges or replaces.

## Install on iPhone

1. Host the folder over HTTPS (see below) and open the URL in **Safari**.
2. Tap the share button → **Add to Home Screen**.
3. Open it from the home screen. It runs full screen with no browser chrome.

Safari is required for the install step — Chrome on iOS cannot add PWAs.

## Hosting

Any static host works; there is nothing to build.

**GitHub Pages** — push to `main` and the included workflow
(`.github/workflows/pages.yml`) publishes the site. Enable it once under
*Settings → Pages → Source: GitHub Actions*.

**Locally** — `npx http-server -p 8080 .` then open `http://localhost:8080`.
Service workers need HTTPS or `localhost`.

## Where your diary lives

IndexedDB, in the browser, on that one device. Nothing is uploaded anywhere.

That also means: **nothing is backed up for you.** Two things to know if you
plan to keep this for years.

1. Run **Settings → back up to a zip file** now and then and put the zip
   somewhere else — iCloud Drive, a computer, an external disk. The app nudges
   you monthly.
2. Deleting the app from the home screen, or "Clear website data" in Safari,
   erases the diary. The app asks iOS to mark its storage persistent, which
   protects it from routine eviction, but not from a deliberate wipe.

A backup zip is readable without this app: `diary.json` is plain text and the
photos are normal JPEGs.

## Project layout

```
index.html              app shell, all screens
css/app.css             themes + layout (every colour is a token)
js/db.js                IndexedDB open/transaction helpers
js/store.js             notes, entries, photos, settings
js/images.js            downscale + compress on the device
js/zip.js               hand-written ZIP reader/writer
js/backup.js            export / restore
js/ui.js                sheets, toast, lightbox
js/views/               home, note, composer, settings
sw.js                   offline shell cache
scripts/make-icons.mjs  regenerates icons/ (node scripts/make-icons.mjs)
```

## Keeping it working for years

- The database schema is **versioned and additive only** — `js/db.js` must never
  drop or repurpose an existing store, so an old diary always opens.
- Backup files carry a `format` number. A newer backup is refused by an older
  app rather than half-imported.
- There are no dependencies to rot. The only tooling is Node, and only for
  regenerating icons.
- After changing any shell file, bump `CACHE` in `sw.js` so installed copies
  pick the change up.
