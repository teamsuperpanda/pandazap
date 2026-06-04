# Changelog

All notable changes to this project will be documented in this file.

## [1.0.5] - 2026-06-04
- **Fix:** Multiple notes targeting the same deck no longer delete each other's cards
- Each note is source-tagged so deletion detection is scoped per-file
- ESLint 10 upgrade
- Badge now tracks latest release dynamically

## [1.0.3] - 2026-06-04
- Fixed `**Q:**` and `**A:**` (bold labels) not being hidden in reading view
- Clean up empty wrapper elements after stripping Q/A labels

## [1.0.2] - 2026-05-25
- Updated dependencies to resolve npm audit vulnerabilities (0 vulnerabilities now)
- Added overrides for vite, flatted, picomatch, postcss, yaml

## [1.0.1] - 2026-05-16
- Cross-window safety: replaced `instanceof` with `.instanceOf()` across SyncModal and CardExtractor
- Popout window compat: replaced `document.*` with `container.ownerDocument.*` in CardExtractor
- Popout window compat: replaced `setTimeout` with `activeWindow.setTimeout` in AnkiConnector
- Use Obsidian API helpers: `createSpan()` instead of `createEl('span')` in SettingsTab
- CSS: removed `!important` from disabled button style (increased specificity instead)
- Replaced deprecated `builtin-modules` dep with `module.builtinModules`
- Added CONTRIBUTING.md

## [1.0.0] - Initial release
- Initial public release of Panda Zap
- Features:
  - Extract Q/A flashcards from notes using `Q:` / `A:` syntax
  - Preview and sync cards to Anki via AnkiConnect
  - Note-based deck organization and optional deck override
  - Basic duplicate detection and update flow
- Desktop-only (requires Anki + AnkiConnect running locally)

