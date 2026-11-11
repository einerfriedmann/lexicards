# LexiCards for Android

An offline English flashcard app with Android text-to-speech, spaced review, nested decks, learning statistics, and text capture through Android's Share menu.

The Android shell is Kotlin. The bundled HTML/CSS/JavaScript interface and SQL.js run locally in WebView; no CDN or account is required to open your cards. Android 8.0+ and a current Android System WebView are required.

## Version 0.7.0

- Explicit Rename, Move and Delete actions in each deck menu. Deleting a parent shows the affected deck/card counts and requires confirmation; unrelated data and review history remain intact.
- Separate New, Due and Later states with the next review date on each card. New words never inflate the due counter.
- Deterministic study plans: oldest overdue cards first, then a configurable daily allowance of new words (20 by default, shared across decks). First attempts are recorded durably, including unsuccessful ones.
- Existing deadlines survive migration and reopening unchanged. Known answers schedule 1 day, then 3 days and progressively longer intervals; Again schedules 10 minutes.

## Interface

- A single home screen for navigation, explicit back-to-home actions, and a clear daily review action.
- No duplicated bottom menu; cards, decks, statistics and data are reachable from home.
- Focused study screens, compact UK/US audio controls and visible review intervals.
- Search, status filters, readable card rows and contextual actions.
- Collapsible nested decks with clear parent/child structure.
- Draft-preserving navigation, inline validation and optional fields in the card editor.
- Accessible SVG icons, large touch targets, visible keyboard focus and reduced-motion support.

## Build

Use JDK 17 and Android SDK 35:

```sh
./gradlew :app:assembleDebug
```

The debug APK appears in `app/build/outputs/apk/debug/`. A debug build has a different signature from the distributed release. Release signing material is kept outside Git and is never included in this repository.

## Verify

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug
npm install
npx playwright install --with-deps chromium
npm test
```

Nine scheduler checks cover fixed-time plans, deadline boundaries, daily budgets and legacy state. The 51 browser checks serve bundled assets through Playwright interception and block external requests. They verify persistence, import/export, drafts, sharing, scheduling, statistics, hierarchy and mobile interactions. `CHROMIUM_PATH` optionally selects an existing Chromium binary.

GitHub Actions builds the debug APK, runs Android and interface checks, and attaches reports and screenshots to each run.

## Data and voices

Card data stays on the device. Full `.sqlite` backups include cards, hierarchy, scheduling and review history. CSV preserves cards, scheduling and deck paths; it does not contain the review journal or empty decks.

Install English UK/US voices through Android TTS settings to pronounce words offline. YouGlish opens in an external browser and requires a network connection.

SQL.js is distributed under its MIT license in `app/src/main/assets/vendor/LICENSE.sql.js`. See [the Russian guide](README_RU.md) for app usage.
