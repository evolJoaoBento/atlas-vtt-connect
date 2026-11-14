import {expect,it,vi} from 'vitest';
import {TokenEditHandler} from '../../../src/app/online/control/TokenEditHandler';
import type {TokenCopyHandlerOptions} from '../../../src/app/online/control/TokenCopyHandler';
import type {SessionPlayer} from '../../../src/app/online/GmSession';
it('checks shown scene, actual entry and ownership before removal',()=>{
 const entry={id:'entry',tokenId:'rpg-turn-00000000-0000-4000-8000-000000000001'};
 const current={...entry};const removeTurn=vi.fn(()=>true);const controls=vi.fn(()=>false);
 const options={session:{send:vi.fn()},tokens:{removeTurn},control:{controls},projection:{slotOf:()=>({sceneId:'scene',tab:{viewId:'v'},lastSent:{initiative:{entries:[entry]}}}),shownSnapshot:()=>({initiative:{entries:[current,{id:'hidden',tokenId:'hidden-token'}]}})}} as unknown as TokenCopyHandlerOptions;
 const handler=new TokenEditHandler(options);const player={playerId:'p'} as SessionPlayer;
 handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'scene',entryId:'entry'});expect(removeTurn).toHaveBeenCalledWith('v','entry');
 handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'scene',entryId:'hidden'});
 handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'other',entryId:'entry'});
 current.tokenId='replaced';handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'scene',entryId:'entry'});expect(removeTurn).toHaveBeenCalledOnce();
 entry.tokenId=current.tokenId='owned';handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'scene',entryId:'entry'});expect(removeTurn).toHaveBeenCalledOnce();
 controls.mockReturnValue(true);handler.onMessage(player,{v:1,type:'turn-remove',sceneId:'scene',entryId:'entry'});expect(removeTurn).toHaveBeenCalledTimes(2);
});
