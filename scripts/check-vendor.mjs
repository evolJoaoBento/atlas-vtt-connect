// Fails when vendor/atlas differs from what SOURCE.json recorded (hand edits, partial syncs). Offline.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hashTree } from './vendorHash.mjs';

const vendor = path.resolve('vendor/atlas');
const source = JSON.parse(readFileSync(path.join(vendor, 'SOURCE.json'), 'utf8'));
const actual = hashTree(vendor);
const problems = [
  ...Object.entries(actual).filter(([rel, hash]) => source.files[rel] !== hash).map(([rel]) => `changed or unknown: ${rel}`),
  ...Object.keys(source.files).filter((rel) => !(rel in actual)).map((rel) => `missing: ${rel}`),
];
if (problems.length) { console.error(`vendor/atlas does not match Atlas ${source.commit}:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`vendor/atlas matches Atlas ${source.commit.slice(0, 7)} (API ${source.apiVersion}).`);
