# Changelog

All notable changes to this project will be documented in this file.

## [1.0.9] - 2026-07-18
- **Feat:** Batch sync - select multiple notes in the file explorer and sync them all at once via "Panda Zap: Sync selected notes to Anki"
- **Feat:** Note type setting now exposed in plugin settings UI
- **Refactor:** Extracted shared stableHash utility to hashUtils.ts
- **Refactor:** AnkiConnector reuses instance across sync operations via updateSettings()
- **Fix:** Deletion display now gated on actual deletion API success
- **Fix:** noteType settings field has empty-value guard restoring "Basic" default
- **CI:** Added push trigger, Prettier format check, manifest.json verification
- **CI:** Dependabot now watches GitHub Actions; npm updates grouped by minor/patch
- **Chore:** Dependency updates (@types/node, @eslint/json, eslint-plugin-obsidianmd)
- **Docs:** Full documentation page at teamsuperpanda.com/pandazap

## [1.0.8] - 2026-07-13
- More reliable syncing, including safer matching when cards have similar content across different notes.
- Safer deletion checks so changes stay tied to the note that started the sync.
- Better card marker handling, with improved support for Markdown formatting and fenced code blocks.
- Safer image handling, including clearer limits and more reliable image names.
- More reliable settings saving when several options are changed quickly.
- Updated dependencies and compatibility with current supported development tools.

## [1.0.7] - 2026-06-18
- **Chore:** Dependency refresh -- dev deps bumped, zero audit vulnerabilities
- **Chore:** Minimum Obsidian version raised to 1.13.0
- **Refactor:** Settings tab migrated to Obsidian 1.13+ `getSettingDefinitions()` API
- **Fix:** Lint compliance for current Obsidian plugin rules (`instanceOf`, `window.setTimeout`)
- **Fix:** Parser now skips YAML frontmatter and fenced code blocks
- **Fix:** HTTP image downloads re-enabled (scheme restriction relaxed)
- **Fix:** `findExistingCard` falls back to untagged entries when source tag missing
- **Perf:** Reuse cached note fields instead of per-card `notesInfo` API calls
- **Cleanup:** Dead CSS partials removed; `mediaUtils.ts` merged into `imageUtils.ts`
- **Cleanup:** `NormalizedMarkers`/`normalizeSettings`/`validationErrors` inlined
- **Cleanup:** JSDoc noise removed, empty esbuild banner dropped
- **Tests:** 3 new parser tests (YAML frontmatter, fenced code blocks)

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
