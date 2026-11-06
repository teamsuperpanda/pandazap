Panda Zap Privacy Policy

What the plugin sends to AnkiConnect

- Card fields: the `Front` and `Back` fields built from each extracted Q/A pair, sent when creating or updating Anki notes. When a card embeds an image, `Back` references the uploaded media filename.
- Deck and model names: the target deck name (from a first-line `Deck::` override, the note path when note-based decks are enabled, or the configured default deck) and the configured note type (model) name.
- Tags: `panda-zap`, `obsidian`, and a per-source tag derived from the note path. The source tag contains a hash of the path and, when it fits within Anki's tag length limit, a sanitized path prefix.
- Lookup and cleanup calls: `findNotes` queries (deck name plus tags), then `notesInfo`, `updateNoteFields`, `updateNoteTags` or `deleteNotes` for the returned note IDs.

What stays local

- Note content: full Markdown note text is never sent to AnkiConnect. It is read locally to extract cards, to read a first-line `Deck::` override, and to decide whether the legacy source tag is used.
- No telemetry, analytics, or crash reports are sent anywhere.

Default behavior and remote hosts

- By default the plugin connects to `http://127.0.0.1:8765` (AnkiConnect running on the local machine).
- If you change the AnkiConnect host/port setting to point at a remote host, the card fields, deck/model names, tags and note IDs listed above will be transmitted to that host. You are responsible for securing that connection and the remote host.
- The plugin does not implement encryption for remote transport. If you must use a remote AnkiConnect, use a secure channel you control (for example an SSH tunnel, VPN, or HTTPS proxy under your control).
- Image URLs: when a card references a remote image by `http(s)://` URL, the plugin downloads it from that URL so it can be uploaded to Anki media. That request goes to the host named in the image URL.

Data retention and removal

- The plugin does not store your Anki credentials or card data outside your Obsidian vault settings and the local `data.json` plugin settings file. To remove local plugin settings, disable and uninstall the plugin from your vault and remove the plugin folder from `.obsidian/plugins`.

Contact

If you have privacy concerns or want to report an issue, open a GitHub issue at https://github.com/teamsuperpanda/pandazap.
