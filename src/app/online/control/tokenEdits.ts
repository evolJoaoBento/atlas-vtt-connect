/** The complete, bounded set of attributes a player may edit on an owned token. */
export interface TokenEdit {
  light?: 'none' | 'torch' | 'light' | 'continual-flame';
  darkvision?: 0 | 30 | 60 | 120;
  hp?: { current: number; max: number };
  showHpBar?: boolean;
  statusText?: string;
  size?: number;
  initiative?: number;
  conditions?: string[];
}

/** Stock Atlas's light distances are rules units, converted by its renderer for each scene. */
export function lightEmission(profile: TokenEdit['light']): Record<string, unknown> | undefined {
  if (!profile || profile === 'none') return undefined;
  return {
    bright: 20, dim: 40, intensity: 1,
    color: profile === 'light' ? '#fff3a3' : '#ffcf81',
    animation: profile === 'torch' ? 'torch' : 'magic',
  };
}

export function isTokenEdit(value: unknown): value is TokenEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  const keys = Object.keys(edit);
  if (!keys.length || keys.some((key) => !['hp', 'showHpBar', 'statusText', 'size', 'conditions', 'initiative', 'light', 'darkvision'].includes(key))) return false;
  if (edit.hp !== undefined) {
    if (!edit.hp || typeof edit.hp !== 'object' || Array.isArray(edit.hp)) return false;
    const hp = edit.hp as Record<string, unknown>;
    if (Object.keys(hp).some((key) => key !== 'current' && key !== 'max')
      || !Number.isInteger(hp.current) || !Number.isInteger(hp.max)
      || (hp.max as number) < 1 || (hp.max as number) > 1000000
      || (hp.current as number) < 0 || (hp.current as number) > (hp.max as number)) return false;
  }
  if (edit.conditions !== undefined && (!Array.isArray(edit.conditions) || edit.conditions.length > 64 || new Set(edit.conditions).size !== edit.conditions.length || !edit.conditions.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120 && [...id].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)))) return false;
  if (edit.initiative !== undefined && (typeof edit.initiative !== 'number' || !Number.isInteger(edit.initiative) || edit.initiative < -1000 || edit.initiative > 1000)) return false;
  return (edit.showHpBar === undefined || typeof edit.showHpBar === 'boolean')
    && (edit.light === undefined || ['none', 'torch', 'light', 'continual-flame'].includes(edit.light as string))
    && (edit.darkvision === undefined || [0, 30, 60, 120].includes(edit.darkvision as number))
    && (edit.statusText === undefined || (typeof edit.statusText === 'string' && edit.statusText.length <= 120 && [...edit.statusText].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)))
    && (edit.size === undefined || (typeof edit.size === 'number' && Number.isFinite(edit.size) && edit.size >= 0.75 && edit.size <= 5));
}
