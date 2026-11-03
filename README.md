# LexiCards for Android

An offline English flashcard app with Android text-to-speech, spaced review, nested decks, learning statistics, and text capture through Android's Share menu.

The Android shell is Kotlin. The bundled HTML/CSS/JavaScript interface and SQL.js run locally in WebView; no CDN or account is required to open your cards. Android 8.0+ and a current Android System WebView are required.

## Version 0.6.0

- Five persistent bottom tabs and a clear daily review action.
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

The browser tests serve bundled assets through Playwright interception and block external requests. They verify persistence, import/export, drafts, sharing, scheduling, statistics, hierarchy and mobile interactions. `CHROMIUM_PATH` optionally selects an existing Chromium binary.

GitHub Actions builds the debug APK, runs Android and interface checks, and attaches reports and screenshots to each run.

## Data and voices

Card data stays on the device. Full `.sqlite` backups include cards, hierarchy, scheduling and review history. CSV preserves cards, scheduling and deck paths; it does not contain the review journal or empty decks.

Install English UK/US voices through Android TTS settings to pronounce words offline. YouGlish opens in an external browser and requires a network connection.

SQL.js is distributed under its MIT license in `app/src/main/assets/vendor/LICENSE.sql.js`. See [the Russian guide](README_RU.md) for app usage.
