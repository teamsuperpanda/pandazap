# Settings

This document explains the plugin settings and how they affect extraction and syncing.

## Settings (explanation)

### Connection

- **Anki Connect URL**
  - The hostname or URL where AnkiConnect listens. Default: `http://127.0.0.1`.
  - Enter an `http://` or `https://` URL. A bare host such as `127.0.0.1` or `localhost:8765` is treated as `http://` plus that host, and paths are kept (for example `localhost/proxy`).
  - You may include a port in the URL; the configured port below is only applied when the URL has no port of its own. Invalid values keep the last valid URL and show a message.

- **Anki Connect Port**
  - Default: `8765`.
  - If your AnkiConnect is listening on a custom port, update this setting.
  - Must be a whole number from `1` to `65535`. Values outside that range are rejected in the settings UI and fall back to `8765` when read from a corrupt `data.json`.

Keep Anki running and reachable at this address while syncing.

### Decking and targeting

- **Default Deck**
  - The Anki deck used for all cards when note-based deck organization is off, and the fallback when no `Deck::` override is present (default: `Default`).
  - Set it in the plugin settings. An empty or multi-line value is rejected in the settings UI, and falls back to `Default` when read from a corrupt `data.json`.

- **Use Note-Based Decks**
  - When enabled, Panda Zap will create or map Anki decks based on the note path in your vault (folder::NoteName). If disabled the plugin uses the configured Default Deck for all created notes.

- **Deck Override Word**
  - The word used for an explicit per-note deck override on the first line of a note (format: `Deck::my/deck/name`). Default: `Deck`.
  - Must not be empty and must not contain line breaks. A colon is allowed because the word is matched before `::`.

### Card extraction

- **Question Word / Answer Word**
  - Words the extractor looks for when parsing Q/A pairs (defaults: `Q` and `A`). These are matched case-insensitively and expected to be followed by `:`.
  - Marker words must not be empty and must not contain `:` or line breaks. They should all differ from each other; equal words are accepted with a warning, because cards may then parse unreliably.

- **Image Word**
  - Word the extractor looks for when parsing image tags (default: `I`). Matched case-insensitively and followed by `:`.
  - Follows the same marker word rules as the question and answer words.

### Note Type (IMPORTANT)

- **Note Type**
  - The Anki note type/model used when creating new notes (e.g., `Basic`, `Cloze`). Make sure this matches a model that exists in your Anki collection.
   - The plugin always writes to two fields named `Front` and `Back`. Use a Basic-style note type that has these fields.
   - Do not select Cloze or other note types that do not expose `Front` and `Back` fields - they will lead to incorrect notes or sync errors.

### Presentation

- **Bold Question in Reading Mode**
  - When enabled, the plugin highlights the question label in rendered reading mode (presentation only).

## Troubleshooting tips

- If notes are not appearing in Anki, verify the URL/port and that Anki is running with AnkiConnect installed.
- If cards look incorrect, confirm the selected Note Type exposes `Front` and `Back` fields.

For more details and examples, see `docs/writing-cards.md`.
