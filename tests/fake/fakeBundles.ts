import type { BundlesApi, Disposer } from '@atlas-vtt/api-types';
import type { Own } from './fakeViews';

const normalized = (keys: readonly string[]): string[] => keys.map((key) => key.trim().toLowerCase()).filter(Boolean);

/**
 * The note properties Atlas strips from collection exports and installs (C-bundles-1..4). A key is stripped while
 * an extension has it registered and, once remembered (Atlas's settings, per extension id), also while that
 * extension is not loaded and after Atlas restarts. Only the returned disposer or `forgetNoteProperties` forgets it.
 */
export class FakeBundles {
  private readonly live = new Map<symbol, { owner: string; keys: ReadonlySet<string> }>();
  /** What Atlas's settings remember, per extension id. */
  readonly remembered = new Map<string, Set<string>>();

  /** Every key an export or install strips now, lowercase. */
  stripped(): ReadonlySet<string> {
    return new Set([...this.live.values()].flatMap((entry) => [...entry.keys]).concat([...this.remembered.values()].flatMap((keys) => [...keys])));
  }

  /** A note's frontmatter as a collection export writes it. */
  exportNote(frontmatter: Record<string, unknown>): Record<string, unknown> {
    const strip = this.stripped();
    return Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !strip.has(key.toLowerCase())));
  }

  /** A note's frontmatter as a bundle install writes it into this vault: the same keys are stripped as on export. */
  installNote(frontmatter: Record<string, unknown>): Record<string, unknown> {
    return this.exportNote(frontmatter);
  }

  /** Atlas starts again: live registrations are gone, what the settings remember stays. */
  restart(): void {
    this.live.clear();
  }

  api(extensionId: string, own: Own): BundlesApi {
    return Object.freeze({
      stripNoteProperties: (keys: readonly string[]): Disposer => {
        if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !key.trim())) {
          throw new Error('[Atlas API] stripNoteProperties needs an array of non-empty property names.');
        }
        const entry = Symbol(extensionId);
        this.live.set(entry, { owner: extensionId, keys: new Set(normalized(keys)) });
        // Unloading the extension ends only the live registration (its connection's teardown).
        const stopLive = own(() => { this.live.delete(entry); });
        this.remember(extensionId, keys);
        return () => {
          stopLive();
          this.forget(extensionId, keys);
        };
      },
      forgetNoteProperties: (): void => { this.remembered.delete(extensionId); },
    });
  }

  private remember(owner: string, keys: readonly string[]): void {
    const kept = this.remembered.get(owner) ?? new Set<string>();
    for (const key of normalized(keys)) kept.add(key);
    this.remembered.set(owner, kept);
  }

  /** Drops `keys` from what is remembered for `owner`, except those another live registration of it still holds. */
  private forget(owner: string, keys: readonly string[]): void {
    const kept = this.remembered.get(owner);
    if (!kept) return;
    const stillHeld = new Set([...this.live.values()].filter((entry) => entry.owner === owner).flatMap((entry) => [...entry.keys]));
    for (const key of normalized(keys)) if (!stillHeld.has(key)) kept.delete(key);
    if (kept.size === 0) this.remembered.delete(owner);
  }
}
