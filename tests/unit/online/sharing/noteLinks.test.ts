import { describe, expect, it } from 'vitest';
import { rewriteLinks } from '../../../../src/app/online/sharing/model/noteLinks';

const shared = (path: string): string | null => (path === 'Cave' || path === 'Places/Cave.md' ? 'Cave' : null);

describe('links in shared notes', () => {
  it('keeps links to notes the receiver gets, by their shared title', () => {
    expect(rewriteLinks('See [[Cave]], [[Cave#Entrance|the entrance]] and ![[Cave]].', shared))
      .toBe('See [[Cave]], [[Cave#Entrance|the entrance]] and ![[Cave]].');
    expect(rewriteLinks('[into](Places/Cave.md)', shared)).toBe('[[Cave|into]]');
  });

  it('turns other links into their text', () => {
    expect(rewriteLinks('[[Secret lair]] and [[Folder/Secret lair|the lair]] and [[#Heading]]', shared))
      .toBe('Secret lair and the lair and Heading');
    expect(rewriteLinks('![[map.png]] [x](Notes/Hidden%20one.md)', shared)).toBe('map.png x');
    expect(rewriteLinks('![[map.png|100]] ![[map.png|a map]]', shared)).toBe('map.png a map');
    expect(rewriteLinks('[a [b]](Notes/Secret.md)', shared)).toBe('a [b]');
  });

  it('leaves web links alone', () => {
    expect(rewriteLinks('[site](https://example.org) ![](https://example.org/a.png)', shared))
      .toBe('[site](https://example.org) ![](https://example.org/a.png)');
  });

  it('resolves reference-style links like inline ones and drops their definitions (F5)', () => {
    const text = 'See [the lair][lair] and [Cave][] and [web][w] and [Short].\n\n'
      + '[lair]: Notes/Secret%20lair.md "Title"\n[CAVE]: Places/Cave.md\n[w]: https://example.org\n[short]: <Notes/Short one.md>\n[unused]: Hidden/Unused.md';
    expect(rewriteLinks(text, shared)).toBe('See the lair and [[Cave|Cave]] and [web][w] and Short.\n\n[w]: https://example.org');
    expect(rewriteLinks('a\n> [x]: Notes/Hidden.md\n- [y]: Notes/Hidden.md\nb', shared)).toBe('a\nb');
    expect(rewriteLinks('![alt][img]\n\n[img]: art/secret.png', shared)).toBe('alt\n');
  });

  it('leaves footnotes and unrelated brackets alone', () => {
    expect(rewriteLinks('Text[^1] and [not a link]\n\n[^1]: Footnote', shared)).toBe('Text[^1] and [not a link]\n\n[^1]: Footnote');
  });

  it('strips local href and src from HTML, and keeps web ones (F5)', () => {
    expect(rewriteLinks('<a href="Notes/Secret.md">x</a> <img src=\'art/s.png\' alt="a"> <a href=https://example.org/x>w</a> <IMG SRC=Notes/p.png>', shared))
      .toBe('<a>x</a> <img alt="a"> <a href=https://example.org/x>w</a> <IMG>');
    expect(rewriteLinks('<img srcset="a.png 1x, https://example.org/b.png 2x" src="https://example.org/b.png"> <a href="#top">t</a>', shared))
      .toBe('<img src="https://example.org/b.png"> <a href="#top">t</a>');
  });

  it('a link around an image leaks neither path (I5)', () => {
    expect(rewriteLinks('[![img](GM/a.png)](GM/b.md)', shared)).toBe('img');
    expect(rewriteLinks('[![img](GM/a.png)](Places/Cave.md)', shared)).toBe('[[Cave|img]]');
    expect(rewriteLinks('[![img][r]](GM/b.md)\n\n[r]: GM/a.png', shared)).toBe('img\n');
    expect(rewriteLinks('[![[GM/a.png]]](GM/b.md)', shared)).toBe('a.png');
    expect(rewriteLinks('[![i](GM/a.png)](https://example.org)', shared)).toBe('[i](https://example.org)');
    expect(rewriteLinks('[![i](https://example.org/a.png)](https://example.org)', shared)).toBe('[![i](https://example.org/a.png)](https://example.org)');
  });

  it('two levels of nested image links leak nothing (R2-2)', () => {
    expect(rewriteLinks('[![![i](GM/a.png)](GM/b.md)](GM/c.md)', shared)).toBe('i');
    expect(rewriteLinks('[[![![i](GM/a.png)](GM/b.md)](GM/c.md)](GM/d.md)', shared)).not.toMatch(/GM\//);
    expect(rewriteLinks('[![![i](GM/a.png)](GM/b.md)](https://example.org)', shared)).not.toMatch(/GM\//);
  });

  it('a wiki link that is not a shared title ends as plain text, an embed as its file name (R3-2)', () => {
    const swept = rewriteLinks('![[GM/a.png|![i](x)]] and [[GM/Secret|![j](y)]] and [[Cave]]', shared);
    expect(swept).not.toContain('GM/');
    expect(swept).not.toContain('![[');
    expect(swept).toBe('i and j and [[Cave]]'); // an embed's alias is its text, as in the first pass
  });

  it('only web links stay: Obsidian, app and file links become their text', () => {
    expect(rewriteLinks('[x](obsidian://open?vault=V&file=GM%2FSecret%20plan) [m](mailto:a@b.c)', shared)).toBe('x [m](mailto:a@b.c)');
    expect(rewriteLinks('<img src="app://abc/C:/Users/x/a.png"> <img src="file:///C:/a.png"> <a href="javascript:alert(1)">j</a>', shared)).toBe('<img> <img> <a>j</a>');
  });

  it('sees a definition whose target is on the next line, and a tag whose attribute holds a ">"', () => {
    expect(rewriteLinks('see [r]\n\n[r]:\n  GM/Secret.md\n"title"\nend', shared)).toBe('see r\n\nend');
    expect(rewriteLinks('<a title=">" href="GM/Secret.md">x</a>', shared)).toBe('<a title=">">x</a>');
  });
});

describe('wiki links nested in the alias of a kept link (I1)', () => {
  it('flattens an inner link to its text so no vault path survives', () => {
    expect(rewriteLinks('body [[Cave|see [[Private/Secret]]]] end', shared)).toBe('body [[Cave|see Secret]] end');
    expect(rewriteLinks('[[Cave|see [[Private/Secret|s]] ok]]', shared)).toBe('[[Cave|see s ok]]');
    expect(rewriteLinks('[[Cave|a ![[GM/map.png]] b [[Places/Cave.md|c]]]]', shared)).toBe('[[Cave|a map.png b c]]');
  });

  it('leaves links after an unclosed opener working', () => {
    const out = rewriteLinks('x [[ then [[Private/Secret]] and [[Cave]]', shared);
    expect(out).not.toContain('Private/');
    expect(out).toContain('[[Cave]]');
  });
});

describe('labels that nest brackets deeply keep no path (F-a)', () => {
  const leaks = (text: string): void => {
    const out = rewriteLinks(text, shared);
    expect(out).not.toMatch(/Private|Secret|GM\//);
  };

  it('strips the destination whatever the nesting', () => {
    leaks('[a [b [c]]](Private/Secret.md)');
    leaks('[see [[Cave]]](Private/Secret.md)');
    leaks('[a [b [c [d [e [f]]]]]](Private/Secret.md) and ![x [y [z]]](GM/Secret.png)');
    leaks('[a [b [c]]](<Private/Secret (1).md>) [p [q [r]]](Private/Secret (1).md)');
    leaks('[a [b [c]]](Private/Secret.md "t")');
    leaks('[a [b [c]]](Private/Secret.md');
  });

  it('keeps web destinations and strips definitions with deep labels', () => {
    expect(rewriteLinks('[a [b [c]]](https://example.org/x)', shared)).toBe('[a [b [c]]](https://example.org/x)');
    leaks('see\n\n[a [b [c]]]: Private/Secret.md\n> [x [y [z]]]:\nPrivate/Secret.md\n"t"\nend');
    expect(rewriteLinks('[a [b [c]]]: https://example.org\n[^1]: Note', shared)).toBe('[a [b [c]]]: https://example.org\n[^1]: Note');
  });
});
