# Contributing to Panda Zap

Thank you for your interest in contributing! Here's how to get started.

## Getting Started

1. Fork the repository.
2. Clone your fork: `git clone https://github.com/teamsuperpanda/pandazap.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feat/my-feature`

## Development

- Run `npm run dev` for watch mode (auto-rebuilds on changes).
- Run `npm run build` for a production build.
- Run `npm test` to run the test suite.
- Run `npm run lint` to check for lint issues.

## Code Style

- Follow the existing patterns in the codebase.
- Use Obsidian API best practices where applicable (e.g., `instanceOf()` for cross-window safety, `createSpan()`/`createDiv()` over `createEl('span')`/`createEl('div')`).
- Avoid `!important` in CSS - use increased selector specificity instead.
- No `console.log` in production code.

## Pull Request Process

1. Ensure your branch is up to date with `main`.
2. Run the full test suite and lint checks.
3. Keep PRs focused - one feature or fix per PR.
4. Write a clear PR description explaining what and why.

## Project Structure

```
src/
├── main.ts            Plugin entry point
├── dialogs/           Modal dialogs (SyncModal, PreviewModal, SettingsTab)
├── sync/              Anki sync logic (AnkiConnector, CardExtractor)
├── constants.ts       Five scalar constants (AnkiConnect version, timeout, default port/URL, plugin tag)
styles.css             Plugin styles
```

## Need Help?

Open an issue on GitHub or reach out to the team.
