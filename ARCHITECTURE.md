# Architecture Overview

[architecture.md](https://architecture.md/) template for rapid codebase comprehension. Update as the codebase evolves.

## 1. Project Structure

```
pandazap/
├── src/                    # Main application source code
│   ├── main.ts             # Plugin entry: PandaZapPlugin extends Plugin
│   ├── constants.ts        # AnkiConnect version, timeouts, defaults, plugin tag
│   ├── dialogs/            # Modal UI components
│   │   ├── SyncModal.ts    # Main sync dialog: connection -> analysis -> preview -> sync
│   │   ├── PreviewModal.ts # Card change preview (add/update/delete) with collapsible sections
│   │   └── SettingsTab.ts  # Settings UI using Obsidian 1.13+ getSettingDefinitions() API
│   └── sync/               # Core sync engine
│       ├── types.ts         # All TypeScript interfaces, enums, default settings
│       ├── AnkiConnector.ts # AnkiConnect HTTP client: note cache, match/diff, image upload
│       ├── CardExtractor.ts # Reading mode DOM post-processor
│       ├── extractionUtils.ts # Core parser: extracts AnkiCard[] from Markdown text
│       ├── hashUtils.ts     # FNV-1a hash -> 7-char base-36 for source tags
│       ├── imageUtils.ts    # Image resolution, base64 encoding, Anki media upload
│       └── markers.ts       # buildMarkerRegexes(): configurable Q/A/I regex generation
├── tests/                  # Test suite
│   ├── extraction.test.ts  # Q/A card extraction (single-line, multi-line, frontmatter, code blocks)
│   ├── markers.test.ts     # Regex building, custom markers, escaping, boundaries
│   ├── imageUtils.test.ts  # Filename sanitization, resolution, oversize rejection
│   ├── types.test.ts       # Default settings, enums, sync context immutability
│   ├── settingsPersistence.test.ts # Snapshot serialization, queue continuation
│   ├── validation.test.ts  # Valid/invalid card combinations
│   ├── ankiConnector.test.ts # AnkiConnect integration tests
│   ├── cardExtractor.test.ts # DOM processing tests
│   ├── extractionUtilsExtra.test.ts # Additional extraction edge cases
│   └── imageExtraction.test.ts # Image path parsing from Markdown formats
├── docs/                   # User documentation
│   ├── installation.md     # Community and manual install steps
│   ├── settings.md         # Settings reference guide
│   └── writing-cards.md    # Card writing guide (formats, images, deck targeting)
├── styles.css              # Plugin CSS: modals, pills, buttons, status indicators
├── manifest.json           # Obsidian plugin manifest
├── versions.json           # Plugin version -> min Obsidian app version mapping
├── main.js                 # Built output (bundled via esbuild, single file)
├── esbuild.config.mjs      # Production build config (CJS, ES2018, tree-shaking)
├── version-bump.mjs        # Syncs npm version into manifest.json + versions.json
├── vitest.config.ts        # Vitest config (Node env, v8 coverage)
├── tsconfig.json           # TypeScript config (ES2018, bundler resolution)
├── eslint.config.js        # ESLint config (obsidianmd plugin rules)
├── .prettierrc             # Prettier formatting config
├── package.json            # npm scripts, dependencies
├── package-lock.json       # Locked dependency versions
├── README.md               # Project overview
├── CONTRIBUTING.md         # Contribution guidelines
├── CHANGELOG.md            # Release notes for all versions
├── PRIVACY.md              # Data flow and privacy disclosure
└── ARCHITECTURE.md         # This document
```

## 2. High-Level System Diagram

```
[Obsidian Desktop App]
        |
        +--> [Panda Zap Plugin] (TypeScript, esbuild)
                    |
                    +--> [AnkiConnect] (HTTP JSON-RPC, 127.0.0.1:8765)
                                |
                                +--> [Anki Desktop App]
                                            |
                                            +--> [Anki SQLite Database]
```

Panda Zap converts Markdown notes from the Obsidian vault into Anki flashcards. Cards are tagged with source hashes for scoped update/delete tracking. Anki is always the sync target — Panda Zap never stores card data independently.

## 3. Core Components

### 3.1. Obsidian Plugin

**Name:** Panda Zap

**Description:** Desktop-only Obsidian plugin that extracts Q/A card pairs from Markdown notes and syncs them to a local Anki instance via AnkiConnect. Features preview of additions, updates, and deletions before syncing. Supports single-note and batch (multi-file) sync. Configurable marker words, deck targeting, and image embedding.

**Technologies:** TypeScript 5.9, Obsidian API 1.13+, esbuild

**Platform:** Desktop only (`isDesktopOnly: true`)

### 3.2. Markdown Extraction Engine

**Name:** extractionUtils + markers

**Description:** Parses Markdown text to extract `AnkiCard[]` objects. Handles single-line `Q: ... A: ...` patterns, multi-line questions, YAML frontmatter stripping, fenced code block skipping, and customizable marker words. Supports inline wikilink images and Markdown image syntax.

**Technologies:** Pure TypeScript, regex-based parsing

**Key features:**
- Customizable Q/A/I marker words (via settings)
- Multi-line question support (answer follows until blank line)
- Code fence awareness (backtick and tilde fences)
- YAML frontmatter exclusion
- Bold marker wrapping support (`**Q:**`)

### 3.3. AnkiConnect Client

**Name:** AnkiConnector

**Description:** HTTP JSON-RPC client for the AnkiConnect add-on. Prefetches note cache via `findNotes` + `notesInfo`, compares field content with normalized matching (HTML entities, `<br>`/`<div>`/`<p>` to newline conversion), and categorizes cards into ADD, UPDATE, or DELETE actions. Handles image upload via `storeMediaFile` with filename collision prevention.

**Technologies:** HTTP JSON-RPC 2.0, AnkiConnect v6 API

**AnkiConnect actions used:** `version`, `createDeck`, `findNotes`, `notesInfo`, `addNote`, `updateNoteFields`, `updateNoteTags`, `deleteNotes`, `storeMediaFile`

### 3.4. Source Tagging System

**Name:** hashUtils + source tags

**Description:** Each synced note gets an Anki tag like `source:folder_note_<7char_hash>` (FNV-1a hash of the vault file path, encoded as 7-char base-36). This scopes deletion and update detection to individual source files, allowing multiple notes targeting the same Anki deck without interference.

**Technologies:** FNV-1a hashing, base-36 encoding

### 3.5. Image Processing

**Name:** imageUtils

**Description:** Resolves image paths from Obsidian vault (wikilinks, Markdown syntax, raw paths) or downloads from HTTP(S). Converts to base64, removes data URI prefix, and uploads to Anki's media collection via `storeMediaFile`. Dual FNV-like hash (14 characters) in filenames prevents collisions. Rejects files larger than 10 MB.

**Technologies:** Obsidian `metadataCache`, `requestUrl`, base64 encoding

## 4. Module Boundary Convention

- **`src/main.ts`** — Plugin entry point. Registers ribbon icon, commands, settings tab, and Markdown post-processor. Delegates sync operations.
- **`src/sync/`** — Core sync engine. Contains all business logic for extraction, Anki communication, image handling, and hashing. No Obsidian UI imports.
- **`src/dialogs/`** — Modal UI components using Obsidian's `Modal` base class. Imports from `sync/` for data.
- **`src/constants.ts`** — App-wide magic values and configuration defaults.

**Dependency rule:** `dialogs/` may import from `sync/`. `sync/` never imports from `dialogs/`. `main.ts` imports from both.

## 5. Data Stores

### 5.1. Plugin Settings

**Name:** Obsidian Plugin Data (`data.json`)

**Type:** JSON file in `.obsidian/plugins/panda-zap/`

**Purpose:** Persists `PandaZapSettings` via Obsidian's `Plugin.loadData()` / `Plugin.saveData()` API.

**Key fields:** `ankiConnectUrl`, `ankiConnectPort`, `defaultDeck`, `questionWord`, `answerWord`, `imageWord`, `deckOverrideWord`, `noteType`, `useNoteBased`, `boldQuestionInReadingMode`

### 5.2. Anki Collection

**Name:** Anki SQLite Database

**Type:** SQLite (via Anki Desktop)

**Purpose:** Target data store for flashcards. All cards are stored in Anki's collection, tagged with `panda-zap`, `obsidian`, and per-source tags.

### 5.3. Anki Media

**Name:** Anki `collection.media` folder

**Type:** File system directory

**Purpose:** Stores embedded images with filenames like `pandazap_<14char_hash>_<sanitized_name>.<ext>`.

## 6. External Integrations / APIs

- **AnkiConnect:** Local HTTP JSON-RPC on `127.0.0.1:8765` (version 6). Required runtime dependency — must be installed separately as an Anki add-on.
- **No external network requests:** All communication is localhost only. No telemetry, no analytics.

## 7. Deployment & Infrastructure

- **CI/CD:** GitHub Actions (`ci.yml`, `release.yml`)
  - **CI** (push/PR): typecheck → lint → format check → test → build → verify artifacts
  - **Release** (tag push): build + extract changelog + attest provenance + GitHub release
- **Platform:** Obsidian Desktop (Linux, macOS, Windows)
- **Build:** esbuild bundles into single `main.js` (CommonJS, ES2018 target). `obsidian` module external.
- **Versioning:** npm `version` script syncs to `manifest.json` and `versions.json` via `version-bump.mjs`
- **Dependabot:** Weekly npm and GitHub Actions updates (grouped by minor/patch)

## 8. Security Considerations

- **Local only:** All communication is on `127.0.0.1:8765` — no data leaves the machine
- **No encryption:** Plugin data and Anki data are local files with OS-level access controls
- **No authentication:** AnkiConnect has no auth by default; assumes trusted local environment
- **Image safety:** Only http/https URLs and local vault files accepted for image embedding
- **10 MB image limit:** Prevents resource exhaustion from oversized images

## 9. Development & Testing

- **Testing:** Vitest 4.1 with v8 coverage (~10 test files). Mocking via `vi.mock()` and `vi.fn()`.
- **Linting:** ESLint 10 + `eslint-plugin-obsidianmd` + TypeScript rules
- **Formatting:** Prettier 3.8
- **Type checking:** `tsc --noEmit`
- **Local dev:** `npm run dev` starts esbuild in watch mode
- **Coverage output:** text, JSON, and HTML reports

## 10. Future Considerations

- **Cloze note type support:** Add support for `{{c1::...}}` cloze deletion cards
- **Custom field mapping:** Allow users to map to arbitrary Anki note type fields
- **Two-way sync:** Read changes made in Anki back into Obsidian notes
- **Media optimization:** Image resizing before upload to reduce Anki media storage
- **Mobile support:** Investigate Obsidian mobile plugin compatibility

## 11. Project Identification

**Project Name:** Panda Zap

**Repository URL:** https://github.com/teamsuperpanda/pandazap

**License:** MIT

**Date of Last Update:** 2026-07-24

## 12. Glossary

**Anki:** Open-source spaced repetition flashcard program

**AnkiConnect:** Anki add-on that exposes an HTTP JSON-RPC API for programmatic card management

**Obsidian:** Markdown-based knowledge base and note-taking application with a plugin ecosystem

**AnkiCard:** Internal type representing a flashcard: `{question, answer, image?, line}`

**SyncContext:** Frozen snapshot of extracted cards and note content at the start of a sync operation

**Source tag:** Anki tag in format `source:<path_hash>` that binds a note to its source vault file

**esbuild:** Fast JavaScript/TypeScript bundler written in Go

**Vitest:** Vite-native unit test framework for TypeScript/JavaScript
