const PORTUGUESE: Readonly<Record<string,string>> = {
  blinded: 'Cego', charmed: 'Enfeitiçado', deafened: 'Surdo', exhaustion: 'Exaustão', frightened: 'Amedrontado', grappled: 'Agarrado', incapacitated: 'Incapacitado', invisible: 'Invisível', paralyzed: 'Paralisado', petrified: 'Petrificado', poisoned: 'Envenenado', prone: 'Caído', restrained: 'Impedido', stunned: 'Atordoado', unconscious: 'Inconsciente',
};
export function conditionName(name: string): string { return PORTUGUESE[name.trim().toLowerCase()] ?? name; }
