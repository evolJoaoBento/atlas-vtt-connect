# Atlas VTT Connect

Atlas VTT Connect is an Obsidian plugin that adds online play and sharing to [Atlas VTT](https://github.com/ByteMirror/atlas-vtt):
- hosting a session;
- a web page players use to join;
- an Obsidian player tab;
- note and map sharing.

Connect is an independent plugin, not made by or affiliated with the Atlas VTT author. It works on top of Atlas VTT through Atlas's extension API and changes nothing in Atlas.

## What you need

- Obsidian 1.8.7 or newer, on desktop.
- **Atlas VTT with extension API 1.x.** This is not in any released Atlas yet: Atlas 0.6.0 does not have the API, because it is not merged upstream. Until it is, Connect needs an Atlas build that includes the extension API. Connect is built against the API build's 1.17.0. It never compares minor versions: it checks each feature it uses (the API's capabilities and the functions it calls), so it also runs on an Atlas whose API starts again at 1.0.0. Where a feature is missing, only that part is off: without scenes or bundles there is no sharing, without the Atlas toolbar and menus the commands still work, and an older remote view shows Follow GM and Fit map in other plugins' views too (doing nothing there), leaves no margin on Fit map and has no Shared with me button in the Online scene's status bar (use the command instead). Without the API, or with another major version, Connect shows a notice and stays off.
- **Atlas VTT with the extension API.** Install it with BRAT from `evolJoaoBento/atlas-vtt`, choosing the latest version (0.6.2-beta.1 or newer). You can also build Atlas from the branch `api/extension-api` (see Developing).
- TODO (fill in once upstream ships it): the first upstream Atlas release that includes the extension API. Switch to that release once it ships.

## Install with BRAT

If you use the online play preview (the fork's built-in online play, Atlas VTT 0.5.x or 0.6.1-beta.x from `evolJoaoBento/atlas-vtt`), see [Moving from the online preview](#moving-from-the-online-preview) first.

1. Install the BRAT plugin.
2. In BRAT, choose "Add beta plugin", enter `evolJoaoBento/atlas-vtt`, and choose the latest version.
3. In BRAT, choose "Add beta plugin" again, enter `evolJoaoBento/atlas-vtt-connect`, and choose the latest version.
4. Enable Atlas VTT and Atlas VTT Connect in Settings, Community plugins.

## Hosting and joining

- **Host.** Open a map in Atlas, present it, then run **Online session** from the command palette or the Atlas toolbar. Start the session, copy the join link and send it to your players. Players open it in a browser, or paste it into **Join online session…** in Obsidian.
- **Settings.** Settings, Atlas VTT Connect: Signaling server (and My own server), Relay (TURN) servers, Player page, Shared note properties, Keep online images on this device and Log online play events.
- **Players** can move the tokens you assign under **Controlled by**, point with a laser and roll dice.

## Split party

Players can be on different scenes. This is opt-in: until you assign someone, every player sees the scene you present, as before.

- **Assign players** in either of two places:
  - **Present to:** in the Online session panel. Hover over it or click it to open a list of players for the tab you are on, and tick or untick them.
  - **Right-click the eye** of any scene tab (or focus it and press the menu key or Shift+F10). Its **Present to** section lists the players for that tab.
- Ticking a player shows them that tab. Unticking them sends them back to the presented scene. A player you never assigned follows the presented scene, and presenting a tab with the eye brings its assigned players to it as followers.
- Assigning a tab that has not been open in this session switches your view to it first, because Connect can only send the tab you have open.
- **Everyone back to the presented scene** clears every assignment. It is the last row of both lists, a button in the panel while anyone is assigned, and a command. It is off while nothing is presented, so it never blanks every screen.
- **At most 4 scenes at once**, the presented one included. The panel says so at the limit, and the rows that would open a fifth scene are off.
- **One scene is live: the tab you have open.** Every other scene in use is paused. Its players keep what they last saw, their page says the GM is on another scene, and their token moves snap back until you return. Their dice and lasers still work. A tab with players on it shows a badge after its eye ("2 players").
- While more than one scene is in use, each player roll in the shared dice log shows the roller's scene: "Anna · Cave".
- Closing a tab sends its players back to the presented scene, and Connect tells you who went back. Assignments last only while the session runs.
- Split party needs the Atlas API build with scene tabs (API 1.17.0). On an older Atlas the panel says to update Atlas instead.

## Sharing

Commands: **People…**, **Share with…**, **Ask to pull…**, **Shared with me…**, **Undo last merge** and **Forget remembered choice**. Nothing is shared until you share it, and only with the people you pick. Private parts of a note stay private. See [PRIVACY.md](PRIVACY.md).

Pulled notes can hold code that other plugins run, such as Dataview, Datacore, JS Engine or Templater blocks and embedded HTML, or HTML that loads from the internet. If those plugins are installed, the code runs in your Obsidian. Connect looks for these known kinds of code, tells you when a note holds one, and pulls it without the code unless you choose **Pull as is**. Other plugins can run code Connect does not know, so pull only from people you trust.

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

Connect replaces the online play preview (the fork of Atlas VTT with online play built in) and keeps its data. The API build comes from the same BRAT repository as the preview (`evolJoaoBento/atlas-vtt`, plugin id `atlas-vtt`), so you change the version of the entry you already have rather than adding a new one:

1. In BRAT, select `evolJoaoBento/atlas-vtt`, unfreeze it if you pinned a version, and update it to the latest version (0.6.2-beta.1 or newer). That is Atlas with the extension API; the built-in online play is gone and Connect replaces it.
2. Restart Obsidian, or turn Atlas VTT off and on.
3. Add Atlas VTT Connect with BRAT (`evolJoaoBento/atlas-vtt-connect`, **0.1.0-beta.4**) and enable it.

Connect takes over the online preview's settings, people and shares on its first start. One thing works differently once:
- **Maps you received before.** A map someone shared with you before Connect ran on an Atlas VTT that lets it replace received maps (including every map the online preview received) cannot be updated in place.
- **The next new version of each such map** arrives as a second scene beside your copy, for example "Inn (2)", and a notice says so. Your old copy stays as it was, and you can delete it.
- **After that,** new versions of the map replace it in place, as the preview did.

What the move leaves behind is described in [PRIVACY.md](PRIVACY.md).

## Developing

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
2. Push the Atlas extension API branch to `evolJoaoBento/atlas-vtt` (branch `api/extension-api`) and check that it is public, as named in this README and in THIRD_PARTY_NOTICES.md. Connect's source for the vendored Atlas code must be reachable (AGPL).
3. Run `npm run sync:atlas` once from that public location, so `vendor/atlas/SOURCE.json` names its `repository` and `branch`.
4. The BRAT versions in this README are filled in (both say "latest"; Atlas 0.6.2-beta.1 or newer). The TODO for the first upstream Atlas release with the extension API stays until that release ships.
5. Check that `manifest.json`'s `version`, the key in `versions.json` and the tag are the same, and that `minAppVersion` is right.
6. Enable Pages in the repository's settings (source "GitHub Actions"), run or wait for `pages.yml`, and check that it goes green and that the default address serves the player page.
7. Run the verify block (`npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run check:vendor && npm run build:page`), then tag and push the tag.
8. Replace the release's placeholder notes with what changed.

## Licence

AGPL-3.0-only, see [LICENSE](LICENSE). Connect contains code from Atlas VTT (AGPL-3.0-only, © Fabian Urbanek) and open-source packages; credits and licence texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
