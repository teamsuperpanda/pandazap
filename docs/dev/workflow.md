# Development Workflow

## Overview

Simple workflow: all work happens directly on `main` branch.

- **Development**: Work directly on `main`
- **Releases**: Tag `main` to create releases for users

## Workflow Steps

1. **Work on main**
   ```bash
   git checkout main
   git pull
   # make changes
   ```

2. **Test and commit**
   ```bash
   npm test
   npm run build
   npm run validate-manifest
   git add .
   git commit -m "your changes"
   git push
   ```

3. **Release** (when ready)
   ```bash
   # Update version in manifest.json and package.json
   git tag v1.x.x
   git push origin v1.x.x
   ```

## Continuous Integration

- **CI runs on**: pushes to main
- **Release builds on**: version tags (`v*`)
- **Tests include**: TypeScript check, unit tests, build verification, manifest validation

## Release Artifacts

Each release includes:
- `main.js` - Compiled plugin
- `manifest.json` - Plugin metadata  
- `styles/` - CSS files
