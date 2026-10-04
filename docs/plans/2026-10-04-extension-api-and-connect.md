# Atlas Extension API and Atlas VTT Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method is already chosen: **subagent-driven**.

**Goal:** Give Atlas VTT a small, versioned extension API (`app.plugins.plugins['atlas-vtt'].api`, groups 1–12 of the proposal, delivered as upstream PRs 1–12). At the same time, build **Atlas VTT Connect** (`atlas-vtt-connect`), a separate Obsidian plugin that runs all of the fork's online play and sharing on top of an unmodified Atlas through that API.

**Architecture:**
- **Track A (Atlas).** Work happens in the worktree `C:\Users\joaoo\2075\atlas-vtt-upstream-wt` on branch `api/extension-api`, cut from upstream `origin/beta` (c1d4d15).
  - Each rollout PR is one or more tasks. Its commits sit on this branch, and each PR ends releasable.
  - Fork code is ported from `merge/upstream-beta` with `git show merge/upstream-beta:<path>`.
  - New facades live in `src/api/`. Contract tests live in `tests/api/`.
  - The API's rolled-up `.d.ts` is committed in `api-report/`. The shared modules are exported from `src/shared/` and built into `dist-packages/` as plain CI artifacts.
- **Track B (Connect).** Work happens in the new repo `C:\Users\joaoo\2075\atlas-vtt-connect`.
  - It ports `src/app/online/**`, `online-client/**` and the "Moves to Atlas Online" files.
  - Every Atlas import is rewritten to one of four things: an API call, the vendored `@atlas-vtt/api-types` or `@atlas-vtt/shared`, a copied helper, or the remote view.
  - B tasks are ordered so that each one is testable against the A tasks that have already landed.

**Tech Stack:**
- Both tracks: TypeScript 5.8.3, Vite 6.4.3, Vitest 4.1.11 (jsdom), ESLint 9 with `eslint-plugin-obsidianmd` 0.4.x, React 19.1.0, zustand 5.0.3, Obsidian API ^1.13.1.
- Atlas only: PIXI v8. Atlas also gains `@microsoft/api-extractor`, used to roll up the API `.d.ts`.
- Connect only: PeerJS ^1.5.5 and three ^0.185.1 (the page's 3D dice). Connect uses no PIXI.

**Spec (binding):** `C:\Users\joaoo\2075\.obsidian\plugins\atlas-vtt\.superpowers\sdd\upstream-0.5.0\extension-api-proposal.md`. Read it together with this plan. Where the two differ, the spec wins, except for the corrections listed under "Spec corrections" below, which come from the real code.

**Rulings that must survive:**
- `...\.superpowers\sdd\2026-10-02-online-sharing\progress.md`
- `...\.superpowers\sdd\upstream-0.5.0\progress.md`

Both are under `C:\Users\joaoo\2075\.obsidian\plugins\atlas-vtt\`. A summary is in "Privacy rulings carried over" below.

**Code rules:** `C:\Users\joaoo\2075\atlas-vtt-upstream-wt\CLAUDE.md` binds both tracks:
- explicit return types;
- files of at most 300 lines;
- no stub or fake data outside tests;
- SCSS and Obsidian classes, no new Tailwind;
- no `title` attributes;
- no duplicated logic;
- PIXI v8 best practice.

---

## Global Constraints

- **NEVER** run `npm run build` or `npm run dev` in the Atlas worktree. `postbuild` and `COPY_ON_CHANGE=true` copy into the user's vault. Build Atlas only with `npm run build:ci`, plus the new `npm run build:packages` and `npm run api:report`, which copy nothing.
- The Connect build must never copy into a vault. Connect's `vite.config.mts` has no copy plugin, and `package.json` has no `post*` hook. For local testing, a person copies `dist/` by hand (README, "Developing").
- Don't create or remove git worktrees, and don't push.
  - Track A runs a single `git switch` in the existing worktree (Task A1, step 1).
  - Local lightweight tags `api-pr-<N>-end` are allowed and stay local.
- Commits always stage explicit paths (`git add <path> …`). Never use `git add -A` or `git add .`. Every commit message ends with this paragraph:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr
  ```
- **Atlas verify block.** Every A task runs this before its commit, from the worktree root. The api line applies from A7 on.
  ```bash
  npx tsc --noEmit && npm run lint && npm run lint:scan && npx vitest run --project unit \
    && npm run build:ci && npm run changelog:check && npm run preflight
  API_BASE_REF=api-pr-<previous>-end npm run api:check
  git grep -nE "src/app/online|/online/|OnlineScene|onlineSessionStore|peerjs|atlas-online" -- src main.ts package.json styles
  ```
  The last line is a fork-leak guard and must print nothing.
- **Connect verify block.** Every B task runs this from the Connect root. The `check:vendor` part applies from B3 on.
  ```bash
  npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run check:vendor
  ```
- **Changelog.** `scripts/changelog.js` accepts only the headings `New`, `Improved`, `Fixed` and `Important changes`.
  - API lines go under `## New`, each starting with `Extension API:`. This satisfies the spec's "Extension API section" without changing the checker.
  - Bug fixes go under `## Fixed`.
  - Pure extractions (PR 1) get no line.
- **Plugin ids:**
  - Connect's manifest id is `atlas-vtt-connect`, with the display name `Atlas VTT Connect`.
  - Its storage folder is `atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/`.
  - Its scene data key is `data.extensions['atlas-vtt-connect']`.
  - The proposal's name `atlas-online` must not appear anywhere.
- **Default player page URL:** `https://evoljoaobento.github.io/atlas-vtt-connect/`. The fork's old default, `https://evoljoaobento.github.io/atlas-vtt/`, is migrated to it.
- **Licence:** Connect is `AGPL-3.0-only`. It derives from Atlas, which is AGPL-3.0-only. It gets a LICENSE file, a build banner and a credit to Atlas VTT in its third-party notices.
- **Desktop only:** Connect's manifest sets `"isDesktopOnly": true` (Atlas is desktop-only) and `"minAppVersion": "1.8.7"` (Atlas's floor).
- **Node:** 22 (`.nvmrc` `22`), the same as Atlas.

## Review Focus

These are the conditions most likely to bite a real user. Each one has a pinned test in the owning task.

1. **Atlas reloads or is disabled while Connect is hosting.**
   - Expected: the session stops cleanly, no slot, panel, listener or remote view is left behind, and Connect re-binds when `atlas-vtt:api-ready` fires again.
   - Tests: A6 `C-life-3`; B3 `atlasLink.test.ts › reconnects after Atlas reloads`; B6 `hostingService.test.ts › hosts the presented scene for players and stops when Atlas unloads`.
2. **An older Atlas, the right major version but without a newer capability.**
   - Expected: the feature that needs the capability is hidden or refused with a notice, and nothing throws.
   - Tests: B3 `capabilities.test.ts`; B11 `slots.test.ts › no ui capability, no toolbar item, commands still work`; B9 `darknessProjection.test.ts › without the lighting capability a lit scene is dark for players`.
3. **A lit scene whose sight is not ready: loading, graphics context lost, explored memory still decoding.**
   - Expected: players get nothing for lit areas; fail closed.
   - Tests: A21 `C-light-1` (pending cases); B9 `darknessProjection.test.ts › pending sends no tokens and full darkness`.
4. **The fork migration is interrupted or runs twice, or a destination already exists.**
   - Expected: no data loss, no duplicate copy, and the run is idempotent through a flag.
   - Tests: B16 `migrateFromFork.test.ts` (interrupted, rerun, existing destination).
5. **A scene that holds extension data, or the fork's legacy `data.sharing`, is copied, exported or installed.**
   - Expected: neither ever leaves the vault, and fingerprints ignore them.
   - Tests: A26 `C-scenes-1` with a legacy record.

---

## Decisions locked before the tasks

### D1. Packaging: no npm, a vendored copy (coordinator ruling)

- `@atlas-vtt/api-types` and `@atlas-vtt/shared` are not published anywhere.
  - Inside Atlas they are the folders `src/api/` (types, rolled up into the committed `api-report/atlas-vtt-api.d.ts`) and `src/shared/` (entries).
  - `npm run build:packages` builds them into `dist-packages/` (gitignored), and Atlas CI uploads that folder as the artifact `atlas-vtt-packages-<sha>`.
- **Connect takes a vendored copy** in `vendor/atlas/`:
  - `vendor/atlas/api-types/atlas-vtt-api.d.ts`;
  - `vendor/atlas/shared/**` (ES modules plus `types/**.d.ts`);
  - `vendor/atlas/SOURCE.json`, holding the Atlas commit, the API version, the sha256 of every file and the contract case ids.
  - `scripts/sync-atlas.mjs --atlas <dir> --commit <sha>` refreshes the copy. It refuses unless that Atlas directory is at exactly that HEAD with no tracked changes, and it runs only Atlas's `npm run build:packages`, never `build`.
  - `npm run check:vendor` recomputes the hashes offline in CI, so any hand edit or partial sync fails.
- **Why not a pinned git dependency:**
  - npm cannot install a package from a subfolder of a git repository.
  - `api/extension-api` is not pushed, and we don't push, so Connect's CI could not fetch it.
  - A git dependency needs the network and would build Atlas on every install.
  - The vendored copy needs no accounts, works offline and pins byte for byte.
- **Proposal open question 2 is answered:** no npm scope is needed. The packages are CI artifacts of `src/api/` and `src/shared/`, which an extension vendors.
- **Runtime types:**
  - Values (rules, snapshots, results) always come from the installed Atlas through the API.
  - The vendored types exist only for compiling.
  - The vendored shared modules are used only for drawing and local previews (spec principle 8).

### D2. API version and capability table

`api-report/atlas-vtt-api.d.ts` contains `API_VERSION` as a literal type. `scripts/api-version-check.js` fails when the report changed but the version line did not.

- Every PR after PR 3 is one minor bump, done in the PR's first A task.
- `has()` returns true only for capabilities that have landed (`src/api/capabilities.ts`).
- Connect requires major 1 and gates every feature with `has()`.

| PR | Last A task | `API_VERSION` | Capabilities added | Added to `AtlasExtension` | Events added |
|---|---|---|---|---|---|
| 1, 2 | A3, A5 | none | none | none | none |
| 3 | A8 | 1.0.0 | none | `id`, `on` | `unload` |
| 4 | A11 | 1.1.0 | `views`, `rules`, `settings`, `storage` | `views`, `rules`, `settings`, `storage` | `map-loaded`, `map-closed`, `rules-changed`, `settings-changed` |
| 5 | A14 | 1.2.0 | `presentation` | `presentation` | none |
| 6 | A17 | 1.3.0 | `dice` | `dice` | none |
| 7 | A18 | 1.4.0 | `lasers` | `lasers` | none |
| 8 | A21 | 1.5.0 | `lighting` | `lighting` | none |
| 9 | A22 | 1.6.0 | `tokens` | `tokens` | none |
| 10 | A25 | 1.7.0 | `ui` | `ui` | none |
| 11 | A27 | 1.8.0 | `scenes`, `bundles` | `scenes`, `bundles` | `scenes-changed` |
| 12 | A31 | 1.9.0 | `remote-view` | `remoteViews?` | none |

- Each PR's last task ends with `git tag api-pr-<N>-end`.
- The `API_BASE_REF` for PR N's tasks is `api-pr-<N-1>-end`. For PR 3 it is `origin/beta`, where no report exists yet, so the check passes.
- Upstream CI compares against `origin/beta`.

### D3. Spec corrections (the code wins)

| Spec says | Code has | API uses |
|---|---|---|
| `BackgroundState` | The store's `background: string \| null` (vault path of the image) | `export type BackgroundState = string \| null` in `src/api/types/records.ts` |
| `objects.fog: readonly FogOperation[]` | `Record<string, FogOperation>` | `Readonly<Record<string, FogOperation>>` (frozen store object by reference, principle 5) |
| `WidgetValues` | The store's `widgetValues: Record<string, number>` | `export type WidgetValues = Readonly<Record<string, number>>` |
| `GridState` from `MapPersistence` | `MapPersistence.ts` imports obsidian, zustand and the plugin type | Re-exported as a type only. A7's rollup test fails if the rollup imports anything but `obsidian`. If it does, A7 moves `GridState` and its parts to `src/app/types/gridStateTypes.ts`, re-exported by `MapPersistence.ts` (a pure extraction) |
| `DiceRollResult` | `src/app/tools/DiceTool.ts`, which imports `events` | Type-only re-export. The same rollup test guards it |
| `addTokenMenuItems` context `ViewContext & { tokenId; kind: TokenEntity['kind'] }` | `ViewContext.kind` already names the view's kind (`'map' \| 'remote'`) | `ViewContext & { tokenId: string; tokenKind: TokenEntity['kind'] }` |
| `PLAYER_VIEW_RULE_KEYS` | Fork only | Defined in `src/api/settings.ts` |
| `data.extensions['atlas-online']` | — | `data.extensions['atlas-vtt-connect']` |
| Open question 4 | — | Answered **yes**. PR 11 moves a legacy `data.sharing` into `data.extensions['atlas-vtt-connect']` when Atlas loads the index, and strips any leftover `data.sharing` from copies, exports, imports and fingerprints. Without this, stock Atlas would export share lists, which breaks the ruling "sharing never travels in bundles" |
| `darknessRaster` imports `FOG_CELL_SIZE` and `insideSpans` from fork files | — | A20 brings `insideSpans` into Atlas (`src/app/lighting/playerDarkness/spans.ts`) and exports it from `@atlas-vtt/shared/draw`, so Connect's `fogRaster` imports it from there. The cell size is the `cellSize` returned in `PlayerVisibility` |
| `projectForPlayers` uses `formationGridFromOptions` | — | Connect computes the snap grid it sends from `GridState` (`snapGridOfState`, B4). The authoritative snap is `tokens.snapPoint` |

### D4. Where the fork's files go

Appendix B maps every fork folder or file to its destination. The rules:

- **Connect keeps the fork's folder layout under `src/app/`.** So `src/app/online/**` stays `src/app/online/**`, and copied helpers keep their Atlas path, for example `src/app/ui/confirmDialog.ts`. Relative imports between ported files and copied helpers then need no rewrite. Only imports that become API calls or vendored modules change (Appendix C).
- **Copied helpers start with a header:** `// Copied from Atlas VTT <path> at <commit> (AGPL-3.0-only).`
- **These move into Atlas instead of Connect:**
  - PR 8: `scene/darknessRaster.ts`, `scene/exploredImage.ts` and the frame and timing part of `scene/LiveLighting.ts`.
  - PR 12: `obsidian/RemoteSceneApplier.ts`, `RemoteMapBackdrop.ts`, `ViewportFollower.ts`, the drag gate of `remoteTokenMoves.ts` and the store part of `remoteScene.ts`.
  - The tests of these files move into Atlas with them.
- **Test-count check.**
  - Connect's test files per area must equal the fork's `tests/unit/online/**` count minus the files listed as moved to Atlas, plus the copied helpers' tests.
  - B17 runs `scripts/test-inventory.mjs`, which prints both counts.
- **Files over 300 lines** are split when their rewrite touches them: `GmSession`, `OnlineJoinService`, `OnlineSessionService`, `sceneTypes`, `SceneBroadcaster` and `PlayerSession`. Each B task names its splits.

### D5. Contract alignment between the tracks

- Every contract case has an id, `C-<group>-<n>`, listed in Appendix A.
  - Atlas's `tests/api/**` names each test with its id, for example `it('C-tok-1: refuses a hidden token unless allowHidden', …)`.
  - `sync-atlas.mjs` collects the ids at the synced commit (`git grep -ohE "C-[a-z]+-[0-9]+" -- tests/api`) into `SOURCE.json.contractCases`.
- Connect's `tests/fake/fakeAtlas.contract.test.ts` runs the same case against `FakeAtlas`. A case the fake cannot simulate goes into the `ATLAS_ONLY` list with a reason; these are UI rendering cases only.
- A meta-test fails when a case id in `SOURCE.json` is neither tested nor listed. When the API grows, Connect's CI therefore fails until the fake catches up.
- `FakeAtlas implements AtlasApi`, typed against the vendored rollup, so any signature drift fails Connect's `tsc`.

### D6. Privacy rulings carried over (must hold in Connect)

Each of these ports with its tests unchanged. A test that changes is a red flag for review.

1. **Table key.**
   - The GM's table key belongs to the vault (ruling 1).
   - Table proofs sign `atlas-table-v1|<table>|<GM host id>|<device id>|<nonce>|<personId>`.
   - A rejoin re-verifies the device proof and re-signs for the new nonce (B3).
2. **The GM sees relayed items in clear.** This is documented in PRIVACY (ruling 2).
3. **Fail closed in sharing.**
   - Unparsed `[!private|[!only|[!except` text, a stray `%%[!end]%%` or a tag possibly inside code hides content or blocks sharing (T-C1, T-stray, T-R2, T-R3, T-R4 sections from `metadataCache`, T-R6).
   - Every `%%…%%` is stripped, inside code too (R3-1).
   - Link rewriting runs to stable and is followed by a fail-closed sweep (R2-2, R3-2, F-a).
4. **`except` and `only` names.**
   - Names are unique across current and former names (I3).
   - An unlinked placeholder in `except` hides the part from everyone, and a map share "everyone except <unlinked placeholder>" reaches nobody (P-I2, P-I3).
   - Placeholders have stable ids (P-I1).
5. **Map payloads.**
   - The full map payload clears every `*Path` field, including plural fields and nested values (I4, R2-4).
   - A player-safe share of a lit map is refused (L2).
6. **Lighting fails closed** when the view has no renderer or lighting state (L4). Texts and drawings in the dark stay hidden online (L1).
7. **Transfers.**
   - Handle ranges are split (B2).
   - The window is clamped (F1).
   - Every way a pull ends closes its transfer (T4-1).
   - The receiver checks the bytes against what it asked for (T4-2).
8. **Bundles.** Sharing never travels in bundles: scene data, the note property and legacy `data.sharing` alike. Import strips `atlas-share` too.
9. **Received notes keep their protection** through `%%[!only|…]%%`, with names translated by person key and unknown names dropped. A pulled note stays private.
10. **Merges.**
    - A missing base counts as a conflict on both sides (T6-1).
    - A merge never saves silently when the diff gives up (T6-3).
    - Files that can't be read are kept as `<name>.broken.json`.

---

## File structure

### Track A, new and changed in Atlas (`atlas-vtt-upstream-wt`)

```
src/api/
  version.ts                 API_VERSION literal
  capabilities.ts            LANDED_CAPABILITIES
  public.ts                  the api-extractor entry: types + API_VERSION only
  types/                     one file per group (public surface; ≤300 lines each)
    common.ts api.ts records.ts views.ts presentation.ts rules.ts lighting.ts tokens.ts
    dice.ts lasers.ts ui.ts scenes.ts settings.ts remoteViews.ts
  disposers.ts               DisposerSet
  events.ts                  ApiEvents (typed fan-out)
  AtlasApiHost.ts            api object, connect bookkeeping, dispose
  ExtensionApiPublisher.ts   ready/unload wiring used by main.ts
  extension.ts               builds one AtlasExtension (one line per namespace)
  services.ts                ApiServices: what facades need (app, plugin, trackers)
  viewTracker.ts             tracks open AtlasViews; map-loaded / map-closed
  views.ts rules.ts settings.ts storage.ts presentation.ts dice.ts lasers.ts lighting.ts
  tokens.ts scenes.ts bundles.ts remoteViews.ts
  ui/                        slotRegistry.ts toolbar.ts palette.ts dashboard.ts menus.ts panels.ts
src/shared/                  grid.ts draw.ts rules.ts dice3d.ts (barrels only)
src/app/…                    ported fork hunks (per task)
src/app/lighting/playerDarkness/  darknessRaster.ts exploredImage.ts sightFrames.ts spans.ts playerVisibility.ts
src/app/remote-view/         RemoteMapView.ts remoteStore.ts RemoteSceneApplier.ts RemoteMapBackdrop.ts
                             ViewportFollower.ts remoteDrag.ts RemoteViewHandle.ts remoteViewType.ts
tests/api/                   contract + lifecycle + report + boundary tests
api-report/atlas-vtt-api.d.ts   committed rollup (the API report and the api-types artifact)
api-extractor.json tsconfig.api.json tsconfig.shared.json vite.shared.config.mts
scripts/api-version-check.js
docs/extension-api.md        how to use the API, version table, deprecation rules
.github/CODEOWNERS           /src/api/ /tests/api/ /api-report/ @evolJoaoBento
```

### Track B, the new Connect repo (`atlas-vtt-connect`)

```
manifest.json versions.json package.json package-lock.json tsconfig.json .nvmrc .gitignore
vite.config.mts            plugin bundle → dist/ (no copy)
vite.page.config.mts       join page → dist-page/
vite/atlasAliases.mts      @atlas-vtt/shared/* → vendor
vitest.config.mts eslint.config.mjs
main.ts                    plugin entry
src/connect/               plugin wiring: atlasLink.ts capabilities.ts startConnect.ts settingsStore.ts
                           settingTab.ts migrateFromFork.ts obsidianAugment.d.ts
src/app/online/**          ported online play and sharing (fork layout)
src/app/{plugin,ui,utils,types,packages,react,imageProcessing}/…   copied helpers (Atlas paths)
src/app/ui/primitives/     Button.tsx LabelTooltip.tsx (rebuilt on Obsidian classes)
online-client/**           the web join page
styles/                    main.scss + ported stylesheets + _atlas-mixins.scss (copied mixins)
vendor/atlas/              api-types/ shared/ SOURCE.json
scripts/sync-atlas.mjs scripts/check-vendor.mjs scripts/test-inventory.mjs
tests/mocks/ tests/setup/  copied from Atlas (obsidian mock, in-memory vault, DOM setup)
tests/fake/FakeAtlas.ts    test-only AtlasApi + fakeAtlas.contract.test.ts
tests/unit/**              ported tests (fork layout)
.github/workflows/ci.yml release.yml pages.yml
README.md PRIVACY.md THIRD_PARTY_NOTICES.md LICENSE
docs/plans/                this plan
```

### Cross-track order

```
A1─A2─A3 (PR1) ─ A4─A5 (PR2) ─ A6─A7─A8 (PR3) ─ A9─A10─A11 (PR4) ─ A12─A13─A14 (PR5) ─ A15─A16─A17 (PR6)
 ─ A18 (PR7) ─ A19─A20─A21 (PR8) ─ A22 (PR9) ─ A23─A24─A25 (PR10) ─ A26─A27 (PR11) ─ A28─A29─A30─A31 (PR12)

B1 ─ B2                    no API: start at once, in parallel with A1–A8
B3  needs A8  (api-pr-3-end)   vendor, AtlasLink, FakeAtlas        B4 needs B3 (pure scene modules)
B5  needs A11 (api-pr-4-end)   people book on storage
B6  needs A14 (api-pr-5-end)   hosting                              B7, B8 need A18 (api-pr-7-end) and B6/B4
B9  needs A21 (api-pr-8-end)   darkness                             B10 needs A22 (api-pr-9-end)
B11 needs A25 (api-pr-10-end)  GM UI slots                          B12 needs A25 and B8 (join + Canvas 2D tab)
B13 needs A27 (api-pr-11-end)  sharing, sender side                 B14 needs B13 and B12 (receiver side)
B15 needs A31 (api-pr-12-end)  remote view tab                      B16 needs B14 (migration)   B17 last
```

When a B task is ready but its A task has not landed, the controller runs the next A task. The two tracks never edit the same repository.

Every B task that needs new API begins with this step: "re-sync the vendor at `api-pr-<N>-end`":

```bash
cd /c/Users/joaoo/2075/atlas-vtt-connect
node scripts/sync-atlas.mjs --atlas ../atlas-vtt-upstream-wt --commit "$(git -C ../atlas-vtt-upstream-wt rev-parse api-pr-<N>-end)"
```

`sync-atlas.mjs` requires the worktree's HEAD to equal that commit.

- The controller runs the sync right after tagging a PR's last A task, while HEAD is the tag, and commits the vendor refresh as part of the next B task that needs it.
- If A has moved on since, the controller detaches to the tag with `git -C ../atlas-vtt-upstream-wt switch --detach api-pr-<N>-end`, syncs, and returns with `git -C ../atlas-vtt-upstream-wt switch api/extension-api`. Both commands need a clean tree.

For local end-to-end testing, build Atlas from `api/extension-api` with `npm run build:ci`. Then copy `dist/main.js`, `dist/styles.css` and `manifest.json` by hand into a test vault's `.obsidian/plugins/atlas-vtt/`, and Connect's `dist/` into `.obsidian/plugins/atlas-vtt-connect/`. Use a test vault, never the user's main vault. The README describes this.

---

# Track A: the Atlas extension API

All paths are relative to `C:\Users\joaoo\2075\atlas-vtt-upstream-wt` unless absolute. `FORK=merge/upstream-beta`. "Port `<path>`" means `git show $FORK:<path> > <path>` for a file that belongs wholly to the task. Mixed files are listed hunk by hunk. Use `git diff api/extension-api $FORK -- <path>` to see the hunks, and edit by hand: never copy a mixed file whole.

**How to port a mixed test file:** copy it, then delete every `import` and every `describe`/`it` block that needs a module from a later PR. The task names the blocks that stay and says where the dropped ones go.

## PR 1: Pure extractions (no behaviour change)

### Task A1: Switch the worktree; extract grid, text, measure and layer-order geometry

**Files:**
- Create (port whole):
  - `src/app/pixi/measureGeometry.ts`
  - `src/app/pixi/textBoxLayout.ts`
  - `src/app/pixi/sceneLayerOrder.ts`
  - `src/app/grid/gridStateOptions.ts`
- Modify, PR 1 hunks only:
  - `src/app/grid/gridDistance.ts`: the `cellCenterAt` export.
  - `src/app/grid/GridSystem.ts`: the `cellCenterAt` import and the `snapToCellCenter` body. **Not** the `safeContrastColor` hunks, which belong to A4.
  - `src/app/grid/measurementFormat.ts`: the `DistanceSettings` type.
  - `src/app/pixi/MeasureRenderer.ts`, `src/app/pixi/utils/measureDrawing.ts`, `src/app/pixi/TextRenderer.ts`: whole diff.
  - `src/app/react/BackgroundSprite.tsx`: only replace the local `toGridOptions` with the `gridStateOptions` import. **Not** `LoadedBackground` or the release order (A4), and **not** object URLs (A29).
  - `src/app/pixi/fog/FogOfWarRenderer.ts`, `src/app/PixiRendererOrchestrator.ts`, `src/app/pixi/TokenRenderer.ts`: only the `SCENE_LAYER_Z` import and the `zIndex = SCENE_LAYER_Z.*` lines.
- Test:
  - `tests/unit/sharedLayout.test.ts`, ported. Keep the `SCENE_LAYER_ORDER`/`SCENE_LAYER_Z` and `textBoxLayout` blocks. Drop the `gridLayer`, `conditionBadgeLayout`, `tokenRingMetrics`, `tokenSizing`, `downedLook` and `ResourceBarView` blocks: the token ones go to A2, the `gridLayer` one to Connect B7.
  - `tests/unit/playerToolsShared.test.ts`, ported. Keep the `cellCenterAt`, `measureGeometry`/`measureDrawing` and `DistanceSettings` blocks. The `LaserTrail`/`laserBeamGeometry` blocks go to A3, `dragRulerPath` to A2, `snapDroppedToken` to A22.

**Interfaces:**
- Produces: `cellCenterAt(options: { size: number; offsetX?: number; offsetY?: number; type?: GridType }, point: Point): Point` in `grid/gridDistance.ts`.
- Produces: `toGridOptions(grid: GridState): GridOptions` in `grid/gridStateOptions.ts`.
- Produces: `SCENE_LAYER_ORDER` and `SCENE_LAYER_Z` in `pixi/sceneLayerOrder.ts`, and the exports of `measureGeometry.ts` and `textBoxLayout.ts` exactly as on the fork. Read the export lists with `git show $FORK:<file> | grep ^export`.

- [ ] **Step 1: Put the worktree on the API branch and install its lockfile**

```bash
cd /c/Users/joaoo/2075/atlas-vtt-upstream-wt
git status --porcelain --untracked-files=no   # must print nothing
git switch api/extension-api
git log --oneline -1                         # c1d4d15 Show rolls as result cards …
npm ci                                       # node_modules is a real folder here (checked), not a junction
```
`dist/` and `dist-online/` may show as untracked or ignored. They are never staged.

- [ ] **Step 2: Baseline**

Run the Atlas verify block, skipping the `api:check` line. Expected: everything passes, and the leak guard prints nothing. If a test fails on the clean branch, record its name in the task report as pre-existing and continue.

- [ ] **Step 3: Port the tests and watch them fail**

```bash
FORK=merge/upstream-beta
git show $FORK:tests/unit/sharedLayout.test.ts > tests/unit/sharedLayout.test.ts
git show $FORK:tests/unit/playerToolsShared.test.ts > tests/unit/playerToolsShared.test.ts
```
Delete the blocks and imports listed above, then run:
```bash
npx vitest run --project unit tests/unit/sharedLayout.test.ts tests/unit/playerToolsShared.test.ts
```
Expected: FAIL with "Failed to resolve import …/sceneLayerOrder" and similar.

- [ ] **Step 4: Port the modules and the renderer call sites**

```bash
for f in src/app/pixi/measureGeometry.ts src/app/pixi/textBoxLayout.ts src/app/pixi/sceneLayerOrder.ts src/app/grid/gridStateOptions.ts \
         src/app/pixi/MeasureRenderer.ts src/app/pixi/utils/measureDrawing.ts src/app/pixi/TextRenderer.ts; do git show $FORK:$f > $f; done
```
Then hand-apply the PR 1 hunks to `gridDistance.ts`, `GridSystem.ts`, `measurementFormat.ts`, `BackgroundSprite.tsx`, `FogOfWarRenderer.ts`, `PixiRendererOrchestrator.ts` and `TokenRenderer.ts`, as listed under **Files**. After porting `MeasureRenderer.ts`, `measureDrawing.ts` and `TextRenderer.ts` whole, check with `git diff` that they contain no `remoteScene`, `LaserHub` or `online` text. If one does, revert that hunk.

- [ ] **Step 5: Run the tests**

`npx vitest run --project unit tests/unit/sharedLayout.test.ts tests/unit/playerToolsShared.test.ts tests/unit/measure*.test.ts tests/unit/text*.test.ts`. Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run the Atlas verify block, without `api:check`. Then:
```bash
git add src/app/pixi/measureGeometry.ts src/app/pixi/textBoxLayout.ts src/app/pixi/sceneLayerOrder.ts src/app/grid/gridStateOptions.ts \
  src/app/grid/gridDistance.ts src/app/grid/GridSystem.ts src/app/grid/measurementFormat.ts src/app/pixi/MeasureRenderer.ts \
  src/app/pixi/utils/measureDrawing.ts src/app/pixi/TextRenderer.ts src/app/react/BackgroundSprite.tsx \
  src/app/pixi/fog/FogOfWarRenderer.ts src/app/PixiRendererOrchestrator.ts src/app/pixi/TokenRenderer.ts \
  tests/unit/sharedLayout.test.ts tests/unit/playerToolsShared.test.ts
git commit -m "refactor: extract PIXI-free measure, text, grid-option and layer-order geometry" -m "Pure extractions for the shared modules package (PR 1); renderers call them, behaviour unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

### Task A2: Extract token UI, badge, downed-look and drag-ruler geometry

**Files:**
- Create (port whole):
  - `src/app/pixi/token-renderer/tokenUiLayout.ts`
  - `src/app/pixi/token-renderer/conditionBadgeLayout.ts`
  - `src/app/pixi/token-renderer/downedLook.ts`
  - `src/app/pixi/token-renderer/dragRulerPath.ts`
- Modify, PR 1 hunks only:
  - `src/app/pixi/token-renderer/ConditionBadge.ts` and `ConditionBadgeRing.ts`: whole diff.
  - `src/app/pixi/token-renderer/DragRuler.ts`: whole diff.
  - `src/app/pixi/TokenUIRenderer.ts`: only the nameplate and bar layout moved to `tokenUiLayout`. **Not** the "no numbers on hover in the remote view" hunk (`remoteScene` checks), which goes to A29.
  - The downed look's consumers: whichever upstream files the fork changed to read `DOWNED_LOOK`. Find them with `git diff api/extension-api $FORK --stat -- src/app/pixi/token-renderer`. Revert any hunk that touches `ResourceBarView`, `DownedTokenOverlay` or `downedEmblemTexture` (ruling D1/M1 keeps upstream files untouched).
- Test: `tests/unit/sharedLayout.test.ts`. Add back the `conditionBadgeLayout`, `tokenRingMetrics`, `tokenSizing` and `downedLook` blocks dropped in A1. A `BAR_LOOK` parity block stays only if `ResourceBarView` exports `BAR_LOOK` upstream; otherwise drop it. Also `tests/unit/playerToolsShared.test.ts`: add back the `dragRulerPath` block.

**Interfaces:**
- Produces: the exports of the four modules exactly as on the fork, including `DragRulerPath`, `dragRulerLabel`, `samePoint`, `WAYPOINT_KEY`, `badgePositions`, `badgeSlots`, `CONDITION_BADGE`, `fitBadges` and `DOWNED_LOOK`.

- [ ] **Step 1:** Restore the dropped test blocks from the fork file and run the two tests. Expected: FAIL, module not found.
- [ ] **Step 2:** Port the four modules with `git show`, and hand-apply the listed hunks.
- [ ] **Step 3:** Run `npx vitest run --project unit tests/unit/sharedLayout.test.ts tests/unit/playerToolsShared.test.ts tests/unit/*token*.test.* tests/unit/*badge*.test.*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block without `api:check`, then commit:
```bash
git add src/app/pixi/token-renderer/tokenUiLayout.ts src/app/pixi/token-renderer/conditionBadgeLayout.ts src/app/pixi/token-renderer/downedLook.ts \
  src/app/pixi/token-renderer/dragRulerPath.ts src/app/pixi/token-renderer/ConditionBadge.ts src/app/pixi/token-renderer/ConditionBadgeRing.ts \
  src/app/pixi/token-renderer/DragRuler.ts src/app/pixi/TokenUIRenderer.ts tests/unit/sharedLayout.test.ts tests/unit/playerToolsShared.test.ts
# plus any downed-look consumer changed in step 2, by explicit path
git commit -m "refactor: extract PIXI-free token UI, badge and drag-ruler layout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

### Task A3: Extract laser trail and beam geometry, dice rolling and the tray pool

**Files:**
- Create (port whole): `src/app/pixi/laser/laserTrail.ts`, `src/app/pixi/laser/laserBeamGeometry.ts`.
- Create `src/app/tools/diceRolling.ts` from the fork **without** the PR 6 additions. Keep `DICE_TYPES`, `DieType`, `DiceSelection`, `DICE_ROLLED_EVENT`, `DiceRollResult` (moved here from `DiceTool.ts`, minus the `rolledBy` field), `isDieType`, `diceTerms`, `diceFormula`, `rollFormula` and `withoutHiddenToken`. Leave out `persistableDiceLog`, `rollerName`, `rolledBy` and `unlistedDice`, which A15 adds.
- Modify:
  - `src/app/tools/DiceTool.ts`: rolling moves to `diceRolling`. `DiceTool.ts` re-exports `DiceRollResult` (`export type { DiceRollResult } from './diceRolling';`), so its importers stay as they are.
  - `src/app/react/components/dice/PlayerDiceToasts.tsx`: `withoutHiddenToken` now comes from `diceRolling`.
  - `src/app/react/components/dice/diceTrayPool.ts`: add `trayPoolByDie`.
  - `src/app/pixi/laser/LaserBeam.ts` and `CanvasLaserBeam.ts`: constants and beam width come from `laserBeamGeometry`.
  - `src/app/pixi/LaserPointerRenderer.ts`, extraction hunks only: the `LaserTrail` field and `laserPointSpacing`, which replace `trailPoints`, `TrailPoint`, `MIN_POINT_SPACING*` and the inline life calculation. **Not** `hub`, `liftLaser` or the window blur: blur goes to A4, the hub to A18.
- Test:
  - `tests/unit/diceRolling.test.ts`, ported. Keep `dice formulas`, `rollFormula` and the `withoutHiddenToken` case. The "names the online player…" and "what the dice log saves" blocks go to A15.
  - `tests/unit/playerToolsShared.test.ts`: add back the `LaserTrail`/`laserBeamGeometry` blocks.

**Interfaces:**
- Produces: `rollFormula(formula: string, random?: () => number, now?: number, rules?: DiceRules): DiceRollResult`, `diceFormula(selection, modifier?): string`, `DiceRollResult` (its home is now `tools/diceRolling.ts`), `trayPoolByDie(...)` as on the fork, `class LaserTrail { add(x, y, t): void; last(): {x;y}|undefined; prune(now): void; beamPoints(now): BeamPoint[]; clear(): void; length: number }`, and `laserPointSpacing(size: number, zoom: number): number`.

- [ ] **Step 1:** Port the tests and trim them as described. Run `npx vitest run --project unit tests/unit/diceRolling.test.ts tests/unit/playerToolsShared.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Port the modules and apply the hunks. In `diceRolling.ts`, a `grep -n "rolledBy\|persistable\|rollerName\|unlisted" src/app/tools/diceRolling.ts` must print nothing.
- [ ] **Step 3:** Run the two tests, plus `tests/unit/diceTool*.test.* tests/unit/laser*.test.* tests/unit/dice*.test.*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block without `api:check`. Commit the listed paths with the message `refactor: extract PIXI-free laser trail, beam geometry and dice rolling` and the attribution paragraph. Then `git tag api-pr-1-end`.

## PR 2: Bug fixes

### Task A4: Rendering fixes: laser on blur, background release, kept fog sprites, safe grid colour

**Files:**
- Create (port whole): `src/app/grid/safeContrastColor.ts`.
- Modify:
  - `src/app/grid/GridSystem.ts`: the `safeContrastColorForSprite` hunk.
  - `src/app/pixi/LaserPointerRenderer.ts`: `onWindowBlur`, `blurWindow`, `handleWindowBlur` and the listener removal in `destroy`. `handleWindowBlur` sets `isPointing = false` and redraws. **No** hub or `liftLaser` (A18 adds both).
  - `src/app/react/BackgroundSprite.tsx`: `LoadedBackground` with its `url` field, and releasing the replaced texture's cache entry after the new sprite is shown. Take the fork's release-order hunk **without** the object-URL branch (A29).
  - `src/app/pixi/fog/FogOfWarRenderer.ts`: `paintOp`/`erases` on `FogSpriteEntry`, `erasesAfter`, `sameRecords` and the "kept" `continue`. **Not** the third `FogCanvasCompositor` argument (A29).
  - `src/app/pixi/backgroundTextureCache.ts`: only the fork hunk the release order needs, if any. Hunks naming `objectUrl` go to A29.
- Test:
  - Port `tests/unit/safeContrastColor.test.ts`.
  - `tests/unit/backgroundSprite.test.tsx`: keep the release-order cases, drop the object-URL cases (A29).
  - `tests/unit/backgroundTextureCache.test.ts`: keep the non-object-URL cases.
  - New file `tests/unit/laserPointerBlur.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LaserPointerRenderer } from '../../src/app/pixi/LaserPointerRenderer';
// Reuse the harness the fork's hub test used: copy its `makeRenderer` setup from
// `git show merge/upstream-beta:tests/unit/laserPointerRenderer.hub.test.ts` (viewport, store, canvas stubs), without the hub.

describe('laser pointer', () => {
  it('lets the laser go when the window loses focus mid-stroke', () => {
    const { renderer, canvas, pressAt } = makeRenderer();
    pressAt(10, 10);
    expect((renderer as unknown as { isPointing: boolean }).isPointing).toBe(true);
    canvas.ownerDocument.defaultView!.dispatchEvent(new Event('blur'));
    expect((renderer as unknown as { isPointing: boolean }).isPointing).toBe(false);
    renderer.destroy();
  });
});
```
   Write `makeRenderer` in the test file itself, from the fork harness: it returns the renderer, its canvas and a `pressAt` that emits `pointerdown` on the viewport. Cases from the fork's fog-sprite test go into `tests/unit/fogOfWarRenderer.kept.test.ts`: "an operation whose canvas would come out the same is kept". Copy that case from `git show $FORK:tests/unit/online/fogCompositorCache.test.ts` if it lives there; otherwise write it against `FogOfWarRenderer` with two renders and the same `paintOp` reference, and assert that the sprite object is the same.

- [ ] **Step 1:** Write or port the four tests. Run them. Expected: FAIL.
- [ ] **Step 2:** Port `safeContrastColor.ts` and apply the hunks listed under **Files**.
- [ ] **Step 3:** Run the tests. Expected: PASS. Also run `tests/unit/*laser* tests/unit/*fog* tests/unit/*background* tests/unit/*grid*`.
- [ ] **Step 4:** Add these lines to `changelog/Unreleased.md` under `## Fixed` (create the heading if missing):
```markdown
- The laser pointer is let go when Obsidian loses focus in the middle of a stroke, instead of staying drawn until the next click
- A replaced map image is released from memory once the new one shows
- Fog that did not change is no longer redrawn when other fog changes
- The automatic grid colour no longer fails on a map whose texture is not an image
```
- [ ] **Step 5:** Run the verify block without `api:check`, then commit the listed paths plus `changelog/Unreleased.md` with the message `fix: laser blur release, background and fog texture reuse, safe grid colour`.

### Task A5: Window and dashboard fixes

**Files:**
- Modify:
  - `src/app/services/PlayerWindowService.ts`: `playerWindowStore.setState({ presentedTabId: null })` when a source is released (fork hunk).
  - `src/app/react/components/dashboard.scss`: the odd last tile spans the row.
- Test:
  - `tests/unit/playerWindowPresenter.test.ts`: add only the fork case that asserts `presentedTabId` is null after the source is released. Find it with `git diff api/extension-api $FORK -- tests/unit/playerWindowPresenter.test.ts | grep -n "presentedTabId"`. The rest of that diff belongs to A12.
  - New file `tests/unit/dashboardOddTile.test.ts`, which reads the SCSS and asserts the rule exists:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard tiles', () => {
  it('lets an odd last tile span the whole row', () => {
    const scss = readFileSync('src/app/react/components/dashboard.scss', 'utf8');
    expect(scss).toMatch(/>\s*\.action-card:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
  });
});
```

- [ ] **Step 1:** Add both tests and run them. Expected: FAIL.
- [ ] **Step 2:** Apply the two hunks.
- [ ] **Step 3:** Run the tests. Expected: PASS.
- [ ] **Step 4:** Add these lines to the changelog under `## Fixed`:
```markdown
- Presenting a scene again after the player window lost its source shows that scene, instead of keeping the window on its last frame
- An odd last tile on the dashboard takes the whole row instead of leaving half of it empty
```
- [ ] **Step 5:** Run the verify block without `api:check`, then commit with the message `fix: re-target the player window after its source is released; odd dashboard tile spans the row`. Then `git tag api-pr-2-end`.

## PR 3: API foundation

### Task A6: `src/api/` skeleton: `api`, `version`, `has`, `connect`, events, ready/unload, disposal

**Files:**
- Create:
  - `src/api/version.ts`
  - `src/api/capabilities.ts`
  - `src/api/types/common.ts`
  - `src/api/types/api.ts`
  - `src/api/public.ts`
  - `src/api/disposers.ts`
  - `src/api/events.ts`
  - `src/api/AtlasApiHost.ts`
  - `src/api/services.ts`
  - `src/api/extension.ts`
  - `src/api/ExtensionApiPublisher.ts`
- Modify: `main.ts`.
- Test:
  - `tests/api/disposers.test.ts`
  - `tests/api/lifecycle.test.ts`
  - `tests/api/apiFakes.ts` (test helpers)

**Interfaces:**
- Produces, used by every later A task:
  - `ExtensionScope { id: string; disposers: DisposerSet; events: ApiEvents }`
  - `ApiServices { app: App; plugin: AtlasVTTPlugin }`. Later tasks add fields.
  - `buildExtension(scope, services): AtlasExtension`
  - `ApiEvents.emit(event, ...args)`
  - `DisposerSet.add(cleanup): Disposer`
  - `LANDED_CAPABILITIES`
- Produces, public:
  - `AtlasApi`, `AtlasExtension`, `AtlasEvents`, `AtlasCapability`, `Disposer`, `ViewId`, `Point`, `Json`, `ConnectingPlugin`
  - workspace events `atlas-vtt:api-ready` (payload: `api`) and `atlas-vtt:api-unload`
  - `plugin.api`

- [ ] **Step 1: Write the failing tests**

`tests/api/apiFakes.ts`:
```ts
import type { App } from 'obsidian';
import type { ConnectingPlugin } from '../../src/api/types/api';

export interface FakePlugin extends ConnectingPlugin {
  /** Runs what `register` was given, as Obsidian does when a plugin unloads. */
  unload(): void;
}

export function fakePlugin(id: string): FakePlugin {
  const cleanups: Array<() => void> = [];
  return {
    manifest: { id, name: id, version: '1.0.0', minAppVersion: '1.8.7', author: 'test', description: '' },
    register: (cleanup: () => void): void => { cleanups.push(cleanup); },
    unload: (): void => { for (const cleanup of cleanups.splice(0)) cleanup(); },
  } as FakePlugin;
}

export interface FakeWorkspaceApp { app: App; triggered: Array<{ name: string; data: unknown[] }> }

export function fakeApp(): FakeWorkspaceApp {
  const triggered: Array<{ name: string; data: unknown[] }> = [];
  const app = { workspace: { trigger: (name: string, ...data: unknown[]): void => { triggered.push({ name, data }); } } } as unknown as App;
  return { app, triggered };
}
```

`tests/api/disposers.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { DisposerSet } from '../../src/api/disposers';

describe('DisposerSet', () => {
  it('C-life-4: a disposer called twice runs its cleanup once', () => {
    const set = new DisposerSet();
    const cleanup = vi.fn();
    const dispose = set.add(cleanup);
    dispose();
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(set.size).toBe(0);
  });

  it('disposeAll runs every cleanup, also after one throws', () => {
    const set = new DisposerSet();
    const after = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    set.add(() => { throw new Error('boom'); });
    set.add(after);
    set.disposeAll();
    expect(after).toHaveBeenCalledTimes(1);
    expect(set.size).toBe(0);
  });

  it('runs a cleanup added after disposeAll at once', () => {
    const set = new DisposerSet();
    set.disposeAll();
    const late = vi.fn();
    set.add(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
```

`tests/api/lifecycle.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { AtlasApiHost } from '../../src/api/AtlasApiHost';
import { buildExtension } from '../../src/api/extension';
import { API_VERSION } from '../../src/api/version';
import { fakeApp, fakePlugin } from './apiFakes';

function host(capabilities: readonly string[] = []): { host: AtlasApiHost; triggered: ReturnType<typeof fakeApp>['triggered'] } {
  const { app, triggered } = fakeApp();
  const apiHost = new AtlasApiHost({
    app,
    capabilities: capabilities as never,
    build: (scope) => buildExtension(scope, { app, plugin: {} as never }),
  });
  return { host: apiHost, triggered };
}

describe('extension API lifecycle', () => {
  it('publishes the API with its version on api-ready', () => {
    const { host: h, triggered } = host();
    h.publish();
    expect(h.api.version).toBe(API_VERSION);
    expect(triggered).toEqual([{ name: 'atlas-vtt:api-ready', data: [h.api] }]);
  });

  it('C-life-5: has() is true only for landed capabilities', () => {
    const { host: h } = host(['views']);
    expect(h.api.has('views')).toBe(true);
    expect(h.api.has('remote-view')).toBe(false);
    expect(h.api.has('nonsense' as never)).toBe(false);
  });

  it('C-life-1: connecting again with the same id disposes the first connection', () => {
    const { host: h } = host();
    const plugin = fakePlugin('ext');
    const first = h.api.connect(plugin);
    const listener = vi.fn();
    first.on('unload', listener);
    h.api.connect(plugin);
    h.dispose();
    expect(listener).not.toHaveBeenCalled();
  });

  it('C-life-2: unloading the extension leaves no listener behind', () => {
    const { host: h } = host();
    const plugin = fakePlugin('ext');
    const extension = h.api.connect(plugin);
    const listener = vi.fn();
    extension.on('unload', listener);
    expect(h.listenerCount()).toBe(1);
    plugin.unload();
    expect(h.listenerCount()).toBe(0);
    h.dispose();
    expect(listener).not.toHaveBeenCalled();
  });

  it('C-life-3: Atlas unloading tells every extension, disposes everything, then triggers api-unload', () => {
    const { host: h, triggered } = host();
    const order: string[] = [];
    h.api.connect(fakePlugin('a')).on('unload', () => order.push('a'));
    h.api.connect(fakePlugin('b')).on('unload', () => order.push('b'));
    h.dispose();
    expect(order).toEqual(['a', 'b']);
    expect(h.listenerCount()).toBe(0);
    expect(triggered.at(-1)).toEqual({ name: 'atlas-vtt:api-unload', data: [] });
    expect(() => h.api.connect(fakePlugin('c'))).toThrow(/unloaded/);
  });

  it('scopes the extension to its manifest id', () => {
    const { host: h } = host();
    expect(h.api.connect(fakePlugin('atlas-vtt-connect')).id).toBe('atlas-vtt-connect');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run `npx vitest run --project unit tests/api`. Expected: FAIL, "Failed to resolve import ../../src/api/AtlasApiHost".

- [ ] **Step 3: Write the implementation**

`src/api/version.ts`:
```ts
/**
 * Semver of the extension API, independent of Atlas's own version (docs/extension-api.md).
 * Minor: something added. Major: something removed, renamed or tightened. The API report
 * check fails when `api-report/` changes and this does not.
 */
export const API_VERSION = '1.0.0';
```

`src/api/types/common.ts`:
```ts
/** Removes a registration; calling it again does nothing. */
export type Disposer = () => void;

/** An Atlas map view (`AtlasView.viewId`); never reused once the view closed. */
export type ViewId = string;

export interface Point {
  x: number;
  y: number;
}

export type AtlasCapability =
  | 'views' | 'presentation' | 'rules' | 'lighting' | 'tokens' | 'dice'
  | 'lasers' | 'ui' | 'scenes' | 'bundles' | 'settings' | 'storage' | 'remote-view';

/** Plain JSON: all an extension may keep on Atlas's records. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
```

`src/api/types/api.ts`:
```ts
import type { Plugin } from 'obsidian';
import type { AtlasCapability, Disposer } from './common';

/** What `connect` needs of the calling plugin: its id, and where to register its own teardown. */
export type ConnectingPlugin = Pick<Plugin, 'manifest' | 'register'>;

/** `app.plugins.plugins['atlas-vtt'].api`, set once Atlas's storage and asset index are ready. */
export interface AtlasApi {
  /** Semver of this API, e.g. "1.0.0"; independent of Atlas's own version. */
  readonly version: string;
  has(capability: AtlasCapability): boolean;
  /** Scopes everything to `plugin.manifest.id`; registrations are disposed when either plugin unloads. */
  connect(plugin: ConnectingPlugin): AtlasExtension;
}

export interface AtlasEvents {
  /** Atlas is unloading; everything is disposed after this. */
  unload: () => void;
}

export interface AtlasExtension {
  /** The calling plugin's manifest id. */
  readonly id: string;
  on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer;
}
```

`src/api/public.ts`, the only entry `api-extractor` reads (A7). Later tasks append one `export type *` line per types file:
```ts
export { API_VERSION } from './version';
export type * from './types/common';
export type * from './types/api';
```

`src/api/capabilities.ts`:
```ts
import type { AtlasCapability } from './types/common';

/** The capabilities whose groups have landed; `has()` answers from this list only. */
export const LANDED_CAPABILITIES: readonly AtlasCapability[] = [];
```

`src/api/disposers.ts`:
```ts
import type { Disposer } from './types/common';

function runSafely(cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    console.error('[Atlas API] A cleanup failed:', error);
  }
}

/** One extension's registrations. Every disposer runs its cleanup once; after `disposeAll`, new cleanups run at once. */
export class DisposerSet {
  private readonly pending = new Set<() => void>();
  private closed = false;

  add(cleanup: () => void): Disposer {
    let done = false;
    const dispose = (): void => {
      if (done) return;
      done = true;
      this.pending.delete(dispose);
      runSafely(cleanup);
    };
    if (this.closed) {
      dispose();
      return dispose;
    }
    this.pending.add(dispose);
    return dispose;
  }

  get size(): number {
    return this.pending.size;
  }

  disposeAll(): void {
    this.closed = true;
    for (const dispose of [...this.pending]) dispose();
  }
}
```

`src/api/events.ts`:
```ts
import type { AtlasEvents } from './types/api';

type Listener = (...args: never[]) => void;

/** Fans Atlas's API events out to every connected extension; a failing listener never stops the others. */
export class ApiEvents {
  private readonly listeners = new Map<keyof AtlasEvents, Set<Listener>>();

  on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const stored = set;
    stored.add(listener);
    return (): void => { stored.delete(listener); };
  }

  emit<E extends keyof AtlasEvents>(event: E, ...args: Parameters<AtlasEvents[E]>): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        (listener as (...values: Parameters<AtlasEvents[E]>) => void)(...args);
      } catch (error) {
        console.error(`[Atlas API] A '${String(event)}' listener failed:`, error);
      }
    }
  }

  get size(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}
```

`src/api/services.ts`:
```ts
import type { App } from 'obsidian';
import type AtlasVTTPlugin from '../../main';

/** What the facades need of Atlas. One per published API; later groups add their trackers here. */
export interface ApiServices {
  app: App;
  plugin: AtlasVTTPlugin;
}
```

`src/api/extension.ts`:
```ts
import type { DisposerSet } from './disposers';
import type { ApiEvents } from './events';
import type { ApiServices } from './services';
import type { AtlasEvents, AtlasExtension } from './types/api';
import type { Disposer } from './types/common';

export interface ExtensionScope {
  readonly id: string;
  readonly disposers: DisposerSet;
  readonly events: ApiEvents;
}

/** One connected extension's view of the API: one line per namespace, each registration owned by `scope`. */
export function buildExtension(scope: ExtensionScope, services: ApiServices): AtlasExtension {
  function on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer {
    return scope.disposers.add(scope.events.on(event, listener));
  }
  void services;
  return Object.freeze({ id: scope.id, on });
}
```
(`void services;` goes away in A9, the first task to use the services.)

`src/api/AtlasApiHost.ts`:
```ts
import type { App } from 'obsidian';
import { DisposerSet } from './disposers';
import { ApiEvents } from './events';
import type { ExtensionScope } from './extension';
import type { AtlasApi, AtlasExtension, ConnectingPlugin } from './types/api';
import type { AtlasCapability } from './types/common';
import { API_VERSION } from './version';

export interface ApiHostOptions {
  app: App;
  capabilities: readonly AtlasCapability[];
  build(scope: ExtensionScope): AtlasExtension;
}

/** The published API object and every connected extension's registrations. */
export class AtlasApiHost {
  readonly api: AtlasApi;
  private readonly events = new ApiEvents();
  private readonly connected = new Map<string, DisposerSet>();
  private disposed = false;

  constructor(private readonly options: ApiHostOptions) {
    const capabilities = new Set<string>(options.capabilities);
    this.api = Object.freeze({
      version: API_VERSION,
      has: (capability: AtlasCapability): boolean => capabilities.has(capability),
      connect: (plugin: ConnectingPlugin): AtlasExtension => this.connect(plugin),
    });
  }

  /** The events every facade emits through. */
  get apiEvents(): ApiEvents {
    return this.events;
  }

  publish(): void {
    this.options.app.workspace.trigger('atlas-vtt:api-ready', this.api);
  }

  /** Atlas is unloading: tell every extension, dispose all their registrations, then say so on the workspace. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.emit('unload');
    for (const disposers of this.connected.values()) disposers.disposeAll();
    this.connected.clear();
    this.options.app.workspace.trigger('atlas-vtt:api-unload');
  }

  listenerCount(): number {
    return this.events.size;
  }

  private connect(plugin: ConnectingPlugin): AtlasExtension {
    if (this.disposed) throw new Error('Atlas VTT has unloaded; wait for atlas-vtt:api-ready.');
    const id = plugin.manifest.id;
    this.connected.get(id)?.disposeAll();
    const disposers = new DisposerSet();
    this.connected.set(id, disposers);
    plugin.register(() => {
      disposers.disposeAll();
      if (this.connected.get(id) === disposers) this.connected.delete(id);
    });
    return this.options.build({ id, disposers, events: this.events });
  }
}
```

`src/api/ExtensionApiPublisher.ts`:
```ts
import type AtlasVTTPlugin from '../../main';
import { AssetService } from '../app/services/AssetService';
import { AtlasApiHost } from './AtlasApiHost';
import { LANDED_CAPABILITIES } from './capabilities';
import { buildExtension } from './extension';
import type { ApiServices } from './services';

/** Publishes `plugin.api` once storage and the asset index are ready, and takes it down on unload. */
export class ExtensionApiPublisher {
  private host: AtlasApiHost | null = null;
  private stopped = false;

  constructor(private readonly plugin: AtlasVTTPlugin) {}

  async start(): Promise<void> {
    await AssetService.getInstance(this.plugin.app).initialize();
    if (this.stopped) return;
    const services: ApiServices = { app: this.plugin.app, plugin: this.plugin };
    const host = new AtlasApiHost({
      app: this.plugin.app,
      capabilities: LANDED_CAPABILITIES,
      build: (scope) => buildExtension(scope, services),
    });
    this.host = host;
    this.plugin.api = host.api;
    host.publish();
  }

  stop(): void {
    this.stopped = true;
    this.host?.dispose();
    this.host = null;
    this.plugin.api = undefined;
  }
}
```

`main.ts`:
```ts
// imports
import { ExtensionApiPublisher } from './src/api/ExtensionApiPublisher';
import type { AtlasApi } from './src/api/types/api';
// fields
  /** The extension API (`src/api/`): set once storage and the asset index are ready, undefined before and after unload. */
  public api: AtlasApi | undefined;
  private extensionApi: ExtensionApiPublisher | undefined;
// at the end of onload(), after registerCommands(…):
    this.extensionApi = new ExtensionApiPublisher(this);
    runInBackground(this.extensionApi.start(), 'Publishing the extension API');
// first line of onunload():
    this.extensionApi?.stop();
```

- [ ] **Step 4: Run the tests**

Run `npx vitest run --project unit tests/api`. Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

Run the verify block without `api:check`; the API report arrives in A7. Then:
```bash
git add src/api main.ts tests/api
git commit -m "feat(api): extension API foundation (version, has, connect, ready/unload, disposal)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```
`git add src/api tests/api` names two explicit folders that this task created entirely. That is allowed.

### Task A7: API report (`api-report/atlas-vtt-api.d.ts`), the version check, CODEOWNERS and docs

**Files:**
- Create:
  - `tsconfig.api.json`
  - `api-extractor.json`
  - `api-report/atlas-vtt-api.d.ts` (generated)
  - `scripts/api-version-check.js`
  - `.github/CODEOWNERS`
  - `docs/extension-api.md`
  - `tests/api/apiReport.test.ts`
- Modify:
  - `package.json`: add the scripts `api:report` and `api:check`, and the devDependency `@microsoft/api-extractor`.
  - `.gitignore`: add `build/api-dts/` and `dist-packages/`.
  - `.github/workflows/plugin-ci.yml`: add an `api:check` step before Test.
  - `changelog/Unreleased.md`.

**Interfaces:**
- Consumes: `src/api/public.ts` (A6).
- Produces:
  - `npm run api:report`, which regenerates the rollup.
  - `npm run api:check`, which regenerates the rollup, runs `git diff --exit-code -- api-report`, then runs the version check against `API_BASE_REF`.
  - The rollup file that Connect vendors as `@atlas-vtt/api-types`.

- [ ] **Step 1: Write the failing test**

`tests/api/apiReport.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../../src/api/version';

const report = readFileSync('api-report/atlas-vtt-api.d.ts', 'utf8');

describe('API report', () => {
  it('imports nothing of Atlas internals or libraries but obsidian', () => {
    const sources = [...report.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(new Set(sources)).toEqual(new Set(['obsidian']));
  });

  it('carries the API version as a literal', () => {
    expect(report).toContain(`export declare const API_VERSION = "${API_VERSION}";`);
  });
});
```
Run: `npx vitest run --project unit tests/api/apiReport.test.ts`. Expected: FAIL with ENOENT.

- [ ] **Step 2: Add the tooling**

```bash
npm install --save-dev --save-exact @microsoft/api-extractor@7
```

`tsconfig.api.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "build/api-dts",
    "rootDir": ".",
    "inlineSourceMap": false,
    "inlineSources": false
  },
  "include": [],
  "files": ["src/api/public.ts"]
}
```

`api-extractor.json`:
```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "mainEntryPointFilePath": "<projectFolder>/build/api-dts/src/api/public.d.ts",
  "bundledPackages": [],
  "apiReport": { "enabled": false },
  "docModel": { "enabled": false },
  "tsdocMetadata": { "enabled": false },
  "dtsRollup": { "enabled": true, "untrimmedFilePath": "<projectFolder>/api-report/atlas-vtt-api.d.ts" },
  "messages": {
    "extractorMessageReporting": { "default": { "logLevel": "warning" }, "ae-missing-release-tag": { "logLevel": "none" } },
    "tsdocMessageReporting": { "default": { "logLevel": "none" } }
  }
}
```

`package.json` scripts. Neither name has a `pre`/`post` hook:
```json
"api:report": "tsc -p tsconfig.api.json && api-extractor run --local",
"api:check": "npm run api:report && git diff --exit-code -- api-report && node scripts/api-version-check.js",
```

`scripts/api-version-check.js`:
```js
// Fails when the API report changed against API_BASE_REF (default origin/beta) but API_VERSION did not.
const { execFileSync } = require('child_process');
const fs = require('fs');

const REPORT = 'api-report/atlas-vtt-api.d.ts';
const VERSION_LINE = /^export declare const API_VERSION = "([^"]+)";$/m;
const base = process.env.API_BASE_REF || 'origin/beta';

function baseReport() {
  try {
    return execFileSync('git', ['show', `${base}:${REPORT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // no report at the base yet: the first API PR
  }
}

const head = fs.readFileSync(REPORT, 'utf8').replace(/\r\n/g, '\n');
const before = baseReport()?.replace(/\r\n/g, '\n') ?? null;
if (before === null) process.exit(0);
const strip = (text) => text.replace(VERSION_LINE, '');
const headVersion = head.match(VERSION_LINE)?.[1];
const baseVersion = before.match(VERSION_LINE)?.[1];
if (strip(head) !== strip(before) && headVersion === baseVersion) {
  console.error(`The extension API changed against ${base} but API_VERSION is still ${headVersion}. Bump src/api/version.ts (docs/extension-api.md).`);
  process.exit(1);
}
```

`.github/CODEOWNERS`:
```
/src/api/     @evolJoaoBento
/tests/api/   @evolJoaoBento
/api-report/  @evolJoaoBento
/src/shared/  @evolJoaoBento
```

`docs/extension-api.md` holds:
- the version and capability table from decision D2;
- the semver rules (spec §5);
- the deprecation rule: two Atlas minor releases, one console warning per session, `@deprecated` in the types, and a changelog line;
- how an extension connects, with the AtlasLink example from B3 written in plain TS;
- "no npm: vendor `api-report/` and `dist-packages/shared`" (decision D1);
- the maintainer split: the API maintainer owns `src/api/`, `tests/api/`, `api-report/` and `src/shared/`.

`.github/workflows/plugin-ci.yml`: add this step after Typecheck:
```yaml
      - name: Extension API report
        run: npm run api:check
        env:
          API_BASE_REF: origin/${{ github.base_ref || 'beta' }}
```
Also add `fetch-depth: 0` to the checkout step `with:` block, so the base ref exists.

- [ ] **Step 3: Generate the report and run the tests**

```bash
npm run api:report
npx vitest run --project unit tests/api/apiReport.test.ts
```
Expected: PASS. If the import test fails because the rollup pulls in `zustand` or similar, the cause is a re-exported record type. Do the pure type-only move described in decision D3, then re-run. At this point the report holds only the foundation types.

- [ ] **Step 4: Changelog and verify**

Under `## New`:
```markdown
- Extension API: other Obsidian plugins can connect to Atlas through `app.plugins.plugins['atlas-vtt'].api` (version 1.0.0), which announces itself with the `atlas-vtt:api-ready` workspace event and tidies up every extension's additions when Atlas unloads. See docs/extension-api.md
```
Run the verify block, including `API_BASE_REF=origin/beta npm run api:check`.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.api.json api-extractor.json api-report/atlas-vtt-api.d.ts scripts/api-version-check.js .github/CODEOWNERS \
  docs/extension-api.md tests/api/apiReport.test.ts package.json package-lock.json .gitignore .github/workflows/plugin-ci.yml changelog/Unreleased.md
git commit -m "feat(api): committed API report with version check, CODEOWNERS and docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

### Task A8: Shared modules (`src/shared/`), `build:packages`, boundary test and CI artifact

**Files:**
- Create:
  - `src/shared/grid.ts`, `src/shared/draw.ts`, `src/shared/rules.ts`, `src/shared/dice3d.ts`
  - `vite.shared.config.mts`
  - `tsconfig.shared.json`
  - `tests/api/sharedBoundary.test.ts`
- Modify:
  - `package.json`: the `build:packages` script.
  - `.github/workflows/plugin-ci.yml`: build and upload `dist-packages`.
  - `eslint.config.mjs`: add `dist-packages/` and `build/` to `globalIgnores`.

**Interfaces:**
- Produces the entry barrels that Connect imports as `@atlas-vtt/shared/<entry>`. Every name is re-exported unchanged from its module:
  - **`grid`:** everything exported by `grid/{hexGeometry, hexLattice, squareLattice, gridDistance, gridPlacement, cellNumbering, measurementFormat}`.
  - **`draw`:** everything exported by:
    - `pixi/{measureGeometry, sceneLayerOrder, textBoxLayout, mapIcons}`
    - `pixi/laser/{laserBeamGeometry, laserTrail}`
    - `pixi/token-renderer/{tokenUiLayout, conditionBadgeLayout, downedLook, dragRulerPath, tokenSizing, tokenRingMetrics}`
    - `pixi/fog/fogRenderUtils`
    - `styles/designTokens`
    - `utils/hexColor`

    A18 adds `remoteLasers`. A20 adds `insideSpans`.
  - **`rules`:** everything exported by:
    - `tools/{diceRolling, diceFormula, diceCrit, diceExplosion, diceLabels, laserPointerSettings}`
    - `gameSystems/{diceRules, initiativeRules}`
    - `initiative/sides`
    - `resources/{resourceTypes, resourceValues, visibleResources, resourceColors}`
    - `react/components/dice/diceTrayPool`
  - **`dice3d`:** everything exported by:
    - `dice3d/{DiceRenderer, diceDisplay, diceScene, dieArtwork, dieGeometry, dieMotion, dieTour, rollPresentation, stagePool, throwChain, throwSeed}`
    - `react/components/dice3d/diceRollText`

    It also exports `DIE_ICONS: Record<'d4'|'d6'|'d8'|'d10'|'d12'|'d20', string>`, the six `assets/dice-icons/*.webp` imported as URLs.
- Produces `npm run build:packages`, whose output is:
  - `dist-packages/shared/{grid,draw,rules,dice3d}.js` plus chunks;
  - `dist-packages/shared/types/src/shared/*.d.ts` plus the `.d.ts` of every module they reach.

- [ ] **Step 1: Write the failing boundary test**

`tests/api/sharedBoundary.test.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRIES = ['grid', 'draw', 'rules', 'dice3d'] as const;
const FORBIDDEN = /^(obsidian|pixi\.js|pixi-viewport|pixi-filters|react|react-dom|zustand|zundo|howler|@codemirror\/.*)$/;
const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['.ts', '.tsx', '/index.ts'];

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  if (/\.(webp|png|svg)$/.test(spec)) return null;
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext)]) if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  throw new Error(`Cannot resolve ${spec} from ${from}`);
}

/** Every module an entry reaches, and the packages they import. */
function reach(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [resolve(`src/shared/${entry}.ts`)];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = match[1] ?? match[2]!;
      if (spec.startsWith('.')) {
        const next = resolveLocal(file, spec);
        if (next) queue.push(next);
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
      }
    }
  }
  return { files, packages };
}

describe('shared modules package', () => {
  for (const entry of ENTRIES) {
    it(`${entry} imports nothing from Obsidian, PIXI or React`, () => {
      const { packages } = reach(entry);
      expect([...packages].filter((name) => FORBIDDEN.test(name))).toEqual([]);
      if (entry !== 'dice3d') expect(packages.has('three')).toBe(false);
    });
  }

  it('only dice3d reads the activeDocument and createEl globals', () => {
    for (const entry of ENTRIES.filter((name) => name !== 'dice3d')) {
      for (const file of reach(entry).files) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(activeDocument|createEl|activeWindow)\b/);
      }
    }
  });
});
```
Run it. Expected: FAIL, because `src/shared/grid.ts` cannot be resolved.

- [ ] **Step 2: Write the barrels**

`src/shared/grid.ts`. The other three barrels follow the same pattern with the module lists from **Interfaces**:
```ts
/**
 * `@atlas-vtt/shared/grid`: Atlas's grid geometry for drawing and local previews outside Atlas
 * (decision: authoritative snapping is `tokens.snapPoint`). PIXI-, Obsidian- and React-free (tests/api/sharedBoundary.test.ts).
 */
export * from '../app/grid/hexGeometry';
export * from '../app/grid/hexLattice';
export * from '../app/grid/squareLattice';
export * from '../app/grid/gridDistance';
export * from '../app/grid/gridPlacement';
export * from '../app/grid/cellNumbering';
export * from '../app/grid/measurementFormat';
```
In `src/shared/dice3d.ts`, add:
```ts
import d4 from '../app/assets/dice-icons/d4.webp';
import d6 from '../app/assets/dice-icons/d6.webp';
import d8 from '../app/assets/dice-icons/d8.webp';
import d10 from '../app/assets/dice-icons/d10.webp';
import d12 from '../app/assets/dice-icons/d12.webp';
import d20 from '../app/assets/dice-icons/d20.webp';

/** The six dice icons the tray shows, as URLs (inlined as data URLs by the package build). */
export const DIE_ICONS = { d4, d6, d8, d10, d12, d20 } as const;
```
If two barrels re-export the same name (`export *` conflicts make `tsc` error TS2308), re-export that name explicitly from its owning module in the one barrel where it belongs, and leave it out of the other.

- [ ] **Step 3: Fix any boundary violation by pure extraction**

Run the boundary test. A module that reaches a forbidden import (for example `pixi/mapIcons` importing PIXI, or `diceRolling` importing `events`) gets its pure part moved into a new file next to it. The old module re-exports it, with no behaviour change. Name the new files in the commit. Re-run until the test passes.

- [ ] **Step 4: The package build**

`vite.shared.config.mts`:
```ts
import { defineConfig } from 'vite';

/** `@atlas-vtt/shared`: plain ES modules for extensions to vendor (docs/extension-api.md). Copies nothing anywhere. */
export default defineConfig({
  build: {
    outDir: 'dist-packages/shared',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: {
      entry: { grid: 'src/shared/grid.ts', draw: 'src/shared/draw.ts', rules: 'src/shared/rules.ts', dice3d: 'src/shared/dice3d.ts' },
      formats: ['es'],
    },
    rollupOptions: { external: ['three', /^three\//] },
  },
});
```

`tsconfig.shared.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist-packages/shared/types",
    "rootDir": ".",
    "inlineSourceMap": false,
    "inlineSources": false
  },
  "include": ["src/types/**/*.d.ts"],
  "files": ["src/shared/grid.ts", "src/shared/draw.ts", "src/shared/rules.ts", "src/shared/dice3d.ts"]
}
```
If the `*.webp` module declaration lives elsewhere, include that `.d.ts` file instead (`git grep -n "declare module '\*.webp'"`).

`package.json`:
```json
"build:packages": "npm run api:report && vite build -c vite.shared.config.mts && tsc -p tsconfig.shared.json",
```

CI, after "Build plugin":
```yaml
      - name: Build extension packages
        run: npm run build:packages
      - name: Upload extension packages
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: atlas-vtt-packages-${{ github.event.pull_request.head.sha || github.sha }}
          path: |
            dist-packages/
            api-report/
          if-no-files-found: error
          retention-days: 30
```

- [ ] **Step 5: Run and inspect the build**

```bash
npm run build:packages
ls dist-packages/shared            # grid.js draw.js rules.js dice3d.js (+ chunks) types/
grep -lE "from ['\"](obsidian|pixi\.js|react)['\"]" dist-packages/shared/*.js   # prints nothing
npx vitest run --project unit tests/api
```
Expected: the build succeeds and the tests PASS.

- [ ] **Step 6: Verify, commit and tag**

Run the verify block with `API_BASE_REF=origin/beta`. Then:
```bash
git add src/shared vite.shared.config.mts tsconfig.shared.json tests/api/sharedBoundary.test.ts package.json .github/workflows/plugin-ci.yml eslint.config.mjs
# plus any pure-extraction files from step 3, by explicit path
git commit -m "feat(api): shared modules entries and package build (no npm; CI artifact)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
git tag api-pr-3-end
```

## PR 4: Views, rules, settings, storage (groups 2, 4, 11), API 1.1.0

### Task A9: `views` (the view tracker, snapshot, subscribe, camera) and the record types

**Files:**
- Create:
  - `src/api/types/records.ts`
  - `src/api/types/views.ts`
  - `src/api/viewTracker.ts`
  - `src/api/viewInfo.ts`
  - `src/api/views.ts`
  - `src/app/services/viewMapSize.ts`
  - `src/app/services/presentedCamera.ts`, ported from the fork with its own `CameraView` interface in place of the `PresentedView` import.
- Modify:
  - `src/app/atlas-view.ts`: the fork's `isClosed` getter only.
  - `src/api/types/api.ts`: add `views` and the `map-loaded` and `map-closed` events.
  - `src/api/extension.ts`, `src/api/services.ts`, `src/api/ExtensionApiPublisher.ts`, `src/api/capabilities.ts`, `src/api/public.ts`, `src/api/version.ts` (`1.1.0`).
  - `api-report/atlas-vtt-api.d.ts`, regenerated.
- Test:
  - `tests/api/views.test.ts`
  - `tests/unit/presentedCamera.test.ts`, ported from `$FORK:tests/unit/online/presentedCamera.test.ts` with its import changed to `../../src/app/services/presentedCamera`.

**Interfaces:**
- Produces, public types:
  - `ViewInfo`, `SceneSnapshot`, `ViewCamera` and `ViewsApi`, exactly as in spec group 2, with the D3 corrections: `objects.fog` is `Readonly<Record<string, FogOperation>>`, and `background` is `BackgroundState`.
  - `records.ts` re-exports the record types listed in the spec's "Common types". It also re-exports every type the fork's online code imports type-only from Atlas (Appendix C, "api-types" rows). To get that list, run `node <scratch>/imports.js`, or read the Appendix C list directly.
- Produces, internal:
  - `class ViewTracker { start(): void; stop(): void; views(): TrackedMapView[]; view(viewId: string): TrackedMapView | null }`
  - `interface TrackedMapView { readonly viewId: string; readonly atlasStore: ViewAtlasStore; readonly tabMetaStore: TabMetaStore; readonly renderer: { getBackgroundSprite(): { width: number; height: number; destroyed: boolean } | null; getViewportInstance?(): CameraViewport | null } | null; readonly isClosed: boolean; register(cb: () => void): void }`
  - `viewInfo(view): ViewInfo`, `sceneSnapshot(view): SceneSnapshot`, `loadedMapSize(view): MapSize`, `type MapSize = { width: number; height: number }`
  - `ApiServices` gains `views: ViewTracker`.

- [ ] **Step 1: Write the failing contract test**

`tests/api/views.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';
import { ApiEvents } from '../../src/api/events';
import { ViewTracker, type TrackedMapView } from '../../src/api/viewTracker';
import { viewsApi } from '../../src/api/views';
import { DisposerSet } from '../../src/api/disposers';
import { createInMemoryApp } from '../mocks/inMemoryVault';

interface FakeView extends TrackedMapView { close(): void }

function fakeView(viewId: string): FakeView {
  const { app } = createInMemoryApp();
  const closers: Array<() => void> = [];
  let closed = false;
  const tabs = createTabMetaStore();
  const tabId = tabs.getState().addTab('maps/a.atlasmap', 'A');
  tabs.getState().setActiveTab(tabId);
  return {
    viewId, atlasStore: createViewAtlasStore(app, viewId), tabMetaStore: tabs,
    renderer: { getBackgroundSprite: () => ({ width: 1000, height: 500, destroyed: false }), getViewportInstance: () => null },
    get isClosed(): boolean { return closed; },
    register: (cb: () => void): void => { closers.push(cb); },
    close: (): void => { closed = true; for (const cb of closers.splice(0)) cb(); },
  };
}

function workspaceWith(views: FakeView[]): { app: never; layoutChanged(): void } {
  let onLayout: () => void = () => undefined;
  const app = {
    workspace: {
      getLeavesOfType: () => views.filter((view) => !view.isClosed).map((view) => ({ view })),
      on: (_name: string, cb: () => void) => { onLayout = cb; return {}; },
      offref: () => undefined,
    },
  } as never;
  return { app, layoutChanged: () => onLayout() };
}

function setup(views: FakeView[]): { api: ReturnType<typeof viewsApi>; events: ApiEvents; layoutChanged(): void } {
  const { app, layoutChanged } = workspaceWith(views);
  const events = new ApiEvents();
  const tracker = new ViewTracker(app, events, (view): view is TrackedMapView => 'atlasStore' in (view as object));
  tracker.start();
  return { api: viewsApi(tracker, new DisposerSet()), events, layoutChanged };
}

function load(view: FakeView): void {
  view.atlasStore.setState({ mapPath: 'maps/a.atlasmap', mapLoaded: true, isMapLoading: false });
}

describe('views', () => {
  it('C-views-1: snapshot is null for an unknown or closed view', () => {
    const view = fakeView('v1');
    const { api } = setup([view]);
    expect(api.snapshot('nope')).toBeNull();
    view.close();
    expect(api.snapshot('v1')).toBeNull();
  });

  it('C-views-2: loaded is false while the map loads; subscribe fires on a replaced field, not on the camera', () => {
    const view = fakeView('v1');
    const { api } = setup([view]);
    view.atlasStore.setState({ mapPath: 'maps/a.atlasmap', mapLoaded: true, isMapLoading: true });
    expect(api.snapshot('v1')!.loaded).toBe(false);
    load(view);
    const listener = vi.fn();
    api.subscribe('v1', listener);
    view.atlasStore.getState().setCamera({ zoom: 2 });
    expect(listener).not.toHaveBeenCalled();
    view.atlasStore.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0]![0];
    expect(snapshot.objects.tokens).toBe(view.atlasStore.getState().objects.tokens);
    expect(snapshot.mapSize).toEqual({ width: 1000, height: 500 });
  });

  it('C-views-4: map-loaded fires once per load, map-closed once on close', () => {
    const view = fakeView('v1');
    const { events } = setup([view]);
    const loaded = vi.fn();
    const closed = vi.fn();
    events.on('map-loaded', loaded);
    events.on('map-closed', closed);
    load(view);
    load(view);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded.mock.calls[0]![0]).toMatchObject({ viewId: 'v1', kind: 'map', mapPath: 'maps/a.atlasmap', loaded: true });
    view.close();
    view.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith('v1');
  });

  it('C-views-3: list and active show map views only, picked up on layout change', () => {
    const first = fakeView('v1');
    const views = [first];
    const { api, layoutChanged } = setup(views);
    views.push(fakeView('v2'));
    layoutChanged();
    expect(api.list().map((info) => info.viewId)).toEqual(['v1', 'v2']);
    expect(api.list().every((info) => info.kind === 'map')).toBe(true);
  });

  it('C-views-5: camera is null without a viewport, and watchCamera is a harmless no-op', () => {
    const view = fakeView('v1');
    const { api } = setup([view]);
    expect(api.camera('v1')).toBeNull();
    const stop = api.watchCamera('v1', () => undefined);
    stop();
    stop();
  });
});
```
Run: `npx vitest run --project unit tests/api/views.test.ts`. Expected: FAIL, the modules don't exist yet.

- [ ] **Step 2: Implement**

`src/app/services/viewMapSize.ts`:
```ts
/** A map's size in world pixels. */
export interface MapSize { width: number; height: number }

interface SizedSprite { width: number; height: number; destroyed: boolean }

/** The loaded background's size, read from the view's renderer; 0 × 0 while none is loaded. */
export function loadedMapSize(view: { readonly renderer: { getBackgroundSprite(): SizedSprite | null } | null }): MapSize {
  const sprite = view.renderer?.getBackgroundSprite() ?? null;
  if (!sprite || sprite.destroyed || !(sprite.width > 0) || !(sprite.height > 0)) return { width: 0, height: 0 };
  return { width: sprite.width, height: sprite.height };
}
```

`src/app/services/presentedCamera.ts`: port the fork file and replace `import type { PresentedView } from './PresentedScene'` with:
```ts
/** What the camera needs of a view: its renderer's viewport, when there is one. */
export interface CameraView {
  readonly renderer?: { getViewportInstance?(): CameraViewport | null } | null;
}
```
Use `CameraView` wherever the fork used `PresentedView`.

`src/api/types/views.ts`. Copy the spec's group 2 block, plus:
```ts
import type { ViewCamera } from '../../app/services/presentedCamera';
import type { BackgroundState, DrawingStroke, FogOperation, GridState, InitiativeState, SceneLighting, TextElement, TokenEntity, WidgetSettings, WidgetValues } from './records';
import type { Disposer, ViewId } from './common';
export type { ViewCamera };
```
- `SceneSnapshot.objects.fog` is `Readonly<Record<string, FogOperation>>`.
- `SceneSnapshot.widgets` is `{ readonly settings: WidgetSettings; readonly values: WidgetValues }`.
- Add a doc line to `mapSize`: "Read when the snapshot is taken: the background may finish drawing after `loaded`; take a fresh snapshot when you need the size."

`src/api/viewInfo.ts`:
```ts
import { loadedMapSize } from '../app/services/viewMapSize';
import type { ViewAtlasState } from '../app/storeFactory';
import type { TrackedMapView } from './viewTracker';
import type { SceneSnapshot, ViewInfo } from './types/views';

export function isLoaded(state: Pick<ViewAtlasState, 'mapLoaded' | 'isMapLoading'>): boolean {
  return state.mapLoaded && !state.isMapLoading;
}

export function viewInfo(view: TrackedMapView): ViewInfo {
  const state = view.atlasStore.getState();
  const { tabs, activeTabId } = view.tabMetaStore.getState();
  return {
    viewId: view.viewId,
    kind: 'map',
    activeTabId,
    tabs: tabs.map((tab) => ({ tabId: tab.id, mapPath: tab.filePath, name: tab.displayName })),
    mapPath: state.mapPath,
    loaded: isLoaded(state),
  };
}

/** The store fields a snapshot carries; a change to any of them (by reference) is a new snapshot. */
export function snapshotSlice(state: ViewAtlasState): readonly unknown[] {
  return [
    state.mapPath, state.mapLoaded, state.isMapLoading, state.background, state.grid,
    state.objects.tokens, state.objects.texts, state.objects.drawings, state.objects.fog,
    state.widgetSettings, state.widgetValues, state.initiative, state.initiativeTrackerOpen, state.lighting,
  ];
}

/** The scene in `view`'s store, by reference: the store's frozen Immer records, never copied. */
export function sceneSnapshot(view: TrackedMapView): SceneSnapshot {
  const state = view.atlasStore.getState();
  return Object.freeze({
    viewId: view.viewId,
    mapPath: state.mapPath,
    loaded: isLoaded(state),
    mapSize: loadedMapSize(view),
    background: state.background,
    grid: state.grid,
    objects: Object.freeze({ tokens: state.objects.tokens, texts: state.objects.texts, drawings: state.objects.drawings, fog: state.objects.fog }),
    widgets: Object.freeze({ settings: state.widgetSettings, values: state.widgetValues }),
    initiative: state.initiative,
    initiativeTrackerOpen: state.initiativeTrackerOpen,
    lighting: state.lighting,
  });
}
```

`src/api/viewTracker.ts`:
```ts
import type { App } from 'obsidian';
import { AtlasView, ATLAS_VIEW_TYPE } from '../app/atlas-view';
import type { CameraViewport } from '../app/services/presentedCamera';
import type { ViewAtlasStore } from '../app/storeFactory';
import type { TabMetaStore } from '../app/stores/tabMetaStore';
import type { ApiEvents } from './events';
import { isLoaded, viewInfo } from './viewInfo';

/** What the API reads of an open Atlas map view (`AtlasView` provides it). */
export interface TrackedMapView {
  readonly viewId: string;
  readonly atlasStore: ViewAtlasStore;
  readonly tabMetaStore: TabMetaStore;
  readonly renderer: {
    getBackgroundSprite(): { width: number; height: number; destroyed: boolean } | null;
    getViewportInstance?(): CameraViewport | null;
  } | null;
  readonly isClosed: boolean;
  register(callback: () => void): void;
}

interface Entry { view: TrackedMapView; unsubscribe: () => void; loadedPath: string | null }

const isAtlasMapView = (view: unknown): view is TrackedMapView => view instanceof AtlasView;

/** Follows the open map views for the API: which there are, and when one loads a map or closes. */
export class ViewTracker {
  private readonly entries = new Map<string, Entry>();
  private stopLayout: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly events: ApiEvents,
    private readonly isMapView: (view: unknown) => view is TrackedMapView = isAtlasMapView,
  ) {}

  start(): void {
    const ref = this.app.workspace.on('layout-change', () => this.scan());
    this.stopLayout = (): void => this.app.workspace.offref(ref);
    this.scan();
  }

  stop(): void {
    this.stopLayout?.();
    this.stopLayout = null;
    for (const entry of this.entries.values()) entry.unsubscribe();
    this.entries.clear();
  }

  views(): TrackedMapView[] {
    return [...this.entries.values()].map((entry) => entry.view).filter((view) => !view.isClosed);
  }

  view(viewId: string): TrackedMapView | null {
    const view = this.entries.get(viewId)?.view ?? null;
    return view && !view.isClosed ? view : null;
  }

  private scan(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
      const view: unknown = leaf.view;
      if (this.isMapView(view) && !view.isClosed && !this.entries.has(view.viewId)) this.track(view);
    }
  }

  private track(view: TrackedMapView): void {
    const entry: Entry = { view, unsubscribe: () => undefined, loadedPath: null };
    const check = (): void => {
      const state = view.atlasStore.getState();
      const path = isLoaded(state) ? state.mapPath : null;
      const changed = path !== null && path !== entry.loadedPath;
      entry.loadedPath = path;
      if (changed) this.events.emit('map-loaded', viewInfo(view));
    };
    entry.unsubscribe = view.atlasStore.subscribe(check);
    this.entries.set(view.viewId, entry);
    let closed = false;
    view.register(() => {
      if (closed) return;
      closed = true;
      entry.unsubscribe();
      if (this.entries.get(view.viewId) !== entry) return;
      this.entries.delete(view.viewId);
      this.events.emit('map-closed', view.viewId);
    });
    check();
  }
}
```

`src/api/views.ts`:
```ts
import { viewCamera, watchViewCamera } from '../app/services/presentedCamera';
import type { DisposerSet } from './disposers';
import { sceneSnapshot, snapshotSlice, viewInfo } from './viewInfo';
import type { ViewTracker } from './viewTracker';
import type { SceneSnapshot, ViewCamera, ViewInfo, ViewsApi } from './types/views';
import type { Disposer, ViewId } from './types/common';

function sameSlice(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function viewsApi(tracker: ViewTracker, disposers: DisposerSet): ViewsApi {
  return Object.freeze({
    list: (): ViewInfo[] => tracker.views().map(viewInfo),
    active: (): ViewInfo | null => {
      const active = tracker.views().find((view) => view === activeViewOf(tracker));
      return active ? viewInfo(active) : null;
    },
    snapshot: (viewId: ViewId): SceneSnapshot | null => {
      const view = tracker.view(viewId);
      return view ? sceneSnapshot(view) : null;
    },
    subscribe: (viewId: ViewId, listener: (snapshot: SceneSnapshot) => void): Disposer => {
      const view = tracker.view(viewId);
      if (!view) return disposers.add(() => undefined);
      let slice = snapshotSlice(view.atlasStore.getState());
      return disposers.add(view.atlasStore.subscribe((state) => {
        const next = snapshotSlice(state);
        if (sameSlice(slice, next)) return;
        slice = next;
        listener(sceneSnapshot(view));
      }));
    },
    camera: (viewId: ViewId): ViewCamera | null => {
      const view = tracker.view(viewId);
      return view ? viewCamera(view) : null;
    },
    watchCamera: (viewId: ViewId, listener: (camera: ViewCamera) => void): Disposer => {
      const view = tracker.view(viewId);
      if (!view) return disposers.add(() => undefined);
      return disposers.add(watchViewCamera(view, () => {
        const camera = viewCamera(view);
        if (camera) listener(camera);
      }));
    },
  });
}
```
`active()`: let `ViewTracker` take a `getActive: () => unknown` dependency (default `() => app.workspace.getActiveViewOfType(AtlasView)`). Add `activeView(): TrackedMapView | null` to the tracker, and use it in place of the `activeViewOf` helper above. The test passes `() => null` and checks `active()` is null. A31 adds "never a remote view".

Wiring:
- `ApiServices` gains `views: ViewTracker`. `ExtensionApiPublisher` creates `new ViewTracker(app, host.apiEvents)` after the host exists, calls `start()` before `publish()`, and calls `stop()` in `stop()` after `host.dispose()`.
- Because the host must exist before the tracker, `buildExtension` reads `services` lazily: build `services` after `host`, and pass `build: (scope) => buildExtension(scope, services)` through a `let services!: ApiServices` declared before the host.
- In `extension.ts`, add `views: viewsApi(services.views, scope.disposers)` and remove `void services;`.
- `capabilities.ts` gets `['views']`. A10 and A11 add theirs.
- `public.ts` gets `export type * from './types/records'; export type * from './types/views';`.
- `version.ts` becomes `'1.1.0'`.
- `AtlasEvents` gains `'map-loaded': (view: ViewInfo) => void` and `'map-closed': (viewId: ViewId) => void`.
- `atlas-view.ts` gets the fork's `get isClosed(): boolean { return this.isViewClosing; }`.

- [ ] **Step 3: Run the tests**

`npx vitest run --project unit tests/api tests/unit/presentedCamera.test.ts`. Expected: PASS.

- [ ] **Step 4: Regenerate the report, verify, commit**

```bash
npm run api:report
API_BASE_REF=api-pr-3-end npm run api:check
```
Then run the full verify block, and:
```bash
git add src/api src/app/services/viewMapSize.ts src/app/services/presentedCamera.ts src/app/atlas-view.ts api-report/atlas-vtt-api.d.ts tests/api/views.test.ts tests/unit/presentedCamera.test.ts
git commit -m "feat(api): views — list, active, snapshot, subscribe, camera (API 1.1.0)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

### Task A10: `rules.forMap`, `mapConeAngle` and `rules-changed`

**Files:**
- Modify:
  - `src/app/services/mapMeasurementSettings.ts`: the fork's `collectionSettingsFor`, `collectionGridDefaultsFor` and `mapConeAngle`, and the GM path through `mapConeAngle`. **Not** the `remoteScene` branch or parameter, which go to A29.
- Create:
  - `src/api/types/rules.ts`
  - `src/api/rules.ts`
- Modify: `src/api/types/api.ts` (`rules`, `'rules-changed'`), `extension.ts`, `capabilities.ts`, `public.ts`, `ExtensionApiPublisher.ts` (the rules watcher).
- Test:
  - `tests/unit/mapMeasurementSettings.test.ts`: port the fork's added cases, minus any `remoteScene` case.
  - `tests/api/rules.test.ts`.

**Interfaces:**
- Produces:
  - `mapConeAngle(assets: AssetService, mapPath: string | null): number`
  - `collectionGridDefaultsFor(assets, mapPath): CollectionGridDefaults | null`
  - `MapRules` and `RulesApi` (spec group 4).
  - `MapRules.measurement` doc: "Outside a collection these are the defaults; the map's own grid units then decide. Combine with `resolveMeasurementSettings(null, snapshot.grid)` from `@atlas-vtt/shared/grid` and this `coneAngle`."
  - `watchRules(app, events): () => void`, which emits `rules-changed` with the collection id on `atlas-vtt:collection-settings-changed`, and with `null` once the asset index has loaded.

- [ ] **Step 1:** Write `tests/api/rules.test.ts`. Seed the in-memory app with a collection whose settings carry `gridDefaults.coneAngle`, `diceRules` and a resource. To find an existing seed helper, run `git grep -ln "getCollectionSettings" tests/mocks tests/unit | head`; `tests/mocks/resourceFixtures.ts` is a likely candidate.
```ts
it('C-rules-1: outside a collection forMap gives Atlas defaults; inside, the collection rules with the GM cone angle', () => {
  const rules = rulesApi(app);
  const outside = rules.forMap(null);
  expect(outside.collectionId).toBeNull();
  expect(outside.gridDefaults).toBeNull();
  expect(outside.measurement.coneAngle).toBe(DEFAULT_CONE_ANGLE);
  const inside = rules.forMap('atlas-vtt/collections/c1/maps/a.atlasmap');
  expect(inside.collectionId).toBe('c1');
  expect(inside.measurement.coneAngle).toBe(mapConeAngle(AssetService.getInstance(app), 'atlas-vtt/collections/c1/maps/a.atlasmap'));
  expect(inside.dice).toEqual(mapDiceRules(app, 'atlas-vtt/collections/c1/maps/a.atlasmap'));
  expect(Object.isFrozen(inside)).toBe(true);
});
it('C-rules-2: rules-changed fires with the collection id when its settings are saved', () => {
  const events = new ApiEvents();
  const listener = vi.fn();
  events.on('rules-changed', listener);
  const stop = watchRules(app, events);
  app.workspace.trigger('atlas-vtt:collection-settings-changed', 'c1');
  expect(listener).toHaveBeenCalledWith('c1');
  stop();
  app.workspace.trigger('atlas-vtt:collection-settings-changed', 'c1');
  expect(listener).toHaveBeenCalledTimes(1);
});
```
Run both test files. Expected: FAIL.

- [ ] **Step 2:** Implement. `src/api/rules.ts`:
```ts
import type { App } from 'obsidian';
import { resolveMeasurementSettings } from '../app/grid/measurementFormat';
import { mapResources } from '../app/resources/collectionResources';
import { AssetService } from '../app/services/AssetService';
import { mapDiceRules } from '../app/services/mapDiceRules';
import { mapInitiativeRules } from '../app/services/mapInitiativeRules';
import { mapConeAngle } from '../app/services/mapMeasurementSettings';
import type { ApiEvents } from './events';
import type { MapRules, RulesApi } from './types/rules';

export function mapRules(app: App, mapPath: string | null): MapRules {
  const assets = AssetService.getInstance(app);
  const collectionId = mapPath ? assets.getCollectionForMap(mapPath) : null;
  const settings = collectionId ? assets.getCollectionSettings(collectionId) : null;
  return Object.freeze({
    collectionId,
    gridDefaults: settings?.gridDefaults ?? null,
    measurement: { ...resolveMeasurementSettings(settings?.gridDefaults, null), coneAngle: mapConeAngle(assets, mapPath) },
    resources: mapResources(assets, mapPath),
    conditions: settings?.conditions ?? [],
    initiative: mapInitiativeRules(app, mapPath),
    dice: mapDiceRules(app, mapPath),
  });
}

export function rulesApi(app: App): RulesApi {
  return Object.freeze({ forMap: (mapPath: string | null): MapRules => mapRules(app, mapPath) });
}

/** `rules-changed` for collection settings saves and once the asset index has loaded; returns the stop. */
export function watchRules(app: App, events: ApiEvents): () => void {
  let live = true;
  const ref = app.workspace.on('atlas-vtt:collection-settings-changed', (collectionId: string) => {
    if (live) events.emit('rules-changed', collectionId ?? null);
  });
  AssetService.getInstance(app).initialize().then(() => { if (live) events.emit('rules-changed', null); }, () => undefined);
  return (): void => {
    live = false;
    app.workspace.offref(ref);
  };
}
```
If `gridDefaults` is null where `resolveMeasurementSettings` expects `undefined`, pass `?? undefined`; `exactOptionalPropertyTypes` is on. Wire `rules: rulesApi(services.app)` and add `'rules'` to `LANDED_CAPABILITIES`. The publisher starts `watchRules` after `publish()` and stops it in `stop()`. Apply the `mapMeasurementSettings.ts` hunks.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## Improved`:
```markdown
- A collection's cone angle is read through one function for the measure tool everywhere, so every view measures cones with the same angle
```
Run the verify block (`API_BASE_REF=api-pr-3-end`). Commit with the message `feat(api): rules.forMap and rules-changed; one cone angle function`.

### Task A11: `settings.get`, `settings-changed`, `storage.folder`

**Files:**
- Create:
  - `src/api/types/settings.ts`: `AtlasSettingKey`, `AtlasSettingsView`, `SettingsApi`, `StorageApi`, as in spec group 11.
  - `src/api/settings.ts`
  - `src/api/storage.ts`
- Modify: `types/api.ts` (`settings`, `storage`, `'settings-changed'`), `extension.ts`, `capabilities.ts`, `public.ts`, `services.ts` (`settings: SettingsService`), `ExtensionApiPublisher.ts`.
- Test: `tests/api/settings.test.ts`.

**Interfaces:**
- Produces:
  - `PLAYER_VIEW_RULE_KEYS = ['showGrid', 'showTokenNameplates', 'showWidgets', 'showInitiative'] as const`
  - `settingsView(service: SettingsService): AtlasSettingsView`
  - `watchSettings(service, events): () => void`
  - `storageFolderOf(id: string): string`, which returns `atlas-vtt/.atlas-data/extensions/${id}`
  - `storageApi(app, id): StorageApi`

- [ ] **Step 1:** Write the test. Use `tests/mocks/memorySettings.ts` if it provides a `SettingsService`; otherwise construct `new SettingsService(createInMemoryApp().app, Promise.resolve())` and `await initialize()`.
```ts
it('C-settings-1: playerView has exactly the four rules; settings-changed fires only for a key whose value changed', async () => {
  const view = settingsView(service);
  expect(Object.keys(view.playerView).sort()).toEqual(['showGrid', 'showInitiative', 'showTokenNameplates', 'showWidgets']);
  const changed = vi.fn();
  const events = new ApiEvents();
  events.on('settings-changed', changed);
  const stop = watchSettings(service, events);
  service.setLaserPointerSettings({ color: '#ff0000' });
  expect(changed.mock.calls).toEqual([['laserPointer']]);
  service.setLaserPointerSettings({ color: '#ff0000' });
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});
it('C-storage-1: folder() is the extension\'s dot folder, created on first call and idempotent', async () => {
  const { app } = createInMemoryApp();
  const storage = storageApi(app, 'atlas-vtt-connect');
  expect(await storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
  expect(await app.vault.adapter.exists('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect')).toBe(true);
  expect(await storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
});
```
If no such setter exists, use the real setter for the laser colour (`git grep -n "setLaserPointer" src/app/services/SettingsService.ts`). Run the test. Expected: FAIL.

- [ ] **Step 2:** Implement.

`src/api/settings.ts`:
```ts
import type { SettingsService } from '../app/services/SettingsService';
import type { ApiEvents } from './events';
import type { AtlasSettingKey, AtlasSettingsView, SettingsApi } from './types/settings';

export const PLAYER_VIEW_RULE_KEYS = ['showGrid', 'showTokenNameplates', 'showWidgets', 'showInitiative'] as const;
const KEYS: readonly AtlasSettingKey[] = ['laserPointer', 'diceLook', 'diceDisplay', 'playerView'];

export function settingsView(service: SettingsService): AtlasSettingsView {
  const laser = service.getLaserPointerSettings();
  const look = service.getDiceLook();
  const player = service.getLocalPlayerViewSettings();
  return {
    laserPointer: { color: laser.color, size: laser.size },
    diceLook: { colour: look.colour, font: look.font },
    diceDisplay: service.getDiceDisplay(),
    playerView: {
      showGrid: player.showGrid === true,
      showTokenNameplates: player.showTokenNameplates === true,
      showWidgets: player.showWidgets === true,
      showInitiative: player.showInitiative === true,
    },
  };
}

export function settingsApi(service: SettingsService): SettingsApi {
  return Object.freeze({
    get: <K extends AtlasSettingKey>(key: K): AtlasSettingsView[K] => settingsView(service)[key],
  });
}

/** `settings-changed` per key whose value changed; returns the stop. */
export function watchSettings(service: SettingsService, events: ApiEvents): () => void {
  let previous = settingsView(service);
  return service.onChange(() => {
    const next = settingsView(service);
    const changed = KEYS.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    previous = next;
    for (const key of changed) events.emit('settings-changed', key);
  });
}
```

`src/api/storage.ts`:
```ts
import type { App } from 'obsidian';
import { ensureAdapterFolder } from '../app/plugin/vaultFolders';
import type { StorageApi } from './types/settings';

export function storageFolderOf(extensionId: string): string {
  return `atlas-vtt/.atlas-data/extensions/${extensionId}`;
}

export function storageApi(app: App, extensionId: string): StorageApi {
  const folder = storageFolderOf(extensionId);
  let ready: Promise<string> | null = null;
  return Object.freeze({
    folder: (): Promise<string> => (ready ??= ensureAdapterFolder(app, folder).then(() => folder)),
  });
}
```
If `ensureAdapterFolder` rejects, reset `ready` to null in a `.catch` that rethrows, so a later call can try again. Also reject ids that are not `/^[a-z0-9-]+$/` with an `Error`; manifest ids are kebab-case, and this check keeps paths inside the folder.

Wiring:
- `settings: settingsApi(services.settings)` and `storage: storageApi(services.app, scope.id)`.
- `ApiServices.settings = plugin.settingsService`.
- `watchSettings` is started and stopped by the publisher.
- Capabilities `'settings'` and `'storage'`.

- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.1: read open map views and their scenes, the rules of a map's collection, the laser, dice and player view settings, and a data folder per extension
```
Run the verify block, commit with the message `feat(api): settings, storage and the settings-changed event`, then `git tag api-pr-4-end`.

## PR 5: Presented scene (group 3), API 1.2.0

### Task A12: `PresentedScene` core, the player window follows it, Present and Stop presenting commands

**Files:**
- Create:
  - `src/app/services/PresentedScene.ts`, ported. Adapt it as follows:
    - Remove the `MapSize` import, and import `MapSize` and `loadedMapSize` from `./viewMapSize`, deleting the local copy.
    - Delete `laser`, `lighting` and `watchLighting` from `PresentedSceneInfo` and from `present()`, along with the `LaserHub` and `PlayerLighting` imports. A18 and A19 add these back.
    - `PresentedView` keeps `tabMetaStore`, `atlasStore`, `register`, `isClosed`, and `renderer` with `getBackgroundSprite` and `getViewportInstance` only.
  - `src/app/services/presentToPlayers.ts`, ported. The texts "Players see …" and "Players no longer see a scene" stay.
- Modify:
  - `src/app/services/PlayerWindowPresenter.ts`: the whole fork diff.
  - `src/app/plugin/registerCommands.ts`: the two new commands only. **Not** the `activeMapView` lines, which belong to A31.
  - `main.ts`: `presentedScene.clear()` in `onunload`.
- Test:
  - Port `tests/unit/presentedScene.test.ts`. Delete the cases about `laser()` and `lighting()`; they come back in A18 and A19.
  - Port `tests/unit/presentToPlayers.test.ts` and `tests/unit/presentTabToPlayers.test.ts`.
  - `tests/unit/playerWindowPresenter.test.ts`: take the rest of the fork diff.

**Interfaces:**
- Produces:
  - `presentedScene: PresentedScene` with `current()`, `isHeld()`, `subscribe(listener)`, `present(view, tabId)` and `clear()`.
  - `PresentedSceneInfo { view; tabId; store; mapSize(); camera(); watchCamera(cb) }`
  - `whenMapLoaded(store)`, `showsTab(view, tabId)`, `presentedTabIdIn(scene, tabStore)`
  - `presentTabToPlayers(view, tabId)`, `presentViewToPlayers(view)`, `stopPresenting()`

- [ ] **Step 1:** Port the four tests and trim them as described. Run them. Expected: FAIL.
- [ ] **Step 2:** Port and adapt the files. `grep -nE "online|LaserHub|PlayerLighting" src/app/services/PresentedScene.ts src/app/services/presentToPlayers.ts src/app/services/PlayerWindowPresenter.ts` must print nothing.
- [ ] **Step 3:** Run the four tests plus `tests/unit/playerWindow*.test.*`. Expected: PASS.
- [ ] **Step 4:** Add these lines to the changelog under `## Improved`:
```markdown
- The presented scene keeps its marker on the scene tab until you choose Stop presenting, and an open player window follows the scene you present from anywhere. New commands: Present to players, Stop presenting
```
Run the verify block (`API_BASE_REF=api-pr-4-end`; the report is unchanged). Commit with the message `feat: presented scene with held and resumed semantics; the player window follows it`.

### Task A13: The eye marker, the present menu and presentation targets

**Files:**
- Create:
  - `src/app/services/presentationTargets.ts`
  - `src/app/react/tabPresenting.ts`, ported. Rewrite it over the targets: `hosting()` becomes `anyTargetActive()`, and `OPEN_PLAYER_WINDOW_LABEL` becomes the local constant `'Open player window'`.
  - `src/app/react/hooks/usePresentedTabId.ts`, ported.
- Modify:
  - `src/app/react/components/SceneTabBar.tsx`: the whole fork diff. The tooltip names the active target's label: "Present to <label>". On a presented scene, the eye stops presenting.
  - `src/app/react/UIRoot.tsx`: only the `presentTab`/`presentTabMenu` hunk. **Not** `OnlineSceneBar`, `OnlineOwnRolls`, `OnlinePanel` or `remote`.
- Test:
  - Port `tests/unit/sceneTabBar.presented.test.tsx` and `tests/unit/tabPresenting.test.ts`. Rewrite the latter: replace every `onlineSessionStore.setState({ status: 'hosting' })` with `const stop = addPresentationTarget({ id: 't', label: 'online players', isActive: () => true })`.
  - Port `tests/unit/sceneTabBar.online.test.tsx` as `tests/unit/sceneTabBar.target.test.tsx`, with the same rewrite.

**Interfaces:**
- Produces, `src/app/services/presentationTargets.ts`:
```ts
export interface PresentationTargetEntry { id: string; label: string; isActive(): boolean }
const targets = new Set<PresentationTargetEntry>();
const listeners = new Set<() => void>();
/** Adds an audience besides the player window; returns the removal (idempotent). */
export function addPresentationTarget(target: PresentationTargetEntry): () => void {
  targets.add(target);
  notify();
  let done = false;
  return () => { if (done) return; done = true; targets.delete(target); notify(); };
}
/** The first active target, which decides what the eye does and says; null when only the player window watches. */
export function activePresentationTarget(): PresentationTargetEntry | null {
  for (const target of targets) {
    try { if (target.isActive()) return target; } catch (error) { console.error('[Atlas] A presentation target failed:', error); }
  }
  return null;
}
/** For React (useSyncExternalStore) and `ui.invalidate()`: targets were added, removed, or asked to be re-read. */
export function subscribePresentationTargets(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function invalidatePresentationTargets(): void { notify(); }
function notify(): void { for (const listener of [...listeners]) listener(); }
```
- `SceneTabBar` reads `activePresentationTarget()` through `useSyncExternalStore(subscribePresentationTargets, …)`, so `isActive()` changes reach it after `invalidatePresentationTargets()`.

- [ ] **Step 1:** Port and rewrite the three tests. Add this case:
```ts
it('the eye opens the player window again once the last target is removed', () => {
  const stop = addPresentationTarget({ id: 't', label: 'online players', isActive: () => true });
  stop();
  expect(activePresentationTarget()).toBeNull();
});
```
Run them. Expected: FAIL.
- [ ] **Step 2:** Implement and port. Run `grep -n "online" src/app/react/tabPresenting.ts src/app/react/components/SceneTabBar.tsx src/app/react/UIRoot.tsx`. It may match only the word in the "online players" example of a doc comment; prefer no match.
- [ ] **Step 3:** Run the tests. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit `src/app/services/presentationTargets.ts`, `src/app/react/tabPresenting.ts`, `src/app/react/hooks/usePresentedTabId.ts`, `src/app/react/components/SceneTabBar.tsx`, `src/app/react/UIRoot.tsx` and the three tests, with the message `feat: scene tab eye follows the presented scene; presentation targets`.

### Task A14: The `presentation` facade

**Files:**
- Create: `src/api/types/presentation.ts` (spec group 3) and `src/api/presentation.ts`.
- Modify: `types/api.ts`, `extension.ts`, `capabilities.ts`, `public.ts`, `version.ts` (`1.2.0`).
- Test: `tests/api/presentation.test.ts`.

**Interfaces:**
- Consumes: `presentedScene`, `presentTabToPlayers` and `addPresentationTarget` (A12, A13), and `ViewTracker.view` (A9).
- Produces: `presentationApi(tracker, disposers): PresentationApi`. `PresentedSceneInfo` has the API shape `{ viewId; tabId; mapPath; held }`, read from the internal scene. `mapPath` is the presented tab's `filePath`.

- [ ] **Step 1:** Write the contract test. Use the `fakeView` helper from `views.test.ts`, moved into `tests/api/apiFakes.ts` so both tests share it. Give the fake a `switchToTab(tabId)` that sets the tab-meta store's active tab and calls `load()`.
```ts
it('C-pres-1: present returns false for a closed view; held on tab switch; resumed only after the tab loaded; cleared when the tab closes', async () => {
  const view = fakeView('v1');
  const { presentation } = setupWith(view);
  const seen: string[] = [];
  presentation.subscribe({
    presented: (scene, resumed) => seen.push(`presented:${scene.tabId}:${resumed}`),
    held: (scene) => seen.push(`held:${scene.tabId}`),
    cleared: () => seen.push('cleared'),
  });
  const tabId = view.tabMetaStore.getState().activeTabId!;
  expect(await presentation.present('v1', tabId)).toBe(true);
  expect(presentation.current()).toMatchObject({ viewId: 'v1', tabId, mapPath: 'maps/a.atlasmap', held: false });
  const other = view.tabMetaStore.getState().addTab('maps/b.atlasmap', 'B');
  expect(seen.at(-1)).toBe(`held:${tabId}`);
  view.atlasStore.setState({ isMapLoading: true });
  view.tabMetaStore.getState().setActiveTab(tabId);
  await Promise.resolve();
  expect(seen.at(-1)).toBe(`held:${tabId}`);           // still loading: no resume
  load(view);
  await Promise.resolve();
  expect(seen.at(-1)).toBe(`presented:${tabId}:true`);
  view.tabMetaStore.getState().removeTab(tabId);
  expect(seen.at(-1)).toBe('cleared');
  view.close();
  expect(await presentation.present('v1')).toBe(false);
  void other;
});
it('C-pres-2: addTarget makes a target active for the eye; its disposer removes it', () => {
  const { presentation } = setupWith(fakeView('v1'));
  const stop = presentation.addTarget({ id: 'online', label: 'online players', isActive: () => true });
  expect(activePresentationTarget()?.label).toBe('online players');
  stop();
  stop();
  expect(activePresentationTarget()).toBeNull();
});
```
Run it. Expected: FAIL.
- [ ] **Step 2:** Implement `src/api/presentation.ts`:
```ts
import { presentedScene, type PresentedSceneInfo as InternalScene } from '../app/services/PresentedScene';
import { presentTabToPlayers, stopPresenting } from '../app/services/presentToPlayers';
import { addPresentationTarget } from '../app/services/presentationTargets';
import type { DisposerSet } from './disposers';
import type { ViewTracker } from './viewTracker';
import type { PresentationApi, PresentationListener, PresentationTarget, PresentedSceneInfo } from './types/presentation';
import type { Disposer, ViewId } from './types/common';

function info(scene: InternalScene, held: boolean): PresentedSceneInfo {
  const tab = scene.view.tabMetaStore.getState().tabs.find((entry) => entry.id === scene.tabId);
  return Object.freeze({ viewId: (scene.view as { viewId: string }).viewId, tabId: scene.tabId, mapPath: tab?.filePath ?? '', held });
}

export function presentationApi(tracker: ViewTracker, disposers: DisposerSet): PresentationApi {
  return Object.freeze({
    current: (): PresentedSceneInfo | null => {
      const scene = presentedScene.current();
      return scene ? info(scene, presentedScene.isHeld()) : null;
    },
    present: async (viewId: ViewId, tabId?: string): Promise<boolean> => {
      const view = tracker.view(viewId) as Parameters<typeof presentTabToPlayers>[0] | null;
      const target = tabId ?? view?.tabMetaStore.getState().activeTabId ?? null;
      if (!view || !target) return false;
      await presentTabToPlayers(view, target);
      const scene = presentedScene.current();
      return Boolean(scene && scene.view === view && scene.tabId === target);
    },
    stop: (): void => stopPresenting(),
    subscribe: (listener: PresentationListener): Disposer => disposers.add(presentedScene.subscribe({
      presented: (scene, resumed) => listener.presented?.(info(scene, false), resumed),
      held: (scene) => listener.held?.(info(scene, true)),
      cleared: (previous) => listener.cleared?.(info(previous, false)),
    })),
    addTarget: (target: PresentationTarget): Disposer => disposers.add(addPresentationTarget(target)),
  });
}
```
`presentTabToPlayers` takes an `AtlasView`. Widen its parameter to the `PresentedView & { switchToTab(tabId: string): Promise<void> }` shape (a type-only change), so the API never casts. Then remove the cast above.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.2: present a scene, follow which scene players see, and add an audience besides the player window
```
Run the verify block (`API_BASE_REF=api-pr-4-end`), commit with the message `feat(api): presentation facade (API 1.2.0)`, then `git tag api-pr-5-end`.

## PR 6: Dice (group 7), API 1.3.0

### Task A15: `rolledBy`, unlisted dice, a persistable log, and a result card for other people's rolls

**Files:**
- Modify:
  - `src/app/tools/diceRolling.ts`:
    - add `rolledBy` and `unlistedDice` to `DiceRollResult`;
    - add `persistableDiceLog` and `rollerName`, exactly as on the fork.
  - `src/app/storeFactory.ts`: the `persistableDiceLog` line in `partialize` only. **Not** the remote store hunks (A28) and **not** `isOnlinePanelOpen`.
  - `src/app/react/components/dice-log/DiceRollEntry.tsx`, `src/app/react/components/dice/DiceToast.tsx`, `src/app/react/components/dice/DiceRollDisplay.tsx`: the whole fork diff (show `rolledBy`, unlisted dice, and a card instead of a throw).
- Test:
  - `tests/unit/diceRolling.test.ts`: add back the "names the online player…" and "what the dice log saves" blocks. Rename their texts from "online player" to "someone else", for example "names who rolled it, else the statblock token, else nobody".
  - Port `tests/unit/diceRollerName.test.tsx`.
  - Port `tests/unit/playerWindowDiceRolls.test.tsx`. Take the whole fork diff if it only concerns `rolledBy` and the card.

**Interfaces:**
- Produces:
  - `persistableDiceLog(log): DiceRollResult[]`
  - `rollerName(result): string | null`
  - `DiceRollResult.rolledBy?: string`
  - `DiceRollResult.unlistedDice?: number`

- [ ] **Step 1:** Restore and port the tests. Run them. Expected: FAIL.
- [ ] **Step 2:** Apply the hunks. In the fork's comments, reword "online player" to "someone other than the GM". The behaviour is generic.
- [ ] **Step 3:** Run the tests plus `tests/unit/dice*.test.*`. Expected: PASS.
- [ ] **Step 4:** Add this line to the changelog under `## Improved`:
```markdown
- Rolls made by someone other than the GM show who rolled them in the dice log and toasts, appear as a result card instead of being thrown on the GM's map, and are never saved in the map file
```
Run the verify block (`API_BASE_REF=api-pr-5-end`; the report changes because `DiceRollResult` gains fields, so bump `version.ts` to `1.3.0` here). Commit with the message `feat(dice): rolls by others show their roller and a result card, and stay out of map files`.

### Task A16: The tray's refusable `onRoll` and `maxDice`

**Files:**
- Modify:
  - `src/app/react/components/dice/DiceTray.tsx`, `DiceDropdownMenu.tsx`, `dice-dropdown.scss`: the whole fork diff.
  - `src/app/packages/components/MainToolbar.tsx`: **only** whatever is needed to keep the tray's existing call compiling. The remote branches go to A31.
- Test: port `tests/unit/online/obsidian/onlineDiceTrayWiring.test.tsx` as `tests/unit/diceTrayRefusal.test.tsx`. Keep only the cases that render `DiceTray`/`DiceDropdownMenu` with an `onRoll` that returns a refusal string, and assert the note shows and the tray stays open. Drop the online scene wiring cases (A31). If no such case exists, write it:
```tsx
it('shows why a roll could not go and keeps the tray open', async () => {
  const onRoll = vi.fn((): string | null => 'Not connected');
  const { getByText, findByText } = render(<DiceTray onRoll={onRoll} maxDice={100} />);
  fireEvent.click(getByText('d20'));
  fireEvent.click(getByText('Roll'));
  expect(onRoll).toHaveBeenCalledWith({ d20: 1 }, 0);
  expect(await findByText('Not connected')).toBeTruthy();
});
```
Adjust the props and labels to the real `DiceTray` signature after the port.

**Interfaces:**
- Produces: `DiceTray` and `DiceDropdownMenu` props `onRoll?: (dice: Readonly<Record<string, number>>, modifier: number) => string | null` and `maxDice?: number`. A31 uses them.

- [ ] **Step 1:** Write or port the test and run it. Expected: FAIL.
- [ ] **Step 2:** Apply the diff.
- [ ] **Step 3:** Run it plus `tests/unit/*dice*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(dice): the tray's roll may be refused with a note; maxDice`.

### Task A17: The `dice` facade

**Files:**
- Create: `src/api/types/dice.ts` (spec group 7) and `src/api/dice.ts`.
- Modify: `types/api.ts`, `extension.ts`, `capabilities.ts` (`'dice'`), `public.ts`.
- Test: `tests/api/dice.test.ts`.

**Interfaces:**
- Produces: `diceApi(app: App, disposers: DisposerSet, doc?: Document): DiceApi`. `roll` rolls with `mapDiceRules(app, mapPath)` and publishes. `onRolled` listens to `DICE_ROLLED_EVENT` on `doc`, which defaults to `document`. `publish` dispatches `DICE_ROLLED_EVENT`.

- [ ] **Step 1:** Write the test:
```ts
it('C-dice-1: roll uses the collection dice rules, sets rolledBy, reaches onRolled, and is not persisted', () => {
  const { app } = seededAppWithExplodingD6Collection(); // reuse A10's seed helper with diceRules.explode
  const dice = diceApi(app, new DisposerSet());
  const seen: DiceRollResult[] = [];
  dice.onRolled((result) => seen.push(result));
  const result = dice.roll({ formula: '2d6+1', mapPath: 'atlas-vtt/collections/c1/maps/a.atlasmap', rolledBy: 'Ana' });
  expect(result.rolledBy).toBe('Ana');
  expect(result.formula).toBe('2d6+1');
  expect(seen).toEqual([result]);
  expect(persistableDiceLog([result])).toEqual([]);
});
it('C-dice-2: publish adds a roll made elsewhere without re-rolling it', () => {
  const dice = diceApi(createInMemoryApp().app, new DisposerSet());
  const seen: DiceRollResult[] = [];
  dice.onRolled((result) => seen.push(result));
  const made = rollFormula('1d20', () => 0.5, 1);
  dice.publish(made);
  expect(seen).toEqual([made]);
});
it('onRolled disposer stops listening', () => {
  const disposers = new DisposerSet();
  const dice = diceApi(createInMemoryApp().app, disposers);
  const listener = vi.fn();
  dice.onRolled(listener)();
  dice.publish(rollFormula('1d4', () => 0, 1));
  expect(listener).not.toHaveBeenCalled();
});
```
Run it. Expected: FAIL.
- [ ] **Step 2:** Implement:
```ts
import type { App } from 'obsidian';
import { mapDiceRules } from '../app/services/mapDiceRules';
import { DICE_ROLLED_EVENT, rollFormula, type DiceRollResult } from '../app/tools/diceRolling';
import type { DisposerSet } from './disposers';
import type { DiceApi, DiceRollRequest } from './types/dice';
import type { Disposer } from './types/common';

export function diceApi(app: App, disposers: DisposerSet, doc: Document = document): DiceApi {
  const publish = (result: DiceRollResult): void => {
    doc.dispatchEvent(new CustomEvent(DICE_ROLLED_EVENT, { detail: result }));
  };
  return Object.freeze({
    roll: (request: DiceRollRequest): DiceRollResult => {
      const rolled = rollFormula(request.formula, Math.random, Date.now(), mapDiceRules(app, request.mapPath ?? null));
      const result = request.rolledBy ? { ...rolled, rolledBy: request.rolledBy } : rolled;
      publish(result);
      return result;
    },
    onRolled: (listener: (result: DiceRollResult) => void): Disposer => {
      const handler = (event: Event): void => listener((event as CustomEvent<DiceRollResult>).detail);
      doc.addEventListener(DICE_ROLLED_EVENT, handler);
      return disposers.add(() => doc.removeEventListener(DICE_ROLLED_EVENT, handler));
    },
    publish,
  });
}
```
`rollFormula` must accept a formula with no dice term without throwing. If it throws on a malformed formula, `roll` lets the error propagate; document that in `types/dice.ts` ("throws on a formula with no dice").
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.3: roll dice by a map's collection rules on someone's behalf, hear every roll, and add rolls made elsewhere to the log
```
Run the verify block, commit with the message `feat(api): dice facade (API 1.3.0)`, then `git tag api-pr-6-end`.

## PR 7: Lasers (group 8), API 1.4.0

### Task A18: Laser hub, the remote laser layer, release events, and the `lasers` facade

**Files:**
- Create (port whole):
  - `src/app/pixi/laser/LaserHub.ts`
  - `src/app/pixi/laser/RemoteLaserRenderer.ts`
  - `src/app/pixi/laser/remoteLasers.ts`
- Create: `src/api/types/lasers.ts` (spec group 8, re-exporting `LocalLaserEvent` and `RemoteLaser` from `LaserHub.ts`) and `src/api/lasers.ts`.
- Modify:
  - `src/app/pixi/LaserPointerRenderer.ts`: the remaining fork hunks, which are the `hub` constructor parameter, `liftLaser()` and its call sites, and `emitLocal` in `addTrailPoint`. Also add `this.liftLaser()` to A4's `handleWindowBlur`.
  - `src/app/PixiRendererOrchestrator.ts`: the laser hub field, `getLaserHub()`, constructing `RemoteLaserRenderer`, and passing the hub to `LaserPointerRenderer`. **Not** the player-lighting getters (A19).
  - `src/app/services/PresentedScene.ts`: add back `laser(): LaserHub | null`.
  - `src/shared/draw.ts`: add `export * from '../app/pixi/laser/remoteLasers';`.
  - `src/api/viewTracker.ts`: `TrackedMapView.renderer` gains `getLaserHub?(): LaserHub`.
- Test:
  - Port `tests/unit/laserPointerRenderer.hub.test.ts`, `tests/unit/remoteLaserRenderer.test.ts` and `tests/unit/remoteLasers.test.ts`.
  - `tests/unit/presentedScene.test.ts`: add back the `laser()` case.
  - New: `tests/api/lasers.test.ts`.

**Interfaces:**
- Produces:
  - `LaserHub { onLocal(cb): () => void; emitLocal(e): void; onRemote(cb): () => void; showRemote(l): void }`
  - `lasersApi(tracker, disposers): LasersApi`. Its `onLocal(viewId, cb)` returns a no-op disposer for an unknown view or a view without a hub. Its `show(viewId, laser)` does nothing for an unknown view.

- [ ] **Step 1:** Port the tests, and write `tests/api/lasers.test.ts`. Give the A9 fake view a real `LaserHub` (`renderer.getLaserHub = () => hub`):
```ts
it('C-laser-1: onLocal hears points and the lift; show reaches the remote layer; unknown views are harmless', () => {
  const hub = new LaserHub();
  const view = fakeView('v1', { laserHub: hub });
  const lasers = lasersApi(trackerWith(view), new DisposerSet());
  const events: LocalLaserEvent[] = [];
  const stop = lasers.onLocal('v1', (event) => events.push(event));
  hub.emitLocal({ kind: 'point', x: 1, y: 2 });
  hub.emitLocal({ kind: 'lift' });
  expect(events).toEqual([{ kind: 'point', x: 1, y: 2 }, { kind: 'lift' }]);
  stop();
  hub.emitLocal({ kind: 'lift' });
  expect(events).toHaveLength(2);
  const shown: RemoteLaser[] = [];
  hub.onRemote((laser) => shown.push(laser));
  lasers.show('v1', { from: 'ana', color: '#f00', points: [{ x: 0, y: 0 }], lifted: false });
  expect(shown).toHaveLength(1);
  expect(() => lasers.show('nope', shown[0]!)).not.toThrow();
  lasers.onLocal('nope', () => undefined)();
});
```
Extend `fakeView` in `apiFakes.ts` with an options bag. The "sender silent for 1 s" and "fades like Atlas's own" cases are pinned by the ported `remoteLasers.test.ts`. Rename those cases to begin with `C-laser-2:`. Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port the files, apply the hunks, and implement `src/api/lasers.ts`:
```ts
import type { LaserHub, LocalLaserEvent, RemoteLaser } from '../app/pixi/laser/LaserHub';
import type { DisposerSet } from './disposers';
import type { ViewTracker } from './viewTracker';
import type { LasersApi } from './types/lasers';
import type { Disposer, ViewId } from './types/common';

export function lasersApi(tracker: ViewTracker, disposers: DisposerSet): LasersApi {
  const hubOf = (viewId: ViewId): LaserHub | null => tracker.view(viewId)?.renderer?.getLaserHub?.() ?? null;
  return Object.freeze({
    onLocal: (viewId: ViewId, listener: (event: LocalLaserEvent) => void): Disposer =>
      disposers.add(hubOf(viewId)?.onLocal(listener) ?? ((): void => undefined)),
    show: (viewId: ViewId, laser: RemoteLaser): void => { hubOf(viewId)?.showRemote(laser); },
  });
}
```
Bump `version.ts` to `1.4.0`, and add the `'lasers'` capability and the namespace.
- [ ] **Step 3:** Run the tests, plus `tests/api/sharedBoundary.test.ts` (it must still pass with `remoteLasers`). Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.4: follow the GM's laser in a view and draw other people's lasers there, fading like Atlas's own
```
Run the verify block (`API_BASE_REF=api-pr-6-end`), commit with the message `feat(api): laser hub, remote laser layer and lasers facade (API 1.4.0)`, then `git tag api-pr-7-end`.

## PR 8: Lighting visibility (group 5), API 1.5.0

### Task A19: The renderers' fail-closed lighting queries

**Files:**
- Modify, whole fork diff of each:
  - `src/app/pixi/lighting/LightingRenderer.ts`
  - `CanvasLightingFallback.ts`
  - `LightingViewHost.ts`
  - `sceneLightingView.ts`
  - `LightingController.ts`
  - `LightingFeature.ts`
  - `playerLightingLayers.ts`
  - `src/app/pixi/lighting/__tests__/LightingViewHost.test.ts`
- Modify `src/app/PixiRendererOrchestrator.ts`: the `getPlayerLighting()` and `watchPlayerLighting()` getters only.
- Modify `src/api/viewTracker.ts`: `TrackedMapView.renderer` gains `getPlayerLighting?(): PlayerLighting | null | undefined` and `watchPlayerLighting?(cb): () => void`.
- Test:
  - Port the fork hunks of `tests/unit/lightingController.sessionView.test.ts`, `tests/unit/lightingControllerHarness.ts` and `tests/unit/lightingMemoryHarness.ts`.
  - New file `tests/unit/playerLightingOf.test.ts` with cases from the fork's `tests/unit/online/lightingProjection.test.ts` that test `playerLightingOf` only (`ready`, `showsExplored`, `perception`).

**Interfaces:**
- Produces:
  - `PlayerLighting { ready: boolean; sight; ambient; reaches; spots; showsExplored: boolean; perception: TokenPerception }`, as on the fork.
  - `playerLightingOf(view, perception): PlayerLighting | undefined`
  - the renderer's `getPlayerLighting()`, which returns null while lighting hides nothing and undefined when it cannot tell.

- [ ] **Step 1:** Port the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Apply the diffs. Then run `grep -n "online" src/app/pixi/lighting/*.ts`. A comment about "online players" is reworded to "players outside the player window".
- [ ] **Step 3:** Run `npx vitest run --project unit tests/unit/lighting* tests/unit/playerLightingOf.test.ts src/app/pixi/lighting/__tests__`. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(lighting): fail-closed player lighting queries (sightReady, seenSpots, showsExplored)`.

### Task A20: Move the players' darkness raster into Atlas

**Files:**
- Create `src/app/lighting/playerDarkness/`:
  - `darknessRaster.ts`: ported from `$FORK:src/app/online/scene/darknessRaster.ts`. Imports become Atlas-local: `FOG_CELL_SIZE` becomes a local `DARKNESS_MIN_CELL = 8` with the doc line "the online fog's cell", and `insideSpans` comes from `./spans`. `MapSize` comes from `../../services/viewMapSize`.
  - `spans.ts`: `insideSpans`, moved from `$FORK:…/scene/fogRaster.ts`, with its `ScenePoint` parameter typed as `Point` (`{x:number;y:number}`).
  - `exploredImage.ts`: ported.
  - `sightFrames.ts`: the frame and timing part of `$FORK:…/scene/LiveLighting.ts`. That is the input memo (`inputs`), the 200 ms interval (`DARKNESS_INTERVAL_MS`), the due timer and `ExploredImages`. The output is a `DarknessRaster`, not online fog; `darknessOf` stays in Connect.
- Modify: `src/shared/draw.ts`, adding `export { insideSpans } from '../app/lighting/playerDarkness/spans';`.
- Test: ported `tests/unit/darknessRaster.test.ts` (from `$FORK:tests/unit/online/darknessRaster.test.ts`), `tests/unit/liveLighting.test.ts` (only the cases about timing, the input memo and explored decode; the cases about online fog stay in Connect B8) and `tests/unit/exploredImage.test.ts`, if the fork has explored decode cases elsewhere. Also copy `lightingFixtures.ts` to `tests/unit/lightingFixtures.ts` and repoint its imports.

**Interfaces:**
- Produces:
  - `darknessRaster(lighting: PlayerLighting, explored: ExploredImage | null, map: MapSize, maxCellsPerSide?: number): DarknessRaster`, where `DarknessRaster` is `{ cols; rows; cellSize; map; dark: Uint8Array }`.
  - `class SightFrames { constructor(onDue: () => void, decode?: ExploredDecoder); raster(lighting, exploredMask, map, maxCellsPerSide, now?): { raster: DarknessRaster; exploredPending: boolean }; restart(): void; dispose(): void }`
  - `insideSpans(points, y)`

- [ ] **Step 1:** Port the tests, repointing every import to the new paths. Run them. Expected: FAIL.
- [ ] **Step 2:** Port and split the files. If `darknessRaster` needs a `maxCellsPerSide` parameter (the fork used the constant `MAX_DARKNESS_CELLS_PER_SIDE = 384`), add it with that default.
- [ ] **Step 3:** Run the tests. Expected: PASS. Each file stays under 300 lines.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(lighting): players' darkness raster and its timing live beside the sense and light rules`.

### Task A21: The `lighting` facade, `playerVisibility` and `watch`

**Files:**
- Create:
  - `src/app/lighting/playerDarkness/playerVisibility.ts`, which turns a view's `PlayerLighting`, store and `SightFrames` into a `PlayerVisibility`.
  - `src/api/types/lighting.ts` (spec group 5)
  - `src/api/lighting.ts`
- Modify: `types/api.ts`, `extension.ts`, `capabilities.ts` (`'lighting'`), `public.ts`, `version.ts` (`1.5.0`), `services.ts`, which gains `sightFrames: SightFramesByView`, one `SightFrames` per view, disposed on `map-closed` and on stop.
- Test: `tests/api/lighting.test.ts`.

**Interfaces:**
- Produces `visibilityOf(view, frames, options): PlayerVisibility` with these rules (fail closed):
  - The renderer's `getPlayerLighting()` returns null: `{ status: 'unlit' }`.
  - It returns undefined (no renderer or lighting state): `{ status: 'pending' }` when `state.lighting.enabled`, else `{ status: 'unlit' }`.
  - `lighting.ready === false`, or the view's store `isMapLoading`, or explored memory still decoding: `{ status: 'pending' }`.
  - Otherwise `{ status: 'ready', tokens, darkness: { cellSize, cols, rows, shown }, showsExplored }`:
    - `tokens` maps each store token id to `lighting.perception(id)`.
    - `shown[i] = raster.dark[i] ? 0 : 1`.
- The result never includes walls, lights, polygons or `Sight`.
- `watch(viewId, cb)` combines the renderer's `watchPlayerLighting`, the `SightFrames` due timer and the store's `lighting`/`exploredMask` fields.

- [ ] **Step 1:** Write the test. Build a fake view whose renderer returns a configurable `PlayerLighting` (use `lightingFixtures.ts`):
```ts
it('C-light-1: unlit, pending (no renderer on a lit scene, sight not ready, loading, explored decoding) and ready', async () => {
  const view = fakeView('v1');
  load(view);
  const api = lightingApi(trackerWith(view), framesFor(), new DisposerSet());
  view.setPlayerLighting(null);
  expect(api.playerVisibility('v1')).toEqual({ status: 'unlit' });
  view.setPlayerLighting(undefined);
  view.atlasStore.getState().setSceneLighting?.({ enabled: true }); // use the store action that enables lighting
  expect(api.playerVisibility('v1')).toEqual({ status: 'pending' });
  view.setPlayerLighting(fixtureLighting({ ready: false }));
  expect(api.playerVisibility('v1')).toEqual({ status: 'pending' });
  view.setPlayerLighting(fixtureLighting({ ready: true, perception: (id) => (id === 'seen-token' ? 'seen' : 'unseen') }));
  view.atlasStore.setState({ isMapLoading: true });
  expect(api.playerVisibility('v1').status).toBe('pending');
  load(view);
  const ready = api.playerVisibility('v1');
  expect(ready.status).toBe('ready');
  if (ready.status !== 'ready') return;
  expect(Object.keys(ready).sort()).toEqual(['darkness', 'showsExplored', 'status', 'tokens']);
  expect(ready.darkness.shown).toBeInstanceOf(Uint8Array);
  expect(ready.darkness.shown.length).toBe(ready.darkness.cols * ready.darkness.rows);
});
it('C-light-1: a graphics context lost after sight was ready reads as pending again', () => {
  const view = fakeView('v1');
  load(view);
  const api = lightingApi(trackerWith(view), framesFor(), new DisposerSet());
  view.setPlayerLighting(fixtureLighting({ ready: true }));
  expect(api.playerVisibility('v1').status).toBe('ready');
  view.setPlayerLighting(fixtureLighting({ ready: false })); // what A19's sightReady() reports after context loss
  expect(api.playerVisibility('v1')).toEqual({ status: 'pending' });
});
it('C-light-2: watch fires when sight is recomputed, and its disposer stops it', () => {
  const view = fakeView('v1');
  const api = lightingApi(trackerWith(view), framesFor(), new DisposerSet());
  const listener = vi.fn();
  const stop = api.watch('v1', listener);
  view.firePlayerLightingChange();
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  view.firePlayerLightingChange();
  expect(listener).toHaveBeenCalledTimes(1);
});
it('C-light-1: explored memory still decoding reads as pending until the decode resolves', async () => {
  let resolveDecode!: (image: ExploredImage) => void;
  const decode = (): Promise<ExploredImage> => new Promise((resolve) => { resolveDecode = resolve; });
  const view = fakeView('v1');
  load(view);
  view.atlasStore.setState({ exploredMask: 'data:image/png;base64,AAAA' } as never); // the store field the fork's LiveLighting read
  view.setPlayerLighting(fixtureLighting({ ready: true, showsExplored: true }));
  const api = lightingApi(trackerWith(view), framesFor(decode), new DisposerSet());
  expect(api.playerVisibility('v1')).toEqual({ status: 'pending' });
  resolveDecode(fixtureExploredImage());
  await Promise.resolve();
  expect(api.playerVisibility('v1').status).toBe('ready');
});
it('C-light-3: an unknown view is pending, never unlit', () => {
  expect(lightingApi(trackerWith(), framesFor(), new DisposerSet()).playerVisibility('nope')).toEqual({ status: 'pending' });
});
```
These test helpers need adding:
- `fakeView` gains `setPlayerLighting(value)` and `firePlayerLightingChange()` in `apiFakes.ts`.
- `fixtureLighting(overrides): PlayerLighting` and `fixtureExploredImage(): ExploredImage` live in `tests/unit/lightingFixtures.ts` (A20).
- `framesFor(decode?: ExploredDecoder)` returns a fresh `SightFramesByView` whose `SightFrames` use `decode`. Run the test. Expected: FAIL.
- [ ] **Step 2:** Implement `playerVisibility.ts` and `src/api/lighting.ts` to the rules above. `maxCellsPerSide` defaults to 384, clamped to `[16, 1024]`.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.5: ask what the player window shows of a lit scene, token by token and cell by cell, failing closed while sight is not ready
```
Run the verify block (`API_BASE_REF=api-pr-7-end`), commit with the message `feat(api): lighting.playerVisibility, fail closed (API 1.5.0)`, then `git tag api-pr-8-end`.

## PR 9: Token moves (group 6), API 1.6.0

### Task A22: `snapDroppedToken` and the `tokens` facade

**Files:**
- Modify: `src/app/clipboard/mapObjectPlacement.ts`, adding the fork's `snapDroppedToken`.
- Create: `src/api/types/tokens.ts` (spec group 6) and `src/api/tokens.ts`.
- Modify: `types/api.ts`, `extension.ts`, `capabilities.ts` (`'tokens'`), `public.ts`, `version.ts` (`1.6.0`).
- Test:
  - `tests/unit/playerToolsShared.test.ts`: add back the `snapDroppedToken` block.
  - Port `$FORK:tests/unit/online/largeTokenSnap.test.ts` and `$FORK:tests/unit/online/hiddenGridSnap.test.ts` as `tests/unit/snapDroppedToken.test.ts`, keeping only the `snapDroppedToken` cases.
  - `tests/api/tokens.test.ts`.

**Interfaces:**
- Produces: `tokensApi(tracker): TokensApi`.
  - `snapPoint` returns `snapDroppedToken(state.grid, point, tokenSize)`.
  - `move` checks moves in this order:
    1. `not-loaded`: no view, or the view is loading.
    2. `unknown-token`.
    3. `hidden`: the token's `isHidden` is true and `allowHidden` is false.
    4. `invalid-position`: a non-finite x or y.
  - If any move fails a check, nothing is written. Otherwise each point is clamped to `[0, mapSize]` when `clampToMap` is true (the default) and `mapSize` is not 0 × 0, then snapped with the token's `size || 1` when `snap` is true (the default). All moves are written in one `runHistoryTransaction(store, () => setTokenPositions([...]))`. The result is `{ ok: true, positions }`.

- [ ] **Step 1:** Write `tests/api/tokens.test.ts`:
```ts
function sceneWithTokens(view: FakeView): void {
  view.atlasStore.setState((state) => ({
    grid: { ...state.grid!, size: 70, offsetX: 0, offsetY: 0, type: 'square', enabled: true, snapToGrid: true },
    objects: { ...state.objects, tokens: {
      a: { ...makeToken('a'), x: 35, y: 35, size: 1 },
      b: { ...makeToken('b'), x: 105, y: 35, size: 1 },
      hidden: { ...makeToken('hidden'), x: 35, y: 105, size: 1, isHidden: true },
    } },
  }));
  load(view);
}

it('C-tok-1: refusals and one undo step', () => {
  const view = fakeView('v1');
  const tokens = tokensApi(trackerWith(view));
  expect(tokens.move('v1', [{ tokenId: 'a', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'not-loaded' });
  sceneWithTokens(view);
  expect(tokens.move('v1', [{ tokenId: 'zzz', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'unknown-token' });
  expect(tokens.move('v1', [{ tokenId: 'hidden', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'hidden' });
  expect(tokens.move('v1', [{ tokenId: 'a', x: Number.NaN, y: 0 }])).toEqual({ ok: false, reason: 'invalid-position' });
  expect(tokens.move('v1', [{ tokenId: 'a', x: 140, y: 140 }, { tokenId: 'zzz', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'unknown-token' });
  expect(view.atlasStore.getState().objects.tokens.a!.x).toBe(35);
  const result = tokens.move('v1', [{ tokenId: 'a', x: 150, y: 150 }, { tokenId: 'b', x: 220, y: 80 }]);
  expect(result).toEqual({ ok: true, positions: { a: { x: 175, y: 175 }, b: { x: 245, y: 105 } } });
  const history = getHistoryStore(view.atlasStore);
  history.getState().undo();
  expect(view.atlasStore.getState().objects.tokens.a!.x).toBe(35);
  expect(view.atlasStore.getState().objects.tokens.b!.x).toBe(105);
  expect(tokens.move('v1', [{ tokenId: 'hidden', x: 0, y: 0 }], { allowHidden: true }).ok).toBe(true);
});

it('C-tok-2: snapPoint as the GM drag: unchanged without grid or snapping, corners for even sizes, a switched-off grid still snaps', () => {
  const view = fakeView('v1');
  sceneWithTokens(view);
  const tokens = tokensApi(trackerWith(view));
  expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 35, y: 35 });
  expect(tokens.snapPoint('v1', { x: 60, y: 60 }, 2)).toEqual({ x: 70, y: 70 });
  view.atlasStore.getState().setGridVisible(false);
  expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 35, y: 35 });
  view.atlasStore.getState().setSnapToGrid(false);
  expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
  expect(tokens.snapPoint('nope', { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
});
```
- `makeToken` is the existing token fixture (`git grep -n "export function makeToken\|export function token(" tests/mocks tests/unit | head`). If there isn't one, add a minimal `makeToken(id): TokenEntity` to `tests/api/apiFakes.ts`, typed in full.
- The snapped values assume the hidden-grid and large-token rulings; run the ported snap tests to confirm.
- `getHistoryStore` comes from `src/app/stores/history`.

Run the test. Expected: FAIL.
- [ ] **Step 2:** Implement `src/api/tokens.ts` to the **Interfaces** rules. Use `loadedMapSize(view)` for the clamp.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.6: move tokens like a GM drag (snapped, kept on the map, one undo step), and ask where a dropped token lands
```
Run the verify block (`API_BASE_REF=api-pr-8-end`), commit with the message `feat(api): tokens.snapPoint and tokens.move (API 1.6.0)`, then `git tag api-pr-9-end`.

## PR 10: UI slots (group 9), API 1.7.0

Atlas's UI never imports from `src/api/`. The registries live in `src/app/extensions/`. `src/api/ui/*` adapts them for extensions, and Atlas's components read them through one hook. Every item an extension gives is data: a Lucide icon name, a label and callbacks. The icon is drawn with Obsidian's `setIcon`, which knows the Lucide names, so Atlas never bundles every Lucide icon. Every callback runs inside `try/catch`. When one throws, Atlas logs `[Atlas API] <extension id>: <slot> failed` and skips that item, so Atlas never breaks.

### Task A23: The slot registry, toolbar items and palette sections

**Files:**
- Create:
  - `src/app/extensions/SlotRegistry.ts`
  - `src/app/extensions/slots.ts`, which holds the per-plugin singletons, like `playerWindowStore`
  - `src/app/extensions/useSlot.ts`
  - `src/app/react/components/ObsidianIcon.tsx`
  - `src/app/extensions/viewContext.ts`
- Modify:
  - `src/app/packages/components/MainToolbar.tsx`: registered items join the toolbar with their `priority` and a `menuEntry`, filtered by `views` against the context's kind and `!isPlayerView`. Badges show as a dot or a count.
  - `src/app/react/components/CommandPalette.tsx`: registered sections follow Atlas's own.
- Test:
  - `tests/unit/extensionSlots.test.ts`
  - `tests/unit/mainToolbar.extensions.test.tsx`, modelled on the fork's `onlineToolbarItem.test.tsx` and `mainToolbar.text-tool.test.tsx` diff
  - `tests/unit/commandPalette.extensions.test.tsx`, modelled on `commandPalette.online.test.tsx`

**Interfaces:**
- Produces:
```ts
// src/app/extensions/SlotRegistry.ts
export interface SlotEntry<T> { owner: string; item: T }
export class SlotRegistry<T> {
  private entries: ReadonlyArray<SlotEntry<T>> = [];
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  /** Adds `item` for extension `owner`; the removal is idempotent. */
  add(owner: string, item: T): () => void {
    const entry = { owner, item };
    this.entries = [...this.entries, entry];
    this.changed();
    let done = false;
    return (): void => {
      if (done) return;
      done = true;
      this.entries = this.entries.filter((candidate) => candidate !== entry);
      this.changed();
    };
  }
  list(): ReadonlyArray<SlotEntry<T>> { return this.entries; }
  /** A number that changes on add, remove and `invalidate`, for `useSyncExternalStore`. */
  version(): number { return this.revision; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Asks every reader to re-read the items' callbacks (badges, isActive, commands). */
  invalidate(): void { this.changed(); }
  private changed(): void { this.revision++; for (const listener of [...this.listeners]) listener(); }
}

/** Calls `read`, logging and returning `fallback` when an extension's callback throws. */
export function safely<R>(owner: string, slot: string, read: () => R, fallback: R): R {
  try { return read(); } catch (error) { console.error(`[Atlas API] ${owner}: ${slot} failed:`, error); return fallback; }
}
```
- `slots.ts` exports `toolbarSlot`, `paletteSlot`, `dashboardSlot`, `viewMenuSlot`, `tokenMenuSlot` and `panelSlot`. Each is a `SlotRegistry` of the matching spec type, imported from `src/api/types/ui.ts`, which is a type-only import and therefore allowed. It also exports `invalidateSlots(): void`, which calls `invalidate()` on every slot and `invalidatePresentationTargets()`.
- `useSlot(registry)` returns `ReadonlyArray<SlotEntry<T>>`. It re-renders on `version()`.
- `ObsidianIcon({ name, className })` renders a `span` with `setIcon(span, name)` in an effect.
- `viewContextOf(view, store): ViewContext` returns `{ viewId: view.viewId, kind: 'map', isPlayerView: store.getState().isPlayerView }`. A28 adds `'remote'`.

- [ ] **Step 1:** Write the tests. `tests/unit/extensionSlots.test.ts` covers:
  - add and list;
  - removal twice;
  - `invalidate` bumps `version`;
  - `safely` returns the fallback and logs.

  `tests/unit/mainToolbar.extensions.test.tsx` renders the toolbar the way `mainToolbar.text-tool.test.tsx` does, with one item `{ id: 'x', icon: 'network', label: 'Online session', priority: 60, onClick }`. It asserts:
  - the button shows with the label (through `LabelTooltip`; no `title` attribute);
  - clicking calls `onClick` with `{ viewId, kind: 'map', isPlayerView: false }`;
  - the button disappears after the removal;
  - a `badge` returning `3` shows `3`, and after `invalidate` with the badge returning `null` it disappears;
  - an item whose `badge` throws still renders without a badge;
  - an item with `views: ['remote']` does not show in a map view.

  `tests/unit/commandPalette.extensions.test.tsx` checks that a section's commands appear under its title and that `run` is called.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement. For the toolbar, look at how `PRIORITY` and `menuEntry` are used for an existing control, and give registered items one `ToolButton` each with `ObsidianIcon`. The fork's `PRIORITY.online` hunk shows where an extension item fits. Use its shape, but take the priority from the item (default 50).
- [ ] **Step 3:** Run the tests plus `tests/unit/mainToolbar*.test.tsx tests/unit/commandPalette*.test.tsx`. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(ui): extension slot registry; toolbar items and palette sections`.

### Task A24: Dashboard tiles, the view's "More options" menu, and the token context menu

**Files:**
- Modify:
  - `src/app/dashboard-view.tsx`: registered tiles join the action cards (A5's odd-tile rule applies).
  - `src/app/react/components/ViewActionsMenu.tsx`: provider items join the menu.
  - `src/app/pixi/token-renderer/InteractionController.ts`: provider items join a token's context menu. The context carries `{ ...ctx, tokenId, tokenKind: token.kind }` and applies in GM views only. The field is `tokenKind`, not the spec's `kind`, which would collide with `ViewContext.kind` (decision D3). This is the generic replacement for the fork's `controlledBySubmenu` hunk; do not port that hunk.
- Create: `src/app/extensions/menuEntries.ts`, which maps `MenuItem` to Atlas's `ContextMenuEntry`. It is recursive for `submenu`, and maps `checked` and `disabled`.
- Test:
  - `tests/unit/dashboardExtensions.test.tsx`
  - `tests/unit/viewMenuExtensions.test.tsx`
  - `tests/unit/tokenMenuExtensions.test.ts`, modelled on the fork's `controlledByContextMenu.test.ts` harness

**Interfaces:**
- Produces: `menuEntriesOf(owner: string, items: readonly MenuItem[]): ContextMenuEntry[]`, which drops items whose label is empty and catches errors from `onClick`.

- [ ] **Step 1:** Write the tests:
  - **Dashboard:** a registered tile renders its title and description, a click calls `onClick`, and the removal makes it disappear.
  - **View menu:** a provider's item with a submenu renders and runs, and a provider that throws adds nothing.
  - **Token menu:**
    - a character token's menu gets the provider's items with `tokenKind: 'character'`;
    - a player view's token menu never calls the provider;
    - the provider receives the token id.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement, reading the field names of `ContextMenuEntry` (`git show HEAD:src/app/react/root/ContextMenuContext.tsx | grep -n "type\|label\|icon\|submenu\|checked\|disabled"`).
- [ ] **Step 3:** Run the tests. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(ui): extension dashboard tiles, view menu and token menu entries`.

### Task A25: Panels, `invalidate`, and the `ui` facade

**Files:**
- Create:
  - `src/app/extensions/ExtensionPanels.tsx`
  - `src/app/extensions/panelState.ts`
  - `src/api/types/ui.ts` (spec group 9; created in A23 for its types, completed here)
  - `src/api/ui/index.ts`, with the facade's seven functions
- Modify:
  - `src/app/react/UIRoot.tsx`: mount `<ExtensionPanels />`. This is the generic replacement for `<OnlinePanel />`.
  - `src/app/stores/uiSlice.ts`: nothing. Panel open state lives in `panelState.ts`, keyed by `viewId` and panel id. This replaces the fork's `isOnlinePanelOpen`, so neither the store nor `storeFactory` changes.
  - `types/api.ts`, `extension.ts`, `capabilities.ts` (`'ui'`), `public.ts`, `version.ts` (`1.7.0`).
- Test:
  - `tests/unit/extensionPanels.test.tsx`
  - `tests/api/ui.test.ts`, which also counts as the lifecycle test for slots

**Interfaces:**
- Produces: `uiApi(scope: ExtensionScope): UiApi`. Every `add*` goes through `scope.disposers.add(slot.add(scope.id, item))`.
- `addPanel` returns a `PanelHandle`:
  - `open(viewId?)`, `close()`, `toggle(viewId?)` and `isOpen(viewId?)`. When `viewId` is omitted, they act on the active map view.
  - `dispose()`, which closes the panel everywhere and removes it.
- While a panel is open in a view, `ExtensionPanels` renders the panel frame:
  - `atlas-panel-radius($radius-2xl)`;
  - an `atlas-close-header` with the title and `CloseButton`;
  - opening and closing with the dialogs' motion.

  Inside the frame is a `div` that is handed to `spec.mount(container, ctx)`. The returned disposer runs when the panel closes, when its view unmounts, or when `dispose()` is called.
- `invalidate()` calls `invalidateSlots()`.

- [ ] **Step 1:** Write the tests.
  - `tests/unit/extensionPanels.test.tsx`:
    - opening mounts once with the container and context;
    - closing runs the disposer once;
    - the close button closes the panel;
    - `dispose()` while open runs the disposer and removes the frame;
    - a `mount` that throws shows nothing and logs.
  - `tests/api/ui.test.ts`:
```ts
it('C-ui-1: everything an extension registers is gone when it unloads', () => {
  const { host } = hostWithUi();
  const plugin = fakePlugin('ext');
  const ui = host.api.connect(plugin).ui;
  ui.addToolbarItem({ id: 't', icon: 'network', label: 'T', onClick: () => undefined });
  ui.addPaletteSection({ id: 'p', title: 'P', commands: () => [] });
  ui.addDashboardTile({ id: 'd', icon: 'users', title: 'D', description: '', onClick: () => undefined });
  ui.addViewMenuItems(() => []);
  ui.addTokenMenuItems(() => []);
  const panel = ui.addPanel({ id: 'panel', title: 'Panel', mount: () => () => undefined });
  expect(slotCounts()).toEqual({ toolbar: 1, palette: 1, dashboard: 1, viewMenu: 1, tokenMenu: 1, panel: 1 });
  plugin.unload();
  expect(slotCounts()).toEqual({ toolbar: 0, palette: 0, dashboard: 0, viewMenu: 0, tokenMenu: 0, panel: 0 });
  expect(() => panel.dispose()).not.toThrow();
});
it('C-ui-2: Atlas unloading removes every extension slot', () => {
  const { host } = hostWithUi();
  host.api.connect(fakePlugin('a')).ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: () => undefined });
  host.dispose();
  expect(slotCounts().toolbar).toBe(0);
});
it('C-ui-3: invalidate bumps every slot version', () => {
  const before = toolbarSlot.version();
  hostWithUi().host.api.connect(fakePlugin('a')).ui.invalidate();
  expect(toolbarSlot.version()).toBeGreaterThan(before);
});
```
    `hostWithUi()` builds the host as `lifecycle.test.ts` does, with `buildExtension` given services whose `views` is a tracker over no views. `slotCounts()` reads `list().length` of each slot.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement. Keep `ExtensionPanels.tsx` under 200 lines: split the frame into `ExtensionPanelFrame.tsx`. The SCSS goes in `src/app/extensions/extension-panels.scss` and uses the CLAUDE.md mixins. Import it from `styles/main.scss`.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.7: other plugins can add toolbar buttons, command palette sections, dashboard tiles, entries in a map's More options and a token's menu, and floating panels in Atlas's style
```
Run the verify block (`API_BASE_REF=api-pr-9-end`), commit with the message `feat(api): ui slots and panels (API 1.7.0)`, then `git tag api-pr-10-end`.

## PR 11: Scenes and bundles (group 10), API 1.8.0

### Task A26: Extension data on scene records, the legacy `data.sharing` move, and stripping it everywhere

**Files:**
- Modify:
  - `src/app/services/AssetService.ts`: `SceneAssetData` gains `extensions?: Record<string, Json>`. When the index loads, a scene record whose `data.sharing` exists has it moved to `data.extensions['atlas-vtt-connect']`, unless that key exists already, in which case `data.sharing` is dropped. The index is then saved once.
- Create:
  - `src/app/services/collectionBundle/bundleExtensionData.ts`, the generic version of the fork's `bundleSharing.ts`:
    - `withoutSceneExtensions(asset)`: removes `data.extensions` and any leftover `data.sharing`.
    - `withoutJsonExtensions(parsed)`: the same for a scene's JSON mirror (keys at the root when `mapPath` is a string) and for a whole scene record.
    - `withoutNoteKeys(file, text, keys)`.
    - `isNote`.
  - `src/app/services/collectionBundle/frontmatterKeys.ts`: `withoutFrontmatterKeys(text: string, keys: ReadonlySet<string>): string`. Port the YAML key removal from `$FORK:src/app/online/sharing/model/frontmatterFilter.ts` (`withoutShareProperty`), generalized to a key set. Keep its byte-order-mark and CRLF handling.
  - `src/app/extensions/bundleNoteKeys.ts`: a registry of keys, `add(owner, keys): () => void` and `keys(): ReadonlySet<string>`.
  - `src/app/services/legacySceneData.ts`: the one-time move, which is pure: `movedLegacySceneData(asset): Asset | null`.
- Modify:
  - `src/app/services/assetTransfer/transferRecords.ts`: a copy drops `extensions` (the fork's hunk, generalized).
  - `src/app/services/collectionBundle/bundleContent.ts`: the fork's hunks, with `withoutJsonExtensions` and `withoutNoteKeys(file, text, bundleNoteKeys.keys())` in place of the online-specific helpers. Keep the byte-order-mark handling and the `mayRewrite` change.
  - `collectionExport.ts`, `importInputs.ts`, `fingerprints.ts`: the fork's hunks, generalized.
- Test:
  - `tests/unit/bundleSharing.test.ts`, ported as `tests/unit/bundleExtensionData.test.ts` with these name changes:
    - `withoutSceneSharing` becomes `withoutSceneExtensions`;
    - `data.sharing` becomes `data.extensions` in each case;
    - every case runs once more with a legacy `data.sharing`.
  - From the fork's diffs of `tests/unit/bundleContent.test.ts` and `tests/unit/collectionBundle.test.ts`, take the share-stripping cases, generalized.
  - New: `tests/unit/legacySceneData.test.ts` and `tests/unit/frontmatterKeys.test.ts`.

**Interfaces:**
- Produces:
  - `withoutSceneExtensions(asset: Asset): Asset`
  - `withoutJsonExtensions(parsed: unknown): unknown`
  - `withoutNoteKeys(file, text, keys): string`
  - `withoutFrontmatterKeys(text, keys): string`
  - `bundleNoteKeys.add(owner, keys)`
  - `LEGACY_SHARING_EXTENSION_ID = 'atlas-vtt-connect'`

- [ ] **Step 1:** Write the tests. These are the key cases:
```ts
it('C-scenes-1: a scene exported, installed, copied or fingerprinted carries no extension data and no legacy share', async () => {
  const legacy = sceneAsset({ data: { mapPath: 'm.atlasmap', sharing: { item: 'x', people: ['k1'] } } });
  const modern = sceneAsset({ data: { mapPath: 'm.atlasmap', extensions: { 'atlas-vtt-connect': { item: 'x' } } } });
  for (const asset of [legacy, modern]) {
    expect(withoutSceneExtensions(asset).data).toEqual({ mapPath: 'm.atlasmap' });
    expect(await assetFingerprint(asset)).toBe(await assetFingerprint(sceneAsset({ data: { mapPath: 'm.atlasmap' } })));
  }
});
it('moves a legacy data.sharing into the Connect extension once, and keeps newer extension data', () => {
  expect(movedLegacySceneData(sceneAsset({ data: { mapPath: 'm', sharing: { a: 1 } } }))?.data)
    .toEqual({ mapPath: 'm', extensions: { 'atlas-vtt-connect': { a: 1 } } });
  expect(movedLegacySceneData(sceneAsset({ data: { mapPath: 'm', sharing: { a: 1 }, extensions: { 'atlas-vtt-connect': { b: 2 } } } }))?.data)
    .toEqual({ mapPath: 'm', extensions: { 'atlas-vtt-connect': { b: 2 } } });
  expect(movedLegacySceneData(sceneAsset({ data: { mapPath: 'm' } }))).toBeNull();
});
it('removes registered note keys from exported and installed notes, keeps the rest and the BOM', () => {
  const text = '﻿---\natlas-share: everyone\ntags: [a]\n---\nBody\n';
  expect(withoutFrontmatterKeys(text, new Set(['atlas-share']))).toBe('﻿---\ntags: [a]\n---\nBody\n');
});
```
`sceneAsset(partial)` is a fixture added to `tests/mocks/` and typed as `Asset`. Port the fork's frontmatter edge cases for `withoutShareProperty` into `frontmatterKeys.test.ts`:
  - no frontmatter;
  - only the key;
  - a list value;
  - CRLF line endings.

Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement. The move runs in `AssetService`, at the point where the index is parsed. Find that point with `git grep -n "isLegacyTokenRecord\|parseIndex\|function load" src/app/services/AssetService.ts`, and apply the move there alongside the existing legacy conversions. Then `grep -rn "sharing" src/app/services` may name only `legacySceneData.ts` and the strip helpers.
- [ ] **Step 3:** Run the tests plus `tests/unit/*bundle* tests/unit/*transfer* tests/unit/*fingerprint*`. Expected: PASS.
- [ ] **Step 4:** Add this line to the changelog under `## Important changes`:
```markdown
- Data that other plugins keep on scenes never travels in collection exports, copies or installs. Map shares saved by the online preview are kept for Atlas VTT Connect and are never exported either
```
Run the verify block, then commit with the message `feat(scenes): extension data on scene records, never exported; legacy map shares move to Atlas VTT Connect`.

### Task A27: The `scenes` and `bundles` facades, and `scenes-changed`

**Files:**
- Create:
  - `src/api/types/scenes.ts`, with `SceneRecord`, `SavedMapInput`, `ScenesApi` and `BundlesApi` from spec group 10
  - `src/api/scenes.ts`
  - `src/api/sceneImport.ts`, the `addToCollection` transaction, kept under 200 lines
  - `src/api/bundles.ts`
- Modify: `types/api.ts` (`scenes`, `bundles`, `'scenes-changed'`), `extension.ts`, `capabilities.ts` (`'scenes'`, `'bundles'`), `public.ts`, `version.ts` (`1.8.0`), `ExtensionApiPublisher.ts`, which emits `scenes-changed` from `AssetService.onChange` for scene records.
- Test: `tests/api/scenes.test.ts`.

**Interfaces:**
- Consumes these `AssetService` methods: `getAssets(undefined, 'scene')`, `getAssetById`, `updateAsset`, `runExclusive`, `addAsset`, `getCollections`, `createCollection`, `onChange` and `initialize`; also `ensureFolder` (`plugin/vaultFolders`), `migrateMapFile` and the `MapPersistence` reading the fork's `sharing/receive/mapPull.ts` uses. Read with `git show $FORK:src/app/online/sharing/receive/mapPull.ts`.
- Produces `scenesApi(app, scope): ScenesApi`:
  - `getData(id)` returns `data.extensions?.[scope.id]`.
  - `setData(id, value)` re-reads the record (`getAssetById`) right before writing, and patches only `data.extensions[scope.id]`. This follows the fork's ruling F-b: never write back `mapPath`. A `null` value deletes the key, and an empty `extensions` object is deleted too.
  - `readMap(path)` reads, migrates and returns `mapSize` (the background's natural size, read from the map file's grid or background metadata the way `mapPull` did), or `null` when the file is missing.
  - `addToCollection(input)` runs inside `runExclusive`:
    1. Ensure the folder.
    2. Write each image under `folder/` with `vault.createBinary`; refuse a path that escapes `folder`.
    3. Write the map JSON.
    4. Create the collection by name when needed.
    5. `addAsset` the scene.

    On any failure it trashes everything it wrote, then rethrows. It returns `{ sceneId, mapPath }`.
- Produces `bundlesApi(scope): BundlesApi`. `stripNoteProperties(keys)` returns `scope.disposers.add(bundleNoteKeys.add(scope.id, keys))`.

- [ ] **Step 1:** Write the test against an in-memory app with an initialized `AssetService`:
```ts
it('C-scenes-1: setData keeps data under the extension id, re-reads before writing, and null clears it', async () => {
  const { scenes, assets, sceneId } = await withScene();
  await scenes.setData(sceneId, { item: 'abc' });
  expect((await assets.getAssetById(sceneId))!.data).toMatchObject({ extensions: { ext: { item: 'abc' } } });
  await assets.updateAsset(sceneId, { data: { ...(await assets.getAssetById(sceneId))!.data, mapPath: 'moved.atlasmap' } });
  await scenes.setData(sceneId, { item: 'def' });
  expect((await assets.getAssetById(sceneId))!.data).toMatchObject({ mapPath: 'moved.atlasmap', extensions: { ext: { item: 'def' } } });
  expect(await scenes.getData(sceneId)).toEqual({ item: 'def' });
  await scenes.setData(sceneId, null);
  expect((await assets.getAssetById(sceneId))!.data).not.toHaveProperty('extensions');
  expect(await scenes.getData(sceneId)).toBeUndefined();
});
it('C-scenes-2: addToCollection leaves nothing behind on failure and runs one at a time', async () => {
  const { scenes, app } = await withScene();
  const input = { collection: { name: 'Shared with me' }, name: 'Cave', folder: 'atlas-vtt/collections/Shared with me/Cave', map: emptyMap(), images: [{ path: 'bg.webp', data: new ArrayBuffer(4) }] };
  vi.spyOn(AssetService.getInstance(app), 'addAsset').mockRejectedValueOnce(new Error('index full'));
  await expect(scenes.addToCollection(input)).rejects.toThrow('index full');
  expect(await app.vault.adapter.exists('atlas-vtt/collections/Shared with me/Cave/bg.webp')).toBe(false);
  const [a, b] = await Promise.all([scenes.addToCollection(input), scenes.addToCollection({ ...input, name: 'Cave 2', folder: input.folder + ' 2' })]);
  expect(a.sceneId).not.toBe(b.sceneId);
  await expect(scenes.addToCollection({ ...input, images: [{ path: '../escape.webp', data: new ArrayBuffer(1) }] })).rejects.toThrow();
});
it('C-scenes-3: readMap returns the migrated map with its size, or null for a missing file', async () => {
  const { scenes, mapPath } = await withScene();
  const map = await scenes.readMap(mapPath);
  expect(map?.objects.tokens).toBeDefined();
  expect(map?.mapSize.width).toBeGreaterThanOrEqual(0);
  expect(await scenes.readMap('nope.atlasmap')).toBeNull();
});
it('C-bundles-1: stripNoteProperties adds keys until disposed', () => {
  const disposers = new DisposerSet();
  const stop = bundlesApi({ id: 'ext', disposers } as never).stripNoteProperties(['atlas-share']);
  expect(bundleNoteKeys.keys().has('atlas-share')).toBe(true);
  stop();
  expect(bundleNoteKeys.keys().has('atlas-share')).toBe(false);
});
```
`withScene()` seeds a collection with one scene and its map file. Use the scene fixtures the bundle tests already use (`git grep -ln "type: 'scene'" tests/unit | head -3`). `emptyMap()` returns a typed `SavedMapInput`. Run the test. Expected: FAIL.
- [ ] **Step 2:** Implement. `list()` maps scene assets to `{ id, name, collectionId: collection, mapPath: data.mapPath ?? null }`. `findByMap(path)` finds the first such record.
- [ ] **Step 3:** Run the tests. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.8: list scenes, keep an extension's own data on a scene (never exported), read a saved map without opening it, add a scene with its images in one step, and keep note properties out of exports
```
Run the verify block (`API_BASE_REF=api-pr-10-end`), commit with the message `feat(api): scenes and bundles facades (API 1.8.0)`, then `git tag api-pr-11-end`.

## PR 12: Remote map view, optional (group 12), API 1.9.0

This is a separate capability and the last PR. If the maintainer answers no to open question 1, PRs 1–11 stand alone and Connect uses its Canvas 2D fallback (B11). All Atlas-side code lives in `src/app/remote-view/`. Upstream files gain only the small hooks listed below.

**Mapping from the fork's `OnlineSceneView`/`remoteScene` to Atlas:**
- `remoteScene` (store field) becomes `remoteView: RemoteViewState | null`.
- `OnlineSceneStatus` becomes the API's `RemoteStatus`. `reconnect: boolean` becomes the optional `action`.
- `following` and the Follow GM button stay in Connect (toolbar items with `views: ['remote']`).
- `ownRoll` becomes `RemoteView.throwRoll`.
- `OnlineSceneControls.rollDice` becomes the `onRoll` listeners.

### Task A28: The remote store, the `atlas-vtt-remote` view type, `remoteViews.open`, close and lifecycle

**Files:**
- Create:
  - `src/app/remote-view/remoteViewState.ts`: `RemoteViewState { movableTokenIds; measurement; conditions; resources; initiativeHealth; initiativeRules; status: RemoteStatus; notice: string | null; diceLog: readonly DiceRollResult[]; ownRoll: DiceRollResult | null }`, `initialRemoteViewState()` and `updateRemoteView(store, partial)`. Port these from the fork's `remoteScene.ts` and rename as described above.
  - `src/app/remote-view/RemoteMapView.ts`: ported from `$FORK:src/app/online/obsidian/OnlineSceneView.ts`, without the session wiring:
    - type `atlas-vtt-remote`;
    - `navigation = false`;
    - `getState()` returns `{ mapFilePath: null }`;
    - `setState` and `onLoadFile` do nothing;
    - `getDisplayText()` and `getIcon()` come from its owner's `open` options;
    - a tab restored at startup with no owner closes itself once the layout is ready.
  - `src/app/remote-view/remoteViewType.ts` (`REMOTE_VIEW_TYPE`).
  - `src/app/remote-view/RemoteViewHandle.ts`: the handle. It is completed in A29–A31.
  - `src/api/types/remoteViews.ts` (spec group 12).
  - `src/api/remoteViews.ts`.
- Modify:
  - `src/app/storeFactory.ts`: the fork's `ViewStoreOptions`, `INERT_STORAGE`, `isPlayerView || remote`, `isGMView: !remote`, `persistenceEnabled: !remote` and the paused history, with `remoteScene` renamed to `remoteView` and typed from `remoteViewState.ts`. The field is excluded from `partialize`.
  - `src/app/services/ServiceManager.ts`: the fork diff.
  - `src/app/atlas-view.ts`: the `remote` constructor flag, `isRemote` (reads `remoteView !== null`) and the `onContainerResized` hook. **Not** `onlineControls()`.
  - `src/app/plugin/atlasLeaves.ts`: `openMapInView` skips `REMOTE_VIEW_TYPE`, plus `activeMapView`.
  - `src/app/plugin/registerCommands.ts`: the `activeMapView` lines.
  - `src/app/plugin/statusBarVisibility.ts`: the remote type is full-bleed.
  - `main.ts`: `registerView(REMOTE_VIEW_TYPE, …)`.
  - `src/api/viewTracker.ts`: also tracks `REMOTE_VIEW_TYPE` leaves. `viewInfo.kind` becomes `'remote'` for them, and `views()` returns both kinds.
  - `src/api/views.ts`: `active()` never returns a remote view.
  - `src/api/types/api.ts`: `remoteViews?: RemoteViewsApi`.
  - `extension.ts`, which sets `remoteViews` only when the capability is landed; `capabilities.ts` (`'remote-view'`); `public.ts`.
- Test:
  - Port `$FORK:tests/unit/online/obsidian/remoteStore.test.ts` as `tests/unit/remoteStore.test.ts`, and port `tests/unit/activeMapView.test.ts` and `tests/unit/openMapInView.test.ts`.
  - New: `tests/api/remoteViews.test.ts`.

**Interfaces:**
- Produces:
  - `openRemoteView(app, owner: string, options: { title; icon?; reuse? }): Promise<RemoteViewHandle>`. With `reuse`, it reveals the owner's existing remote tab.
  - `RemoteViewHandle` implements `RemoteView`, with `close()` and `onClose()` working from this task. Every other method is completed in A29–A31.
  - `remoteViewsApi(app, scope)`. Every handle it opens is owned by `scope` and closed when the scope is disposed.

- [ ] **Step 1:** Port the tests and write `tests/api/remoteViews.test.ts`. Use the in-memory app and a fake workspace whose `getLeaf('tab')` returns a fake leaf. `setViewState({ type })` on that leaf constructs `RemoteMapView` with a stubbed `ServiceManager` renderer, which is what the fork's `onlineSceneView.test.ts` harness does: copy that harness into `tests/api/remoteViewHarness.ts`.
```ts
it('C-remote-1: open with reuse reveals the same tab; close fires onClose once; the view is never active() and never saved', async () => {
  const { api, workspace } = await remoteHarness();
  const first = await api.open({ title: 'Online scene', icon: 'network', reuse: true });
  const again = await api.open({ title: 'Online scene', reuse: true });
  expect(again.viewId).toBe(first.viewId);
  const closed = vi.fn();
  first.onClose(closed);
  expect(views().list().find((info) => info.viewId === first.viewId)?.kind).toBe('remote');
  expect(views().active()).toBeNull();
  first.close();
  first.close();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(workspace.leavesOf('atlas-vtt-remote')).toHaveLength(0);
});
it('C-remote-2: unloading the extension or Atlas closes its remote views', async () => {
  const { host, plugin } = await remoteHostHarness();
  const view = await host.api.connect(plugin).remoteViews!.open({ title: 'X' });
  const closed = vi.fn();
  view.onClose(closed);
  plugin.unload();
  expect(closed).toHaveBeenCalledTimes(1);
});
```
Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement. Then `grep -rn "online" src/app/remote-view src/app/storeFactory.ts src/app/atlas-view.ts` must print nothing.
- [ ] **Step 3:** Run the tests plus `tests/unit/*store* tests/unit/atlasView*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block (the report changes, so bump `version.ts` to `1.9.0` here), then commit with the message `feat(remote-view): an externally fed, never-saved map view type with open and close`.

### Task A29: `setScene` and `setPlayer`: applier, backdrop by URL, fog cache, per-token stand-ins, initiative

**Files:**
- Create:
  - `src/app/remote-view/RemoteSceneApplier.ts`, ported. Its input is now `RemoteSceneInput` (Atlas records plus URLs). The fork's `PlayerScene`-to-store conversion stays in Connect. The applier writes with `runUntracked`, sets `mapPath` to `remote:<viewId>` and `mapLoaded: true`, and sets the `remoteView` measurement.
  - `src/app/remote-view/RemoteMapBackdrop.ts`, ported. It shows `background.url` through `backgroundTextureCache` and keeps a placeholder of the given size while the URL is null.
- Modify. These are the fork's group-12 hunks, renamed from `remoteScene` to `remoteView`:
  - `src/app/react/BackgroundSprite.tsx` and `src/app/pixi/backgroundTextureCache.ts`: object-URL images.
  - `src/app/pixi/fog/FogCanvasCompositor.ts` and `FogOfWarRenderer.ts`: the prefix-cache flag, on only when `remoteView` is set.
  - Create (port whole) `src/app/pixi/token-renderer/viewConditionDefinitions.ts` and `viewResourceDefinitions.ts`. Modify `src/app/resources/resourceTypes.ts`, so the provider takes a token id, and `TokenRenderer.ts`, `UIManager.ts` and `TokenUIRenderer.ts`, for per-token definitions and no numbers on hover in the remote view.
  - `src/app/services/PlayerInitiativePanel.ts` and `PlayerSceneOverlay.ts`.
  - `src/app/services/mapMeasurementSettings.ts`: the `remoteView` branch.
- `RemoteViewHandle`: `setScene(input | null)` applies the input, or clears the store to an empty unloaded scene. `setPlayer(state)` writes `movableTokenIds`, `measurement`, `tokenUi.conditions` as `conditions`, `tokenUi.resources` as `resources`, `initiative.rules` and `initiative.health`.
- Test:
  - Port `$FORK:tests/unit/online/obsidian/remoteSceneApplier.test.ts`. Rewrite its inputs from `PlayerScene` fixtures into `RemoteSceneInput` with the fork's `playerSceneToAtlasState` expectations. The conversion itself is tested in Connect B15.
  - Port `remoteMapBackdrop.test.ts`, `$FORK:tests/unit/online/fogCompositorCache.test.ts`, `tests/unit/viewConditionDefinitions.test.ts`, the object-URL cases of `backgroundSprite.test.tsx` and `backgroundTextureCache.test.ts`, the Atlas-side cases of `onlineSceneResources.test.ts` (definitions per token, no numbers on hover) and of `onlineSceneInitiative.test.ts` (panel reads rules and health from the remote view). All go under `tests/unit/remote*.test.ts`.
  - `tests/api/remoteViews.test.ts`: add `C-remote-3`. After `setScene(input)`, `views.snapshot(viewId)` shows the input's tokens. After `setScene(null)`, `loaded` is false. A GM view's `mapMeasurementSettings` is unaffected.

**Interfaces:**
- Produces: `RemoteView.setScene` and `RemoteView.setPlayer`, behaving as described.
- Consumes: `RemoteSceneInput` and `RemotePlayerState` (spec group 12). Connect B15 produces them.

- [ ] **Step 1:** Port and rewrite the tests. Run them. Expected: FAIL.
- [ ] **Step 2:** Port, rename and apply the hunks. Each file stays under 300 lines.
- [ ] **Step 3:** Run the tests plus `tests/unit/*fog* tests/unit/*background* tests/unit/*token*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(remote-view): feed a scene and the player's state into a remote view`.

### Task A30: Player drag, drop and cancel; the camera; Fit map; lasers in the remote view

**Files:**
- Create:
  - `src/app/remote-view/remoteDrag.ts`: the drag gate from `$FORK:…/obsidian/remoteTokenMoves.ts`. Only tokens in `movableTokenIds` drag, with the drag ruler. A drop emits at the snapped drop point (A22's `snapDroppedToken` over the remote grid), and the token goes back until the scene says otherwise.
  - `src/app/remote-view/ViewportFollower.ts`, ported.
- Modify:
  - `src/app/pixi/token-renderer/InteractionController.ts`: the fork's player drag, drop event and cancel hunks, wired to `remoteDrag` and active only when `remoteView` is set.
  - `src/app/react/useMapNavigationHotkeys.ts`: Fit map in the remote view goes through the follower and reports `byUser: false`.
  - `RemoteViewHandle`: `onTokenDrop`, `cancelDrag`, `setCamera(camera, { animate })` and `onCameraMoved`.
- Test:
  - Port `$FORK:tests/unit/online/obsidian/viewportFollower.test.ts`.
  - Port the Atlas-side cases of `onlinePlayerDrag.test.ts` (drag allowed only for movable ids, drop emits the snapped point, cancel returns the token) as `tests/unit/remoteDrag.test.ts`.
  - `tests/api/remoteViews.test.ts`: add `C-remote-4`. `onTokenDrop` fires only for movable ids. `lasers.onLocal(remoteViewId)` and `lasers.show(remoteViewId)` work, because the remote view's renderer has a `LaserHub`. `onCameraMoved(true)` fires after a user pan.

- [ ] **Step 1:** Port and write the tests. Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the tests plus `tests/unit/interaction*.test.*`. Expected: PASS.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat(remote-view): player drag and drop, camera follow and Fit map`.

### Task A31: Status bar, shared dice log, own throws, tray rolls; finish group 12

**Files:**
- Create:
  - `src/app/remote-view/RemoteStatusBar.tsx`, ported from `$FORK:src/app/react/components/online/OnlineSceneBar.tsx`. It reads `remoteView.status`, and the action button runs `status.action.run`. Its styles go in `src/app/remote-view/remote-view.scss`, taken from the fork's `online-scene.scss` parts that style the bar, renamed `atlas-remote-*`.
  - `src/app/remote-view/RemoteOwnRolls.tsx`, ported from `OnlineOwnRolls.tsx`. It throws `remoteView.ownRoll` once per id with the player's Atlas dice look, and shows a result card where WebGL is missing (upstream's card path).
- Modify:
  - `src/app/react/components/dice-log/DiceRollLog.tsx` and `useDiceHistory.ts`: the remote view shows `remoteView.diceLog`, hides Clear, and sends Roll again to `onRoll`.
  - `src/app/packages/components/MainToolbar.tsx`: the remote branch. The dice tray's `onRoll` goes to the handle's listeners, and `maxDice` is 100. Registered items with `views: ['remote']` show here, which comes from A23.
  - `src/app/react/UIRoot.tsx`: `{remote && <RemoteStatusBar />}` and `{remote && <RemoteOwnRolls />}`.
  - `RemoteViewHandle`: `setStatus`, `setDiceLog`, `throwRoll` and `onRoll`.
  - `docs/extension-api.md`: the remote view section.
- Test:
  - Port the fork's `onlineSceneStatus.test.ts`, `onlineSceneRoll.test.tsx`, `onlineOwnRolls.test.tsx` and `onlineDiceUi.test.tsx` (Atlas parts) as `tests/unit/remote*.test.tsx`, over the handle.
  - `tests/api/remoteViews.test.ts`: add `C-remote-5`. An `onRoll` listener returning `'Not connected'` shows that text in the tray, and `null` closes it. `setDiceLog` entries render and Clear is absent. `throwRoll` sets `ownRoll`, and the same id thrown again is ignored.

- [ ] **Step 1:** Port and write the tests. Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. Then `git grep -nE "online" -- src/app/remote-view src/app/react src/app/packages` must print nothing.
- [ ] **Step 3:** Run the tests and the whole `tests/api`. Expected: PASS. Then `npm run api:report`.
- [ ] **Step 4:** Add this line to the changelog under `## New`:
```markdown
- Extension API 1.9 (optional `remote-view` capability): a read-only map view fed by another plugin, never saved, with the player's tools: dragging the tokens they may move, measuring, the laser and the dice tray into a shared log
```
Run the verify block (`API_BASE_REF=api-pr-11-end`), commit with the message `feat(api): remote view status, dice log, own throws and tray rolls (API 1.9.0)`, then `git tag api-pr-12-end`.

**Track A done check (controller):** run `git log --oneline origin/beta..api/extension-api`, which should list about 31 commits, then the verify block on HEAD, then `git tag --list 'api-pr-*'`, which should list 12 tags. Then prepare the upstream PR text per PR from the commits in `api-pr-<N-1>-end..api-pr-<N>-end`. Writing and opening the PRs is a user step; nothing is pushed.

---

# Track B: Atlas VTT Connect

All paths are relative to `C:\Users\joaoo\2075\atlas-vtt-connect` unless absolute.
- `ATLAS=../atlas-vtt-upstream-wt` (the worktree).
- `FORK=merge/upstream-beta`, read with `git -C $ATLAS show $FORK:<path>`.
- "Port `<fork path>` to `<path>`" means `git -C $ATLAS show $FORK:<fork path> > <path>`, then rewriting the imports by Appendix C.

The first commit of this repository is this plan with a minimal README. The controller makes that commit when it saves the plan. B1 builds on it.

### Task B1: Scaffold, test infrastructure and copied helpers

**Files:**
- Create:
  - `package.json`, `package-lock.json` (from `npm install`), `tsconfig.json`, `.nvmrc`, `.gitignore`
  - `manifest.json`, `versions.json`
  - `vite.config.mts`, `vitest.config.mts`, `eslint.config.mjs`, `eslint.suppressions.json` (`{}`)
  - `main.ts`, `styles/main.scss`, `styles/_atlas-mixins.scss`
  - `LICENSE`, the AGPL-3.0 text, copied from `$ATLAS/LICENSE`
  - `.github/workflows/ci.yml`
- Create test infrastructure: `tests/mocks/obsidian.ts`, `tests/mocks/inMemoryVault.ts` and `tests/setup/obsidianDom.ts`, copied from `$ATLAS` at `api/extension-api`, each with the "Copied from Atlas VTT" header.
- Create the copied helpers, each with the header. The path stays Atlas's (decision D4):
  - `src/app/plugin/vaultFolders.ts`: the fork version with the widened `ensureAdapterFolder` type.
  - `src/app/ui/confirmDialog.ts`
  - `src/app/ui/nativeModal.ts`: only the class-name constants, `ATLAS_NATIVE_MODAL_CLASSES`. If the module holds more, copy only what the fork's online code imports.
  - `src/app/utils/mapStrings.ts`, `timerWidget.ts`, `counterWidget.ts`, `widgetActivation.ts`
  - `src/app/types/widgetIcons.ts`
  - `src/app/packages/components/toolbar/toolbarFit.ts`
  - `src/app/react/components/dice3d/diceRollText.ts`
  - `src/app/imageProcessing/imageDimensions.ts`

  Copy each helper's Atlas tests too, into `tests/unit/copied/` (`git -C $ATLAS ls-files tests | grep -iE "confirmDialog|mapStrings|timerWidget|counterWidget|widgetActivation|toolbarFit|diceRollText|imageDimensions|vaultFolders"`).
- Create the rebuilt primitives: `src/app/ui/primitives/Button.tsx` and `src/app/ui/primitives/LabelTooltip.tsx`, with `tests/unit/primitives.test.tsx`.

**Interfaces:**
- Produces:
  - `Button` props `{ variant?: 'default' | 'cta' | 'warning' | 'ghost'; size?: 'sm' | 'md'; onClick?; disabled?; children; className?; 'aria-label'? }`. It renders `<button className="atlas-connect-button mod-<variant>">` and uses Obsidian's own `mod-cta` and `mod-warning` classes.
  - `LabelTooltip({ label, children, side? })`, a CSS tooltip on hover and focus with no `title` attribute.
  - Every copied helper keeps its Atlas exports unchanged.

- [ ] **Step 1: The project files**

`package.json`:
```json
{
  "name": "atlas-vtt-connect",
  "version": "0.1.0",
  "private": true,
  "description": "Online play and sharing for Atlas VTT: host a session, the web join page, the Obsidian player tab, and note and map sharing.",
  "main": "dist/main.js",
  "license": "AGPL-3.0-only",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "vite build",
    "build:page": "vite build -c vite.page.config.mts",
    "test": "vitest",
    "lint": "eslint . --max-warnings 0 --suppressions-location eslint.suppressions.json",
    "check:vendor": "node scripts/check-vendor.mjs",
    "sync:atlas": "node scripts/sync-atlas.mjs"
  },
  "dependencies": {
    "lucide-react": "^0.503.0",
    "peerjs": "^1.5.5",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "three": "^0.185.1",
    "zustand": "5.0.3"
  },
  "devDependencies": {
    "@codemirror/state": "6.5.0",
    "@codemirror/view": "6.38.6",
    "@testing-library/react": "16.3.0",
    "@types/node": "26.6.3",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@types/three": "^0.185.3",
    "@vitejs/plugin-react": "^4.3.1",
    "eslint": "^9.39.5",
    "eslint-plugin-obsidianmd": "^0.4.2",
    "jsdom": "^26.1.0",
    "obsidian": "^1.13.1",
    "sass": "^1.87.0",
    "typescript": "5.8.3",
    "typescript-eslint": "^8.70.0",
    "vite": "6.4.3",
    "vitest": "4.1.11",
    "yaml": "^2.8.0"
  }
}
```
- `check:vendor` and `sync:atlas` arrive in B3. Until then they print "missing script"; that is fine because the verify block uses `check:vendor` only from B3 on.
- Before running `npm install`, check that every pinned version above is the one Atlas's `package.json` uses at `api/extension-api`, so the ported code meets the same libraries. `yaml` is for the Obsidian mock; use the version in `$ATLAS/package-lock.json`.

`manifest.json`:
```json
{
  "id": "atlas-vtt-connect",
  "name": "Atlas VTT Connect",
  "version": "0.1.0",
  "minAppVersion": "1.8.7",
  "description": "Online play for Atlas VTT: host sessions, let players join from a web page or Obsidian, and share notes and maps.",
  "author": "João Bento",
  "authorUrl": "https://github.com/evolJoaoBento",
  "isDesktopOnly": true
}
```
`versions.json`: `{ "0.1.0": "1.8.7" }`. `.nvmrc`: `22`.

`.gitignore`:
```
node_modules/
dist/
dist-page/
coverage/
*.tsbuildinfo
.DS_Store
**/__screenshots__/
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "types": ["vitest/globals"],
    "paths": {
      "@atlas-vtt/api-types": ["vendor/atlas/api-types/atlas-vtt-api.d.ts"],
      "@atlas-vtt/shared/*": ["vendor/atlas/shared/types/src/shared/*"]
    }
  },
  "include": ["main.ts", "src/**/*", "online-client/**/*", "tests/**/*", "*.mts", "vite/**/*.mts"]
}
```
`moduleResolution: Bundler` is needed for the `paths` mapping onto a `.d.ts` file. If the vendored `.d.ts` files use `.ts` extensions in their specifiers, `allowImportingTsExtensions` covers them.

`vite/atlasAliases.mts`. B3 adds the vendor; until then nothing imports the aliases:
```ts
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** `@atlas-vtt/shared/<entry>` → the vendored ES module (decision D1). `@atlas-vtt/api-types` is types only. */
export const atlasAliases = [
  { find: /^@atlas-vtt\/shared\/(grid|draw|rules|dice3d)$/, replacement: path.join(root, 'vendor/atlas/shared/$1.js') },
];
```

`vite.config.mts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import module from 'node:module';
import { atlasAliases } from './vite/atlasAliases.mts';

const isProduction = process.env.NODE_ENV === 'production';

/** The Obsidian plugin bundle. It writes dist/ and nothing else: never a vault (README, "Developing"). */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: atlasAliases },
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: isProduction ? false : 'inline',
    minify: isProduction,
    lib: { entry: 'main.ts', formats: ['cjs'], fileName: () => 'main.js' },
    rollupOptions: {
      external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view', ...module.builtinModules],
      output: {
        banner: `/*! Atlas VTT Connect — SPDX-License-Identifier: AGPL-3.0-only
 * Source code and licence: https://github.com/evolJoaoBento/atlas-vtt-connect
 * Contains code from Atlas VTT (AGPL-3.0-only, https://github.com/ByteMirror/atlas-vtt); third-party notices:
 * https://github.com/evolJoaoBento/atlas-vtt-connect/blob/main/THIRD_PARTY_NOTICES.md
 */`,
        exports: 'named',
        inlineDynamicImports: true,
        entryFileNames: 'main.js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'styles.css' : asset.name ?? '[name][extname]'),
      },
    },
  },
});
```

`vitest.config.mts`:
```ts
import { defineConfig } from 'vitest/config';
import { atlasAliases } from './vite/atlasAliases.mts';

export default defineConfig({
  resolve: { alias: [...atlasAliases, { find: /^obsidian$/, replacement: '/tests/mocks/obsidian.ts' }] },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup/obsidianDom.ts'] },
});
```

`eslint.config.mjs`: copy Atlas's file, with this ignore list:
```js
globalIgnores(["dist/", "dist-page/", "node_modules/", "vendor/", "tests/", "scripts/", "docs/", "vite/", "online-client/", "**/*.test.*", "*.js", "*.cjs", "*.mjs", "*.mts", "*.config.ts"]),
```
The `obsidianmd/ui/sentence-case` `ignoreWords` become `["Atlas", "VTT", "Connect", "PeerJS", "TURN", "STUN", "GM"]`.

`main.ts`. B2 fills it:
```ts
import { Plugin } from 'obsidian';
import './styles/main.scss';

export default class AtlasVttConnectPlugin extends Plugin {
  async onload(): Promise<void> {
    // Services are added task by task (plan B2 onwards).
  }
}
```

`styles/main.scss`:
```scss
// Atlas VTT Connect styles. Uses Obsidian's variables and the mixins copied from Atlas (_atlas-mixins.scss).
@use 'atlas-mixins' as *;
```

`styles/_atlas-mixins.scss`: copy `atlas-elevated-surface`, `atlas-panel-radius`, `atlas-panel-inset-radius`, `atlas-panel-inset-radius-value`, `atlas-close-header`, `atlas-corner-shape`, `atlas-keep-in-view` and the variables they need (`$radius-*`, `$spacing-*`, `$close-button-gap`) from `$ATLAS/styles/_mixins.scss` and its variables file, with the copied header.

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx vitest run
      - run: npm run build
```
B3 adds `npm run check:vendor`, and B7 adds the page build.

- [ ] **Step 2: Copy the test infrastructure and the helpers with their tests**

```bash
ATLAS=../atlas-vtt-upstream-wt; FORK=merge/upstream-beta; REF=api/extension-api
mkdir -p tests/mocks tests/setup tests/unit/copied
for f in tests/mocks/obsidian.ts tests/mocks/inMemoryVault.ts tests/setup/obsidianDom.ts; do git -C $ATLAS show $REF:$f > $f; done
git -C $ATLAS show $FORK:src/app/plugin/vaultFolders.ts > src/app/plugin/vaultFolders.ts
# …each helper listed under Files, from $REF unless it is vaultFolders
```
Prepend the header to each file: `// Copied from Atlas VTT <path> at <git -C $ATLAS rev-parse --short $REF> (AGPL-3.0-only).`

If a copied helper imports another Atlas module, either copy that module too, if it is small and pure, or drop the dependency, if the online code never needs it. List the decision in the task report.

- [ ] **Step 3: Write the primitive test and see it fail**

`tests/unit/primitives.test.tsx`:
```tsx
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/app/ui/primitives/Button';
import { LabelTooltip } from '../../src/app/ui/primitives/LabelTooltip';

describe('primitives', () => {
  it('Button uses Obsidian classes and calls onClick', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Button variant="cta" onClick={onClick}>Allow</Button>);
    const button = getByRole('button', { name: 'Allow' });
    expect(button.className).toContain('mod-cta');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('LabelTooltip never sets a title attribute', () => {
    const { container, getByText } = render(<LabelTooltip label="Kick"><span>x</span></LabelTooltip>);
    expect(container.querySelector('[title]')).toBeNull();
    fireEvent.mouseEnter(getByText('x'));
    expect(getByText('Kick')).toBeTruthy();
  });
});
```
Run `npx vitest run tests/unit/primitives.test.tsx`. Expected: FAIL, module not found.

- [ ] **Step 4: Write the primitives**

`src/app/ui/primitives/Button.tsx`:
```tsx
import React from 'react';

export interface ButtonProps {
  variant?: 'default' | 'cta' | 'warning' | 'ghost';
  size?: 'sm' | 'md';
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}

/** A button in Obsidian's own style (`mod-cta`, `mod-warning`), sized for Connect's panels. */
export function Button({ variant = 'default', size = 'md', className, children, ...rest }: ButtonProps): React.ReactElement {
  const classes = ['atlas-connect-button', `is-${size}`, variant === 'default' ? '' : `mod-${variant}`, className ?? ''].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest}>{children}</button>;
}
```

`src/app/ui/primitives/LabelTooltip.tsx`:
```tsx
import React, { useId, useState } from 'react';

export interface LabelTooltipProps { label: string; side?: 'top' | 'bottom'; children: React.ReactElement }

/** A small tooltip on hover and focus, never the browser's (no `title`). */
export function LabelTooltip({ label, side = 'top', children }: LabelTooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="atlas-connect-tooltip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && <span id={id} role="tooltip" className={`atlas-connect-tooltip is-${side}`}>{label}</span>}
    </span>
  );
}
```
Add their styles to `styles/primitives.scss`, imported from `main.scss`. Use uniform padding and gap, `atlas-elevated-surface` for the tooltip, and Obsidian's `--interactive-*` variables for the button.

- [ ] **Step 5: Run everything**

```bash
npm install
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
ls dist   # main.js styles.css
```
Expected: all pass, and `dist/` holds the two files. Nothing outside the repository changed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .nvmrc .gitignore manifest.json versions.json vite.config.mts vite/atlasAliases.mts \
  vitest.config.mts eslint.config.mjs eslint.suppressions.json main.ts styles LICENSE .github/workflows/ci.yml tests src
git commit -m "chore: scaffold Atlas VTT Connect with copied Atlas helpers and test setup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```
`git add styles tests src` names folders that this task created in full. That is allowed.

### Task B2: Networking core, Connect's own settings, and the setting tab

Nothing in this task needs the Atlas API.

**Files:**
- Port into `src/app/online/`:
  - `protocol.ts`, `ids.ts`, `rateLimit.ts`, `joinLink.ts`, `onlineLog.ts`
  - `onlineSettings.ts`, with `DEFAULT_ONLINE_SETTINGS.playerPageUrl = 'https://evoljoaobento.github.io/atlas-vtt-connect/'`
  - `transport/**` (6 files)
  - `GmSession.ts`, `gmSessionEntries.ts`, `gmSessionTypes.ts`
  - `sharing/identity/**` (6 files; they are used by GmSession's table proofs)
- Split `GmSession.ts` (330 lines): the admission and re-admission paths move to `gmSessionAdmission.ts`, so both files stay at or under 300 lines.
- Create:
  - `src/connect/settingsStore.ts`, Connect's settings in `loadData`/`saveData`
  - `src/connect/settingTab.ts`, ported from `$FORK:src/app/settings/onlineSettingsSection.ts` as a `PluginSettingTab`
  - `styles/settings-rows.scss`, from the fork, together with the user-test fix that stops the "Own server address" row squeezing its label (fork commit `e554b46`–`5e54f62`; take the file at `$FORK`)
- Modify: `main.ts`.
- Test: port these from `$FORK:tests/unit/online/` into `tests/unit/online/`:
  - `protocol.test.ts`, `joinLink.test.ts`, `onlineSettings.test.ts`
  - `memoryTransport.test.ts`, `peerTransport.test.ts`
  - `gmSession.test.ts`, `gmSessionClient.test.ts`
  - `onlineLog.test.ts`
  - from `sharing/`: `identityProofs.test.ts`, `identityWire.test.ts`, `deviceKeys.test.ts`, `gmSessionIdentity.test.ts`, `tableReissuer.test.ts`

  New: `tests/unit/connect/settingsStore.test.ts` and `tests/unit/connect/settingTab.test.ts`.

**Interfaces:**
- Produces:
  - `class ConnectSettingsStore { static load(plugin: Plugin): Promise<ConnectSettingsStore>; get(): OnlineSettings; set(partial: Partial<OnlineSettings>): void; onChange(cb: () => void): () => void; readonly migratedFromFork: boolean; markMigrated(): void }`. It saves debounced, 500 ms after the last change. Its stored shape is `{ online: OnlineSettings; migratedFromFork?: 1 }`.
  - The fork's `SettingsService.getOnlineSettings()` and `setOnlineSettings()` call sites become `settings.get()` and `settings.set()`.
  - `ensureTableIdentity(settings: { get(): OnlineSettings; set(p): void }, crypto)`. Narrow its parameter to that shape.

- [ ] **Step 1:** Port the tests. Their imports of `SettingsService` become a `memorySettings()` helper in `tests/unit/connect/memorySettings.ts`, which returns an in-memory store with the same `get`/`set` interface. Write `settingsStore.test.ts`:
```ts
it('loads defaults with the new player page, keeps a stored custom page, and saves debounced', async () => {
  vi.useFakeTimers();
  const plugin = fakeDataPlugin({ online: { playerPageUrl: 'https://my.example/page/' } });
  const store = await ConnectSettingsStore.load(plugin);
  expect(store.get().playerPageUrl).toBe('https://my.example/page/');
  const fresh = await ConnectSettingsStore.load(fakeDataPlugin(null));
  expect(fresh.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
  store.set({ playerName: 'GM' });
  expect(plugin.saved).toHaveLength(0);
  vi.advanceTimersByTime(500);
  expect(plugin.saved.at(-1)).toMatchObject({ online: { playerName: 'GM' } });
  vi.useRealTimers();
});
```
`fakeDataPlugin(data)` lives in the same test folder. It returns `{ loadData: async () => data, saveData: async (d) => { saved.push(d) }, saved }`.

`settingTab.test.ts` renders the tab into a container through the Obsidian mock's `Setting`, and checks:
- the rows "Signaling server", "Relay (TURN) servers", "Player page address", "Log online play events" and "Shared note properties" exist;
- editing the page address calls `set`.

Copy the row names from the fork section. Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port the files and rewrite their imports by Appendix C. The only Atlas imports in these files are `SettingsService` (types), which becomes Connect's store; `tools/diceRolling` types, which come from `@atlas-vtt/api-types` (`DiceRollResult`) and `@atlas-vtt/shared/rules` (`DiceSelection`); and `transport/*` (PeerJS).

  Because `@atlas-vtt/*` resolves only after B3, keep the two dice types this task needs in a local `src/app/online/diceTypes.ts`, ported verbatim. B3 deletes it and repoints the imports to the vendor. Note this in the commit body.
- [ ] **Step 3:** Wire `main.ts`:
```ts
export default class AtlasVttConnectPlugin extends Plugin {
  settings!: ConnectSettingsStore;
  async onload(): Promise<void> {
    this.settings = await ConnectSettingsStore.load(this);
    this.addSettingTab(new ConnectSettingTab(this.app, this, this.settings));
  }
}
```
- [ ] **Step 4:** Run the tests and the Connect verify block, without `check:vendor`. Expected: PASS. Every ported test passes unchanged except for its imports. Review flags any assertion change.
- [ ] **Step 5:** Commit `src/app/online`, `src/connect`, `styles/settings-rows.scss`, `styles/main.scss`, `main.ts` and `tests/unit` by explicit path, with the message `feat: networking core, table proofs and Connect's own settings`.

### Task B3: The vendored Atlas packages, AtlasLink, capabilities and FakeAtlas

Re-sync the vendor at `api-pr-3-end` (A8) first.

**Files:**
- Create:
  - `scripts/sync-atlas.mjs`, `scripts/check-vendor.mjs`
  - `vendor/atlas/**`, produced by the sync
  - `src/connect/obsidianAugment.d.ts`, `src/connect/atlasLink.ts`, `src/connect/capabilities.ts`, `src/connect/startConnect.ts`
  - `tests/fake/FakeAtlas.ts`, `tests/fake/fakeAtlas.contract.test.ts`
  - `tests/unit/connect/atlasLink.test.ts`, `tests/unit/connect/capabilities.test.ts`
- Modify:
  - `main.ts`
  - `.github/workflows/ci.yml`, adding `npm run check:vendor`
  - delete `src/app/online/diceTypes.ts`, repointing its imports

**Interfaces:**
- Produces:
  - `class AtlasLink { constructor(plugin: Plugin, start: (atlas: AtlasExtension, api: AtlasApi) => Disposer, notify?: (message: string) => void); start(): void; readonly connected: AtlasExtension | null }`
  - `need<K extends keyof NeedMap>(api: AtlasApi, atlas: AtlasExtension, capability: K): NeedMap[K] | null`, where `NeedMap` maps each capability to its namespace type
  - `startConnect(plugin, atlas, api): Disposer`, which every later task extends
  - `FakeAtlas implements AtlasApi`, with `capabilities`, `extension` and control methods per namespace that later tasks add
- Atlas compatibility rule:
  - Major version 1 is required. Any other major shows the notice "Atlas VTT Connect needs Atlas VTT with extension API 1.x (found <v>)." once per session, and Connect stays idle.
  - A missing `api` means Atlas is not installed or not enabled. Connect then waits for `atlas-vtt:api-ready`. After layout-ready it shows "Atlas VTT Connect needs Atlas VTT. Install or enable it, then reload." once.

- [ ] **Step 1: The sync and check scripts**

`scripts/sync-atlas.mjs`:
```js
// node scripts/sync-atlas.mjs --atlas <atlas dir> --commit <sha>
// Builds Atlas's extension packages at exactly <sha> and copies them into vendor/atlas (decision D1).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const atlas = path.resolve(args.atlas ?? '');
const commit = args.commit ?? '';
const git = (...a) => execFileSync('git', ['-C', atlas, ...a], { encoding: 'utf8' }).trim();
const fail = (message) => { console.error(message); process.exit(1); };

if (!existsSync(path.join(atlas, 'package.json')) || !/^[0-9a-f]{7,40}$/.test(commit)) fail('Usage: --atlas <Atlas dir> --commit <sha>');
const head = git('rev-parse', 'HEAD');
if (!head.startsWith(commit)) fail(`Atlas is at ${head}, not ${commit}. Check out that commit first.`);
if (git('status', '--porcelain', '--untracked-files=no')) fail('Atlas has uncommitted changes to tracked files.');

// Only build:packages: never `build` or `dev`, whose hooks copy into a vault.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:packages'], { cwd: atlas, stdio: 'inherit', shell: process.platform === 'win32' });
if (git('status', '--porcelain', '--untracked-files=no')) fail('build:packages changed tracked files in Atlas (api-report out of date?).');

const vendor = path.resolve('vendor/atlas');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(path.join(vendor, 'api-types'), { recursive: true });
cpSync(path.join(atlas, 'api-report/atlas-vtt-api.d.ts'), path.join(vendor, 'api-types/atlas-vtt-api.d.ts'));
cpSync(path.join(atlas, 'dist-packages/shared'), path.join(vendor, 'shared'), { recursive: true });

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name !== 'SOURCE.json') files[path.relative(vendor, full).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex');
  }
};
walk(vendor);
const report = readFileSync(path.join(vendor, 'api-types/atlas-vtt-api.d.ts'), 'utf8');
const apiVersion = report.match(/export declare const API_VERSION = "([^"]+)";/)?.[1] ?? fail('No API_VERSION in the report.');
const contractCases = [...new Set(git('grep', '-ohE', 'C-[a-z]+-[0-9]+', head, '--', 'tests/api').split('\n').map((line) => line.replace(/^.*?:/, '')).filter(Boolean))].sort();
writeFileSync(path.join(vendor, 'SOURCE.json'), JSON.stringify({ repository: 'ByteMirror/atlas-vtt', branch: 'api/extension-api', commit: head, apiVersion, contractCases, files }, null, 2) + '\n');
console.log(`Vendored Atlas ${head.slice(0, 7)} (API ${apiVersion}): ${Object.keys(files).length} files, ${contractCases.length} contract cases.`);
```

`scripts/check-vendor.mjs`:
```js
// Fails when vendor/atlas differs from what SOURCE.json recorded (hand edits, partial syncs). Offline.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const vendor = path.resolve('vendor/atlas');
const source = JSON.parse(readFileSync(path.join(vendor, 'SOURCE.json'), 'utf8'));
const seen = new Set();
const problems = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (name === 'SOURCE.json') continue;
    const rel = path.relative(vendor, full).split(path.sep).join('/');
    seen.add(rel);
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (source.files[rel] !== hash) problems.push(`changed or unknown: ${rel}`);
  }
};
walk(vendor);
for (const rel of Object.keys(source.files)) if (!seen.has(rel)) problems.push(`missing: ${rel}`);
if (problems.length) { console.error(`vendor/atlas does not match Atlas ${source.commit}:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`vendor/atlas matches Atlas ${source.commit.slice(0, 7)} (API ${source.apiVersion}).`);
```
`.gitattributes` gets `vendor/** -text`, so line endings never change the hashes on Windows.

- [ ] **Step 2: Sync**

```bash
node scripts/sync-atlas.mjs --atlas ../atlas-vtt-upstream-wt --commit "$(git -C ../atlas-vtt-upstream-wt rev-parse api-pr-3-end)"
npm run check:vendor
```
Expected: "Vendored Atlas … (API 1.0.0) …", then "vendor/atlas matches …". If Atlas has moved on, use the detach procedure in "Cross-track order".

- [ ] **Step 3: Write the failing tests**

`tests/fake/FakeAtlas.ts`, which grows in later tasks:
```ts
import type { AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, ConnectingPlugin, Disposer } from '@atlas-vtt/api-types';

type Listeners = { [E in keyof AtlasEvents]?: Set<AtlasEvents[E]> };

/** A test-only Atlas: the API as Connect sees it, with the documented edge cases (Appendix A). */
export class FakeAtlas implements AtlasApi {
  readonly version: string;
  private readonly listeners: Listeners = {};
  private readonly capabilities: Set<AtlasCapability>;
  private readonly disposers = new Set<() => void>();
  connectedIds: string[] = [];

  constructor(options: { version?: string; capabilities?: readonly AtlasCapability[] } = {}) {
    this.version = options.version ?? '1.0.0';
    this.capabilities = new Set(options.capabilities ?? []);
  }

  has(capability: AtlasCapability): boolean {
    return this.capabilities.has(capability);
  }

  connect(plugin: ConnectingPlugin): AtlasExtension {
    this.connectedIds.push(plugin.manifest.id);
    const on = <E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer => {
      const set = (this.listeners[event] ??= new Set()) as Set<AtlasEvents[E]>;
      set.add(listener);
      const dispose = (): void => { set.delete(listener); this.disposers.delete(dispose); };
      this.disposers.add(dispose);
      return dispose;
    };
    return { id: plugin.manifest.id, on } as AtlasExtension;
  }

  emit<E extends keyof AtlasEvents>(event: E, ...args: Parameters<AtlasEvents[E]>): void {
    for (const listener of [...((this.listeners[event] as Set<(...a: Parameters<AtlasEvents[E]>) => void>) ?? [])]) listener(...args);
  }

  /** Atlas unloads: 'unload', then everything is disposed (C-life-3). */
  unload(): void {
    this.emit('unload' as keyof AtlasEvents, ...([] as never));
    for (const dispose of [...this.disposers]) dispose();
  }

  listenerCount(): number {
    return Object.values(this.listeners).reduce((sum, set) => sum + (set?.size ?? 0), 0);
  }
}
```
`connect` returns an extension that grows namespace by namespace in later tasks, for example `views: this.views.api`. Its `as AtlasExtension` cast is removed once every namespace exists (B15). Until then, add namespaces as fields of `Partial<AtlasExtension>` and keep the cast in this test helper only.

`tests/fake/fakeAtlas.contract.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeAtlas } from './FakeAtlas';

const source = JSON.parse(readFileSync('vendor/atlas/SOURCE.json', 'utf8')) as { contractCases: string[] };
/** Cases only Atlas can show (rendering, Atlas's own UI); each with why the fake leaves it out. */
export const ATLAS_ONLY: Record<string, string> = {
  'C-life-4': 'Atlas-internal DisposerSet; the fake disposers are trivially idempotent',
};
const plugin = (id: string) => ({ manifest: { id }, register: () => undefined }) as never;

describe('FakeAtlas follows the contract cases', () => {
  it('C-life-1: a second connect with the same id gets a fresh scope', () => {
    const atlas = new FakeAtlas();
    atlas.connect(plugin('x'));
    atlas.connect(plugin('x'));
    expect(atlas.connectedIds).toEqual(['x', 'x']);
  });
  it('C-life-3: unload tells the extension, then nothing is left', () => {
    const atlas = new FakeAtlas();
    let told = false;
    atlas.connect(plugin('x')).on('unload', () => { told = true; });
    atlas.unload();
    expect(told).toBe(true);
    expect(atlas.listenerCount()).toBe(0);
  });
  it('C-life-5: has() answers only for given capabilities', () => {
    expect(new FakeAtlas({ capabilities: ['views'] }).has('dice')).toBe(false);
  });
  it('C-life-2: a disposer removes its listener', () => {
    const atlas = new FakeAtlas();
    atlas.connect(plugin('x')).on('unload', () => undefined)();
    expect(atlas.listenerCount()).toBe(0);
  });

  it('every case Atlas pins is tested here or listed as Atlas-only', () => {
    const text = readFileSync('tests/fake/fakeAtlas.contract.test.ts', 'utf8');
    const missing = source.contractCases.filter((id) => !ATLAS_ONLY[id] && !text.includes(`'${id}:`));
    expect(missing).toEqual([]);
  });
});
```
Each later B task that re-syncs adds its group's cases here, or adds them to `ATLAS_ONLY` with a reason.

`tests/unit/connect/atlasLink.test.ts`:
```ts
it('connects when the API is already there, and when it arrives later', () => { /* fake app.plugins + workspace.trigger/on */ });
it('reconnects after Atlas reloads: unload stops what start returned, a new api-ready starts again', () => {
  const { app, fire } = fakeWorkspaceApp();
  const plugin = fakeConnectPlugin(app);
  const stops: string[] = [];
  const link = new AtlasLink(plugin, (atlas) => { stops.push(`start:${atlas.id}`); return () => stops.push('stop'); });
  link.start();
  const first = new FakeAtlas();
  fire('atlas-vtt:api-ready', first);
  first.unload();
  fire('atlas-vtt:api-unload');
  fire('atlas-vtt:api-ready', new FakeAtlas());
  expect(stops).toEqual(['start:atlas-vtt-connect', 'stop', 'start:atlas-vtt-connect']);
});
it('refuses another major version with one notice', () => {
  const notices: string[] = [];
  const { app, fire } = fakeWorkspaceApp();
  new AtlasLink(fakeConnectPlugin(app), () => () => undefined, (m) => notices.push(m)).start();
  fire('atlas-vtt:api-ready', new FakeAtlas({ version: '2.0.0' }));
  fire('atlas-vtt:api-ready', new FakeAtlas({ version: '2.0.0' }));
  expect(notices).toEqual(['Atlas VTT Connect needs Atlas VTT with extension API 1.x (found 2.0.0).']);
});
it('ignores a value at plugins.atlas-vtt.api that is not an API', () => { /* api = { version: 1 } → no start */ });
```
Write the first and last cases in full as well:
- the first sets `app.plugins.plugins['atlas-vtt'] = { api: new FakeAtlas() }` before `start()`;
- the last sets `api = { version: 1 }` and asserts no start.

`fakeWorkspaceApp()` gives `workspace.on(name, cb)` (records callbacks), `workspace.offref`, `onLayoutReady(cb)` (calls it) and `fire(name, ...args)`. `fakeConnectPlugin(app)` has `manifest.id = 'atlas-vtt-connect'`, `register`, `registerEvent(ref)` and `app`.

`tests/unit/connect/capabilities.test.ts`:
```ts
it('need() returns the namespace only when the capability has landed', () => {
  const atlas = new FakeAtlas({ capabilities: [] });
  const extension = atlas.connect(plugin('atlas-vtt-connect'));
  expect(need(atlas, extension, 'views')).toBeNull();
});
```
Run all three test files. Expected: FAIL.

- [ ] **Step 4: Implement**

`src/connect/obsidianAugment.d.ts`:
```ts
import 'obsidian';

declare module 'obsidian' {
  interface App {
    /** Obsidian's plugin registry; not in the public typings. Read only to find Atlas's API. */
    plugins: { plugins: Record<string, { api?: unknown } | undefined> };
  }
}
```

`src/connect/atlasLink.ts`:
```ts
import { Notice, type Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';

const SUPPORTED_MAJOR = 1;

function isAtlasApi(value: unknown): value is AtlasApi {
  const api = value as Partial<AtlasApi> | null;
  return typeof api === 'object' && api !== null && typeof api.version === 'string'
    && typeof api.has === 'function' && typeof api.connect === 'function';
}

/** Finds Atlas's extension API whichever plugin loads first, and follows Atlas reloading (spec principle 2). */
export class AtlasLink {
  private extension: AtlasExtension | null = null;
  private stop: Disposer | null = null;
  private warned = false;

  constructor(
    private readonly plugin: Plugin,
    private readonly startWith: (atlas: AtlasExtension, api: AtlasApi) => Disposer,
    private readonly notify: (message: string) => void = (message) => new Notice(message),
  ) {}

  get connected(): AtlasExtension | null {
    return this.extension;
  }

  start(): void {
    const { workspace } = this.plugin.app;
    this.plugin.registerEvent(workspace.on('atlas-vtt:api-ready' as never, (api: unknown) => this.attach(api)));
    this.plugin.registerEvent(workspace.on('atlas-vtt:api-unload' as never, () => this.detach()));
    this.plugin.register(() => this.detach());
    this.attach(this.plugin.app.plugins?.plugins['atlas-vtt']?.api);
    workspace.onLayoutReady(() => {
      if (!this.extension && !this.warned) {
        this.warned = true;
        this.notify('Atlas VTT Connect needs Atlas VTT. Install or enable it, then reload.');
      }
    });
  }

  private attach(value: unknown): void {
    if (!isAtlasApi(value)) return;
    const major = Number(value.version.split('.')[0]);
    if (major !== SUPPORTED_MAJOR) {
      if (!this.warned) this.notify(`Atlas VTT Connect needs Atlas VTT with extension API ${SUPPORTED_MAJOR}.x (found ${value.version}).`);
      this.warned = true;
      return;
    }
    this.detach();
    this.extension = value.connect(this.plugin);
    this.stop = this.startWith(this.extension, value);
  }

  private detach(): void {
    const stop = this.stop;
    this.stop = null;
    this.extension = null;
    stop?.();
  }
}
```
If `workspace.on` with a custom event name needs a typed overload, declare `on(name: 'atlas-vtt:api-ready', cb: (api: unknown) => unknown): EventRef` and the same for `'atlas-vtt:api-unload'` in `obsidianAugment.d.ts`, and drop the `as never` casts.

`src/connect/capabilities.ts`:
```ts
import type { AtlasApi, AtlasCapability, AtlasExtension } from '@atlas-vtt/api-types';

/** The namespace each capability brings; filled in as the API grows (decision D2). */
export interface NeedMap {}

/** The namespace for `capability` when this Atlas has it; null on an older Atlas. */
export function need<K extends keyof NeedMap & AtlasCapability>(api: AtlasApi, atlas: AtlasExtension, capability: K): NeedMap[K] | null {
  if (!api.has(capability)) return null;
  const namespace = (atlas as unknown as Record<string, unknown>)[capability === 'remote-view' ? 'remoteViews' : capability];
  return (namespace ?? null) as NeedMap[K] | null;
}
```
`NeedMap` gains one entry per synced namespace, for example `views: AtlasExtension['views']` in B5. While it is empty, the test passes `'views' as never`. B5 removes that cast.

`src/connect/startConnect.ts`:
```ts
import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';

/** Starts every Connect feature this Atlas supports; the returned disposer stops them all (Atlas unloaded or Connect unloading). */
export function startConnect(plugin: Plugin, atlas: AtlasExtension, api: AtlasApi): Disposer {
  const stops: Disposer[] = [];
  void plugin; void atlas; void api;
  return () => { for (const stop of stops.splice(0).reverse()) stop(); };
}
```
The `void` line goes once the first feature uses these parameters (B5).

`main.ts` adds, after the setting tab:
```ts
    new AtlasLink(this, (atlas, api) => startConnect(this, atlas, api)).start();
```
Delete `src/app/online/diceTypes.ts` and repoint its imports to `@atlas-vtt/api-types` and `@atlas-vtt/shared/rules`.

CI gains `- run: npm run check:vendor` before `npx tsc`.

- [ ] **Step 5:** Run the Connect verify block, now including `check:vendor`. Expected: PASS.
- [ ] **Step 6:** Commit:
```bash
git add scripts/sync-atlas.mjs scripts/check-vendor.mjs .gitattributes vendor/atlas src/connect main.ts tests/fake tests/unit/connect .github/workflows/ci.yml src/app/online
git commit -m "feat: vendored Atlas API types and shared modules; AtlasLink and FakeAtlas" -m "Vendor: Atlas api-pr-3-end (API 1.0.0)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

### Task B4: Scene protocol and projection (the pure parts), assets, and `PlayerSession`

The vendor stays at `api-pr-3-end`: its shared modules and record types are all this task needs.

**Files:**
- Port into `src/app/online/`:
  - `scene/**` except these:
    - `darknessRaster.ts` and `exploredImage.ts` (moved to Atlas, A20);
    - `LiveLighting.ts` (B8);
    - `SceneBroadcaster.ts`, `sceneSources.ts`, `CameraSender.ts` and `PlayerChannels.ts` (B5);
    - `AssetRegistry.ts` (B5).
  - `coverage.ts`
  - `assets/**` except `vaultImageFiles.ts` (B5)
  - `preview/**`
  - `PlayerSession.ts`. Split it (301 lines): `playerSessionScene.ts` takes the scene and camera message handling.
  - `tools/toolMessages.ts`, `tools/laserColors.ts`, `tools/LaserBatcher.ts`
  - `control/ControlLists.ts`, `control/TokenControl.ts`
- Split `sceneTypes.ts` (321 lines) into `sceneTypes.ts` (records) and `sceneLimits.ts` (`SCENE_LIMITS` and the defaults).
- Modify `projectForPlayers.ts`: replace `formationGridFromOptions` with a local `snapGridOfState`:
```ts
/** The grid a player's drag snaps to, as the GM's check of the drop does (`tokens.snapPoint`); null where nothing snaps. */
export function snapGridOfState(grid: GridState | null): PlayerSnapGrid | null {
  if (!grid || !(grid.snapToGrid ?? true) || !(grid.size > 0)) return null;
  return { type: grid.type ?? 'square', size: grid.size, offsetX: grid.offsetX ?? 0, offsetY: grid.offsetY ?? 0 };
}
```
- Modify `fogRaster.ts` to import `insideSpans` from `@atlas-vtt/shared/draw`. That export lands in A20; until then keep the fork's local `insideSpans`, and B8 removes it.
- Test: port the matching `$FORK:tests/unit/online/*.test.ts` files. That is every test whose subject is a ported file:
  - `coverage`, `coverageGuard`, `fogCoverage`, `darknessFog`, `darknessFogCost`
  - `projectForPlayers`, `projectParts`, `projectResources`
  - `sceneDiff`, `sceneProtocol`, `sceneCamera`, `scenePreview`
  - `playerSceneMirror`, `playerSession*`
  - `asset*` (except `assetRegistry`, `assetServer` and `assetStreamingEndToEnd`)
  - `transferAssembler`, `joinSession`, `toolMessages`, `laserBatcher`, `laserColors`, `controlLists`, `tokenControl`
  - `hiddenGridSnap`, `largeTokenSnap`, `initiativeSides`

  Also port the fixtures `sceneFixtures.ts`, `assetFixtures.ts`, `cameraFixtures.ts`, `toolsFixtures.ts` and `tokenMoveFixtures.ts`.

**Interfaces:**
- Produces:
  - `projectForPlayers(snapshot: ProjectionInput, context: ProjectionContext, memo): PlayerScene`. `ProjectionInput` is the subset of `SceneSnapshot` it reads: `grid`, `objects`, `widgets`, `initiative`, `initiativeTrackerOpen`, `mapPath`. The fork's `ViewAtlasState` field names are renamed:
    - `state.widgetSettings` becomes `snapshot.widgets.settings`;
    - `state.widgetValues` becomes `snapshot.widgets.values`;
    - `state.objects.fog` keeps its record shape.
  - `coverage.ts` tables stay `Record<keyof TokenEntity, Coverage>` over the vendored `TokenEntity`. That is the "new data private by default" guard from spec §5.

- [ ] **Step 1:** Port the tests and rewrite their imports by Appendix C. Their fixtures that build `ViewAtlasState` become `SceneSnapshot`-shaped fixtures in `sceneFixtures.ts` (`snapshotOf(partial)`). Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port the sources and rewrite their imports by Appendix C. `git grep -nE "from '\.\./\.\./(services|storeFactory|grid|pixi|tools|types|resources|gameSystems|initiative|encounters|vision)" -- src/app/online` must print nothing.
- [ ] **Step 3:** Run the tests. Expected: PASS, with assertions unchanged. A test that needs a changed expectation is a review flag: explain why in the report.
- [ ] **Step 4:** Run the verify block, then commit with the message `feat: scene projection, asset streaming and the player session (pure parts)`.

### Task B5: The people book and Connect's data files in Atlas's storage

Re-sync the vendor at `api-pr-4-end` (A11) first.

**Files:**
- Port into `src/app/online/sharing/`:
  - `dataFile.ts`, rewritten: no `SHARING_DATA_DIR` constant
  - `people/{PeopleBook, IdentityDesk, hostIdentity, peopleNames, peopleTypes, placeholderTypes, sessionPeople}.ts`
- Create:
  - `src/app/online/sharing/sharingPaths.ts`
  - `src/connect/connectStorage.ts`
- Modify:
  - `src/connect/capabilities.ts`, adding `NeedMap` entries for `views`, `rules`, `settings` and `storage`
  - `tests/fake/FakeAtlas.ts`, adding `storage` and `settings`
  - `tests/fake/fakeAtlas.contract.test.ts`, adding `C-storage-1` and `C-settings-1`, plus `ATLAS_ONLY` entries for the `C-views-*` and `C-rules-*` cases. B6 tests those; until then they are listed with the reason "tested in B6", and B6 removes the entries.
- Test: port `dataFile.test.ts`, `peopleBook.test.ts`, `identityDesk.test.ts`, `sessionPeople.test.ts` and `peoplePlaceholders.test.ts` from `$FORK:tests/unit/online/sharing/`, plus `onlineJoinIdentity.test.ts` if it only needs these modules.

**Interfaces:**
- Produces:
  - `interface SharingPaths { root: string; people: string; items: string; pulled: string; history: string }`
  - `sharingPaths(storageFolder: string): SharingPaths`. With `storageFolder` = `atlas-vtt/.atlas-data/extensions/atlas-vtt-connect`, `root` is `<storageFolder>/sharing`, `people` is `<root>/people.json`, `items` is `<root>/items.json`, `pulled` is `<root>/pulled.json`, and `history` is `<root>/history`.
  - `PeopleBook.forApp(app, paths: SharingPaths)` and the same for `ShareItems` and `PulledItems` later. The constants become fields of `paths`.
  - `connectStorage(atlas): Promise<SharingPaths | null>`, which returns null when there is no `storage` capability.
- The ruling "JsonDataFile copies an unreadable file to `<name>.broken.json` once before its first save" is kept, with its test.

- [ ] **Step 1:** Port the tests. Wherever they used the `SHARING_DATA_DIR` paths, construct `sharingPaths('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect')`. Add the contract cases to the fake test:
```ts
it('C-storage-1: folder() is the extension folder and is stable', async () => {
  const atlas = new FakeAtlas({ capabilities: ['storage'] });
  const extension = atlas.connect(plugin('atlas-vtt-connect'));
  expect(await extension.storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
  expect(await extension.storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
});
it('C-settings-1: playerView has the four rules and settings-changed names the key', () => {
  const atlas = new FakeAtlas({ capabilities: ['settings'] });
  const extension = atlas.connect(plugin('atlas-vtt-connect'));
  expect(Object.keys(extension.settings.get('playerView')).sort()).toEqual(['showGrid', 'showInitiative', 'showTokenNameplates', 'showWidgets']);
  const keys: string[] = [];
  extension.on('settings-changed', (key) => keys.push(key));
  atlas.setSetting('laserPointer', { color: '#f00', size: 2 });
  expect(keys).toEqual(['laserPointer']);
});
```
Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement and port. `FakeAtlas` gets `setSetting(key, value)`, and its extension carries `storage` and `settings` objects implementing the vendored interfaces.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4:** Commit with the message `feat: people book and sharing data in Atlas's extension folder`, with the body `Vendor: api-pr-4-end (API 1.1.0).`.

### Task B6: Hosting a session: broadcaster, camera, assets, the session service, commands, the status bar and the presentation target

Re-sync the vendor at `api-pr-5-end` (A14) first.

**Files:**
- Create `src/app/online/atlas/presentedSource.ts`, the API adapter that replaces the fork's `PresentedSceneInfo` and `PresentedSceneSource` (rule below).
- Port and rewrite:
  - `scene/SceneBroadcaster.ts`, split into `SceneBroadcaster.ts` and `sceneTicks.ts` (the tick and timer logic), each at most 300 lines
  - `scene/sceneSources.ts`, `scene/CameraSender.ts`, `scene/PlayerChannels.ts`, `scene/AssetRegistry.ts`
  - `assets/vaultImageFiles.ts`
  - `OnlineSessionService.ts`, split into `OnlineSessionService.ts` and `hostedSession.ts` (the `host()` body)
  - `onlineSessionStore.ts`, `registerOnline.ts`
  - `ui/OnlineSessionModal.ts`, `ui/openOnlineSession.ts`, `ui/joinRequestNotice.ts`, `ui/confirmNotice.ts`, `ui/onlineCopy.ts`, `ui/presentedSceneSummary.ts`, `ui/online-session.scss`
  - `control/deletedTokens.ts`
- Create `src/app/online/atlas/sessionDeps.ts`, the API-backed defaults for the `Deps` of `OnlineSessionService`.
- Modify:
  - `src/connect/startConnect.ts`, which starts hosting support when `views`, `presentation`, `rules`, `settings` and `storage` are all present
  - `tests/fake/FakeAtlas.ts`, adding `views`, `presentation` and `rules`
  - the contract test, adding `C-views-*`, `C-rules-*` and `C-pres-1`, with `C-pres-2` as `ATLAS_ONLY` ("the eye is Atlas UI")
- Test:
  - port `sceneBroadcaster.test.ts`, `cameraSender.test.ts`, `assetRegistry.test.ts`, `assetServer.test.ts`, `assetStreamingEndToEnd.test.ts`, `sceneSyncEndToEnd.test.ts`, `onlineSessionService.test.ts`, `onlineUi.test.ts`, `openOnlineSession.test.ts` and `presentedSceneSummary.test.ts`, plus `sharing/onlineSessionIdentity.test.ts`
  - new: `tests/unit/connect/hostingService.test.ts`

**Interfaces:**
- Produces, in `src/app/online/atlas/presentedSource.ts`:
```ts
import type { AtlasExtension, Disposer, PresentedSceneInfo, SceneSnapshot, ViewCamera } from '@atlas-vtt/api-types';

/** The presented scene as online play reads it: everything through the API, nothing of Atlas's store. */
export interface LiveScene {
  readonly info: PresentedSceneInfo;
  snapshot(): SceneSnapshot | null;
  subscribe(listener: (snapshot: SceneSnapshot) => void): Disposer;
  camera(): ViewCamera | null;
  watchCamera(listener: () => void): Disposer;
}
export interface PresentedSceneListener {
  presented?(scene: LiveScene, resumed: boolean): void;
  held?(scene: LiveScene): void;
  cleared?(previous: LiveScene): void;
}
export interface PresentedSceneSource {
  current(): LiveScene | null;
  isHeld(): boolean;
  subscribe(listener: PresentedSceneListener): Disposer;
}
export function presentedSource(atlas: Pick<AtlasExtension, 'presentation' | 'views'>): PresentedSceneSource {
  const live = (info: PresentedSceneInfo): LiveScene => ({
    info,
    snapshot: () => atlas.views.snapshot(info.viewId),
    subscribe: (listener) => atlas.views.subscribe(info.viewId, listener),
    camera: () => atlas.views.camera(info.viewId),
    watchCamera: (listener) => atlas.views.watchCamera(info.viewId, () => listener()),
  });
  return {
    current: () => { const info = atlas.presentation.current(); return info ? live(info) : null; },
    isHeld: () => atlas.presentation.current()?.held === true,
    subscribe: (listener) => atlas.presentation.subscribe({
      presented: (info, resumed) => listener.presented?.(live(info), resumed),
      held: (info) => listener.held?.(live(info)),
      cleared: (info) => listener.cleared?.(live(info)),
    }),
  };
}
```
- The rewrite rule for every ported consumer:
  - `scene.store.getState()` becomes `scene.snapshot()`, and a `null` snapshot counts as "not loaded".
  - `scene.store.subscribe` becomes `scene.subscribe`.
  - `scene.mapSize()` becomes `scene.snapshot()?.mapSize`.
  - `scene.view` identity becomes `scene.info.viewId`.
  - The fork's `sliceOf(state)` becomes a slice of snapshot fields: `snapshot.background`, `grid`, `objects`, `widgets.settings`, `widgets.values`, `initiative`, `initiativeTrackerOpen` and `lighting`. Change detection by reference still holds, because the API passes the store's frozen objects (spec principle 5).
  - The explored memory and lighting inputs that `LIGHTING_SLICE_FIELDS` read are no longer in the slice. B9 uses `lighting.watch`.
- `sessionDeps(atlas, settings)` returns:
  - `presented: presentedSource(atlas)`
  - `collectionGrid: (p) => atlas.rules.forMap(p).gridDefaults`
  - `coneAngle: (p) => atlas.rules.forMap(p).measurement.coneAngle`
  - `resources: (p) => atlas.rules.forMap(p).resources`
  - `initiativeRules: (p) => atlas.rules.forMap(p).initiative`
  - `watchResources: (cb) => atlas.on('rules-changed', () => cb())`
  - `diceRules: (p) => atlas.rules.forMap(p).dice`
  - `playerViewSettings`, an object `{ getLocalPlayerViewSettings: () => atlas.settings.get('playerView'), onChange: (cb) => atlas.on('settings-changed', (key) => { if (key === 'playerView') cb(); }) }`
  - `gmLaserColor: () => atlas.settings.get('laserPointer').color`
- `diceFeed` and `laser` stay absent until B7. With them absent, the dice and laser hosts are not started; make that the explicit behaviour in `hostedSession.ts`.
- While a session is hosted, Connect holds `atlas.presentation.addTarget({ id: 'atlas-vtt-connect', label: 'online players', isActive: () => true })`. It adds the target on hosting and disposes it on stop, so Atlas's eye presents to online players during a session and opens the player window otherwise.
- Commands (`registerOnline`): "Start online session", "Stop online session", "Online session…" (opens `OnlineSessionModal`), "Present to players" and "Stop presenting". The last two go through `atlas.presentation`. The status bar item shows the hosting status.
- On Atlas unload (the disposer from `startConnect`), Connect calls `OnlineSessionService.stop()`, removes the status bar item and leaves no timers running.

- [ ] **Step 1:** Port the tests and rewrite their fixtures to `FakeAtlas`:
  - `presented` comes from `presentedSource(fake)`;
  - scenes are snapshots set with `fake.views.setSnapshot(viewId, snapshot)`;
  - `fake.presentation.present(viewId, tabId)` drives the held, resumed and cleared listeners exactly as `C-pres-1` describes.

  Write `hostingService.test.ts`:
```ts
it('hosts the presented scene for players and stops when Atlas unloads', async () => {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage'] });
  const extension = atlas.connect(plugin('atlas-vtt-connect'));
  const host = memoryHost();                       // MemoryTransport host from transport/MemoryTransport
  const service = new OnlineSessionService(fakeApp(), memorySettings(), { ...sessionDeps(extension, memorySettings()), createHost: async () => host.transport, table: async () => null });
  await service.start();
  expect(onlineSessionStore.getState().status).toBe('hosting');
  const player = await host.join('Ana');           // admits through the same path the ported gmSession tests use
  atlas.views.setSnapshot('v1', snapshotOf({ tokens: { a: tokenFixture('a') } }));
  await atlas.presentation.present('v1', 't1');
  await vi.advanceTimersByTimeAsync(60);
  expect(player.received.some((m) => m.type === 'scene-snapshot')).toBe(true);
  atlas.unload();                                   // startConnect's disposer runs service.stop()
  expect(onlineSessionStore.getState().status).toBe('idle');
});
it('holds a presentation target only while hosting', async () => {
  // start → atlas.presentation.targets has 'atlas-vtt-connect'; stop → it is gone
});
```
  Write the second case in full against `FakeAtlas.presentation.targets`. Use the helpers the ported `onlineSessionService.test.ts` already has for `memoryHost`/`join`, and name them as that file does.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port, rewrite and split. `git grep -nE "PresentedSceneInfo\b.*services|storeFactory|ViewAtlasState" -- src/app/online` must print nothing.
- [ ] **Step 3:** Run the verify block. Expected: PASS. Every ported assertion is unchanged, except fixture construction and the slice field names.
- [ ] **Step 4: Manual smoke test (record it in the report).**
  1. Build Atlas at `api-pr-5-end` with `npm run build:ci` in `$ATLAS`, and build Connect with `npm run build`.
  2. Install both by hand into a **test** vault.
  3. Open a map and start an online session.
  4. Open the join link (any page URL works for this check; B8 brings the real page).
  5. Check that Atlas's scene tab eye says "Present to online players".
  6. Disable Atlas in Settings → Community plugins. The session stops and the status bar item goes.
- [ ] **Step 5:** Commit with the message `feat: host online sessions on top of the Atlas API`, with the body `Vendor: api-pr-5-end (API 1.2.0).`.

### Task B7: Dice and laser relays

Re-sync the vendor at `api-pr-7-end` (A18) first.

**Files:**
- Port and rewrite: `tools/DiceHost.ts` and `tools/LaserRelay.ts`.
- Delete from the port list `diceFeed.ts`, which is replaced by `atlas.dice` (Appendix B).
- Modify:
  - `src/app/online/atlas/sessionDeps.ts`:
    - `diceFeed: { subscribe: (cb) => atlas.dice.onRolled(cb), publish: (r) => atlas.dice.publish(r) }`;
    - DiceHost rolls through `atlas.dice.roll({ formula: diceFormula(dice, modifier), mapPath, rolledBy: player.name })` instead of `rollFormula`, so the collection rules are applied by Atlas (spec principle 8);
    - `laser: { onLocal: (viewId, cb) => atlas.lasers.onLocal(viewId, cb), show: (viewId, l) => atlas.lasers.show(viewId, l) }`.
  - `LaserRelay` takes the presented `viewId` from `scene.info.viewId`.
  - `tests/fake/FakeAtlas.ts` gets `dice` (`roll` with a seeded random, `onRolled`, `publish`) and `lasers`. The contract test gets `C-dice-1`, `C-dice-2`, `C-laser-1` and `C-laser-2`. `C-laser-2` is `ATLAS_ONLY` ("fading is drawn by Atlas").
- Test: port `diceHost.test.ts`, `laserRelay.test.ts`, `playerTools.test.ts`, `playerToolsEndToEnd.test.ts` and `toolMessages.test.ts`, the last only if it was not done in B4.

**Interfaces:**
- Consumes: `atlas.dice` and `atlas.lasers`, both API 1.3+ / 1.4+.
- Produces: `DiceHost` options `{ session; presented; projection; roll(request: DiceRollRequest): DiceRollResult; feed: DiceFeed }`. `roll` replaces the fork's `diceRules` plus `random`. Its tests pass a `FakeAtlas` dice roll with a seeded random.
- The ruling that the GM sees `"GM (player)"` for a player named like the GM stays, with its test.

- [ ] **Step 1:** Port the tests and swap in the FakeAtlas-backed deps. Run them. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4:** Commit with the message `feat: players' dice through Atlas's rules and lasers through the API`, with the body `Vendor: api-pr-7-end (API 1.4.0).`.

### Task B8: The web join page and its Pages workflow

The vendor is the one B7 synced at `api-pr-7-end`, which includes `remoteLasers` and `dice3d`.

**Files:**
- Port: `online-client/**` (19 files), `src/app/online/page/**`, `src/app/online/view/**` and `src/app/online/preview/**` if B4 did not port it.
- Move `online-client/canvasSurface.mts` to `src/app/online/view/canvasSurface.ts`, with `online-client` importing it. The Obsidian fallback tab (B12) uses it too.
- Create:
  - `vite.page.config.mts`
  - `.github/workflows/pages.yml`
- Modify:
  - `.github/workflows/ci.yml`, adding `npm run build:page`
  - `online-client/dice3d/obsidianShim.mts`, kept as it is (the page installs `activeDocument` and `createEl`)
- Test: port `canvasSurface.test.ts`, `mapView.test.ts`, `pageScreen.test.ts`, `pageToolbar.test.ts`, `playerToolbar.test.ts`, `playerToolsPage.test.ts`, `playerViewRenderer.test.ts`, `tokensLayer.test.ts`, `toolsLayer.test.ts`, `fogLayer.test.ts`, `tokenHit.test.ts`, `tokenMoves.test.ts`, `tokenMovesPage.test.ts`, `viewInput.test.ts`, `cameraController.test.ts`, `dragRulerTool.test.ts`, `diceTray.test.ts`, `diceTrayView.test.ts`, `diceLogView.test.ts`, `diceLogModel.test.ts`, `ownRollThrows.test.ts`, `throwPanel.test.ts`, `throwPlan.test.ts`, `diceThrowsStages.test.ts`, `diceChunkGlobals.test.ts`, `obsidianShim.test.ts`, `mapIconPaths.test.ts`, `toolIcons.test.tsx`, `assetStatus.test.ts` and `recordingSurface.ts`. Also add the `gridLayer` case of the fork's `tests/unit/sharedLayout.test.ts`, the one A1 dropped, as `tests/unit/online/gridLayerCellNumbers.test.ts`.

**Interfaces:**
- Produces:
  - `npm run build:page`, which writes `dist-page/` (the page's script plus the lazy dice chunk, which loads three.js on the first thrown roll)
  - the Pages site at `https://evoljoaobento.github.io/atlas-vtt-connect/`
- `vite.page.config.mts`:
```ts
import { defineConfig } from 'vite';
import { atlasAliases } from './vite/atlasAliases.mts';

/** The web page players open to join an online session; deployed to GitHub Pages (pages.yml). */
export default defineConfig({
  root: 'online-client',
  base: './',
  resolve: { alias: atlasAliases },
  build: {
    outDir: '../dist-page',
    emptyOutDir: true,
    // The 3D dice chunk (three.js and Atlas's dice) loads only with the player's first thrown roll.
    chunkSizeWarningLimit: 700,
  },
});
```
- `.github/workflows/pages.yml`:
```yaml
name: Publish the player page
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: ['online-client/**', 'src/app/online/page/**', 'src/app/online/view/**', 'src/app/online/preview/**', 'vendor/atlas/**', 'vite.page.config.mts']
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run check:vendor
      - run: npm run build:page
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist-page }
      - id: deployment
        uses: actions/deploy-pages@v4
```
  The user enables Pages with source "GitHub Actions" in the repository settings once, after the first push. B17's README lists this.

- [ ] **Step 1:** Port the tests and rewrite their imports (Appendix C). The page's Atlas imports all become `@atlas-vtt/shared/*` or `@atlas-vtt/api-types`. Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port the sources. `git grep -nE "from '(\.\./)+(src/app/)?(grid|pixi|tools|dice3d|react|gameSystems|resources|initiative|styles|utils/hexColor)" -- online-client src/app/online/page src/app/online/view` must print nothing. `diceTrayPool` and `toolbarFit` come from the shared package and the copied helper respectively.
- [ ] **Step 3:** `npm run build:page`. Expected: `dist-page/index.html` exists, and `grep -l "obsidian" dist-page/assets/*.js` prints nothing.
- [ ] **Step 4:** Run the verify block and `npm run build:page`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat: the web join page, built from Atlas's shared modules, with its Pages workflow`.

### Task B9: Players' darkness from `lighting.playerVisibility`

Re-sync the vendor at `api-pr-8-end` (A21) first.

**Files:**
- Create `src/app/online/scene/LiveLighting.ts`, rewritten. It turns `PlayerVisibility` into the fork's `LightingFrame`:
  - `unlit` becomes `null`, meaning the projection is the unlit one;
  - `pending` becomes `closedFrame(map)`, which shows nothing;
  - `ready` becomes `lightingFrame` with `seen = (id) => tokens[id] === 'seen'` and the darkness `darknessOf({ cols, rows, cellSize, map, dark: invert(shown) })`.

  It keeps no raster code: `darknessRaster` and `exploredImage` are Atlas's now.
- Modify:
  - `src/app/online/scene/fogRaster.ts`: delete the local `insideSpans` and import it from `@atlas-vtt/shared/draw`.
  - `SceneBroadcaster.ts`: `LiveLighting` is constructed with `(atlas.lighting, viewId, onDue)`, and `onDue` comes from `atlas.lighting.watch(viewId, …)`.
  - `sessionDeps.ts`.
  - `tests/fake/FakeAtlas.ts`: `lighting`, set per view with `setVisibility(viewId, v)`, and `watch`.
  - The contract test: `C-light-1`, `C-light-2` and `C-light-3`.
- Test:
  - port `liveLighting.test.ts` (the cases left after A20 took the timing ones), `lightingCoverage.test.ts`, `lightingProjection.test.ts` and `lightingFixtures.ts`, rewritten to feed `PlayerVisibility` values;
  - new: `tests/unit/online/darknessProjection.test.ts`.

**Interfaces:**
- Produces: `new LiveLighting(lighting: Pick<LightingApi, 'playerVisibility' | 'watch'>, viewId: string, onDue: () => void)`, with `frame(map: MapSize): LightingFrame | null`, `restart()` and `dispose()`.
- Fail closed: without the `lighting` capability (an older Atlas), a presented scene whose `snapshot.lighting.enabled` is true is projected with `closedFrame`, and the GM sees the notice "Update Atlas VTT to show lit scenes to online players." once per scene. Ruling L4 holds: unknown means dark.

- [ ] **Step 1:** Write `darknessProjection.test.ts`:
```ts
it('pending sends no tokens and full darkness', () => {
  const frame = new LiveLighting(fakeLighting({ status: 'pending' }), 'v1', () => undefined).frame({ width: 700, height: 700 });
  expect(frame!.seen('a')).toBe(false);
  expect(frame!.darkness.covered.length).toBeGreaterThan(0);
});
it('unlit projects as without lighting', () => {
  expect(new LiveLighting(fakeLighting({ status: 'unlit' }), 'v1', () => undefined).frame({ width: 700, height: 700 })).toBeNull();
});
it('ready shows the tokens players see and hides the cells the window hides', () => {
  const shown = new Uint8Array([1, 0, 0, 1]);
  const frame = new LiveLighting(fakeLighting({ status: 'ready', tokens: { a: 'seen', b: 'sensed' }, darkness: { cellSize: 350, cols: 2, rows: 2, shown }, showsExplored: false }), 'v1', () => undefined).frame({ width: 700, height: 700 })!;
  expect(frame.seen('a')).toBe(true);
  expect(frame.seen('b')).toBe(false);
  expect(frame.darkness.covered).toHaveLength(2);
});
it('without the lighting capability a lit scene is dark for players', () => {
  // SceneBroadcaster with a FakeAtlas lacking 'lighting' and snapshot.lighting.enabled = true → tokens hidden, notice once
});
```
  `fakeLighting(v)` returns `{ playerVisibility: () => v, watch: () => () => undefined }`. Write the fourth case in full with the B6 broadcaster harness, asserting that the projected token list is empty and that the notice was shown once. Run the tests. Expected: FAIL.
- [ ] **Step 2:** Implement. `grep -rn "senseRules\|lightLevels\|vision/" src/app/online` must print nothing.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4: Manual check (record it in the report).** Use a lit map with token vision, and test GPU on and `--disable-gpu`. Players see only what the player window shows. Pull the GPU context: Atlas's devtools `WEBGL_lose_context` makes players see darkness until sight returns. Ruling L5's list applies.
- [ ] **Step 5:** Commit with the message `feat: players' darkness from Atlas's playerVisibility, failing closed`, with the body `Vendor: api-pr-8-end (API 1.5.0).`.

### Task B10: Token control and players' moves through `tokens.move`

Re-sync the vendor at `api-pr-9-end` (A22) first.

**Files:**
- Port and rewrite:
  - `control/TokenControlHost.ts`
  - `control/TokenMoveHandler.ts`. It keeps its checks (control list, `sceneId`, held, presence in the projection, rate limit), then calls `atlas.tokens.move(viewId, [{ tokenId, x, y }], { snap: true, clampToMap: true })` with the point clamped to `sceneWorldBounds(scene)` first, as the fork did. `ok: false` sends `token-move-refused`.
- Modify: `hostedSession.ts`, which starts the token control host when `tokens` is present; `tests/fake/FakeAtlas.ts`, adding `tokens`; the contract test, adding `C-tok-1` and `C-tok-2`.
- Test: port `tokenMoveHandler.test.ts`, `tokenMovesEndToEnd.test.ts` and `tokenControl.test.ts` (if not done in B4). Re-check `hiddenGridSnap.test.ts` and `largeTokenSnap.test.ts`: the parts about GM-side snapping now go through `FakeAtlas.tokens`, whose `snapPoint` mirrors `C-tok-2`.

**Interfaces:**
- Produces: `TokenMoveHandler` options `{ session; presented; projection; control; tokens: Pick<TokensApi, 'move'> }`.
- Without the `tokens` capability, players get `token-control` lists that are always empty, so nobody can drag. The GM panel shows "Update Atlas VTT to let players move tokens." The control list itself is not sent until moves can land.

- [ ] **Step 1:** Port the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite. `grep -rn "runHistoryTransaction\|snapDroppedToken" src` must print nothing.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4:** Commit with the message `feat: players move their tokens through tokens.move (one GM undo step)`, with the body `Vendor: api-pr-9-end (API 1.6.0).`.

### Task B11: The GM's UI in Atlas: online panel, toolbar item, palette section, view menu and "Controlled by"

Re-sync the vendor at `api-pr-10-end` (A25) first.

**Files:**
- Port into `src/app/online/gm-ui/`, from `$FORK:src/app/react/components/online/`:
  - `OnlinePanel.tsx`, `OnlinePlayerList.tsx`, `OnlinePresenting.tsx`, `useOnlineState.ts`
  - `online-panel.scss`, `_online-marks.scss`, `online-toolbar-marks.scss`
- Create:
  - `src/app/online/gm-ui/registerGmUi.ts`
  - `src/app/online/gm-ui/onlinePalette.ts`, rewritten from `onlineCommands.tsx` as a `PaletteSection`
  - `src/app/online/gm-ui/onlineToolbar.ts`, rewritten from `onlineToolbarItem.tsx` as a `ToolbarItem`
  - `src/app/online/gm-ui/controlledByMenu.ts`, rewritten from `ui/controlledByMenu.ts` as a token menu provider. It has no `ContextMenuContext` import.
- Modify:
  - `src/connect/startConnect.ts`, which calls `registerGmUi` when `ui` is present
  - `styles/main.scss`, which imports the stylesheets
  - `tests/fake/FakeAtlas.ts`, adding `ui`, which records the registrations
  - the contract test, adding `C-ui-1`, `C-ui-2` and `C-ui-3`
- Test:
  - port `tests/unit/onlinePanel.test.tsx`, `onlineToolbarItem.test.tsx` and `commandPalette.online.test.tsx` from `$FORK:tests/unit/`, plus `controlledByMenu.test.ts` and `controlledByContextMenu.test.ts`. All are rewritten to assert against `FakeAtlas.ui` registrations, not Atlas components.
  - new: `tests/unit/connect/slots.test.ts`

**Interfaces:**
- Consumes: `atlas.ui` (API 1.7).
- Produces: `registerGmUi(atlas, service, settings): Disposer`. It registers:
  - **The toolbar item** `{ id: 'online', icon: 'network', label: 'Online session', priority: 60, isActive: hosting, badge: waiting-player count or null, onClick: panel.toggle(ctx.viewId) }`.
  - **The palette section** "Online play", with the fork's commands.
  - **View menu items:** "Online session…", "Present to players" and "Stop presenting".
  - **Token menu items:** "Controlled by", a submenu of admitted players with `checked`, for `kind === 'character'` tokens and GM views only.
  - **The panel** `{ id: 'online', title: 'Online session', mount }`. `mount` renders `OnlinePanel` into the container with Connect's own React root, and unmounts on dispose.
  - Every change to `onlineSessionStore` calls `atlas.ui.invalidate()`.
- Without `ui`, the commands, the status bar and the modal from B6 remain the way to run a session.

- [ ] **Step 1:** Port the tests and write `slots.test.ts`:
```ts
it('registers the toolbar item, palette section, menus and panel when ui is present, and removes them on Atlas unload', () => {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage', 'ui'] });
  const stop = registerGmUi(atlas.connect(plugin('atlas-vtt-connect')), serviceFixture(), memorySettings());
  expect(atlas.ui.counts()).toEqual({ toolbar: 1, palette: 1, dashboard: 0, viewMenu: 1, tokenMenu: 1, panel: 1 });
  stop();
  expect(atlas.ui.counts()).toEqual({ toolbar: 0, palette: 0, dashboard: 0, viewMenu: 0, tokenMenu: 0, panel: 0 });
});
it('no ui capability, no toolbar item, commands still work', () => {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage'] });
  const stops = startConnectFor(atlas);
  expect(atlas.ui).toBeUndefined();
  expect(registeredCommandIds()).toContain('atlas-vtt-connect:start-online-session');
  stops();
});
it('the token menu offers Controlled by for characters only', () => {
  const provider = controlledByProvider(serviceWithPlayers(['Ana', 'Ben']));
  const base = { viewId: 'v', kind: 'map' as const, isPlayerView: false, tokenId: 't' };
  const items = provider({ ...base, tokenKind: 'character' });
  expect(items.map((item) => item.label)).toEqual(['Controlled by']);
  expect(items[0]!.submenu!.map((item) => item.label)).toEqual(['Ana', 'Ben']);
  expect(provider({ ...base, tokenKind: 'monster' })).toEqual([]);
});
```
  The context field is `tokenKind`, per decision D3 and A24. Use the real `TokenEntity['kind']` values; read them from the vendored rollup.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite. The panel React components use the rebuilt `Button` and `LabelTooltip` (B1).
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4: Manual check.** With Atlas built at `api-pr-10-end` in a test vault, check that the toolbar button, the panel (close button, panel corners), the palette section, the More options entries and "Controlled by" all work.
- [ ] **Step 5:** Commit with the message `feat: the GM runs online play from the map through Atlas's UI slots`, with the body `Vendor: api-pr-10-end (API 1.7.0).`.

### Task B12: Joining from Obsidian: the join service, the join modal, the dashboard tile, and the Canvas 2D scene tab (the fallback)

Uses the vendor at `api-pr-10-end`.

**Files:**
- Port and rewrite into `src/app/online/obsidian/`:
  - `OnlineJoinService.ts`, split into `OnlineJoinService.ts` and `joinFlow.ts`, each at most 300 lines
  - `joinedSessionStore.ts`, `keyPerHost.ts`, `onlineJoinTypes.ts`, `onlineSceneStatus.ts`, `onlineSceneTab.ts`
  - `ui/JoinSessionModal.ts`, `ui/joinSessionTile.ts`
- Create:
  - `src/app/online/obsidian/CanvasSceneView.ts`: an Obsidian `ItemView` of type `atlas-vtt-connect-scene`. It draws the joined session with `view/PlayerViewRenderer` and `view/canvasSurface.ts`, plus the page's tools: token drag, measure, laser and dice tray. They come from `online-client`'s DOM views, which are moved to `src/app/online/page/` by B8 if not already there. It also shows the dice log and an own-roll throw through `@atlas-vtt/shared/dice3d`, using the Obsidian globals Obsidian already provides. It is used when `!api.has('remote-view')`.
  - `src/app/online/obsidian/sceneTabs.ts`: `openSceneTab(app, api, atlas)` chooses the remote view (B15) or `CanvasSceneView`.
  - `styles/online-scene-canvas.scss`
- Modify:
  - `src/connect/startConnect.ts`: the join service exists whenever Connect is loaded. Joining needs no Atlas map, but the tile needs `ui`. The command "Join online session…" is always registered.
  - `main.ts`: register the view type.
  - `tests/fake/FakeAtlas.ts`: `ui.addDashboardTile` is recorded.
- Test:
  - port `onlineJoinService.test.ts`, `joinSessionModal.test.ts`, `dashboardJoinTile.test.tsx`, `onlineSceneStatus.test.ts` (the Connect side), `objectUrlImages.test.ts` and `obsidianPlayerEndToEnd.test.ts`, rewritten to open `CanvasSceneView`, from `$FORK:tests/unit/online/obsidian/`
  - port `sharing/onlineJoinIdentity.test.ts` if B5 did not
  - new: `tests/unit/online/canvasSceneView.test.ts`

**Interfaces:**
- Produces:
  - `OnlineJoinService` with `join(link)`, `leave()`, `forApp(app)`, a `state` store and `controls` (`followGm`, `fitMap`, `reconnect`, `rollDice`), as on the fork.
  - `CanvasSceneView` with `onOpen` (attach to the joined session, or close at once when there is none) and `onClose` (leave the session unless another tab shows it), following the fork's `OnlineSceneView` semantics.
- Hosting while joined is refused, and joining while hosting is refused, with the fork's notices.

- [ ] **Step 1:** Port the tests. Write `canvasSceneView.test.ts`:
  - it draws the joined scene into a canvas with the recording surface from B8's `recordingSurface.ts`;
  - closing the tab leaves the session;
  - a second tab gives way to the first;
  - with no session, the tab closes itself after layout-ready.

  Run the tests. Expected: FAIL.
- [ ] **Step 2:** Port and implement.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4: Manual check.** Use two test vaults, or one vault plus the web page. The GM hosts in vault A. Vault B joins with the link through "Join online session…". The scene shows in Connect's own tab, and drag, measure, laser and dice work.
- [ ] **Step 5:** Commit with the message `feat: join from Obsidian into a Canvas 2D scene tab (works without the remote view)`.

### Task B13: Sharing, the sender side: share transport, the people UI, share rules and parts, the catalogue, map payloads, tags display and commands

Re-sync the vendor at `api-pr-11-end` (A27) first.

**Files:**
- Port into `src/app/online/sharing/`:
  - `transport/**` (9 files)
  - `people/ui/**`
  - `model/**` (24 files) except as noted below
  - `parts/**`, `display/**`, `ui/**`
  - `registerSharing.ts`, `registerShareCommands.ts`, `registerSessionHooks.ts`, `registerAskToPull.ts`
  - `shareSessionStore.ts`, `sharedFromView.ts`, `pathRenames.ts`
- Rewrite:
  - `model/catalogueSources.ts`: `AssetService` becomes `atlas.scenes.list()`, `findByMap()` and `getData()`, and the rules imports become `atlas.rules.forMap(...)`.
  - `model/mapShare.ts` and `model/mapShareRenames.ts`: a share is read with `atlas.scenes.getData(sceneId)` and written with `atlas.scenes.setData(sceneId, share)`. Ruling F-b holds because `setData` re-reads before writing (A27).
  - `model/buildMapPayload.ts`: `MapPersistence` and `sceneLightingOptions` become `atlas.scenes.readMap(mapPath)`. Ruling L2 holds: a player-safe share of a map whose `readMap(...).lighting?.enabled` is true is refused.
  - `registerSharing.ts`: on start, `atlas.bundles.stripNoteProperties(['atlas-share'])`. Its disposer goes with Connect's disposers.
  - Every `SHARING_DATA_DIR` use becomes `SharingPaths` (B5).
- Modify:
  - `src/connect/startConnect.ts`: sharing starts when `scenes` and `bundles` are present. Without them, the share commands are hidden and the settings tab says "Update Atlas VTT to share notes and maps."
  - `styles/main.scss`: imports `sharing.scss` and `share-tags.scss`.
  - `tests/fake/FakeAtlas.ts`: `scenes` (an in-memory record list with `data.extensions`, `readMap` from given maps, and `addToCollection` writing into the fake vault) and `bundles`.
  - The contract test: `C-scenes-1`, where the fake's export strips are checked through a `fake.scenes.exported(sceneId)` helper; `C-scenes-2`, `C-scenes-3` and `C-bundles-1`.
- Test: port every sender-side test from `$FORK:tests/unit/online/sharing/`:
  - `noteFilter`, `noteLinks`, `forwardedParts`, `publicTag`, `sectionTrust`, `shareRule`, `shareRules`, `mapPayload`, `mapShare`, `senderCatalogue`, `shareItems`
  - `shareNode`, `shareProtocol`, `shareRelay`, `gmShareHost`, `transfers`
  - `partEdits`, `partCommands`, `partWarnings`
  - `peopleUi`, `peoplePlaceholdersUi`, `shareWithForm`
  - `display/**`
  - `sharingFixtures.ts`, `obsidianSections.ts`

**Interfaces:**
- Consumes: `atlas.scenes` and `atlas.bundles` (API 1.8), `atlas.rules`, and the session hooks from B6. `OnlineSessionService.useSharingHooks` is called here.
- Every fail-closed ruling in decision D6, items 3–5 and 8–9, ports with its tests. **No assertion may change.** A changed assertion is a privacy regression until review clears it.

- [ ] **Step 1:** Port the tests and rewrite their fixtures: `AssetService` fakes become `FakeAtlas.scenes`, and `MapPersistence` reads become `fake.scenes.setMap(path, map)`. Run them. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite. Then check that `git grep -nE "AssetService|MapPersistence|sceneLightingOptions|SHARING_DATA_DIR" -- src` prints nothing.
- [ ] **Step 3:** Run the verify block. Expected: PASS. Compare the counts: `npx vitest run tests/unit/online/sharing --reporter=json | node -e "…"` gives the number of tests, which must equal the fork's count for the same files. Run the fork's with `npx vitest run --project unit tests/unit/online/sharing/<same files>` in `$ATLAS` with `merge/upstream-beta` checked out **only if** the controller has a spare checkout. Otherwise count `it(` occurrences in both trees with `git grep -c "it(" $FORK -- <files>`.
- [ ] **Step 4:** Commit with the message `feat: note and map sharing (sender side) on the scenes and bundles API`, with the body `Vendor: api-pr-11-end (API 1.8.0).`.

### Task B14: Sharing, the receiver side: Shared with me, pulls, merges and push prompts

Uses the vendor at `api-pr-11-end`.

**Files:**
- Port into `src/app/online/sharing/`: `receive/**` (14 files), `merge/**` (9 files) and `registerReceiving.ts`.
- Rewrite `receive/mapPull.ts`. Its whole write-images, write-map, `addAsset`, clean-up-on-failure transaction becomes one `atlas.scenes.addToCollection({ collection: { name: 'Shared with me' }, name, folder, map, images })`. Delete the local `runExclusive` and trash logic; Atlas owns them now (C-scenes-2). The parked fork item "trash error masks addAsset error" is closed by A27's single transaction.
- Test: port `mapPull.test.ts`, `notePull.test.ts`, `noteUpdate.test.ts`, `diff3.test.ts`, `mergeUi.test.tsx`, `pullCleanup.test.ts`, `pushPrompts.test.ts`, `realPullEndToEnd.test.ts`, `safePaths.test.ts`, `sharedWithMe.test.ts`, `sharedWithMeList.test.tsx`, `sharingEndToEnd.test.ts` and `shareSessionEndToEnd.test.ts`.

**Interfaces:**
- Consumes: `atlas.scenes.addToCollection` and `atlas.scenes.findByMap`.
- Rulings T5-1..3, T6-1..3, F8, F14 and the received-notes protection (D6.9) port with their tests unchanged.

- [ ] **Step 1:** Port the tests over `FakeAtlas.scenes`. Run them. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4: Manual check.** Use two test vaults. The GM shares a note with a private part and a map. The player pulls both; the private part is absent, and the map lands in "Shared with me". The GM edits the note, the player pulls again, and the merge page appears on a conflict.
- [ ] **Step 5:** Commit with the message `feat: receiving shared notes and maps; one atomic scene import through the API`.

### Task B15: The remote view tab, when Atlas has `remote-view`

Re-sync the vendor at `api-pr-12-end` (A31) first.

**Files:**
- Port and rewrite into `src/app/online/obsidian/remote/`:
  - `OnlineSceneClient.ts` → `RemoteSceneClient.ts`, over a `RemoteView` handle in place of the store, viewport, backdrop, initiative panel and laser hub.
  - `playerSceneToAtlasState.ts` → `toRemoteScene.ts`. It produces `RemoteSceneInput` with `tokenImages` and the background URL from `objectUrlImages.ts`.
  - `convertTokens.ts`, `convertShapes.ts`, `convertPanels.ts`, `convertResources.ts`. Together they produce `RemotePlayerState.tokenUi` and `initiative`.
  - `objectUrlImages.ts`. It releases replaced object URLs after `setScene`.
  - `OnlineLaserLink.ts`, over `atlas.lasers.onLocal(remote.viewId)` and `atlas.lasers.show(remote.viewId, …)`.
  - `onlineDice.ts` and `onlineRollRefusal.ts`, over `remote.onRoll`, `setDiceLog` and `throwRoll`.
  - `remoteTokenMoves.ts`, the Connect part: `remote.onTokenDrop` sends `token-move`, and a refusal calls `remote.cancelDrag()` and shows the notice through `setStatus`.
  - `ViewportFollower`'s follow logic, over `remote.setCamera` and `remote.onCameraMoved`: Follow GM turns off on `byUser`.
  - `onlineSceneToolbarItems.tsx` → `remoteToolbar.ts`: "Follow GM" and "Fit map" as `ToolbarItem`s with `views: ['remote']`.
- Modify:
  - `sceneTabs.ts`: `has('remote-view')` opens `atlas.remoteViews.open({ title: 'Online scene', icon: 'network', reuse: true })` and attaches `RemoteSceneClient`. Otherwise it opens `CanvasSceneView` (B12).
  - `tests/fake/FakeAtlas.ts`: `remoteViews`, whose handle records every call. Remove the `as AtlasExtension` cast now that every namespace exists.
  - The contract test: `C-remote-1..5`. `C-remote-3` and `C-remote-5`, which concern rendering, are `ATLAS_ONLY` with reasons.
- Test: port and rewrite these over the recorded handle: `onlineSceneClient.test.ts`, `playerSceneToAtlasState.test.ts` → `toRemoteScene.test.ts`, `convertCoverage.test.ts`, `onlineLaserLink.test.ts`, `onlinePlayerTools.test.ts` (Connect parts), `onlineSceneToolbar.test.tsx` → `remoteToolbar.test.ts`, and `onlineSceneResources.test.ts`/`onlineSceneInitiative.test.ts` (Connect parts: the stand-in definitions sent).

**Interfaces:**
- Consumes: `RemoteViewsApi` and `RemoteView` (API 1.9).
- Produces: `RemoteSceneClient { attach(): boolean; dispose(): void }`.
- `convertCoverage.test.ts` keeps its guard. Every `TokenEntity` field must be decided for the remote view, which is spec §5's "new data private by default" rule, now enforced in Connect.

- [ ] **Step 1:** Port the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Port and rewrite. `grep -rnE "pixi|zustand/vanilla|AtlasView" src/app/online/obsidian` must print nothing: Connect has no PIXI.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4: Manual check.** With Atlas built at `api-pr-12-end`, an Obsidian player joins. The scene shows in Atlas's own remote view, with their dice look, the shared dice log, token drag, Follow GM and Fit map. With the same Connect build on an Atlas from `api-pr-11-end`, the Canvas 2D tab opens instead.
- [ ] **Step 5:** Commit with the message `feat: the Obsidian player sees the scene in Atlas's remote view when available`, with the body `Vendor: api-pr-12-end (API 1.9.0).`.

### Task B16: Migration from the fork

Uses the vendor at `api-pr-12-end`.

**Files:**
- Create: `src/connect/migrateFromFork.ts` and `tests/unit/connect/migrateFromFork.test.ts`.
- Modify: `src/connect/startConnect.ts`, which runs the migration once `storage` is present and before sharing and hosting start; and `PRIVACY.md`, adding the leftover-key note. B17 writes the full file. Here, add only the section text below to a new `PRIVACY.md` that B17 completes.

**Interfaces:**
- Produces: `migrateFromFork(deps: { adapter: DataAdapter; settings: ConnectSettingsStore; storageFolder: string; scenes: Pick<ScenesApi, 'list' | 'getData'> | null; notify(message: string): void }): Promise<MigrationReport>`, with `MigrationReport { settings: 'copied' | 'skipped' | 'none'; sharing: 'moved' | 'merged' | 'none'; mapShares: number }`.
- It runs these steps in order and is idempotent. `settings.markMigrated()` is set only after every step succeeded, so an interrupted run starts again next time.
  1. **Settings.**
     - If Connect's store has no `online` key yet and `atlas-vtt/.atlas-data/settings.json` exists, read it with `adapter.read`. This is a read only: Connect never writes Atlas's file, which Atlas rewrites on a debounce.
     - Copy `resolveOnlineSettings(parsed.online)` into Connect's store.
     - Rewrite `playerPageUrl` to the new default when it equals the fork's old default `https://evoljoaobento.github.io/atlas-vtt/` (with or without the trailing slash). A custom value is kept.
  2. **Sharing folder.**
     - If `atlas-vtt/.atlas-data/sharing/` exists and `<storageFolder>/sharing/` does not, `adapter.rename` the folder.
     - If both exist, copy every file that is missing in the destination, keep the destination's files, and leave the old folder in place with a notice: "Atlas VTT Connect kept its sharing data and left the preview's copy in atlas-vtt/.atlas-data/sharing. Delete it once you've checked your people and shares."
  3. **Map shares.** Atlas A26 moved `data.sharing` into `data.extensions['atlas-vtt-connect']` when it loaded the index, so there is nothing to write. Count the scenes whose `getData` is set, for the report. With `scenes` null (Atlas older than 1.8), skip this step; Atlas cannot have moved the shares, so run the migration again next start, and don't mark it done.
- It shows one notice when anything was migrated: "Atlas VTT Connect brought over your online play settings, people and shares from the preview."

- [ ] **Step 1:** Write the test over the in-memory vault:
```ts
it('copies the online settings once, moving the old default page to the new one and keeping a custom one', async () => {
  const { app } = createInMemoryApp({ files: { 'atlas-vtt/.atlas-data/settings.json': JSON.stringify({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/', playerName: 'GM' } }) } });
  const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
  const report = await migrateFromFork(deps(app, settings));
  expect(report.settings).toBe('copied');
  expect(settings.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
  expect(settings.get().playerName).toBe('GM');
  expect(settings.migratedFromFork).toBe(true);
  expect(await app.vault.adapter.read('atlas-vtt/.atlas-data/settings.json')).toContain('"online"');   // never written
  expect((await migrateFromFork(deps(app, settings))).settings).toBe('skipped');
});
it('moves the sharing folder, or merges into an existing one without overwriting', async () => {
  // case 1: only old → renamed; case 2: both, people.json in both → destination's kept, items.json copied, old left, notice shown
});
it('an interrupted run (rename throws) is not marked done and finishes next time', async () => {
  // adapter.rename rejects once → migratedFromFork false; second run → moved, marked
});
it('keeps a custom player page address', async () => { /* playerPageUrl 'https://my.host/' stays */ });
it('without the scenes capability it waits for a newer Atlas before marking done', async () => { /* scenes: null → not marked */ });
```
Write the four commented cases in full, following the first. Run the test. Expected: FAIL.
- [ ] **Step 2:** Implement, keeping the file under 200 lines. Split the folder merge into `migrateSharingFolder.ts` if it grows.
- [ ] **Step 3:** Run the verify block. Expected: PASS.
- [ ] **Step 4:** Add to `PRIVACY.md`, section "Moving from the online play preview":
```markdown
Atlas VTT Connect copies the preview's online settings, including your table key, from `atlas-vtt/.atlas-data/settings.json` into its own settings. It never edits Atlas's settings file, so the old copy of the key stays there until you remove the `online` entry from that file by hand while Obsidian is closed. Both copies are in your vault; nothing is sent anywhere.
```
- [ ] **Step 5:** Commit with the message `feat: bring over the online preview's settings, people and shares`.

### Task B17: README, privacy, notices, the BRAT release workflow and the final inventory

**Files:**
- Create or complete:
  - `README.md`, `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`
  - `.github/workflows/release.yml`
  - `scripts/test-inventory.mjs`
- Modify: `manifest.json` and `versions.json`, only if the version changes; `package.json`, adding the `inventory` script.

**Interfaces:**
- Produces:
  - **`README.md`** sections:
    - what Connect is, and that it needs Atlas VTT with extension API 1.x;
    - install through BRAT (`evolJoaoBento/atlas-vtt-connect`);
    - hosting and joining;
    - sharing;
    - **Hosts it talks to**: PeerJS cloud signalling (`0.peerjs.com`) unless a custom server is set, `stun.l.google.com:19302`, the player page at `evoljoaobento.github.io/atlas-vtt-connect`, and any TURN servers you add;
    - the default page and how to host your own;
    - **Developing**: `npm ci`; `npm run build` writes `dist/` only; copy `dist/main.js`, `dist/styles.css` and `manifest.json` by hand into a test vault's `.obsidian/plugins/atlas-vtt-connect/`; build Atlas from `api/extension-api` with `npm run build:ci` and copy it the same way; re-vendor with `npm run sync:atlas -- --atlas <dir> --commit <sha>`;
    - enabling Pages ("GitHub Actions" source);
    - the licence.
  - **`PRIVACY.md`**: port `$FORK:PRIVACY.md`'s online play data flows, plus the rulings in decision D6 as plain statements:
    - what players receive and never receive;
    - that the GM sees relayed items in clear;
    - device and table keys;
    - what stays in the vault;
    - the B16 section.
  - **`THIRD_PARTY_NOTICES.md`**:
    - Atlas VTT (AGPL-3.0-only, © Fabian Urbanek): the vendored shared modules and the copied helpers;
    - PeerJS (MIT) and its bundled dependencies, as listed by `$FORK:THIRD_PARTY_NOTICES.md`;
    - three.js (MIT);
    - React and React DOM (MIT);
    - zustand (MIT);
    - lucide-react (ISC);
    - the STUN host note.
  - **`.github/workflows/release.yml`**, BRAT-friendly:
```yaml
name: Release
on:
  push:
    tags: ['[0-9]+.[0-9]+.[0-9]+', '[0-9]+.[0-9]+.[0-9]+-*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ github.token }}
      TAG: ${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run check:vendor
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx vitest run
      - name: Manifest version matches the tag
        run: test "$(node -p "require('./manifest.json').version")" = "$TAG"
      - run: NODE_ENV=production npm run build
      - name: Publish
        run: |
          flags=""
          case "$TAG" in *-*) flags="--prerelease";; esac
          gh release create "$TAG" dist/main.js dist/styles.css manifest.json --title "$TAG" --notes "See the README for what changed." $flags
```
  - **`scripts/test-inventory.mjs`**, which prints:
    - the number of test files per area in `tests/unit/online/**`;
    - the fork's count per area (`git -C <atlas> ls-tree -r --name-only merge/upstream-beta -- tests/unit/online`);
    - the files Appendix B marks as moved to Atlas.

    Each area must satisfy `connect = fork − moved + rewritten-as-new`. It exits 1 when an area has fewer Connect files than `fork − moved`.

- [ ] **Step 1:** Write the docs and the workflow.
- [ ] **Step 2:** `node scripts/test-inventory.mjs --atlas ../atlas-vtt-upstream-wt`. Expected: every area OK. If an area falls short, a fork test was not ported: port it in this task.
- [ ] **Step 3:** Run the full verify block and `npm run build:page`. Then check:
  - `grep -c "atlas-online" -r src README.md PRIVACY.md` prints `0`;
  - `grep -rn "evoljoaobento.github.io/atlas-vtt/" src` matches only the migration's old-default constant.
- [ ] **Step 4:** Commit with the message `docs: README, privacy, third-party notices and the BRAT release workflow`.

**Track B done check (controller):**
- `git log --oneline` lists the plan commit plus about 17 task commits.
- `npm run check:vendor` reports API 1.9.0.
- The manual checks from B6, B9, B11, B12, B14 and B15 are recorded.
- Tagging `0.1.0` and pushing are user steps. Until the repository is pushed with Pages enabled, the default page URL serves nothing; README "Developing" says how to use a local page (`npx vite preview -c vite.page.config.mts`) and paste its address into "Player page address".

---

# Track A notes for the upstream PRs (the proposal's open questions)

These go into the first API PR's description (PR 3) and into `docs/extension-api.md`:

1. **Remote view.** Built, as PR 12, behind the optional `remote-view` capability. If the maintainer declines it, PRs 1–11 stand alone, and Connect falls back to its Canvas 2D tab (B12) with no Atlas change.
2. **Shared packages.** Answered: **no npm scope is needed**. `@atlas-vtt/api-types` is the committed `api-report/atlas-vtt-api.d.ts`. `@atlas-vtt/shared` is `src/shared/`, built by `npm run build:packages` and uploaded by CI as the artifact `atlas-vtt-packages-<sha>`. Extensions vendor a copy pinned to a commit (decision D1). Nothing is published to a registry.
3. **Darkness rules in Atlas.** Built as proposed (A20, A21), in `src/app/lighting/playerDarkness/`.
4. **`data.extensions` and `data.sharing`.** Answered yes: a one-time move, plus a strip of any leftover `data.sharing` (A26). The alternative is "share again", but then stock Atlas would export the preview's share lists.
5. **UI slots.** Five slots and panels, all data-only (A23–A25). The token menu context uses `tokenKind` (decision D3).
6. **Event cost.** `views.subscribe` fires per store change that replaced a snapshot field. Connect throttles to 50 ms. Atlas does not coalesce in v1; this is open for the maintainer.
7. **Naming.** `api` on the plugin instance, `src/api/`, and CODEOWNERS for the API maintainer (A7).

The CLA workflow (`.github/workflows/cla.yml`) applies to each upstream PR. The author signs once.

---

# Appendix A: Contract cases (ids shared by both tracks)

| Id | Owner A task | What it pins | In FakeAtlas (B task) |
|---|---|---|---|
| C-life-1 | A6 | Connecting again with the same id disposes the first connection | B3 |
| C-life-2 | A6 | Unloading the extension leaves no listener | B3 |
| C-life-3 | A6 | Atlas unload: `unload` to all, dispose all, then `atlas-vtt:api-unload` | B3 |
| C-life-4 | A6 | A disposer is idempotent | Atlas-only |
| C-life-5 | A6 | `has()` only for landed capabilities | B3 |
| C-views-1 | A9 | `snapshot` is null for an unknown or closed view | B6 |
| C-views-2 | A9 | `loaded` is false while loading; `subscribe` fires on a replaced field only; values passed by reference | B6 |
| C-views-3 | A9, A28 | `list` shows map views; `active` is never a remote view | B6 |
| C-views-4 | A9 | `map-loaded` once per load; `map-closed` once | B6 |
| C-views-5 | A9 | `camera` is null without a viewport; `watchCamera` is a no-op | B6 |
| C-rules-1 | A10 | Defaults outside a collection; the collection's rules and `mapConeAngle` inside | B6 |
| C-rules-2 | A10 | `rules-changed` on a settings save | B6 |
| C-settings-1 | A11 | The four `playerView` rules; `settings-changed` per changed key | B5 |
| C-storage-1 | A11 | `folder()` path, created, idempotent | B5 |
| C-pres-1 | A14 | `present` is false for a closed view; held, resumed after load, cleared | B6 |
| C-pres-2 | A14 | `addTarget` makes the eye present to the target | Atlas-only (UI) |
| C-dice-1 | A17 | Collection rules, `rolledBy`, `onRolled`, not persisted | B7 |
| C-dice-2 | A17 | `publish` without re-rolling | B7 |
| C-laser-1 | A18 | `onLocal` points and lift; `show`; unknown views harmless | B7 |
| C-laser-2 | A18 | Fading, and a sender silent for 1 s is let go | Atlas-only (drawing) |
| C-light-1 | A21 | Unlit, pending (no renderer, not ready, loading, context lost, explored decoding), ready shape | B9 |
| C-light-2 | A21 | `watch` fires on a sight recompute; the disposer stops it | B9 |
| C-light-3 | A21 | An unknown view is pending | B9 |
| C-tok-1 | A22 | Refusals in order, nothing written on refusal, one undo step, `allowHidden` | B10 |
| C-tok-2 | A22 | `snapPoint` like a GM drag (even sizes, switched-off grid, snapping off, unknown view) | B10 |
| C-ui-1 | A25 | Extension unload removes every slot | B11 |
| C-ui-2 | A25 | Atlas unload removes every slot | B11 |
| C-ui-3 | A25 | `invalidate` bumps the slots | B11 |
| C-scenes-1 | A26, A27 | Extension data and legacy `data.sharing` never exported, copied or fingerprinted; `setData` re-reads; null clears | B13 |
| C-scenes-2 | A27 | `addToCollection` is atomic, serialized, and rejects path escapes | B13 |
| C-scenes-3 | A27 | `readMap` migrates and returns the size; null when missing | B13 |
| C-bundles-1 | A27 | `stripNoteProperties` until disposed | B13 |
| C-remote-1 | A28 | `open`/`reuse`, `close`/`onClose` once, never active, never saved | B15 |
| C-remote-2 | A28 | Extension or Atlas unload closes its remote views | B15 |
| C-remote-3 | A29 | `setScene` is reflected in the snapshot; null unloads | Atlas-only (store) |
| C-remote-4 | A30 | `onTokenDrop` for movable ids only; lasers in the remote view; `onCameraMoved` | B15 |
| C-remote-5 | A31 | `onRoll` refusal text; dice log without Clear; `throwRoll` once per id | Atlas-only (UI) |

---

# Appendix B: Where every fork file goes

Fork paths are relative to `src/app/online/` unless they start with `src/`, `online-client/` or a root file name.

| Fork path | Destination | Task |
|---|---|---|
| `protocol.ts`, `ids.ts`, `rateLimit.ts`, `joinLink.ts`, `onlineLog.ts`, `onlineSettings.ts` | Connect, same path | B2 |
| `transport/**` | Connect | B2 |
| `GmSession.ts` (split), `gmSessionEntries.ts`, `gmSessionTypes.ts` | Connect | B2 |
| `sharing/identity/**` | Connect | B2 |
| `scene/**` except the rows below | Connect | B4 |
| `scene/darknessRaster.ts`, `scene/exploredImage.ts` | **Atlas** `src/app/lighting/playerDarkness/` | A20 |
| `scene/LiveLighting.ts` | **Atlas**: the timing part (`sightFrames.ts`, A20). Connect: rewritten over `playerVisibility` (B9) | A20, B9 |
| `scene/SceneBroadcaster.ts` (split), `sceneSources.ts`, `CameraSender.ts`, `PlayerChannels.ts`, `AssetRegistry.ts` | Connect | B6 |
| `coverage.ts`, `assets/**` (except `vaultImageFiles.ts`), `preview/**`, `PlayerSession.ts` (split) | Connect | B4 |
| `assets/vaultImageFiles.ts` | Connect | B6 |
| `tools/toolMessages.ts`, `laserColors.ts`, `LaserBatcher.ts` | Connect | B4 |
| `tools/DiceHost.ts`, `tools/LaserRelay.ts` | Connect | B7 |
| `diceFeed.ts` | **Dropped**: `atlas.dice.onRolled`/`publish` | B7 |
| `watchCollectionResources.ts` | **Dropped**: `atlas.on('rules-changed')` | B6 |
| `control/ControlLists.ts`, `TokenControl.ts` | Connect | B4 |
| `control/TokenControlHost.ts`, `TokenMoveHandler.ts` | Connect | B10 |
| `control/deletedTokens.ts` | Connect | B6 |
| `OnlineSessionService.ts` (split), `onlineSessionStore.ts`, `registerOnline.ts`, `ui/**` except `controlledByMenu.ts` | Connect | B6 |
| `ui/controlledByMenu.ts` | Connect, rewritten as a token menu provider | B11 |
| `page/**`, `view/**`, `online-client/**` | Connect (`canvasSurface.mts` moves to `view/canvasSurface.ts`) | B8 |
| `obsidian/OnlineJoinService.ts` (split), `joinedSessionStore.ts`, `keyPerHost.ts`, `onlineJoinTypes.ts`, `onlineSceneStatus.ts`, `onlineSceneTab.ts`, `ui/**` | Connect | B12 |
| `obsidian/OnlineSceneView.ts` | **Atlas** `remote-view/RemoteMapView.ts` (generic, A28). Connect: `CanvasSceneView` (B12) and `sceneTabs.ts` | A28, B12 |
| `obsidian/RemoteSceneApplier.ts`, `RemoteMapBackdrop.ts` | **Atlas** `remote-view/` | A29 |
| `obsidian/ViewportFollower.ts` | **Atlas** `remote-view/` (camera). Connect keeps the follow decision (B15) | A30, B15 |
| `obsidian/remoteTokenMoves.ts` | **Atlas**: the drag gate (A30). Connect: sending and refusal (B15) | A30, B15 |
| `obsidian/remoteScene.ts` | **Atlas** `remote-view/remoteViewState.ts` (renamed). Connect: none | A28 |
| `obsidian/OnlineSceneClient.ts`, `playerSceneToAtlasState.ts`, `convert*.ts`, `objectUrlImages.ts`, `OnlineLaserLink.ts`, `onlineDice.ts`, `onlineRollRefusal.ts` | Connect `obsidian/remote/`, rewritten over the `RemoteView` handle | B15 |
| `sharing/dataFile.ts`, `sharing/people/*.ts` | Connect | B5 |
| `sharing/transport/**`, `people/ui/**`, `model/**`, `parts/**`, `display/**`, `ui/**`, `register{Sharing,ShareCommands,SessionHooks,AskToPull}.ts`, `shareSessionStore.ts`, `sharedFromView.ts`, `pathRenames.ts` | Connect | B13 |
| `sharing/receive/**`, `merge/**`, `registerReceiving.ts` | Connect | B14 |
| `src/app/react/components/online/OnlinePanel.tsx`, `OnlinePlayerList.tsx`, `OnlinePresenting.tsx`, `useOnlineState.ts`, `*.scss` (except the scene bar parts) | Connect `gm-ui/` | B11 |
| `src/app/react/components/online/onlineToolbarItem.tsx`, `command-palette/onlineCommands.tsx` | Connect, rewritten as slot data | B11 |
| `src/app/react/components/online/onlineSceneToolbarItems.tsx` | Connect `remoteToolbar.ts` | B15 |
| `src/app/react/components/online/OnlineSceneBar.tsx`, `OnlineOwnRolls.tsx`, `online-scene.scss` (bar parts) | **Atlas** `remote-view/RemoteStatusBar.tsx`, `RemoteOwnRolls.tsx`, `remote-view.scss` | A31 |
| `src/app/settings/onlineSettingsSection.ts`, `settings-rows.scss` | Connect `src/connect/settingTab.ts`, `styles/` | B2 |
| `vite.online.config.mts`, `.github/workflows/online-client.yml` | Connect `vite.page.config.mts`, `pages.yml` | B8 |
| `README.md` online section, `PRIVACY.md`, `THIRD_PARTY_NOTICES.md` | Connect | B17 |
| `package.json` peerjs, `tsconfig` online-client include, eslint ignores, `eslint.suppressions.json` (`protocol.ts`), `.gitignore` `dist-online` | Connect's own files (B1). The `protocol.ts` suppression is fixed at the root rather than carried over; if it can't be, put it in Connect's `eslint.suppressions.json` | B1, B2 |
| `scripts/preflight.js` hosts | **Stay upstream as they are** (spec §4) | none |

**Tests:** `tests/unit/online/<file>.test.ts` follows its subject file. These move to Atlas:
- `darknessRaster`;
- the timing cases of `liveLighting`;
- `presentedCamera`;
- `fogCompositorCache`;
- from `obsidian/`: `remoteSceneApplier`, `remoteMapBackdrop`, `viewportFollower` and `remoteStore`;
- the Atlas parts of `onlinePlayerDrag`, `onlineSceneStatus`, `onlineSceneRoll`, `onlineOwnRolls`, `onlineDiceUi`, `onlineSceneResources` and `onlineSceneInitiative`;
- `onlineSceneView`, as `remoteViews` contract cases.

Of the 37 fork tests outside `tests/unit/online/`, each goes with its A task (named in that task).

---

# Appendix C: Rewriting the fork's Atlas imports

This list comes from a scan of every import in `src/app/online/**` and `online-client/**` that leaves those folders, at `merge/upstream-beta` 6c939e6. To re-check one file, run `git -C $ATLAS show $FORK:<file> | grep -nE "from '(\.\./)+"`, and resolve each relative path against the file's folder.

| Fork import | In Connect |
|---|---|
| `types`, `types/{fogTypes, collectionSettingsTypes, initiativeRulesTypes, initiativeTypes, lightingTypes, senseTypes, widgetTypes, diceRulesTypes}` (types) | `@atlas-vtt/api-types` (A9's `records.ts` re-exports them all) |
| `services/MapPersistence` (`GridState`), `resources/resourceTypes` (types), `grid/measurementFormat` (types), `tools/diceRolling` (`DiceRollResult`, `DiceSelection` types) | `@atlas-vtt/api-types` |
| `storeFactory` (`ViewAtlasState`) | `SceneSnapshot` (api-types) with field renames (B4, B6) |
| `grid/{hexGeometry, hexLattice, squareLattice, gridDistance, gridPlacement, cellNumbering, measurementFormat}` (values) | `@atlas-vtt/shared/grid` |
| `pixi/{measureGeometry, sceneLayerOrder, textBoxLayout, mapIcons}`, `pixi/laser/{laserBeamGeometry, remoteLasers}`, `pixi/token-renderer/{tokenUiLayout, conditionBadgeLayout, downedLook, dragRulerPath, tokenSizing, tokenRingMetrics}`, `pixi/fog/fogRenderUtils`, `styles/designTokens` | `@atlas-vtt/shared/draw` |
| `tools/{diceRolling, diceFormula, diceCrit, diceLabels, laserPointerSettings}`, `gameSystems/initiativeRules`, `initiative/sides`, `resources/{resourceValues, visibleResources, resourceColors}`, `react/components/dice/diceTrayPool` (values) | `@atlas-vtt/shared/rules` |
| `dice3d/{DiceRenderer, diceDisplay, diceScene, dieArtwork, dieGeometry, dieMotion, dieTour, rollPresentation, stagePool, throwChain, throwSeed}`, `assets/dice-icons/*.webp` | `@atlas-vtt/shared/dice3d` (`DIE_ICONS`) |
| `plugin/vaultFolders`, `ui/confirmDialog`, `ui/nativeModal`, `utils/{mapStrings, timerWidget, counterWidget, widgetActivation}`, `types/widgetIcons`, `packages/components/toolbar/toolbarFit`, `react/components/dice3d/diceRollText`, `imageProcessing/imageDimensions` | Copied helpers, same relative path (B1) |
| `packages/components/primitives/button`, `…/tooltip` | `src/app/ui/primitives/Button`, `LabelTooltip` (B1) |
| `react/root/ContextMenuContext` | Dropped: the token menu slot (B11) |
| `services/PresentedScene` | `src/app/online/atlas/presentedSource.ts` over `atlas.presentation` + `atlas.views` (B6) |
| `services/presentedCamera` | `atlas.views.camera` / `watchCamera` |
| `services/SettingsService` | `atlas.settings.get` (Atlas settings) + `ConnectSettingsStore` (online settings) |
| `services/AssetService`, `services/assetPaths` | `atlas.scenes.*` |
| `services/{mapMeasurementSettings, mapDiceRules, mapInitiativeRules}`, `resources/collectionResources` | `atlas.rules.forMap` |
| `clipboard/mapObjectPlacement`, `stores/history`, `encounters/encounterFormation` | `atlas.tokens.move` / `snapPoint`; `snapGridOfState` for the preview grid (B4) |
| `gameSystems/senseRules`, `gameSystems/senses/generic`, `vision/{lightLevels, sight, visibility}`, `pixi/lighting/playerLightingLayers` | `atlas.lighting.playerVisibility` (B9) |
| `lighting/sceneLightingOptions` | `atlas.scenes.readMap(...).lighting` (B13) |
| `pixi/laser/LaserHub` (types) | `atlas.lasers` (types from api-types) |
| `services/PlayerInitiativePanel`, `services/PlayerSceneOverlay`, `atlas-view`, `main`, `grid/GridSystem`, `grid/gridStateOptions` | The remote view (A28–A31); nothing in Connect |
| `pkg:pixi.js`, `pkg:pixi-viewport` | Dropped (Connect has no PIXI) |
| `pkg:events` (`OnlineSceneClient`) | Replaced by the handle's listeners (B15) |
| `pkg:@codemirror/*`, `pkg:obsidian`, `pkg:react`, `pkg:react-dom`, `pkg:zustand`, `pkg:lucide-react`, `pkg:peerjs` | Connect's own dependencies (`@codemirror/*` and `obsidian` external) |

---

# Risks the controller watches

1. **Mixed fork files ported hunk by hunk.** Twelve upstream files carry hunks from several groups. A wrong hunk either leaks online code into a PR or changes behaviour early.
   - Guard: the leak grep in every A verify block, plus "revert any hunk naming `remoteView`/`LaserHub`/`online`" in each task.
   - The reviewer compares each A task's diff with `git diff api/extension-api merge/upstream-beta -- <file>`.
2. **Group 12 is the largest PR, and the maintainer may reject it.** Connect then lives on the Canvas 2D tab (B12). Two Obsidian player paths must be maintained until the answer is known.
   - B15 keeps both, behind `has('remote-view')`.
3. **The API rollup is not self-contained.** `GridState` lives in `MapPersistence.ts`, `DiceRollResult` near `DiceTool.ts`, and record types reach deep. A rollup that imports internals breaks Connect's vendored types.
   - A7's rollup test fails fast.
   - The fix is a pure type-only move (decision D3).
   - A new `TokenEntity` field breaks Connect's coverage tables on purpose (spec §5).
4. **Privacy regressions while rewriting projection and sharing over the API.**
   - The field renames (`SceneSnapshot`) are a risk.
   - Lighting now comes from `playerVisibility`; unknown must mean dark.
   - Legacy `data.sharing` must never be exported.
   - Rule: no ported assertion may change without a review note.
   - The GM's table key stays duplicated in Atlas's `settings.json` after migration. This is documented in PRIVACY, but it is still a copy of a private key.
5. **Vendoring friction and cross-repo drift.**
   - `sync-atlas.mjs` needs the worktree at the exact tag and builds packages there.
   - Windows line endings could break hashes; `vendor/** -text` prevents it.
   - FakeAtlas can drift from real Atlas behaviour. The contract case ids (Appendix A) and the meta-test catch missing cases, but not wrong semantics. The manual checks in B6, B9, B11, B12, B14 and B15 against a real Atlas build are the backstop.

Also noted:
- **CLA** for each upstream PR.
- **Pages** serves nothing until the user pushes and enables it.
- **Long full test runs** on every A task. Run the targeted tests first, and the full suite once per task.

