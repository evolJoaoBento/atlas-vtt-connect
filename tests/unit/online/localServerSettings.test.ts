import {expect,it,vi} from 'vitest';
import type {App} from 'obsidian';
import {applyLocalServerSettings,parseLocalServerSettings,LOCAL_SERVER_CONFIG} from '../../../src/app/online/localServerSettings';
it('restores the installed server URL after old in-memory settings overwrite data.json', async () => {
  const set=vi.fn(); const read=vi.fn(async () => JSON.stringify({publicUrl:'https://rpg.example/',adminKey:'a'.repeat(64),webDir:'private-folder',port:8787}));
  const app={vault:{adapter:{exists:async()=>true,read}}} as unknown as App;
  await applyLocalServerSettings(app,{set});
  expect(read).toHaveBeenCalledWith(LOCAL_SERVER_CONFIG);
  expect(set).toHaveBeenCalledWith({playerPageUrl:'https://joaodlouro.github.io/atlas-vtt-connect/',localRelay:{url:'https://rpg.example/',adminKey:'a'.repeat(64)}});
});
it('leaves other installations unchanged and refuses malformed installed configuration', async () => {
  const set=vi.fn(); await applyLocalServerSettings({vault:{adapter:{exists:async()=>false}}} as unknown as App,{set}); expect(set).not.toHaveBeenCalled();
  for(const text of ['{}','null','invalid',JSON.stringify({publicUrl:'http://public.example/',adminKey:'a'.repeat(64)}),JSON.stringify({publicUrl:'https://rpg.example/',adminKey:'short'})]) expect(()=>parseLocalServerSettings(text)).toThrow();
});
