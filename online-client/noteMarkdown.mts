// online-client/noteMarkdown.mts
/**
 * Draws a pin's note (Markdown, as `tools/pinNotes.ts` sends it) into an element, with text nodes only: nothing in it
 * is ever read as HTML, so a note cannot run script or load anything. It reads what notes mostly hold: headings,
 * paragraphs, lists (with tasks), quotes and callouts, code, rules and tables, and inline bold, italic, strikethrough,
 * highlight and code. Links keep their text and go nowhere: a wiki link reads as its alias or its note's name.
 * Shared with the Obsidian scene tab.
 */

type Inline = { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'mark'; tag: 'strong' | 'em' | 'del' | 'mark'; children: Inline[] };

/** Inline patterns, tried in order at each place; the first that matches there wins. */
const INLINE: Array<{ pattern: RegExp; make: (match: RegExpExecArray) => Inline }> = [
  { pattern: /^`([^`\n]+)`/, make: (m) => ({ kind: 'code', text: m[1]! }) },
  { pattern: /^\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/, make: (m) => ({ kind: 'text', text: (m[2]?.trim() || wikiText(m[1]!)) }) },
  { pattern: /^\[([^\]\n]*)\]\([^)\n]*\)/, make: (m) => ({ kind: 'mark', tag: 'em', children: parseInline(m[1]!) }) },
  { pattern: /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, make: (m) => ({ kind: 'mark', tag: 'strong', children: parseInline(m[2]!) }) },
  { pattern: /^(\*|_)(?=\S)([\s\S]*?\S)\1/, make: (m) => ({ kind: 'mark', tag: 'em', children: parseInline(m[2]!) }) },
  { pattern: /^~~(?=\S)([\s\S]*?\S)~~/, make: (m) => ({ kind: 'mark', tag: 'del', children: parseInline(m[1]!) }) },
  { pattern: /^==(?=\S)([\s\S]*?\S)==/, make: (m) => ({ kind: 'mark', tag: 'mark', children: parseInline(m[1]!) }) },
];

/** A wiki link's text without an alias: its note's name, and its heading after a ›. */
function wikiText(target: string): string {
  const [path = '', ...rest] = target.split('#');
  const name = (path.split('/').pop() ?? '').replace(/\.md$/i, '').trim();
  const heading = rest.join('#').replace(/^\^/, '').trim();
  return [name, heading].filter((part) => part !== '').join(' › ') || target;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    // A backslash keeps the next character as it is.
    if (rest.startsWith('\\') && rest.length > 1) {
      plain += rest[1];
      index += 2;
      continue;
    }
    const found = INLINE.map(({ pattern, make }) => ({ match: pattern.exec(rest), make })).find(({ match }) => match !== null);
    if (found?.match) {
      if (plain) out.push({ kind: 'text', text: plain });
      plain = '';
      out.push(found.make(found.match));
      index += found.match[0].length;
      continue;
    }
    plain += text[index];
    index += 1;
  }
  if (plain) out.push({ kind: 'text', text: plain });
  return out;
}

function appendInline(doc: Document, into: HTMLElement, text: string): void {
  const draw = (parts: Inline[], parent: HTMLElement): void => {
    for (const part of parts) {
      if (part.kind === 'text') parent.append(doc.createTextNode(part.text));
      else if (part.kind === 'code') {
        const code = doc.createElement('code');
        code.textContent = part.text;
        parent.append(code);
      } else {
        const element = doc.createElement(part.tag);
        draw(part.children, element);
        parent.append(element);
      }
    }
  };
  draw(parseInline(text), into);
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** Draws `markdown` into `into`, replacing what it held. */
export function renderNoteMarkdown(markdown: string, into: HTMLElement): void {
  const doc = into.ownerDocument;
  into.replaceChildren();
  renderBlocks(doc, markdown.replace(/\r\n?/g, '\n').split('\n'), into, 0);
}

function renderBlocks(doc: Document, lines: string[], into: HTMLElement, depth: number): void {
  let index = 0;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => doc.createElement(tag);
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = fence[1]!;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith(close)) body.push(lines[index++]!);
      index += 1;
      const pre = el('pre');
      const code = el('code');
      code.textContent = body.join('\n');
      pre.append(code);
      into.append(pre);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // Under the note's own title: # reads as a section heading, the rest one step down each.
      const level = Math.min(6, heading[1]!.length + 2) as 3 | 4 | 5 | 6;
      const element = el(`h${level}`);
      appendInline(doc, element, heading[2]!);
      into.append(element);
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      into.append(el('hr'));
      index += 1;
      continue;
    }
    if (QUOTE.test(line) && depth < 4) {
      const inner: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) inner.push(QUOTE.exec(lines[index++]!)![1]!);
      const quote = el('blockquote');
      const callout = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(inner[0] ?? '');
      if (callout) {
        quote.className = 'note-callout';
        quote.dataset.callout = callout[1]!.toLowerCase();
        const title = el('p');
        title.className = 'note-callout-title';
        appendInline(doc, title, callout[2]?.trim() || callout[1]!.replace(/^\w/, (first) => first.toUpperCase()));
        quote.append(title);
        inner.shift();
      }
      renderBlocks(doc, inner, quote, depth + 1);
      into.append(quote);
      continue;
    }
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]!)) {
      const table = el('table');
      const head = el('thead');
      const headRow = el('tr');
      for (const cell of cells(line)) {
        const th = el('th');
        appendInline(doc, th, cell);
        headRow.append(th);
      }
      head.append(headRow);
      table.append(head);
      const body = el('tbody');
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index]!)) {
        const row = el('tr');
        for (const cell of cells(lines[index++]!)) {
          const td = el('td');
          appendInline(doc, td, cell);
          row.append(td);
        }
        body.append(row);
      }
      table.append(body);
      const wrap = el('div');
      wrap.className = 'note-table';
      wrap.append(table);
      into.append(wrap);
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]!);
      const list = el(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const current = LIST.exec(lines[index]!);
        if (!current || /\d/.test(current[2]!) !== ordered) break;
        const li = el('li');
        const indent = current[1]!.replace(/\t/g, '    ').length;
        if (indent >= 2) li.className = `note-indent-${Math.min(4, Math.floor(indent / 2))}`;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(current[3]!);
        if (task) {
          li.classList.add('note-task');
          li.append(doc.createTextNode(task[1] === ' ' ? '☐ ' : '☑ '));
          appendInline(doc, li, task[2]!);
        } else {
          appendInline(doc, li, current[3]!);
        }
        list.append(li);
        index += 1;
      }
      into.append(list);
      continue;
    }
    // A paragraph: lines up to a blank one or the start of another block, each on its own line as Obsidian shows them.
    const paragraph = el('p');
    let first = true;
    while (index < lines.length) {
      const current = lines[index]!;
      if (current.trim() === '' || (!first && (FENCE.test(current) || HEADING.test(current) || RULE.test(current) || QUOTE.test(current) || LIST.test(current)))) break;
      if (!first) paragraph.append(el('br'));
      appendInline(doc, paragraph, current.trim());
      first = false;
      index += 1;
    }
    into.append(paragraph);
  }
}
