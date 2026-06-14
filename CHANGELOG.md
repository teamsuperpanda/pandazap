# Changelog

All notable changes to this project will be documented in this file.

## [1.0.6] - 2026-06-15
- **Fix:** Deletion now only acts on source-tagged notes - removing the dangerous fallback that could delete cards from other notes sharing a deck (reported issue)
- **Fix:** Reading-mode DOM processor now uses custom marker names (Q:/A:/I: were hardcoded)
- **Fix:** Empty marker settings normalize to defaults instead of matching bare `:`
- **Fix:** Note cache stores all duplicate Front values (was last-write-wins); prefers source-tagged entries
- **Fix:** Image filenames are now unique per source file (`pandazap_hash_filename.ext` prevents collisions)
- **Fix:** Markdown image paths with spaces and quoted titles parse correctly (was `split(' ')[0]`)
- **Fix:** HTML normalization added for Anki field comparison (entities, `<br>`, `<div>`, whitespace)
- **Fix:** Broad catch blocks now log to `console.warn` instead of swallowing silently
- **Fix:** `DEFAULT_TIMEOUT_MS` wired into AnkiConnect request retry backoff
- **Refactor:** Shared marker handling extracted to `src/sync/markers.ts`; media utilities to `src/sync/mediaUtils.ts`
- **Tests:** 30 new tests across 3 new suites (markers, media utils, path-with-spaces, empty-marker fallback)
- **Docs:** `docs/writing-cards.md` rewritten with more examples and clearer structure

## [1.0.5] - 2026-06-04
- **Fix:** Multiple notes targeting the same deck no longer delete each other's cards
- Each note is source-tagged so deletion detection is scoped per-file
- ESLint 10 upgrade
- Badge now tracks latest release dynamically

## [1.0.4] - 2026-06-03
- Auto-detect answer content after `Q:` without requiring `A:` prefix
- Multi-line answers now supported (bullet lists, tables, numbered steps)
- Answer continues until next `Q:` or end of note

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

