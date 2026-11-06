# ⚡ Panda Zap

<p>
  <img src="https://img.shields.io/github/v/release/teamsuperpanda/pandazap?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/status-stable-brightgreen?style=flat-square" alt="Status">
  <img src="https://img.shields.io/badge/desktop--only-8B5CF6?style=flat-square" alt="Desktop Only">
</p>

Turn Obsidian notes into Anki flashcards. Panda Zap extracts Q/A pairs from Markdown and syncs them to Anki via AnkiConnect. The sync dialog previews every add, update, and deletion, and nothing is deleted without confirmation.

> Desktop only. Requires Anki + AnkiConnect.

---

## Features

| | |
|---|---|
| **Q/A extraction** | Simple, configurable labels (`Q:` / `A:`). Bold/italic around labels is stripped automatically. |
| **Preview before sync** | See exactly what will be added, updated, or removed. |
| **Deck targeting** | Frontmatter `deck:` > first-line `Deck::` override > note-based deck naming (`folder::Note`, on by default) > global default. Deck and note type are picked from lists read from Anki. |
| **Batch sync** | Select multiple notes in the file explorer and sync them all at once via the command palette. |
| **One-step sync** | Run "Sync current note to Anki" from the command palette, or right-click one or more Markdown files and choose "Sync note to Anki" (a multi-selection shows "Sync 3 notes to Anki"). Deletions are still confirmed first. |
| **Sync on save** | Optionally sync notes that already exist in Anki shortly after you save them, with no dialog. |
| **Anki edit protection** | Cards changed directly in Anki are detected and skipped instead of being overwritten. Deletions warn you when an edited card is in the delete set. |
| **Rename safe** | Renaming or moving a note migrates its cards to the new name and deck instead of orphaning them in Anki. |
| **Media cleanup** | "Clean up orphaned media" removes uploaded images that no Anki note references any more. |
| **Connection test** | Quick status check in the sync dialog. |
| **Documentation** | Full docs at [teamsuperpanda.com/pandazap](https://teamsuperpanda.com/pandazap) |

---

## Requirements

- **Obsidian** 1.13.0 or newer - desktop app
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

4. Click the ⚡ **Sync notes to Anki** ribbon icon to open the sync dialog, review the preview, and sync.

## Documentation

Full docs with writing cards and a settings reference: [teamsuperpanda.com/pandazap](https://teamsuperpanda.com/pandazap)

---

## License

MIT License - see [`LICENSE`](LICENSE).

Privacy: see [`PRIVACY.md`](PRIVACY.md).
