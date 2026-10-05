import { normalizePath } from 'obsidian';
import type { SavedMapInput } from '@atlas-vtt/api-types';
import { checkedSceneFields, isPlainRelative, withImagePaths } from './fakeMapFields';
import { savedMapText } from './fakeSavedMap';
import type { FakeSceneRecord } from './fakeScenes';

/**
 * `scenes.replaceMap` as Atlas does it (`src/api/sceneReplace.ts` at api-pr-13-end, C-scenes-5): only a scene the calling
 * extension added (`data.createdBy`, in the index only); refused while the map is open in a map view or among its tabs,
 * checked again just before the map is written; the input checked as for `addToCollection`, before any write; new
 * images beside the map file (a taken name gets ` (2)`…); the GM's note link, dice log, pinned previews and loot roller
 * kept from the old file, explored memory dropped; then only images Atlas wrote for the scene (`createdImages`) that
 * nothing uses any more are removed. A failed write removes the images it wrote and puts the old map back. The fake
 * has no note links (`resolvedLinks`), so only other records and other scenes' map files count as uses.
 */

export interface ReplaceInput { map: SavedMapInput; images: ReadonlyArray<{ path: string; data: ArrayBuffer }> }

export interface ReplaceTarget {
  files: Map<string, string>;
  record(sceneId: string): FakeSceneRecord | undefined;
  records(): FakeSceneRecord[];
  /** Map paths open in a map view (loaded or among its scene tabs). */
  openMaps(): ReadonlySet<string>;
  /** Set by a test: runs between writing the images and writing the map (a tab opening meanwhile). */
  beforeMapWrite: (() => void) | null;
}

const LOCAL_PLAY_FIELDS = ['dmNotePath', 'diceLog', 'pinnedNotePreviews', 'lootRoller'] as const;

function fail(message: string): never {
  throw new Error(`[Atlas API] replaceMap: ${message}`);
}

function freeFilePath(files: Map<string, string>, path: string, chosen: ReadonlySet<string>): string {
  const dot = path.lastIndexOf('.');
  const [stem, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  let candidate = path;
  for (let n = 2; chosen.has(candidate.toLowerCase()) || files.has(candidate); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}

function withLocalPlay(newText: string, oldText: string): string {
  let old: { state?: Record<string, unknown> };
  try {
    old = JSON.parse(oldText) as { state?: Record<string, unknown> };
  } catch {
    return newText;
  }
  const kept = Object.fromEntries(LOCAL_PLAY_FIELDS.flatMap((field) => (old.state?.[field] !== undefined ? [[field, old.state[field]]] : [])));
  if (Object.keys(kept).length === 0) return newText;
  const next = JSON.parse(newText) as { state: Record<string, unknown> };
  next.state = { ...next.state, ...kept };
  return JSON.stringify(next, null, 2);
}

function usedElsewhere(target: ReplaceTarget, sceneId: string, path: string): boolean {
  const quoted = JSON.stringify(path);
  return target.records().filter((record) => record.id !== sceneId).some((record) => JSON.stringify(record).includes(quoted)
    || (record.mapPath !== null && (target.files.get(record.mapPath)?.includes(quoted) ?? false)));
}

export function replaceScene(target: ReplaceTarget, owner: string, sceneId: string, input: ReplaceInput): { sceneId: string; mapPath: string } {
  const scene = typeof sceneId === 'string' ? target.record(sceneId) : undefined;
  if (!scene) fail(`there is no scene with the id "${String(sceneId)}".`);
  if (scene.data.createdBy !== owner) fail('only a scene this extension added with addToCollection can be replaced.');
  const { mapPath } = scene;
  const oldText = mapPath ? target.files.get(mapPath) : undefined;
  if (!mapPath || oldText === undefined) fail('the scene has no map file.');
  if (target.openMaps().has(mapPath)) fail('the scene is open in a map view; close its tab first.');
  if (!input || !input.map || !Array.isArray(input.images)) fail('it needs { map, images }.');
  const fields = checkedSceneFields(input.map);
  const folder = mapPath.slice(0, mapPath.lastIndexOf('/'));
  const chosen = new Set<string>();
  const targets = new Map<string, { at: string; data: ArrayBuffer }>();
  for (const image of input.images) {
    const path: unknown = image?.path;
    if (!isPlainRelative(path) || !normalizePath(`${folder}/${path}`).startsWith(`${folder}/`) || targets.has(path)) fail(`the image path "${String(path)}" must stay inside the folder, once.`);
    const at = freeFilePath(target.files, normalizePath(`${folder}/${path}`), chosen);
    chosen.add(at.toLowerCase());
    targets.set(path, { at, data: image.data });
  }
  const imagePaths = new Map([...targets].map(([path, { at }]) => [path, at]));
  const newText = withLocalPlay(savedMapText(withImagePaths(input.map, imagePaths), mapPath, scene.name, fields), oldText);
  const written: string[] = [];
  try {
    for (const { at, data } of targets.values()) {
      written.push(at);
      target.files.set(at, new TextDecoder().decode(data));
    }
    target.beforeMapWrite?.();
    if (target.openMaps().has(mapPath)) fail('the scene is open in a map view; close its tab first.');
    target.files.set(mapPath, newText);
  } catch (error) {
    target.files.set(mapPath, oldText);
    for (const path of written.reverse()) target.files.delete(path);
    throw error;
  }
  const kept: string[] = [];
  for (const path of Array.isArray(scene.data.createdImages) ? scene.data.createdImages as string[] : []) {
    if (!target.files.has(path)) continue;
    if (newText.includes(JSON.stringify(path)) || usedElsewhere(target, sceneId, path)) kept.push(path);
    else target.files.delete(path);
  }
  // Read again: only the image list is this call's to change.
  const record = target.record(sceneId);
  if (record) record.data = { ...record.data, createdImages: [...kept, ...written] };
  return { sceneId, mapPath };
}
