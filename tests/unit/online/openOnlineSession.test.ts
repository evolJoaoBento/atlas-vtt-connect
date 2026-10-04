import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openOnlineSessionModal } = vi.hoisted(() => ({ openOnlineSessionModal: vi.fn() }));

vi.mock('../../../src/app/online/ui/OnlineSessionModal', () => ({ openOnlineSessionModal }));

import { openOnlineSession } from '../../../src/app/online/ui/openOnlineSession';

// The fork's cases for the online panel in an Atlas view (active view first, then the first open one, never in a
// player view) come with Atlas's UI slots (plan B11). Until then every Atlas view counts as one that cannot show it.
describe('Online session… command', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens the modal when no Atlas view can show the online panel', () => {
    const app = { workspace: { getActiveViewOfType: () => null, getLeavesOfType: () => [] } } as never;
    openOnlineSession(app);
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
    expect(openOnlineSessionModal).toHaveBeenCalledWith(app);
  });
});
