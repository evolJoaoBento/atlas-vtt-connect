import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Disposer, ViewContext } from '@atlas-vtt/api-types';
import { OnlinePanel, type PanelEnv } from './OnlinePanel';

/** Renders the online panel into Atlas's panel container with Connect's own React root; the disposer unmounts it. */
export function mountPanel(env: PanelEnv, container: HTMLElement, ctx: ViewContext): Disposer {
  const root = createRoot(container);
  root.render(<OnlinePanel env={env} ctx={ctx} />);
  return () => root.unmount();
}
