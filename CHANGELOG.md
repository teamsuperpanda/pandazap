# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-11-07
- Pick the default deck and note type from dropdowns filled from your Anki collection instead of typing names by hand.
- Set a deck per note with a `deck:` key in YAML frontmatter. It wins over a first-line `Deck::` override.
- Sync the current note in one step from the command palette, or right-click one or more Markdown files and choose "Sync note(s) to Anki". Deletions are still confirmed first.
- Optionally sync notes that already exist in Anki shortly after you save them, without a dialog.
- Cards stay attached to their note when you rename or move it: source tags and decks are migrated, and a pending migration is retried if Anki was unreachable at the time.
- Run "Clean up orphaned media" to remove images uploaded by Panda Zap that no Anki note references any more. The list is verified before and after you confirm.
- Cards changed directly in Anki are detected and skipped instead of overwritten. "Overwrite changes made in Anki" makes sync use your note's version instead; sync on save always skips them.
- Only one sync dialog runs at a time. The sync screen shows per-card progress and lets you cancel, keeping the cards already processed.
- Fixed: notes sharing the default deck could update or delete another note's cards. A sync now only touches its own note, and an emptied note can remove the cards it left behind.
- Fixed: cards are no longer extracted from indented code blocks or HTML comments.
- Fixed: the sync screen distinguishes an unreachable Anki from an outdated AnkiConnect and a protocol error, and shows an analysis error with a retry button instead of reporting the connection as down.
- Added validation for the Anki host, port, deck name and marker words in settings. Invalid values keep the last valid value, and duplicate marker words are flagged.
- Faster syncing: the deck lookup is reused between preview and sync, requests time out after 5 seconds instead of hanging, and safe requests are retried.
- Modals use Obsidian theme colours, fit screens down to 400 px, and their section headers work from the keyboard.
- Fixed: deleting a note during a direct sync stops the run before it writes any more cards.
- Fixed: a corrupt or unreadable `data.json` no longer stops the plugin from loading; settings fall back to their defaults.
- Fixed: the settings connection test result now uses the full width under its row instead of squeezing the "Test connection" button.
- Updated development dependencies to their latest compatible releases. Security advisories GHSA-g3hv-75wg-m249 (minimatch) and GHSA-4p3w-j4w9-5jqw (moment) no longer affect the dependency tree.

## [1.1.2] - 2026-10-25
- Updated dependencies and build tooling to their latest compatible releases.
- Fixed: corrected capitalization in the "No Markdown notes with cards found" notice.
- Merged pending dependency update pull requests.

## [1.1.1] - 2026-08-18
- Fixed: "Panda Zap" now shows the proper capitalization in the sync modal.

## [1.1.0] - 2026-08-17
- Sync every note in the vault at once: run "Panda Zap: Sync all notes to Anki" from the command palette.
- Syncing several notes is faster because the connection to Anki is now checked once instead of for every note.
- The removal confirmation now says how many notes are affected before cards are deleted.

## [1.0.10] - 2026-08-02
- Syncing is noticeably faster when notes have lots of cards or when a deck already has many cards in Anki.
- Large images now transfer without slowing the plugin down.
- Reading view stays quick on long notes.
- Syncing several selected notes at once now reads them all together instead of one at a time.
- Fixed: after a successful connection test, a batch sync could switch to syncing only the current note instead of the selected notes.
- Cleaned up behind the scenes and removed duplicated code.

## [1.0.9] - 2026-07-18
- Sync several notes at once: select them in the file explorer and run "Panda Zap: Sync selected notes to Anki".
- Choose which type of card to create from the settings screen.
- The sync screen now only reports removals that actually went through.
- Leaving the card type field empty in settings restores it to the default.
- Updated the tools used to build the plugin and tidied up the code behind the scenes.
- Added a full documentation page at teamsuperpanda.com/pandazap.

## [1.0.8] - 2026-07-13
- More reliable syncing, including safer matching when cards have similar content across different notes.
- Safer deletion checks so changes stay tied to the note that started the sync.
- Better card marker handling, with improved support for Markdown formatting and fenced code blocks.
- Safer image handling, including clearer limits and more reliable image names.
- More reliable settings saving when several options are changed quickly.
- Updated dependencies and compatibility with current supported development tools.

## [1.0.7] - 2026-06-18
- Cards are no longer accidentally picked up from the text at the top of a note or from blocks of code.
- Images hosted on the web can be synced again.
- Syncing is faster because the plugin reuses information it has already loaded from Anki.
- Cards are matched up with the right note more reliably, even without the source label.
- Requires Obsidian 1.13.0 or newer.
- Updated the tools used to build the plugin and tidied up the code behind the scenes.

## [1.0.6] - 2026-06-15
- Cards are only removed from Anki when they are actually gone from the note that started the sync, so notes sharing a deck no longer interfere with each other.
- The question, answer, and image labels you pick in settings are now honoured in reading view.
- Two notes with the same question but different sources are matched up correctly.
- Images are given unique names, so pictures with the same filename in different notes no longer clash.
- Image links that include spaces or a title work correctly again.
- Comparing cards with Anki is more reliable, including cards with simple formatting like line breaks.
- Rewrote the writing cards guide with more examples and a clearer structure.

## [1.0.5] - 2026-06-04
- Notes that share a deck no longer accidentally delete each other's cards.
- Each note is tracked separately, so removing a card only ever affects the note it came from.
- Updated the tools used to build the plugin.

## [1.0.4] - 2026-06-03
- An answer can follow the question directly without needing an `A:` label.
- Answers can span several lines, including bullet lists, tables, and numbered steps.
- An answer carries on until the next question or the end of the note.

## [1.0.3] - 2026-06-04
- Bold labels such as `**Q:**` and `**A:**` are now hidden in reading view.
- Empty space left behind after removing the labels is tidied up automatically.

## [1.0.2] - 2026-05-25
- Updated the tools used to build the plugin to fix security warnings.

## [1.0.1] - 2026-05-16
- The plugin now works correctly when notes are opened in a separate Obsidian window.
- Used Obsidian's own building blocks where possible to keep the plugin working smoothly as Obsidian updates.
- Added a guide for people who want to help improve the plugin.

## [1.0.0] - Initial release
- First public release of Panda Zap.
- Turn notes into flashcards using `Q:` for the question and `A:` for the answer.
- Preview changes and sync cards to Anki before anything is saved.
- Organize cards into decks based on where each note lives, or override the deck yourself.
- Cards that already exist in Anki are spotted and updated rather than duplicated.
- Desktop only: needs Anki with the AnkiConnect add-on running on your computer.
