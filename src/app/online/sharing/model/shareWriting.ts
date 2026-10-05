/** Writes a note's `atlas-share` and reads it back from the file, so the dialog and the property always agree. */
import { parseYaml, type App, type TFile } from 'obsidian';
import { splitFrontmatter } from './frontmatterFilter';
import { parseShareRule, SHARE_PROPERTY, type ShareRule } from './shareRule';

export async function writeNoteShare(app: App, file: TFile, value: string | string[] | null): Promise<ShareRule> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    if (value === null) Reflect.deleteProperty(frontmatter, SHARE_PROPERTY);
    else frontmatter[SHARE_PROPERTY] = value;
  });
  const { frontmatter } = splitFrontmatter((await app.vault.read(file)).replace(/\r\n?/g, '\n'));
  const parsed: unknown = frontmatter ? parseYaml(frontmatter.join('\n')) : null;
  return parseShareRule(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[SHARE_PROPERTY] : undefined);
}
