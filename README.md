# Atlas VTT Connect

Atlas VTT Connect is an Obsidian plugin that adds online play and sharing to [Atlas VTT](https://github.com/ByteMirror/atlas-vtt):
- hosting a session;
- a web page players use to join;
- an Obsidian player tab;
- note and map sharing.

Connect is an independent plugin, not made by or affiliated with the Atlas VTT author. It works on top of Atlas VTT through Atlas's extension API and changes nothing in Atlas.

## What you need

- Obsidian 1.8.7 or newer, on desktop.
- **Atlas VTT with extension API 1.13 or newer.** This is not in any released Atlas yet: Atlas 0.6.0 does not have the API, because it is not merged upstream. Until it is, Connect needs an Atlas build that includes the extension API, which means the build of the API branch (`api/extension-api`; see Developing below for how to build it). Connect is built against API 1.13.0. Without the API, Connect shows a notice and stays off.
- TODO (fill in once upstream ships it): the first Atlas release that includes the extension API.
- The Atlas extension API build is the repository `evolJoaoBento/atlas-vtt`, branch `api/extension-api`. Once that branch is pushed and public, build Atlas from it (see Developing). Until then nobody but the maintainer can get a working Atlas for Connect.

## Install with BRAT

1. Install the BRAT plugin and Atlas VTT (a build with the extension API, see above).
2. In BRAT, choose "Add beta plugin" and enter `evolJoaoBento/atlas-vtt-connect`.
3. Enable Atlas VTT Connect in Settings, Community plugins.

TODO (fill in when the first release is published): the release version to pick in BRAT.

## Hosting and joining

- **Host.** Open a map in Atlas, present it, then run **Online session** from the command palette or the Atlas toolbar. Start the session, copy the join link and send it to your players. Players open it in a browser, or paste it into **Join online session…** in Obsidian.
- **Settings.** Settings, Atlas VTT Connect: Signaling server (and My own server), Relay (TURN) servers, Player page, Shared note properties, Keep online images on this device and Log online play events.
- **Players** can move the tokens you assign under **Controlled by**, point with a laser and roll dice.

## Sharing

Commands: **People…**, **Share with…**, **Ask to pull…**, **Shared with me…**, **Undo last merge** and **Forget remembered choice**. Nothing is shared until you share it, and only with the people you pick. Private parts of a note stay private. See [PRIVACY.md](PRIVACY.md).

## Hosts it talks to

- PeerJS cloud signalling, `0.peerjs.com`, unless you set a custom server.
- The STUN server `stun.l.google.com:19302`.
- The player page at `evoljoaobento.github.io/atlas-vtt-connect`.
- Any TURN servers you add.

Details of what is sent to whom are in [PRIVACY.md](PRIVACY.md).

## The player page

By default the join link points at `https://evoljoaobento.github.io/atlas-vtt-connect/`. To host your own:

1. Fork the repository and push it.
2. In the repository's Settings, Pages, set the source to **GitHub Actions**. The workflow `.github/workflows/pages.yml` then publishes the page when you push to `main`.
3. Set **Player page** in Connect's settings to your page's address.

Until a page is published, the default address serves nothing. To try the page locally, run `npm run build:page`, then `npx vite preview -c vite.page.config.mts`, and paste the address it prints into **Player page**.

## Moving from the online preview

Connect takes over the online preview's settings, people and shares on its first start. One thing works differently once:
- **Maps you received before.** A map someone shared with you before Connect ran on Atlas VTT with extension API 1.13 (including every map the online preview received) cannot be updated in place.
- **The next new version of each such map** arrives as a second scene beside your copy, for example "Inn (2)", and a notice says so. Your old copy stays as it was, and you can delete it.
- **After that,** new versions of the map replace it in place, as the preview did.

What the move leaves behind is described in [PRIVACY.md](PRIVACY.md).

## Developing

Install with `npx npm@10.9.2 ci`. The npm 10.0.0 shipped on some machines has an install bug ("Cannot read properties of null (reading 'edgesOut')").

Then run `npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npm run build`. `npm run build` writes `dist/` only. Copy `dist/main.js`, `dist/styles.css` and `manifest.json` by hand into a test vault's `.obsidian/plugins/atlas-vtt-connect/`, never into your main vault. `npm run build:page` builds the join page into `dist-page/`.

To test against a real Atlas, check out the Atlas branch `api/extension-api` of `evolJoaoBento/atlas-vtt`, build it with `npm run build:ci` (which never copies into a vault), and copy its `main.js`, `styles.css` and `manifest.json` into the test vault's `.obsidian/plugins/atlas-vtt/` the same way.

### Syncing the vendored Atlas

`vendor/atlas` holds Atlas's extension API types and shared modules, recorded in `vendor/atlas/SOURCE.json`. `npm run check:vendor` verifies it offline. To re-vendor, run `npm run sync:atlas -- --atlas <dir> --commit <sha>`. A sync replaces the whole directory. Two modes:

- **Git mode** (default): `npm run sync:atlas -- --atlas <Atlas checkout> --commit <sha>`. The checkout must be at `<sha>` with no tracked changes; the script runs `npm run build:packages` there.
- **Exported tree**: `npm run sync:atlas -- --source <dir> --commit <full sha>`. Use this when the checkout is busy or on another branch. Export the tag (`git archive <tag> | tar -x -C <dir>`), link or install `node_modules`, run `npm run build:packages` in `<dir>`, then sync. `<dir>` needs `dist-packages`, `api-report` and `tests/api`; the script reads the contract case ids from those files and does not use git.

### Test inventory

`npm run inventory -- --atlas <Atlas checkout>` compares the test files per area with the online play preview's, and exits 1 when an area has fewer files than it should.

### Releasing

A tag that matches the version in `manifest.json` (for example `0.1.0`, or `0.1.0-beta.1` for a pre-release) triggers `.github/workflows/release.yml`, which checks, builds and attaches `main.js`, `styles.css` and `manifest.json` to a GitHub release, as BRAT expects. Tagging and pushing are manual steps. The release notes are a fixed line; put what changed in the release description by hand.

Release checklist, before the first tag:

1. Push the Atlas extension API branch to `evolJoaoBento/atlas-vtt` (branch `api/extension-api`) and check that it is public, as named in this README and in THIRD_PARTY_NOTICES.md. Connect's source for the vendored Atlas code must be reachable (AGPL).
2. Run `npm run sync:atlas` once from that public location, so `vendor/atlas/SOURCE.json` names its `repository` and `branch`.
3. Fill the version TODOs in this README: the first Atlas release with the extension API, and the release version to pick in BRAT. Remove the lines when done.
4. Check that `manifest.json`'s `version`, the key in `versions.json` and the tag are the same, and that `minAppVersion` is right.
5. Enable Pages (source "GitHub Actions") and let `pages.yml` publish the player page, so the default address serves it.
6. Run the verify block (`npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run check:vendor`), then tag and push.

## Licence

AGPL-3.0-only, see [LICENSE](LICENSE). Connect contains code from Atlas VTT (AGPL-3.0-only, © Fabian Urbanek) and open-source packages; credits and licence texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
