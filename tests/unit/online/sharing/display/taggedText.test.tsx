import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TaggedText, taggedPieces } from '../../../../../src/app/online/sharing/display/TaggedText';
import { tagDisplayOf } from '../../../../../src/app/online/sharing/display/tagDisplay';

const piecesOf = (text: string): ReturnType<typeof taggedPieces> => taggedPieces(text, tagDisplayOf(text, 'inline-only'));

describe('the Share with… preview shows tags as labels', () => {
  it('a forwarded tag ("only you") is a label, its text highlighted, the end tag gone', () => {
    const { container } = render(<pre><TaggedText text={'Open.\n%%[!only|you, Ben]%%\nFor two.\n%%[!end]%%\nAfter'} /></pre>);
    expect(container.textContent).toBe('Open.\nOnly you, Ben\nFor two.\nAfter');
    expect(container.querySelector('.atlas-share-tag--only')?.textContent).toBe('Only you, Ben');
    expect(container.querySelector('.atlas-share-tag-hl--only')?.textContent).toBe('\nFor two.\n');
    expect(container.textContent).not.toContain('%%');
  });

  it('nested parts render as nested highlights', () => {
    const { container } = render(<pre><TaggedText text="%%[!only|you]%%a %%[!private]%%b%%[!end]%% c%%[!end]%%" /></pre>);
    const inner = [...container.querySelectorAll('.atlas-share-tag-hl--private')];
    expect(inner.map((span) => span.textContent)).toEqual(['b']);
    expect(inner[0]?.parentElement?.classList).toContain('atlas-share-tag-hl--only');
  });

  it('inline end tags leave the rest of the line; text without tags is unchanged', () => {
    expect(piecesOf('x %%[!private]%%y%%[!end]%% z').map((piece) => piece.text)).toEqual(['x ', 'Private', 'y', ' z']);
    expect(piecesOf('plain\ntext')).toEqual([{ kind: 'text', text: 'plain\ntext', highlights: [] }]);
  });
});
