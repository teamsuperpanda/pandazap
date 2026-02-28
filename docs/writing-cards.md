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

Place the `Q:` on one line and the `A:` on the next. The answer continues until a blank line or the next `Q:` or `A:` label. It's valid for the `A:` line to be empty (just `A:`); in that case the following non-empty lines are included until a blank line or a new label is encountered.

    ```markdown
    Q: Explain photosynthesis
    A:
    Photosynthesis is the process by which plants convert light energy into chemical energy.
    It occurs in chloroplasts and involves chlorophyll.

    Q: Next question? A: Short answer
    ```

3) Multiple cards in one note

Write multiple `Q:` / `A:` pairs in the same note. Each pair becomes a separate Basic card.

4) Deck override

Add a first line like `Deck::my/deck/name` to explicitly set the target deck for that note. This per-note override is honored regardless of the "Use Note‑Based Decks" setting. Any slashes in the override are normalized to Anki's `::` nested-deck separator.

    ```
    Deck::Biology/Plants
    Q: What organelle performs photosynthesis? A: Chloroplast
    ```

5) Small formatting notes

- Surrounding `*` or `_` around the `Q:`/`A:` labels is accepted by the extractor (so `*Q:*` or `_A:_` will match). The extractor strips surrounding asterisks/underscores from the captured question/answer text.
- Leading/trailing whitespace around questions and answers is trimmed.

Note: If a `Q:` is present without a matching `A:` on the same line or in the following lines (before the next label or a blank line), no card will be produced for that question, UNLESS an image tag (`I:`) is present.

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
- Arbitrary field mappings — the plugin only writes `Front` and `Back`.

## Tips

- Keep questions focused and answers concise for best Anki results.
- Use the preview before syncing to verify how notes will look in Anki.

For troubleshooting and edge cases, see `README.md` and open an issue with a minimal example if something looks wrong.
