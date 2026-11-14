import {expect,it} from 'vitest';
import {computeTokenPixelSize,restingTokenUIScale} from '@atlas-vtt/shared/draw';
import {drawTokenUi} from '../../../src/app/online/view/layers/tokenUiDrawing';
import type {PlayerToken} from '../../../src/app/online/scene/sceneTypes';
import {RecordingSurface} from './recordingSurface';
it('scales condition badges in proportion to token diameter, retaining the default size',()=>{
 const token={x:0,y:0,name:null,resources:[],wheels:[],conditions:[{id:'condition',name:'Charmed',value:null}],hp:null} as unknown as PlayerToken;
 const render=(size:number)=>{const surface=new RecordingSurface();const pixels=computeTokenPixelSize(70,size);drawTokenUi(surface,token,{size:pixels,cellSize:70,ringRadius:pixels/2});return surface.calls.find(c=>c.op==='push');};
 const normal=render(1);const large=render(2.75);const small=render(.75);
 expect(normal?.op).toBe('push');expect(large?.op).toBe('push');expect(small?.op).toBe('push');
 if(normal?.op!=='push'||large?.op!=='push'||small?.op!=='push')throw new Error('Badge was not drawn');
 expect(normal.scale).toBeCloseTo(restingTokenUIScale(70));
 expect(large.scale/normal.scale).toBeCloseTo(computeTokenPixelSize(70,2.75)/computeTokenPixelSize(70,1));
 expect(small.scale/normal.scale).toBeCloseTo(computeTokenPixelSize(70,.75)/computeTokenPixelSize(70,1));
});
