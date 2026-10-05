/**
 * How a note line is read past its markers: any run of spaces or tabs, list markers (`-`, `*`, `+`,
 * `N.`, `N)`) and `>` are stripped, so a line nested in a list or a quote, or behind a tab, is still read.
 * Depth is the count of `>`. Used to tell a line left with only markers (dropped by the filter) and
 * whether tag text sits where an old `> [!private]` callout header would.
 */
export interface QuoteLine {
  depth: number;
  content: string;
}

const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;

export function lenientQuote(line: string): QuoteLine {
  let depth = 0;
  let rest = line;
  for (;;) {
    rest = rest.replace(/^[ \t]+/, '');
    if (rest.startsWith('>')) {
      depth++;
      rest = rest.slice(1);
      continue;
    }
    const marker = LIST_MARKER.exec(rest);
    if (!marker) return { depth, content: rest };
    rest = rest.slice(marker[0].length);
  }
}
