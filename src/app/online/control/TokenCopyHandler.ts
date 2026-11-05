import type { TokensApi } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotProjection } from '../scene/slotViews';
import { MAX_CONTROLLED_TOKENS, type ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import { heldOffTurn } from './turnHold';
import type { TokenControl } from './TokenControl';

/** Optional Connect operation on stock Atlas; API hosts without it refuse copies. */
export type CopyableTokens = Pick<TokensApi, 'move'> & { duplicate?(viewId: string, tokenId: string): string | null };

export interface TokenCopyHandlerOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot'>;
  control: TokenControl;
  tokens: CopyableTokens;
  movesOnTurn?: () => boolean;
}

export class TokenCopyHandler implements SessionHandler {
  private readonly limit = new RateLimit(2);
  private stopSession: (() => void) | null = null;
  constructor(private readonly options: TokenCopyHandlerOptions) {}
  start(): void { this.stopSession ??= this.options.session.use(this); }
  stop(): void { this.stopSession?.(); this.stopSession = null; }
  retainPlayers(known: ReadonlySet<string>): void { this.limit.retain(known); }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'token-copy' || !this.limit.allow(player.playerId, Date.now())) return;
    const { control, projection, tokens } = this.options;
    const refuse = (): void => { this.options.session.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId }); };
    const slot = projection.slotOf(player.playerId);
    const scene = slot?.lastSent;
    const snapshot = slot ? projection.shownSnapshot(slot.sceneId) : null;
    const source = snapshot && Object.hasOwn(snapshot.objects.tokens, message.tokenId) ? snapshot.objects.tokens[message.tokenId] : null;
    if (!tokens.duplicate || !control.controls(player.playerId, message.tokenId)
      || control.tokensOf(player.playerId).length >= MAX_CONTROLLED_TOKENS
      || !scene || scene.sceneId !== message.sceneId || !snapshot || !source || source.isHidden
      || !Object.hasOwn(scene.tokens, message.tokenId)
      || (this.options.movesOnTurn?.() === true && heldOffTurn(scene, message.tokenId))) { refuse(); return; }
    // Only the source id goes to Atlas: the browser cannot supply stats, images, owners or positions.
    const id = tokens.duplicate(slot.tab.viewId, message.tokenId);
    if (!id) { refuse(); return; }
    control.set(id, player.playerId, true);
  }
}
