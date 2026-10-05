import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { shareItemLabels, sharePropertyView, shareSummary, UNRECOGNISED_LABEL } from '../../../../../src/app/online/sharing/display/shareProperty';
import { clearShareProperty, decorateShareProperty, SharePropertyDecorator } from '../../../../../src/app/online/sharing/display/sharePropertyDom';
import { shareYamlEntries, shareYamlExtension, yamlEntryClass } from '../../../../../src/app/online/sharing/display/shareYaml';
import { testPeople, testPerson } from '../sharingFixtures';

const book = testPeople([testPerson('guy', 'Guy'), testPerson('dave', 'Dave')]);
const people = { ...book, allByName: (name: string) => [book.byName(name)].filter((person) => person !== null), isPlaceholder: (name: string) => name === 'Zed' };
const labels = (value: unknown): Array<[string, string, string]> => shareItemLabels(value, people).map((label) => [label.tone, label.text, label.status]);

describe('atlas-share values as labels (the filter’s parser)', () => {
  it('maps each recognised entry to its label', () => {
    expect(labels('public')).toEqual([['public', 'Public', 'ok']]);
    expect(labels('private')).toEqual([['private', 'Private', 'ok']]);
    expect(labels('Guy')).toEqual([['only', 'Only Guy', 'ok']]);
    expect(labels('except Dave')).toEqual([['except', 'Except Dave', 'ok']]);
    expect(labels({ except: 'Dave' })).toEqual([['except', 'Except Dave', 'ok']]);
    expect(labels('Guy, Dave')).toEqual([['only', 'Only Guy', 'ok'], ['only', 'Only Dave', 'ok']]);
  });

  it('marks people not met yet, and names and entries Atlas cannot read, with a reason', () => {
    const [notMet] = shareItemLabels('Zed', people);
    expect(notMet).toMatchObject({ tone: 'only', text: 'Only Zed (not met yet)', status: 'not-met' });
    expect(notMet?.reason).toContain('not met yet');
    expect(shareItemLabels('Nobody', people)[0]).toMatchObject({ tone: 'private', status: 'unrecognised', reason: 'Not in your people list: Nobody.' });
    expect(shareItemLabels({ secret: 'x' }, people)[0]).toMatchObject({ tone: 'private', text: UNRECOGNISED_LABEL, status: 'unrecognised' });
  });

  it('sums up who the whole value reaches, as the filter decides it', () => {
    expect(shareSummary(['public', 'except Dave'], people)).toBe('Shared with: everyone except Dave');
    expect(shareSummary('public', people)).toBe('Shared with: everyone in your sessions');
    expect(shareSummary(['Guy', 'Zed'], people)).toBe('Shared with: Guy');
    expect(shareSummary(['public', 'private'], people)).toBe('Shared with: nobody (private)');
    expect(shareSummary(['public', 'except Nobody'], people)).toBe('Shared with: nobody until Nobody is in your people list');
    expect(shareSummary(['public', { secret: 1 }], people)).toBe('Shared with: nobody, an entry could not be read');
    expect(shareSummary('except Dave', people)).toBe('Shared with: nobody (add public to share with everyone except them)');
  });
});

/** The properties panel's row, as Obsidian draws a list value. */
function listRow(entries: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'metadata-property';
  row.dataset.propertyKey = 'atlas-share';
  row.innerHTML = `<div class="metadata-property-key"><input value="atlas-share"></div><div class="metadata-property-value"><div class="multi-select-container">${
    entries.map((entry) => `<div class="multi-select-pill"><div class="multi-select-pill-content"><span>${entry}</span></div><div class="multi-select-pill-remove-button"></div></div>`).join('')
  }<div class="multi-select-input" contenteditable="true"></div></div></div>`;
  return row;
}

describe('the properties panel row', () => {
  it('colours each pill, never touching Obsidian’s inputs, and adds a line with the reasons and the summary', () => {
    const row = listRow(['public', 'except Dave', 'Nobody']);
    const input = row.querySelector('.multi-select-input');
    decorateShareProperty(row, sharePropertyView(['public', 'except Dave', 'Nobody'], people));
    const pills = [...row.querySelectorAll('.multi-select-pill')].map((pill) => pill.className);
    expect(pills).toEqual([
      'multi-select-pill atlas-share-pill atlas-share-pill--public',
      'multi-select-pill atlas-share-pill atlas-share-pill--except',
      'multi-select-pill atlas-share-pill atlas-share-pill--private atlas-share-unrecognised',
    ]);
    expect(row.querySelector('.multi-select-input')).toBe(input);
    const hint = row.querySelector('.atlas-share-property-hint');
    expect(hint?.textContent).toContain('Shared with: everyone except Dave');
    expect(hint?.textContent).toContain('Not in your people list: Nobody.');
    expect(row.querySelector('[title]')).toBeNull();
  });

  it('a text value is coloured whole, with its labels in the line under it', () => {
    const row = document.createElement('div');
    row.className = 'metadata-property';
    row.dataset.propertyKey = 'atlas-share';
    row.innerHTML = '<div class="metadata-property-value"><div class="metadata-input-longtext" contenteditable="true">Guy</div></div>';
    decorateShareProperty(row, sharePropertyView('Guy', people));
    expect(row.querySelector('.metadata-property-value')?.classList).toContain('atlas-share-text--only');
    expect(row.querySelector('.atlas-share-property-hint .atlas-share-tag--only')?.textContent).toBe('Only Guy');
    expect(row.querySelector('.metadata-input-longtext')?.textContent).toBe('Guy');
  });

  it('decorating again with the same view changes nothing; clearing takes everything off', () => {
    const row = listRow(['public']);
    const view = sharePropertyView(['public'], people);
    decorateShareProperty(row, view);
    const hint = row.querySelector('.atlas-share-property-hint');
    decorateShareProperty(row, view);
    expect(row.querySelector('.atlas-share-property-hint')).toBe(hint);
    clearShareProperty(row);
    expect(row.innerHTML).toBe(listRow(['public']).innerHTML);
  });
});

describe('the decorator follows Obsidian’s redraws and cleans up', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('redecorates a redrawn row, and on destroy stops observing and removes everything', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="metadata-container"><div class="metadata-content"></div></div>';
    document.body.append(root);
    const content = root.querySelector('.metadata-content')!;
    content.append(listRow(['public']));
    const viewOf = vi.fn(() => sharePropertyView(['public'], people));
    const decorator = new SharePropertyDecorator(root, viewOf);
    decorator.refresh();
    expect(root.querySelector('.atlas-share-pill--public')).not.toBeNull();
    content.replaceChildren(listRow(['public']));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(root.querySelector('.atlas-share-pill--public')).not.toBeNull();
    decorator.destroy();
    expect(root.querySelector('.atlas-share-pill, .atlas-share-property-hint')).toBeNull();
    const calls = viewOf.mock.calls.length;
    content.replaceChildren(listRow(['public']));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(viewOf.mock.calls.length).toBe(calls);
    expect(root.querySelector('.atlas-share-pill')).toBeNull();
  });
});

describe('Source mode frontmatter', () => {
  const ranges = (text: string): string[] => shareYamlEntries(text).map((entry) => `${text.slice(entry.from, entry.to)}=>${entry.value}`);

  it('finds the entries of a scalar, a flow list and a block list', () => {
    expect(ranges('---\natlas-share: public\n---\nBody')).toEqual(['public=>public']);
    expect(ranges('---\ntitle: x\natlas-share: [public, "except Dave", {except: Guy}]\n---\n')).toEqual(['public=>public', '"except Dave"=>except Dave', '{except: Guy}=>except: Guy']);
    expect(ranges('---\natlas-share:\n  - Guy\n  - except: Dave\nother: 1\n---\n')).toEqual(['Guy=>Guy', 'except: Dave=>except: Dave']);
    expect(ranges('No frontmatter\natlas-share: public')).toEqual([]);
  });

  it('colours each entry like its label, the unrecognised look for what Atlas cannot read', () => {
    expect(yamlEntryClass(shareItemLabels('except: Dave', people))).toBe('atlas-share-yaml atlas-share-yaml--except');
    expect(yamlEntryClass(shareItemLabels('Nobody', people))).toBe('atlas-share-yaml atlas-share-yaml--private atlas-share-unrecognised');
    const state = EditorState.create({ doc: '---\natlas-share: [public, Zed]\n---\n', extensions: [shareYamlExtension(people)] });
    const classes: string[] = [];
    for (const set of state.facet(EditorView.decorations)) {
      if (typeof set === 'function') continue;
      set.between(0, state.doc.length, (from, to, value) => { classes.push(`${state.doc.sliceString(from, to)}:${String((value.spec as { class?: string }).class)}`); });
    }
    expect(classes).toEqual(['public:atlas-share-yaml atlas-share-yaml--public', 'Zed:atlas-share-yaml atlas-share-yaml--only atlas-share-not-met']);
  });
});
