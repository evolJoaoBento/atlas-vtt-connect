import {loggedSession,createOnlineLog} from '../../../src/app/online/onlineLog';
import type {SceneSession} from '../../../src/app/online/scene/sceneContracts';
import {expect,it,vi} from 'vitest';
import {isEditMatrix,resizeMap,matrixBounds,type EditMatrix} from '../../../src/app/online/control/mapEdits';
import {TokenEditHandler} from '../../../src/app/online/control/TokenEditHandler';
import type {TokenCopyHandlerOptions} from '../../../src/app/online/control/TokenCopyHandler';
import type {SessionPlayer} from '../../../src/app/online/GmSession';
import {stockTokensApi,type TokenView} from '../../../src/connect/stockTokens/stockTokens';
const base:EditMatrix=[100,0,0,80,10,20];
it('moves and independently stretches each edge, preserving the opposite anchor',()=>{
 expect(resizeMap(base,'move',{x:20,y:40},{x:0,y:0})).toEqual([100,0,0,80,30,60]);
 expect(resizeMap(base,'se',{x:210,y:180},{x:0,y:0})).toEqual([200,0,0,160,10,20]);
 resizeMap(base,'w',{x:0,y:20},{x:0,y:0}).forEach((value,index)=>expect(value).toBeCloseTo([110,0,0,80,0,20][index]!));
 expect(matrixBounds(base)).toEqual({x:10,y:20,width:100,height:80});
 for(const m of [[1,0,0,1,0,0],[100,0,0,-80,0,0],[100,0,0,80,Infinity,0],[],[1000000,0,0,80,0,0]])expect(isEditMatrix(m)).toBe(false);
 expect(isEditMatrix(base)).toBe(true);
});
it('refuses map edits without the private GM key or for another scene',()=>{
 const editMap=vi.fn(()=>true);const options={session:{send:vi.fn(),canEditMap:(key:string)=>key==='private'},projection:{slotOf:()=>({sceneId:'scene',lastSent:{map:{asset:'image'}},tab:{viewId:'view'}})},tokens:{editMap}} as unknown as TokenCopyHandlerOptions;
 const h=new TokenEditHandler(options);const player={playerId:'p'} as SessionPlayer;
 h.onMessage(player,{v:1,type:'map-edit',sceneId:'scene',key:'bad',matrix:base});
 h.onMessage(player,{v:1,type:'map-edit',sceneId:'other',key:'private',matrix:base});expect(editMap).not.toHaveBeenCalled();
 h.onMessage(player,{v:1,type:'map-edit',sceneId:'scene',key:'private',matrix:base});expect(editMap).toHaveBeenCalledWith('view',base);
});
it('persists the web map matrix in existing grid metadata without moving tokens',()=>{
 const setGrid=vi.fn();const grid={size:70,snapToGrid:true};const state={mapLoaded:true,isMapLoading:false,grid,background:'map.png',lighting:{enabled:false},objects:{tokens:{}},setGrid};
 const api=stockTokensApi({view:()=>({viewId:'view',atlasStore:{getState:()=>state}}) as unknown as TokenView,mapSize:()=>({width:100,height:80}),dynamicLighting:()=>false});
 expect(api.editMap?.('view',base)).toBe(true);expect(setGrid).toHaveBeenCalledWith({...grid,rpgMapLayouts:{'map.png':base}});
});

it('preserves GM authorization through the production logging wrapper',()=>{
 const session={canEditMap:(key:string)=>key==='gm',use:()=>()=>{},send:()=>{},getPlayers:()=>[]} satisfies SceneSession;
 const wrapped=loggedSession(session,createOnlineLog(()=>false));
 expect(wrapped.canEditMap?.('gm')).toBe(true);expect(wrapped.canEditMap?.('player')).toBe(false);
});
