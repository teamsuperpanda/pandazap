# Panda Zap — Settings

This document explains the plugin settings and how they affect extraction and syncing.

## Settings (explanation)

### Connection

- **Anki Connect URL**
  - The hostname or URL where AnkiConnect listens. Default: `http://127.0.0.1`.
  - You may include a protocol (http://) and even a port; the plugin will normalize the URL and apply the configured port if none is present.

- **Anki Connect Port**
  - Default: `8765`.
  - If your AnkiConnect is listening on a custom port, update this setting.

Keep Anki running and reachable at this address while syncing.

### Decking and targeting

- **Default Deck**
  - The fallback Anki deck to use when the plugin cannot determine a note-based deck or no `Deck::` override is present.

- **Use Note-Based Decks**
  - When enabled, Panda Zap will create or map Anki decks based on the note path in your vault (folder::NoteName). If disabled the plugin uses the configured Default Deck for all created notes.

- **Deck Override Word**
  - The word used for an explicit per-note deck override on the first line of a note (format: `Deck::my/deck/name`). Default: `Deck`.

### Card extraction

- **Question Word / Answer Word**
  - Words the extractor looks for when parsing Q/A pairs (defaults: `Q` and `A`). These are matched case-insensitively and expected to be followed by `:`.

- **Image Word**
  - Word the extractor looks for when parsing image tags (default: `I`). Matched case-insensitively and followed by `:`.

### Note Type (IMPORTANT)

- **Note Type**
  - The Anki note type/model used when creating new notes (e.g., `Basic`, `Cloze`). Make sure this matches a model that exists in your Anki collection.
  - Note Type must be a Basic-style note. The plugin creates and updates notes using two fields named `Front` and `Back`.
  - Do not select Cloze or other models that do not expose `Front` and `Back` fields — they are not supported and will lead to incorrect notes or sync errors.

### Presentation

- **Bold Question in Reading Mode**
  - When enabled, the plugin highlights the question label in rendered reading mode (presentation only).

## Troubleshooting tips

- If notes are not appearing in Anki, verify the URL/port and that Anki is running with AnkiConnect installed.
- If cards look incorrect, confirm the selected Note Type exposes `Front` and `Back` fields.

For more details and examples, see `docs/writing-cards.md`.
