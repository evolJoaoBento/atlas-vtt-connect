/**
 * What sharing hears for as long as the plugin is loaded, made in `onload` before Atlas is bound: what the metadata
 * cache parsed (`SectionTrust`, so a note edited before or between bindings stays untrusted until Obsidian parses
 * it again) and the vault's renames and deletions (`VaultChanges`, kept for the next binding).
 */
import type { Plugin } from 'obsidian';
import { sectionTrustFor, type SectionTrust } from './model/sectionTrust';
import { vaultChangesFor, type VaultChanges } from './vaultChanges';

export interface SharingLifetime {
  sections: SectionTrust;
  vaultChanges: VaultChanges;
}

export function sharingLifetime(plugin: Pick<Plugin, 'app' | 'registerEvent'>): SharingLifetime {
  return { sections: sectionTrustFor(plugin), vaultChanges: vaultChangesFor(plugin) };
}
