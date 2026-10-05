# Atlas VTT Connect

Atlas VTT Connect is an Obsidian plugin that adds online play and sharing to [Atlas VTT](https://github.com/ByteMirror/atlas-vtt):
- hosting a session;
- a web page players use to join;
- an Obsidian player tab;
- note and map sharing.

It works on top of an unmodified Atlas VTT, through Atlas's extension API.

**Status:** being built. The implementation plan is in [docs/plans/2026-10-04-extension-api-and-connect.md](docs/plans/2026-10-04-extension-api-and-connect.md).

Licence: AGPL-3.0-only. Connect contains code from Atlas VTT.

## Moving from the online preview

Connect takes over the online preview's settings, people and shares on its first start. One thing works differently once:
- **Maps you received before.** A map someone shared with you before Connect ran on Atlas VTT with extension API 1.13 (including every map the online preview received) cannot be updated in place.
- **The next new version of each such map** arrives as a second scene beside your copy, for example "Inn (2)", and a notice says so. Your old copy stays as it was, and you can delete it.
- **After that,** new versions of the map replace it in place, as the preview did.

## Development

Install with `npx npm@10.9.2 ci`. The npm 10.0.0 shipped on some machines has an install bug ("Cannot read properties of null (reading 'edgesOut')").

Then run `npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npm run build`. The build writes `dist/` only; copy `dist/main.js`, `dist/styles.css` and `manifest.json` into a test vault's `.obsidian/plugins/atlas-vtt-connect/` by hand, never into your main vault.

### Syncing the vendored Atlas

`vendor/atlas` holds Atlas's extension API types and shared modules, recorded in `vendor/atlas/SOURCE.json`. `npm run check:vendor` verifies it offline. A sync replaces the whole directory. Two modes:

- **Git mode** (default): `npm run sync:atlas -- --atlas <Atlas checkout> --commit <sha>`. The checkout must be at `<sha>` with no tracked changes; the script runs `npm run build:packages` there.
- **Exported tree**: `npm run sync:atlas -- --source <dir> --commit <full sha>`. Use this when the checkout is busy or on another branch. Export the tag (`git archive <tag> | tar -x -C <dir>`), link or install `node_modules`, run `npm run build:packages` in `<dir>`, then sync. `<dir>` needs `dist-packages`, `api-report` and `tests/api`; the script reads the contract case ids from those files and does not use git.
