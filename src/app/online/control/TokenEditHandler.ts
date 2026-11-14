import { isManualTurn } from './manualTurns';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { TokenCopyHandlerOptions } from './TokenCopyHandler';
import { isTokenEdit } from './tokenEdits';
import { isLightProfile } from '../lighting/lightMask';

/** Ownership and visibility are checked against the master's current scene, never client data. */
export class TokenEditHandler implements SessionHandler {
  private readonly limit = new RateLimit(8);
  private stopSession: (() => void) | null = null;
  constructor(private readonly options: TokenCopyHandlerOptions) {}
  start(): void { this.stopSession ??= this.options.session.use(this); }
  stop(): void { this.stopSession?.(); this.stopSession = null; }
  retainPlayers(known: ReadonlySet<string>): void { this.limit.retain(known); }
  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'map-edit') {
      if (!this.limit.allow(player.playerId, Date.now())) {
        if(this.options.session.canEditMap?.(message.key))this.options.session.send(player.playerId,{v:1,type:'map-edit-result',sceneId:message.sceneId,accepted:false});
        return;
      }
      const slot = this.options.projection.slotOf(player.playerId);
      const accepted = !!this.options.session.canEditMap?.(message.key) && !!slot?.lastSent && slot.sceneId === message.sceneId && !!slot.lastSent.map.asset && (this.options.tokens.editMap?.(slot.tab.viewId, message.matrix) ?? false);
      this.options.session.send(player.playerId,{v:1,type:'map-edit-result',sceneId:message.sceneId,accepted});
      return;
    }
    if (message.type === 'turn-remove') {
      if (!this.limit.allow(player.playerId, Date.now())) return;
      const slot = this.options.projection.slotOf(player.playerId);
      const entry = slot?.lastSent?.initiative?.entries.find(candidate => candidate.id === message.entryId);
      const current = slot ? this.options.projection.shownSnapshot(slot.sceneId)?.initiative?.entries.find(candidate => candidate.id === message.entryId) : null;
      if (slot?.sceneId === message.sceneId && entry && current?.tokenId === entry.tokenId && (isManualTurn(entry.tokenId) || this.options.control.controls(player.playerId, entry.tokenId))) this.options.tokens.removeTurn?.(slot.tab.viewId, entry.id);
      return;
    }
    if (message.type === 'turn-add') {
      if (!this.limit.allow(player.playerId, Date.now())) return;
      const slot = this.options.projection.slotOf(player.playerId);
      if (slot?.lastSent && slot.sceneId === message.sceneId) this.options.tokens.addTurn?.(slot.tab.viewId, message.name, message.value);
      return;
    }
    if (message.type === 'dynamic-light-toggle') return;
    if (message.type === 'token-light-flash') {
      if (!this.limit.allow(player.playerId, Date.now()) || !this.options.projection.flashAt) return;
      const slot = this.options.projection.slotOf(player.playerId);
      const snapshot = slot ? this.options.projection.shownSnapshot(slot.sceneId) : null;
      const token = snapshot && Object.hasOwn(snapshot.objects.tokens, message.tokenId) ? snapshot.objects.tokens[message.tokenId] : null;
      if (slot?.sceneId === message.sceneId && token && !token.isHidden && Number.isFinite(token.x) && Number.isFinite(token.y)
        && Object.hasOwn(slot.lastSent?.tokens ?? {}, message.tokenId) && this.options.control.controls(player.playerId, message.tokenId)) {
        this.options.projection.flashAt(slot.sceneId, token.x, token.y);
      }
      return;
    }
    if (message.type !== 'token-edit' || !this.limit.allow(player.playerId, Date.now())) return;
    const { projection, control, tokens, session } = this.options;
    const slot = projection.slotOf(player.playerId);
    const snapshot = slot ? projection.shownSnapshot(slot.sceneId) : null;
    const token = snapshot && Object.hasOwn(snapshot.objects.tokens, message.tokenId) ? snapshot.objects.tokens[message.tokenId] : null;
    if (!isTokenEdit(message.edit) || (message.edit.light !== undefined && !isLightProfile(message.edit.light)) || !tokens.edit || !control.controls(player.playerId, message.tokenId)
      || !slot?.lastSent || slot.sceneId !== message.sceneId || !snapshot || !token || token.isHidden
      || !Object.hasOwn(slot.lastSent.tokens, message.tokenId)
      || !tokens.edit(slot.tab.viewId, message.tokenId, message.edit)) {
      session.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId });
    }
  }
}
