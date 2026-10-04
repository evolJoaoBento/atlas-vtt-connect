// Shared by sync-atlas.mjs and check-vendor.mjs: one way to walk and hash vendor/atlas.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TEXT = /\.(?:d\.ts|ts|js|mjs|map|json|css|scss|md)$/;

/** sha256 of a file; CRLF counts as LF in text files, so a Windows checkout cannot change a hash. */
export function hashFile(file) {
  const bytes = readFileSync(file);
  if (!TEXT.test(file)) return createHash('sha256').update(bytes).digest('hex');
  return createHash('sha256').update(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
}

/** Hashes of every file under `vendor` (SOURCE.json excluded), keyed by forward-slash relative path. */
export function hashTree(vendor) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== 'SOURCE.json') files[path.relative(vendor, full).split(path.sep).join('/')] = hashFile(full);
    }
  };
  walk(vendor);
  return files;
}
