# ⚡ Panda Zap

<p>
  <img src="https://img.shields.io/github/v/release/teamsuperpanda/pandazap?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/status-stable-brightgreen?style=flat-square" alt="Status">
  <img src="https://img.shields.io/badge/desktop--only-8B5CF6?style=flat-square" alt="Desktop Only">
</p>

Turn Obsidian notes into Anki flashcards. Panda Zap extracts Q/A pairs from Markdown and syncs them to Anki via AnkiConnect, with full preview of adds, updates, and deletions before anything touches your collection.

> Desktop only. Requires Anki + AnkiConnect.

---

## Features

| | |
|---|---|
| **Q/A extraction** | Simple, configurable labels (`Q:` / `A:`). Bold/italic around labels is stripped automatically. |
| **Preview before sync** | See exactly what will be added, updated, or removed. |
| **Deck targeting** | Per-note override > folder-based naming > global default. Multiple files can share a deck, cards merge safely. |
| **Batch sync** | Select multiple notes in the file explorer and sync them all at once via the command palette. |
| **Connection test** | Quick status check in the sync dialog. |
| **Documentation** | Full docs at [teamsuperpanda.com/pandazap](https://teamsuperpanda.com/pandazap) |

---

## Requirements

- **Obsidian** - desktop app
- **Anki** - desktop app
- **AnkiConnect** - [add-on 2055492159](https://ankiweb.net/shared/info/2055492159)

---

## Quick start

1. Install **Anki** and **AnkiConnect**, then keep Anki running.
2. Install and enable **Panda Zap** in Obsidian.
3. In a note, write cards using Q/A:

   ```markdown
   Q: What is the capital of France? A: Paris
   Q: What year did World War II end? A: 1945
   ```

4. Click the ⚡ **Zap** ribbon icon to open the sync dialog, review the preview, and sync.

## Documentation

Full docs with writing cards, settings reference, and troubleshooting: [teamsuperpanda.com/pandazap](https://teamsuperpanda.com/pandazap)

---

## License

MIT License - see [`LICENSE`](LICENSE).

Privacy: see [`PRIVACY.md`](PRIVACY.md).
