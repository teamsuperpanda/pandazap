# Writing cards

Panda Zap extracts Basic Anki cards from your Markdown notes. This page explains the supported formats and gives examples.

Important: Panda Zap supports only Basic (Front/Back) Anki notes. The extractor writes `Front` and `Back` fields and does not generate cloze deletions or map arbitrary fields.

## Labels and basic rules

- Default labels: `Q:` for question and `A:` for answer. These are configurable in the plugin settings.
 - Labels are case‑insensitive and must be followed by a colon.
 - Avoid placing Q/A pairs inside fenced code blocks or YAML frontmatter. The text extractor operates on the raw note text and does not automatically exclude frontmatter or fenced code; placing Q/A there may produce cards. (The in-document visual processor used for bolding questions during reading mode does try to skip code elements for presentation only.)

## Supported formats

1) Single‑line Q/A

Place both the question and answer on one line.

    ```markdown
    Q: What is the capital of France? A: Paris
    ```

    This produces a Basic note with `Front` = "What is the capital of France?" and `Back` = "Paris".

2) Multi‑line answer

Place the `Q:` on one line and the answer on subsequent lines. The answer continues until a blank line or the next `Q:` label. You can use an explicit `A:` line or omit it - any content after `Q:` is treated as the answer. This supports bullet lists, tables, numbered steps, and paragraph text.

    ```markdown
    Q: What are the types of fruit?
    - Apple
    - Banana
    - Orange

    Q: Conversion rates
    | From | To | Rate |
    | --- | --- | --- |
    | USD | EUR | 0.85 |
    | EUR | USD | 1.18 |
    ```

An explicit `A:` (or `I:`) label can still be used to clearly mark the start of the answer:

    ```markdown
    Q: Explain photosynthesis
    A:
    Photosynthesis is the process by which plants convert light energy into chemical energy.
    It occurs in chloroplasts and involves chlorophyll.
    ```

3) Multiple cards in one note

Write multiple `Q:` / `A:` pairs in the same note. Each pair becomes a separate Basic card.

4) Deck targeting (priority order)

Panda Zap determines the target Anki deck using this priority:

   1. **Explicit override**  --  If the first line is `Deck::some/deck`, that deck is used. Slashes become Anki's `::` separator. This works regardless of any other setting.
   2. **Folder‑based**  --  If "Use Note‑Based Decks" is enabled and no override is present, the deck is built from the note's folder path + filename. For example, `Biology/Plants/Photosynthesis.md` → deck `Biology/Plants::Photosynthesis`.
   3. **Default deck**  --  If neither override nor folder‑based naming applies, the plugin falls back to the **Default Deck** setting.

```
Deck::Biology/Plants
Q: What organelle performs photosynthesis? A: Chloroplast
```

**Multiple files, same deck**  --  If several notes target the same deck (via `Deck::` or folder path), their cards are merged into one deck. Each file's cards are tracked independently: deleting cards from one file never touches cards from another file that shares the deck.

Setting "Use Note‑Based Decks" off means folder‑based naming is skipped  --  notes go to the Default Deck (unless they have an explicit `Deck::` override).

5) Small formatting notes

- Surrounding `*` or `_` around the `Q:`/`A:` labels is accepted by the extractor (so `*Q:*` or `_A:_` will match). The extractor strips surrounding asterisks/underscores from the captured question/answer text.
- Leading/trailing whitespace around questions and answers is trimmed.

Note: A `Q:` with no content after it (blank line or end of note) produces no card. If an `A:` line is present but empty, the following non-blank lines are captured as the answer. An image tag (`I:`) alone (without `A:`) also produces a card.

6) Images

You can include images in your cards using the `I:` label. The image will be displayed on the back of the card (Answer side).
The `A:` (Answer) field is optional if `I:` is present. This allows for "image-only" answers.

Supported formats include:
- Obsidian internal links: `[[image.png]]` or `![[image.png]]`
- Markdown links: `![Alt Text](path/to/image.png)`
- Raw paths/URLs: `path/to/image.png`

Example (Text + Image):
    ```markdown
    Q: Identify this cell organelle
    A: Mitochondrion
    I: [[mitochondrion.jpg]]
    ```

Example (Image only):
    ```markdown
    Q: What does the UI look like?
    I: [[screenshot.png]]
    ```
    This creates a card with Front "What does the UI look like?" and Back "<img src='screenshot.png'>".

## What is not supported

- Cloze deletions or Cloze note types are not supported. Do not expect `{{c1::...}}` style generation.
- Arbitrary field mappings - the plugin only writes `Front` and `Back`.

## Tips

- Keep questions focused and answers concise for best Anki results.
- Use the preview before syncing to verify how notes will look in Anki.

For troubleshooting and edge cases, see `README.md` and open an issue with a minimal example if something looks wrong.
