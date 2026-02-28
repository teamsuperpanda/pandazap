# Installation

This page covers how to install Panda Zap for everyday use and for development.

## Requirements

- Obsidian (desktop)
- Anki desktop app
- AnkiConnect add‑on (code 2055492159): https://ankiweb.net/shared/info/2055492159

> Keep Anki running while you use the plugin so AnkiConnect can accept requests.

## Community install (recommended)

1. Open Obsidian and go to Settings → Community plugins → Browse.
2. Search for "Panda Zap" and install the plugin when it appears.
3. Enable the plugin and open its settings to configure your Anki connection and default deck.

## Manual / development install

Use these steps if you need to install from source or are developing the plugin locally.

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/teamsuperpanda/pandazap.git
cd pandazap
npm install
```

2. Build the plugin:

```bash
npm run build
```

3. Copy the built plugin into your vault's plugin folder. The destination should contain the plugin's `manifest.json`, `main.js`, and `styles`:

```bash
# Replace /path/to/your/vault with your vault path
mkdir -p /path/to/your/vault/.obsidian/plugins/panda-zap
cp -r dist/* /path/to/your/vault/.obsidian/plugins/panda-zap/
```

4. In Obsidian: Settings → Community plugins → Installed plugins → enable "Panda Zap".

## Development notes

- Run the development build/watch process if available (see `package.json` scripts).
- Use the browser Dev Console (Ctrl/Cmd+Shift+I) in Obsidian for runtime errors and logs.

If you run into issues, open an issue on the project's GitHub with a minimal repro and any console output.

