# atlas-shared

Atlas VTT's own rules, shared by Connect for Atlas and Tabletop for Atlas, so that a distance or a unit label is worked
out by the same code in Atlas, on the 3D board and on a player's page.

## Where the files come from

Everything under `src/app/` is copied byte for byte from stock Atlas VTT (`github.com/atlas-vtt/atlas-vtt`) at the tag
and commit named in `SOURCE.json`, by `scripts/sync-atlas-shared.mjs`. The list of files is `files.mjs`.

A copied file may import the type of an Atlas file that is not copied. Each such file gets a generated stub at the same
path, holding only `export type Name = any;` lines. `SOURCE.json` lists the stubs apart from the copies.

`src/index.ts` is ours: it names what the plugins may import.

## Do not edit by hand

`npm run check:shared` fails when a copied file or a stub differs from `SOURCE.json`. A fix belongs in Atlas, or in the
file list. Tabletop holds a copy of this folder made by its own `npm run sync:connect`; it is never edited there either.

The folder is browser-safe: the sync refuses a copied file that imports a package (Obsidian, Node, a DOM library) or
that imports, at run time, an Atlas file that is not listed.

## Licence

Atlas VTT is licensed AGPL-3.0-only, as Connect and Tabletop are. The copied files keep their text unchanged; see
`THIRD_PARTY_NOTICES.md` at the repository root.

## Upgrading Atlas

1. Check out the new Atlas tag.
2. Set `ATLAS_TAG` in `files.mjs`, and add any file the new rules need to `FILES`.
3. Run `npm run sync:shared -- --atlas <checkout>`.
4. Run Connect's checks, then `npm run sync:connect` and the checks in Tabletop.
5. Set `MIN_ATLAS_VERSION` in `packages/atlas-host` to the same version. A test fails while the two differ.
