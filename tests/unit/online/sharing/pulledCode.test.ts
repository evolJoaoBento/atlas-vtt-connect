import { describe, expect, it, vi } from 'vitest';
import type { CatalogueItem } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { codeKindsText, findExecutable, withoutCode, type CodeKind } from '../../../../src/app/online/sharing/receive/executableContent';
import { keepBothPolicy, type NoteUpdatePolicy, type UpdateContext } from '../../../../src/app/online/sharing/receive/notePull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { SharedWithMe, type PulledCodeChoice } from '../../../../src/app/online/sharing/receive/SharedWithMe';
import { pulledCodeDialog } from '../../../../src/app/online/sharing/registerReceiving';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { TABLE_ID } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

// Final review I3: a pulled note can carry code that other plugins run. A pull that finds some asks first; Pull
// without code (the default) writes it inert.

const FENCE = '```';
const DVJS = `# Cave\n\n${FENCE}dataviewjs\napp.vault.adapter.remove('x')\n${FENCE}\n`;
const ALL_KINDS = [
  `${FENCE}dataviewjs\ndv.paragraph(1)\n${FENCE}`,
  '~~~js-engine\nreturn 1\n~~~',
  'Gold: `$= dv.current().gold` coins',
  '<%* tR += await tp.system.prompt("x") %>',
  '<iframe src="https://evil.example"></iframe>',
  '<img src="https://tracker.example/p.png">',
].join('\n\n');
const ZW = '\u200B';

describe('finding known code', () => {
  it('finds each kind, named in a fixed order', () => {
    expect(findExecutable(ALL_KINDS)).toEqual(['code-block', 'dataview-inline', 'templater', 'html', 'remote']);
    expect(findExecutable('<% tp.date.now() %>')).toEqual(['templater']);
    for (const tag of ['<script>alert(1)</script>', '<object data="x">', '<embed src="x">', '<IFRAME src=x>', '</script>']) expect(findExecutable(tag), tag).toEqual(['html']);
  });

  it('treats any fence language a plugin may run as code, wherever the fence sits', () => {
    for (const language of ['dataviewjs', 'DataviewJS', 'dataview', 'datacorejs', 'datacorejsx', 'datacorets', 'datacoretsx', 'js-engine', 'js-engine-debug', 'js', 'jsx', 'ts', 'tsx', 'templater']) {
      for (const at of [`${FENCE}${language}`, `~~~ ${language} {x}`, `> ${FENCE}${language}`, `> > ${FENCE}${language}`, `- ${FENCE}${language}`, `1. ${FENCE}${language}`, `      ${FENCE}${language}`]) {
        expect(findExecutable(`${at}\nx\n${FENCE}`), at).toEqual(['code-block']);
      }
    }
  });

  it('flags HTML that loads from the internet, not the same tags on this device', () => {
    for (const tag of ['<style>@import url(x)</style>', '<img src="https://t.example/a.png">', '<img src=//t.example/a>', '<link rel=stylesheet href="http://t.example/a.css">', '<audio src="https://t.example/a.mp3">', '<VIDEO src=https://x>', '<source srcset="https://t.example/a.webp">']) {
      expect(findExecutable(tag), tag).toEqual(['remote']);
    }
    expect(findExecutable('<img src="art/map.png"> <img src="data:image/png;base64,AA">')).toEqual([]);
  });

  it('catches the re-review bypasses: a fence that ends with its quote, and a span across a line break', () => {
    const quoteThenProse = "> ```\n`$= dv.el('p', 1)`\n<iframe src=x></iframe>\n";
    expect(findExecutable(quoteThenProse)).toEqual(['dataview-inline', 'html']);
    const callout = "> [!note]\n> ```\n> x\n`$= dv.el('p', 1)`\n<iframe src=x></iframe>\n";
    expect(findExecutable(callout)).toEqual(['dataview-inline', 'html']);
    const wrapped = "text `\n$= dv.el('p', 1)` end\n";
    expect(findExecutable(wrapped)).toEqual(['dataview-inline']);
    expect(findExecutable("text `\n> $= dv.el('p', 1)` end\n")).toEqual(['dataview-inline']);
    for (const text of [quoteThenProse, callout, wrapped]) expect(findExecutable(withoutCode(text)), text).toEqual([]);
  });

  it('reads code blocks and inline code too, so no fence Markdown does not open hides anything', () => {
    // Inside an HTML block a fence line opens nothing, so what follows the blank line renders.
    expect(findExecutable('<div>\n```\n</div>\n\n<iframe src=x></iframe>\n```\n')).toEqual(['html']);
    expect(findExecutable('<span title="`"><iframe src=x></iframe><span title="`">')).toEqual(['html']);
    expect(findExecutable(`${FENCE}html\n<script>1</script>\n${FENCE}`)).toEqual(['html']);
    expect(findExecutable('\\`<iframe src=x>\\`')).toEqual(['html']);
  });

  it('leaves prose and code no plugin runs alone', () => {
    const ordinary = [
      `${FENCE}python\nprint('<b>')\n${FENCE}`,
      `${FENCE}text\nplain\n${FENCE}`,
      '`= this.file.name` is plain Dataview text; a $ sign and = signs are text.',
      'A scripted scene, an embedded quote, an objection, 100% sure, <b>bold</b>, a <scripture> tag, <img src="art/a.png">.',
      `${FENCE}markdown\n# Title\n${FENCE}`,
    ].join('\n\n');
    expect(findExecutable(ordinary)).toEqual([]);
    expect(withoutCode(ordinary)).toBe(ordinary);
  });
});

describe('inline Dataview JS anywhere (re-review 2, R3)', () => {
  it('flags $= wherever Dataview could read it, entity forms included, and makes each inert', () => {
    const probes = [
      '```text\n$= dv.el("p", 1)\n```', '~~~\n$= dv.x\n~~~', '    $= dv.el("p", 1)', '```md\n  $= dv.x\n```',
      "<code>$= dv.el('p', 1)</code>", '<code>&#36;= dv.x</code>', '<code>$&#61; dv.x</code>', '<code>&#x24;&#x3D; dv.x</code>',
      '<code>&dollar;&equals; dv.x</code>', '<code>&#036;= dv.x</code>', 'plain $= prose',
    ];
    for (const probe of probes) {
      expect(findExecutable(probe), probe).toEqual(['dataview-inline']);
      const once = withoutCode(probe);
      expect(findExecutable(once), once).toEqual([]);
      expect(withoutCode(once)).toBe(once);
    }
    expect(withoutCode('<code>&#36;= dv.x</code>')).toBe('<code>&amp;#36;= dv.x</code>');
    expect(withoutCode('```text\n$= dv.x\n```')).toBe(`\`\`\`text\n$${ZW}= dv.x\n\`\`\``);
  });
});

describe('frames and webviews (re-review 2, M-R5)', () => {
  it('flags webview, frame and frameset as HTML that embeds something', () => {
    for (const tag of ['<webview src="https://x">', '<frame src=x>', '<frameset rows="*">', '</FRAMESET>']) {
      expect(findExecutable(tag), tag).toEqual(['html']);
      expect(findExecutable(withoutCode(tag))).toEqual([]);
    }
    expect(findExecutable('a <framework> and <frames>')).toEqual([]);
  });
});

describe('pulling without code', () => {
  it('makes each kind inert: escaped in prose, invisibly broken in code, the rest byte for byte', () => {
    const inert = withoutCode(ALL_KINDS);
    expect(findExecutable(inert)).toEqual([]);
    expect(inert).toContain(`${FENCE}text\ndv.paragraph(1)\n${FENCE}`);
    expect(inert).toContain('~~~text\nreturn 1\n~~~');
    expect(inert).toContain(`\`$${ZW}= dv.current().gold\` coins`);
    expect(inert).toContain('<\\%* tR += await tp.system.prompt("x") %>');
    expect(inert).toContain('&lt;iframe src="https://evil.example">&lt;/iframe>');
    expect(inert).toContain('&lt;img src="https://tracker.example/p.png">');
  });

  it('does not show an escape inside code: Templater and tags there get an invisible break', () => {
    expect(withoutCode(`${FENCE}erb\n<%= name %>\n${FENCE}`)).toBe(`${FENCE}erb\n<${ZW}%= name %>\n${FENCE}`);
    expect(withoutCode('Use `<% tp.date.now() %>` here')).toBe(`Use \`<${ZW}% tp.date.now() %>\` here`);
    expect(withoutCode(`${FENCE}html\n<script>1</script>\n${FENCE}`)).toBe(`${FENCE}html\n<${ZW}script>1<${ZW}/script>\n${FENCE}`);
    // A fence opened in a quote ends with it: the prose after it is escaped as prose.
    expect(withoutCode('> ```\n> <% x %>\n<% y %>\n')).toBe(`> \`\`\`\n> <${ZW}% x %>\n<\\% y %>\n`);
  });

  it('keeps CRLF line endings, block quotes and info after the language', () => {
    const crlf = `> ${FENCE}dataviewjs\r\n> x\r\n> ${FENCE}\r\nok\r\n`;
    expect(withoutCode(crlf)).toBe(`> ${FENCE}text\r\n> x\r\n> ${FENCE}\r\nok\r\n`);
    expect(withoutCode(`${FENCE}js-engine {x}\n${FENCE}`)).toBe(`${FENCE}text {x}\n${FENCE}`);
    expect(withoutCode(`- ${FENCE}datacorejsx\n  x\n  ${FENCE}`)).toBe(`- ${FENCE}text\n  x\n  ${FENCE}`);
  });

  it('never leaves anything to find, whatever the nesting (a table of parts, in pairs and with a tail)', () => {
    const parts = [
      ALL_KINDS, DVJS, '<%', '`$=x`', '<script', `${FENCE}js\n<% x %>\n${FENCE}`, '> <embed src=x>', '\r\n', '``$=``', '> ```', '> > ~~~~js',
      '`', '\n\n', '<div>', '```', '- ```dataviewjs', '`\n$= x`', '<img src=//t', '`//t">`', '<style>', '\\`', '> [!note]', '~~~', '    ```ts',
    ];
    for (const a of parts) {
      for (const b of parts) {
        const text = `${a}\n${b}`;
        const once = withoutCode(text);
        expect(findExecutable(once), JSON.stringify(text)).toEqual([]);
        expect(withoutCode(once)).toBe(once);
        for (const c of ['\n<iframe src=x>', '\n`$= y`', '\n<% z %>']) expect(findExecutable(withoutCode(`${text}${c}`)), JSON.stringify(text + c)).toEqual([]);
      }
    }
  });

  it('a seeded fuzz of nested quotes, fences, spans and code never leaves anything to find', () => {
    const atoms = ['> ', '> > ', '```', '````', '~~~', 'dataviewjs', 'js', '\n', '\r\n', '`', '``', '$=', '$', '=', '&#36;', '&', '#61;', '<%', '<iframe', '<frame', '<img src=//x', '<style', '\\', ' ', 'text', '- ', '1. ', '    '];
    let seed = 7;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let round = 0; round < 3000; round++) {
      let text = '';
      for (let index = next() % 30; index > 0; index--) text += atoms[next() % atoms.length];
      expect(findExecutable(withoutCode(text)), JSON.stringify(text)).toEqual([]);
    }
  });

  it('names what was found in the dialog as known kinds, with Pull without code focused last', () => {
    const kinds: CodeKind[] = ['code-block', 'templater'];
    expect(codeKindsText(kinds)).toBe('code blocks other plugins run (such as Dataview, Datacore or JS Engine); and Templater commands');
    const dialog = pulledCodeDialog('Cave', 'Ana', kinds);
    expect(dialog.message[0]).toContain('Templater commands');
    expect(dialog.message.join(' ')).toContain('known kinds');
    expect(dialog.choices.map((choice) => choice.label)).toEqual(['Pull as is (I trust Ana)', 'Pull without code']);
    expect(dialog.choices.at(-1)?.value).toBe('without');
  });
});

const NOTE = 'c'.repeat(22);
const cave = (version: string): CatalogueItem => ({ item: NOTE, kind: 'note', title: 'Cave', version, size: 4 });
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

async function setup(answers: Array<PulledCodeChoice | null>, policy: NoteUpdatePolicy = keepBothPolicy) {
  const { app, files } = createInMemoryApp();
  const pulled = PulledItems.create(app.vault.adapter, PATHS);
  await pulled.ready();
  let text = DVJS;
  let version = 'A'.repeat(43);
  const node = {
    requestList: vi.fn(async () => [cave(version)]),
    pull: vi.fn(async () => ({ kind: 'note' as const, version, bytes: bytes(text) })),
  };
  const asked: Array<readonly CodeKind[]> = [];
  const service = new SharedWithMe({
    app, pulled, node: node as never, tableId: TABLE_ID, policy, nameOf: () => 'Ana', nameAt: () => 'Ana', scenes: {} as never,
    confirmMapUpdate: async () => 'theirs',
    confirmCode: async (_title, _person, kinds) => { asked.push(kinds); return answers.shift() ?? null; },
  });
  const pull = async (): Promise<unknown> => service.pull('ana', (await service.refresh('ana')).items[0]!);
  return { files, pull, asked, send: (next: string, nextVersion: string) => { text = next; version = nextVersion; } };
}

describe('a pull that finds code', () => {
  it('asks which kinds were found; Pull without code writes the note inert', async () => {
    const { files, pull, asked } = await setup(['without']);
    await pull();
    expect(asked).toEqual([['code-block']]);
    expect(files.get('Shared/Ana/Cave.md')).toBe(withoutCode(DVJS));
    expect(files.get('Shared/Ana/Cave.md')).toContain(`${FENCE}text`);
  });

  it('Pull as is writes it as received; cancelling writes nothing', async () => {
    const trusted = await setup(['as-is']);
    await trusted.pull();
    expect(trusted.files.get('Shared/Ana/Cave.md')).toBe(DVJS);
    const cancelled = await setup([null]);
    expect(await cancelled.pull()).toEqual({ kind: 'cancelled' });
    expect(cancelled.files.has('Shared/Ana/Cave.md')).toBe(false);
  });

  it('asks again on every pull of an update, and does not ask for a note without code', async () => {
    const { files, pull, asked, send } = await setup(['as-is', 'without']);
    await pull();
    send(`${DVJS}\nmore\n`, 'B'.repeat(43));
    await pull();
    expect(asked).toHaveLength(2);
    expect(files.get('Shared/Ana/Cave.md')).toBe(withoutCode(`${DVJS}\nmore\n`));
    send('plain text', 'C'.repeat(43));
    await pull();
    expect(asked).toHaveLength(2);
    expect(files.get('Shared/Ana/Cave.md')).toBe('plain text');
  });

  it('gives a merge the text that would be written', async () => {
    const seen: UpdateContext[] = [];
    const policy: NoteUpdatePolicy = { resolve: async (context) => { seen.push(context); return { kind: 'write', text: context.theirs }; } };
    const { files, pull, send } = await setup(['without', 'without'], policy);
    await pull();
    files.set('Shared/Ana/Cave.md', `${files.get('Shared/Ana/Cave.md')!}\nmine\n`);
    send(`${DVJS}\ntheirs\n`, 'B'.repeat(43));
    await pull();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.theirs).toBe(withoutCode(`${DVJS}\ntheirs\n`));
    expect(findExecutable(files.get('Shared/Ana/Cave.md')!)).toEqual([]);
  });
});
