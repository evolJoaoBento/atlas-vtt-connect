# Developing Atlas VTT Extension - Connect

## Hosting your own player page

By default the join link points at `https://evoljoaobento.github.io/atlas-vtt-connect/`. To host your own:

1. Fork the repository and push it.
2. In the repository's Settings, Pages, set the source to **GitHub Actions**. The workflow `.github/workflows/pages.yml` then publishes the page when you push to `main`.
3. Set **Player page** in Connect's settings to your page's address.

Until a page is published, the default address serves nothing. To try the page locally, run `npm run build:page`, then `npx vite preview -c vite.page.config.mts`, and paste the address it prints into **Player page**.

## Building

Install with `npx npm@10.9.2 ci`. The npm 10.0.0 shipped on some machines has an install bug ("Cannot read properties of null (reading 'edgesOut')").

Then run `npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npm run build`. `npm run build` writes `dist/` only, as a development bundle: unminified, with an inline source map. The release builds with `NODE_ENV=production npm run build`, which is minified and has no source map; use that for a copy you hand to others. Copy `dist/main.js`, `dist/styles.css` and `manifest.json` by hand into a test vault's `.obsidian/plugins/atlas-vtt-connect/`, never into your main vault. `npm run build:page` builds the join page into `dist-page/`.

To test against a real Atlas, check out the Atlas branch `api/extension-api` of `evolJoaoBento/atlas-vtt`, build it with `npm run build:ci` (which never copies into a vault), and copy its `main.js`, `styles.css` and `manifest.json` into the test vault's `.obsidian/plugins/atlas-vtt/` the same way.

### Syncing the vendored Atlas

`vendor/atlas` holds Atlas's extension API types and shared modules, recorded in `vendor/atlas/SOURCE.json`. `npm run check:vendor` verifies it offline. To re-vendor, run `npm run sync:atlas -- --atlas <dir> --commit <sha>`. A sync replaces the whole directory. Two modes:

- **Git mode** (default): `npm run sync:atlas -- --atlas <Atlas checkout> --commit <sha>`. The checkout must be at `<sha>` with no tracked changes; the script runs `npm run build:packages` there.
- **Exported tree**: `npm run sync:atlas -- --source <dir> --commit <full sha>`. Use this when the checkout is busy or on another branch. Export the tag (`git archive <tag> | tar -x -C <dir>`), link or install `node_modules`, run `npm run build:packages` in `<dir>`, then sync. `<dir>` needs `dist-packages`, `api-report` and `tests/api`; the script reads the contract case ids from those files and does not use git.
- Both modes record `--repository` and `--branch` in SOURCE.json (default `evolJoaoBento/atlas-vtt`, `api/extension-api`); name them when syncing from elsewhere.

### Test inventory

`npm run inventory -- --atlas <Atlas checkout>` compares the test files per area with the online play preview's, and exits 1 when an area has fewer files than it should. It also lists the checks that run only beside an Atlas checkout: `throwPlan.test.ts`'s guard against upstream dice drift reads Atlas's source at the vendored commit (`ATLAS_SRC`, by default `../atlas-vtt-upstream-wt`), so CI, which has no checkout, always skips it. Run it locally after each re-vendor.

### Releasing

A tag that matches the version in `manifest.json` (for example `0.1.0`, or `0.1.0-beta.1` for a pre-release) triggers `.github/workflows/release.yml`, which checks, builds and attaches `main.js`, `styles.css` and `manifest.json` to a GitHub release, as BRAT expects. Tagging and pushing are manual steps. The workflow's release notes are a placeholder line; replace them with what changed by editing the release by hand.

Release checklist, before the first tag:

1. Push Connect's `main` to `evolJoaoBento/atlas-vtt-connect`. Until then the repository is empty: the player page, the source link and the notice links all 404, and Pages cannot deploy.
2. Push the Atlas extension API branch to `evolJoaoBento/atlas-vtt` (branch `api/extension-api`) and check that it is public, as named in the README and in THIRD_PARTY_NOTICES.md. Connect's source for the vendored Atlas code must be reachable (AGPL).
3. Run `npm run sync:atlas` once from that public location, so `vendor/atlas/SOURCE.json` names its `repository` and `branch`.
4. The BRAT versions in the README are filled in (both say "latest"; Atlas 0.6.2-beta.1 or newer). The TODO for the first upstream Atlas release with the extension API stays until that release ships.
5. Check that `manifest.json`'s `version`, the key in `versions.json` and the tag are the same, and that `minAppVersion` is right.
6. Enable Pages in the repository's settings (source "GitHub Actions"), run or wait for `pages.yml`, and check that it goes green and that the default address serves the player page.
7. Run the verify block (`npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run check:vendor && npm run build:page`), then tag and push the tag.
8. Replace the release's placeholder notes with what changed.
