Panda Zap Privacy Policy

What the plugin sends to AnkiConnect

- Note content: the full Markdown note contents are sent when performing analysis or sync operations that require finding or creating Anki notes.
- Note path / filename: the plugin may send the current note's path (for note-based deck tagging and for analysis to find previously-synced cards).
- Card fields: the plugin constructs `Front` and `Back` fields (from extracted Q/A) and sends these when creating or updating Anki notes.
- Deck and model names: the plugin may create or reference the target deck name and require the `Basic` note type (or a model exposing `Front`/`Back`).

Default behavior and remote hosts

- By default the plugin connects to `http://127.0.0.1:8765` (AnkiConnect running on the local machine).
- If you change the AnkiConnect host/port setting to point at a remote host, note content, metadata, and card fields will be transmitted to that host. You are responsible for securing that connection and the remote host.
- The plugin does not implement encryption for remote transport. If you must use a remote AnkiConnect, use a secure channel you control (for example an SSH tunnel, VPN, or HTTPS proxy under your control).

Telemetry and data collection

- This plugin collects no telemetry, analytics, or crash reports. No user data is sent to third parties by the plugin itself.

Data retention and removal

- The plugin does not store your Anki credentials or card data outside your Obsidian vault settings and the local `data.json` plugin settings file. To remove local plugin settings, disable and uninstall the plugin from your vault and remove the plugin folder from `.obsidian/plugins`.

Contact

If you have privacy concerns or want to report an issue, open a GitHub issue at https://github.com/teamsuperpanda/pandazap.
