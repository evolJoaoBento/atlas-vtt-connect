import {expect, it, vi, afterEach} from 'vitest';
import {TurnOrderView} from '../../../online-client/turnOrderView.mts';
import {playerScene} from './sceneFixtures';
afterEach(() => document.body.replaceChildren());
it('opens, sends the owned initiative and lists the shared numbers in descending order', () => {
  const panel=document.createElement('aside'); panel.hidden=true;
  const button=document.createElement('button'); document.body.append(panel,button);
  const send=vi.fn(() => true); const view=new TurnOrderView(panel,button,send);
  const scene=playerScene();
  scene.initiative={active:true,round:1,entries:[{id:'a',tokenId:'t1',name:'Hero',initiative:12,hp:null,isActive:true},{id:'b',tokenId:'t2',name:'NPC',initiative:18,hp:null,isActive:false}]};
  view.update(scene,[]); button.click(); expect(panel.hidden).toBe(false);
  const roll=panel.querySelector<HTMLInputElement>('input[type=number]')!; panel.querySelector<HTMLInputElement>('input[type=text]')!.value='Goblin livre'; roll.value='20'; panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(send).toHaveBeenCalledWith('Goblin livre',20);
  expect(panel.querySelector('li')?.textContent).toContain('18 · NPC');
  view.update(scene,[]); panel.querySelector<HTMLInputElement>('input[type=text]')!.value=''; panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true})); expect(send).toHaveBeenCalledOnce();
});

it('deletes by stable entry ID, and the shared scene update removes the row',()=>{
 const panel=document.createElement('aside');const button=document.createElement('button');document.body.append(panel,button);
 const remove=vi.fn(()=>true);const view=new TurnOrderView(panel,button,()=>true,remove);
 const scene=playerScene();scene.initiative={round:0,active:false,entries:[{id:'manual-id',tokenId:'rpg-turn-00000000-0000-4000-8000-000000000001',initiative:12,name:'Goblin',hp:null,isActive:false}]};
 view.update(scene,[]);panel.querySelector<HTMLButtonElement>('li button')!.click();expect(remove).toHaveBeenCalledWith('manual-id');
 scene.initiative.entries=[];view.update(scene,[]);expect(panel.querySelector('li')?.textContent).toBe('Nenhuma iniciativa registrada.');
});
