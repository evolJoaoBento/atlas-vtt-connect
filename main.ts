import { Plugin } from 'obsidian';
import './styles/main.scss';
import { AtlasLink } from './src/connect/atlasLink';
import { startConnect } from './src/connect/startConnect';

export default class AtlasVttConnectPlugin extends Plugin {
  async onload(): Promise<void> {
    new AtlasLink(this, (atlas, api) => startConnect(this, atlas, api)).start();
    // Further services are added task by task (plan B2 onwards).
  }
}
