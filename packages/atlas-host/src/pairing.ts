/** The notice shown when Tabletop and Connect are not builds of the same fusion step, so they refuse to work together. */
export function pairingNotice(tabletopVersion: string | null, connectVersion: string | null): string {
  return `Tabletop for Atlas VTT ${tabletopVersion ?? 'unknown'} and Connect for Atlas VTT ${connectVersion ?? 'unknown'} do not match: update both to the same release.`;
}
