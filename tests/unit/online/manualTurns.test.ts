import {expect,it} from 'vitest';
import {projectInitiative} from '../../../src/app/online/scene/projectPanels';
import type {PlayerViewRules} from '../../../src/app/online/scene/playerViewRules';
import {decodeControl,encodeControl} from '../../../src/app/online/protocol';
it('publishes manual names, while an unshown token remains private',()=>{
 const entry={id:'manual',tokenId:'rpg-turn-00000000-0000-4000-8000-000000000001',name:'Nome livre',initiative:19,initiativeModifier:0,imagePath:'',isActive:false,isNPC:true,order:0};
 const state={initiativeTrackerOpen:true,initiative:{entries:[entry,{...entry,id:'hidden',tokenId:'hidden',name:'Segredo'}],currentIndex:-1,round:0,isActive:false,config:{autoSort:true}},objects:{tokens:{},texts:{},drawings:{},fog:{}}};
 const projected=projectInitiative(state,new Set(),{showInitiative:true,showTokenNameplates:false} as PlayerViewRules);
 expect(projected?.entries.map(e=>e.name)).toEqual(['Nome livre']);
 for(const name of ['', 'x'.repeat(121),'bad\nname']) expect(decodeControl(encodeControl({v:1,type:'turn-add',sceneId:'scene',name,value:19})).kind).toBe('invalid');
 expect(decodeControl(encodeControl({v:1,type:'turn-add',sceneId:'scene',name:'Livre',value:0})).kind).toBe('message');
});
