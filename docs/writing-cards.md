# Writing cards

Panda Zap turns lines in your notes into Anki flashcards. This page shows you exactly how to write them.

## Quick start

Add a `Q:` and `A:` line anywhere in a note:

```markdown
Q: What is the capital of France? A: Paris
```

Open the note, click the zap icon, and sync. Anki gets a new card:

```
Front: What is the capital of France?
Back:  Paris
```

That is all you need to get started. Keep reading for multi-line answers, images, deck targeting, and more.

## How it works

Panda Zap scans your note for lines that start with `Q:` (question) and `A:` (answer). Everything after `Q:` becomes the front of the card. Everything after `A:` becomes the back.

You can put cards anywhere in the note - they do not need their own section. The plugin finds them all.

## Single-line cards

Put the question and answer on the same line:

```markdown
Q: What year did WW2 end? A: 1945
```

```markdown
Q: What is an atom? A: The smallest unit of matter
```

```markdown
Q: Who wrote Romeo and Juliet? A: William Shakespeare
```

Each line above creates one Anki card.

## Multi-line answers

When the answer is longer, put `Q:` on one line and the answer on the lines below. The answer keeps going until a blank line or the next `Q:`.

### Bullet list

```markdown
Q: What are the three states of matter?
- Solid
- Liquid
- Gas
```

Result: One card whose back is a bullet list.

### Numbered steps

```markdown
Q: Steps to boil an egg
1. Fill pot with water
2. Bring to a boil
3. Add egg
4. Wait 7 minutes
```

### Table

```markdown
Q: Common HTML tags
| Tag     | Purpose       |
| ------- | ------------- |
| `<p>`   | Paragraph     |
| `<a>`   | Link          |
| `<img>` | Image         |
```

### Paragraphs

```markdown
Q: What is photosynthesis?
Photosynthesis is how plants turn sunlight into energy.
It happens in the chloroplasts using a pigment called chlorophyll.
```

### Explicit A: label

You can also write `A:` to mark where the answer starts. This is optional but can make things clearer:

```markdown
Q: Explain mitosis
A:
Mitosis is cell division that produces two identical daughter cells.
It has four phases: prophase, metaphase, anaphase, and telophase.
```

## Multiple cards in one note

Just write one card after another. Each `Q:` starts a new card.

```markdown
Q: Capital of France? A: Paris
Q: Capital of Japan? A: Tokyo
Q: Capital of Brazil? A: Brasilia
```

Blank lines between cards are fine:

```markdown
Q: What is Python? A: A programming language

Q: What is Flutter? A: A UI toolkit from Google

Q: What is Docker? A: A container platform
```

## Images on cards

Add an image to the back of a card with `I:`. The image is attached to the answer side.

### Image + text answer

```markdown
Q: Identify this cell organelle
A: Mitochondrion
I: [[mitochondrion.jpg]]
```

Result: Back shows "Mitochondrion" followed by the image.

### Image-only answer (no text)

```markdown
Q: What does the UI look like?
I: [[screenshot.png]]
```

The `A:` is optional when `I:` is present. The card back contains just the image.

### Supported image formats

Obsidian links:

```markdown
I: [[diagram.png]]
I: ![[photo.jpg]]
```

Markdown syntax:

```markdown
I: ![Diagram](path/to/diagram.png)
I: ![Screenshot](assets/screenshot.png "Optional title")
```

Direct paths and URLs:

```markdown
I: images/chart.png
I: https://example.com/diagram.jpg
```

## Choosing which deck cards go to

By default, cards go to a deck named after your note's folder and filename. You can change this.

### Priority order (first match wins)

| Priority | Method | Example |
| -------- | ------ | ------- |
| 1 | First-line override | `Deck::Biology/Plants` on the very first line |
| 2 | Folder-based (if enabled) | `Biology/Plants/Photosynthesis.md` becomes deck `Biology/Plants::Photosynthesis` |
| 3 | Default deck setting | The deck you set in plugin settings |

### Deck override on first line

Put `Deck::name` on the first line of your note to send all cards in that note to a specific deck:

```markdown
Deck::Spanish/Vocab
Q: Hello A: Hola
Q: Goodbye A: Adios
Q: Thank you A: Gracias
```

Use slashes for nested decks:

```markdown
Deck::Biology/Cell-Biology
Q: What is the powerhouse of the cell? A: Mitochondrion
```

### Multiple notes in the same deck

Several notes can target the same deck. Their cards merge together. Each file's cards are tracked separately - deleting cards from one note never affects cards from another note in the same deck.

```
Note: Spanish/Vocab.md          Note: Spanish/Greetings.md
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ Deck::Spanish/Vocab         │ │ Deck::Spanish/Vocab         │
│ Q: Hello A: Hola            │ │ Q: Good morning A: Buenos   │
│ Q: Goodbye A: Adios         │ │     dias                    │
└─────────────────────────────┘ │ Q: Good night A: Buenas     │
                                │     noches                  │
                                └─────────────────────────────┘
                                      │
                                      ▼
                          Deck "Spanish::Vocab" contains:
                          Hello / Hola
                          Goodbye / Adios
                          Good morning / Buenos dias
                          Good night / Buenas noches
```

## Formatting notes

- Labels are case-insensitive: `q:`, `Q:`, `q: ` all work.
- Bold/italic around labels is stripped: `*Q:*`, `_A:_`, `**Q:**` all work.
- Extra spaces around questions and answers are trimmed.
- You can use Markdown inside answers: **bold**, *italic*, `code`, links, lists.

```markdown
Q: What is Panda Zap?
A: An **Obsidian plugin** that syncs cards to _Anki_.
   Use it with `Q: and A:` labels.
```

## What NOT to do

### Do not put cards inside code blocks

```markdown
Some text...

```markdown
Q: This will NOT be detected A: It is inside a code block
```

More text...
```

Cards inside fenced code blocks or YAML frontmatter are not extracted.

### Do not leave Q: empty

```markdown
Q:     (nothing here)
```

A question with no content produces no card.

## Cheatsheet

| Format | Example |
| ------ | ------- |
| Single line | `Q: Question A: Answer` |
| Multi-line | `Q: Question` then answer on next lines |
| With image | `I: [[image.png]]` |
| Deck override | `Deck::Name` on first line |
| Nested deck | `Deck::Subject/Topic` |
| Bold labels | `*Q:* Question *A:* Answer` |

## What is not supported

- Cloze deletions (`{{c1::...}}`). Only Basic (Front/Back) notes are supported.
- Custom field mappings. The plugin always writes to `Front` and `Back`.
- Multiple note types per note.

## Tips

- Keep questions short and answers clear - this works best for spaced repetition.
- Use the preview before syncing to check how cards will look in Anki.
- If a card is missing, check it is not inside a code block or frontmatter.

For troubleshooting and edge cases, see the main `README.md` or open a GitHub issue with a short example.
