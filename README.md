# ⚡ Panda Zap

Turn Obsidian notes into Anki flashcards. Panda Zap extracts Q/A pairs from Markdown and syncs them to Anki via AnkiConnect. You can preview adds, updates, and deletions before anything is written to your Anki collection.

This README is a concise user guide; developer notes and extended examples are in `docs/`.

— Desktop only (requires Anki + AnkiConnect) —

## Key features

- Extracts Q/A pairs using simple, configurable labels (defaults: `Q:` and `A:`).
- Preview adds, updates, and removals before syncing.
- Deck targeting:
	- Global default deck (plugin setting)
	- Note‑based decks that mirror `folder::NoteName`
	- Per‑note override via a first‑line header: `Deck::my/deck` (slashes normalized to Anki's `::` format)
- Creates and updates notes only as Basic (Front / Back) cards. The plugin requires a Basic note type or any model exposing fields named `Front` and `Back`.
- Quick connection test and status in the sync dialog.

## Requirements

- Obsidian on desktop
- Anki desktop app
- AnkiConnect add‑on (code 2055492159): https://ankiweb.net/shared/info/2055492159

## Quick start

1. Install Anki and AnkiConnect, then keep Anki running.
2. Install and enable Panda Zap plugin in Obsidian.
3. In a note, write cards using Q/A:

	 ```markdown
	 Q: What is the capital of France? A: Paris
	 Q: What year did World War II end? A: 1945
	 ```
4. Click the ⚡ ribbon icon (Zap) to open the sync dialog, review the preview, and sync.

Note: Preview and full analysis that detects existing Anki notes rely on a working AnkiConnect connection; for accurate add/update/delete suggestions keep Anki running with AnkiConnect enabled when using Preview or Sync.

## Writing cards (essentials)

- Supported model: Basic only (for now...). The plugin creates and updates notes using `Front` and `Back` fields. Use Anki's Basic model (or another model that exposes `Front` and `Back`) to ensure compatibility.

- Labels are case‑insensitive and must be followed by a colon: `Q:` and `A:`.

- Single‑line: `Q: [question] A: [answer]`.

- Images: `I: [[image.png]]` or `I: ![Alt](image.png)`. Attach images to the Answer field (Back of card).

- Formatting: bold or italic around labels is allowed — the extractor strips `*` and `_`.

- Avoid Q/A inside fenced code blocks or YAML frontmatter.

- Deck override: place `Deck::my/deck` on the first line to target a specific deck for that note (slashes are normalized to Anki's `::`).

Important: Cloze and other non‑Basic models are not supported. The plugin does not construct cloze deletions or map arbitrary fields.

More examples: `docs/writing-cards.md`.

## How syncing works

1. The plugin extracts Q/A pairs from the active note.
2. It analyzes existing Anki notes to decide what to add, update, or remove.
3. You can preview all changes in a modal before syncing.
4. If note‑based decks are enabled, the plugin can also detect cards previously made from the same note that no longer exist and ask to delete them from Anki (with confirmation).

Notes
- Communication is via AnkiConnect’s local HTTP API. Keep Anki open.

## Settings (at a glance)

- Anki Connect URL and Port (defaults: `http://127.0.0.1` and `8765`).
- Default Deck.
- Use Note‑based Decks (mirror `folder::NoteName`).
- Deck Override Word (first‑line prefix, default `Deck`).
- Question/Answer Words (defaults `Q` / `A`).
 - Note Type (must be `Basic` — the plugin uses `Front` and `Back` fields).
 - Bold Question in Reading Mode (presentation only).

Details: `docs/settings.md`.

## Troubleshooting

- “Not connected to Anki” → Ensure Anki is open and AnkiConnect is installed; check host/port.
- “Duplicate” errors → The note likely already exists; the plugin will skip when safe.
- Missing cards → Confirm your Q/A lines aren’t inside code blocks or frontmatter.
- See Obsidian’s Dev Console (Ctrl/Cmd+Shift+I) for error messages.

If you’re stuck, please open a GitHub issue with a small repro (a few lines of the note) and any console output.

## Privacy & security

Panda Zap talks to AnkiConnect over HTTP (default `http://127.0.0.1:8765`). See `PRIVACY.md` for full details. In brief, the plugin may transmit the following to the configured AnkiConnect host:

- Full note content (for analysis and sync)
- Note path / filename (used when note-based decks are enabled)
- Card fields (`Front` and `Back`) and the target deck/model names

By default the plugin connects to localhost only. If you point the plugin to a remote host you are responsible for securing that transport (for example using an SSH tunnel or VPN). This plugin collects no telemetry (see `PRIVACY.md`).

## License

MIT — see `LICENSE`.


