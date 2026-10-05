import { describe, expect, it } from 'vitest';
import { SectionTrust, type SectionEvents } from '../../../../src/app/online/sharing/model/sectionTrust';
import { simpleSections } from './obsidianSections';

function trustWithEvents(): { trust: SectionTrust; modify(path: string): void; parsed(path: string, data: string): void; rename(path: string, old: string): void } {
  let modify: (path: string) => void = () => {};
  let parsed: (path: string, data: string) => void = () => {};
  let rename: (path: string, old: string) => void = () => {};
  const events: SectionEvents = {
    onModify: (listener) => { modify = listener; },
    onParsed: (listener) => { parsed = listener; },
    onRename: (listener) => { rename = listener; },
    onDelete: () => {},
  };
  const trust = new SectionTrust(events);
  return { trust, modify: (path) => modify(path), parsed: (path, data) => parsed(path, data), rename: (path, old) => rename(path, old) };
}

describe('trusting the metadata cache’s sections (stale sections)', () => {
  const text = 'One\n%%[!private]%%x%%[!end]%%';
  const sections = simpleSections(text);

  it('trusts sections parsed from the very text read, and no others', () => {
    const { trust, parsed } = trustWithEvents();
    parsed('a.md', text);
    expect(trust.trusted('a.md', text, sections)).toBe(sections);
    // Same length, one character changed: positions still fit, but the cache parsed other text.
    expect(trust.trusted('a.md', 'Onf\n%%[!private]%%x%%[!end]%%', sections)).toBeNull();
  });

  it('does not trust a note changed since it was parsed, until it is parsed again', () => {
    const { trust, modify, parsed } = trustWithEvents();
    modify('a.md');
    expect(trust.trusted('a.md', text, sections)).toBeNull();
    parsed('a.md', text);
    expect(trust.trusted('a.md', text, sections)).toBe(sections);
  });

  it('keeps the cache Obsidian loaded for a note untouched since startup; follows renames; no sections stay none', () => {
    const { trust, parsed, rename } = trustWithEvents();
    expect(trust.trusted('b.md', text, sections)).toBe(sections);
    parsed('a.md', 'old text');
    rename('c.md', 'a.md');
    expect(trust.trusted('c.md', text, sections)).toBeNull();
    expect(trust.trusted('d.md', text, null)).toBeNull();
  });
});
