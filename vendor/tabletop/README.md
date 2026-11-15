# Tabletop's player board, for the join page

Built from [Tabletop for Atlas VTT](https://github.com/evolJoaoBento/atlas-vtt-tabletop) (AGPL-3.0) with
`node scripts/build-web.mjs` there, and copied here as it came out (`SOURCE.json` says from which commit). The join page
loads it as a chunk of its own when the GM offers the 3D board, so a player in a browser sees the board as a player in
Obsidian with the Tabletop plugin does. three.js is the page's own. Do not edit these files: build them again.
