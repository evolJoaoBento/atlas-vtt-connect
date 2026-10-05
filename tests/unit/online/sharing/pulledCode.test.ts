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
].join('\n\n');

describe('finding executable content', () => {
  it('finds each kind, named in a fixed order', () => {
    expect(findExecutable(ALL_KINDS)).toEqual(['dataviewjs', 'js-engine', 'dataview-inline', 'templater', 'html']);
    expect(findExecutable('<% tp.date.now() %>')).toEqual(['templater']);
    for (const tag of ['<script>alert(1)</script>', '<object data="x">', '<embed src="x">', '<IFRAME src=x>', '</script>']) expect(findExecutable(tag)).toEqual(['html']);
    expect(findExecutable(`> ${FENCE}dataviewjs\n> x\n> ${FENCE}`)).toEqual(['dataviewjs']);
    expect(findExecutable(`- item\n\n      ${FENCE}DataviewJS\n      x\n      ${FENCE}`)).toEqual(['dataviewjs']);
    expect(findExecutable(`${FENCE} js-engine {x}\nx\n${FENCE}`)).toEqual(['js-engine']);
  });

  it('leaves ordinary code and prose alone: no false positives', () => {
    const ordinary = [
      `${FENCE}js\nconst a = '<script>';\n${FENCE}`,
      `${FENCE}html\n<iframe src="x"></iframe>\n<script>1</script>\n${FENCE}`,
      `${FENCE}dataview\nTABLE file.name\n${FENCE}`,
      '`<script>` and `<iframe>` are tags; `= this.file.name` is plain Dataview; $= outside code is text.',
      'A scripted scene, an embedded quote, an objection, 100% sure, <b>bold</b>, a <scripture> tag.',
      `${FENCE}dataviewjsx\nx\n${FENCE}`,
      `~~~~\n${FENCE}dataviewjs (shown, not run)\n~~~~`.replace('dataviewjs (shown, not run)', 'text'),
    ].join('\n\n');
    expect(findExecutable(ordinary)).toEqual([]);
    expect(withoutCode(ordinary)).toBe(ordinary);
  });

  it('treats a fence indented four spaces as prose, so the HTML after it still counts', () => {
    expect(findExecutable(`    ${FENCE}\n<iframe src="x"></iframe>\n`)).toEqual(['html']);
    // An unclosed fence runs to the end: what follows is not rendered.
    expect(findExecutable(`${FENCE}\n<iframe src="x"></iframe>\n`)).toEqual([]);
    // A closer must use the opener's character and be at least as long.
    expect(findExecutable(`${FENCE}${FENCE[0]}\n${FENCE}\n<iframe>\n${FENCE}${FENCE[0]}\n<iframe>`)).toEqual(['html']);
  });
});

describe('pulling without code', () => {
  it('makes each kind inert and keeps the rest byte for byte', () => {
    const inert = withoutCode(ALL_KINDS);
    expect(findExecutable(inert)).toEqual([]);
    expect(inert).toContain(`${FENCE}text\ndv.paragraph(1)\n${FENCE}`);
    expect(inert).toContain('~~~text\nreturn 1\n~~~');
    expect(inert).toContain('`$ = dv.current().gold` coins');
    expect(inert).toContain('<\\%* tR += await tp.system.prompt("x") %>');
    expect(inert).toContain('&lt;iframe src="https://evil.example">&lt;/iframe>');
  });

  it('keeps CRLF line endings, block quotes and info after the language', () => {
    const crlf = `> ${FENCE}dataviewjs\r\n> x\r\n> ${FENCE}\r\nok\r\n`;
    expect(withoutCode(crlf)).toBe(`> ${FENCE}text\r\n> x\r\n> ${FENCE}\r\nok\r\n`);
    expect(withoutCode(`${FENCE}js-engine {x}\n${FENCE}`)).toBe(`${FENCE}text {x}\n${FENCE}`);
  });

  it('never leaves anything to find, whatever the mix', () => {
    const parts = [ALL_KINDS, DVJS, '<%', '`$=x`', '<script', `${FENCE}js\n<% x %>\n${FENCE}`, '> <embed src=x>', '\r\n', '``$=``'];
    for (let a = 0; a < parts.length; a++) {
      for (let b = 0; b < parts.length; b++) {
        const text = `${parts[a]!}\n${parts[b]!}`;
        expect(findExecutable(withoutCode(text)), text).toEqual([]);
        expect(withoutCode(withoutCode(text))).toBe(withoutCode(text));
      }
    }
  });

  it('names what was found in the dialog, with Pull without code focused last', () => {
    const kinds: CodeKind[] = ['dataviewjs', 'templater'];
    expect(codeKindsText(kinds)).toBe('Dataview JS blocks and Templater commands');
    const dialog = pulledCodeDialog('Cave', 'Ana', kinds);
    expect(dialog.message[0]).toContain('Dataview JS blocks and Templater commands');
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
    expect(asked).toEqual([['dataviewjs']]);
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
