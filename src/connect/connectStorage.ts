import type { AtlasApi, AtlasExtension } from '@atlas-vtt/api-types';
import { sharingPaths, type SharingPaths } from '../app/online/sharing/sharingPaths';
import { need } from './capabilities';

/** Where Connect keeps its data files, in the folder Atlas gives it; null on an Atlas without `storage`. */
export async function connectStorage(api: AtlasApi, atlas: AtlasExtension): Promise<SharingPaths | null> {
  const storage = need(api, atlas, 'storage');
  return storage ? sharingPaths(await storage.folder()) : null;
}
