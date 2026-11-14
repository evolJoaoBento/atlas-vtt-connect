import {expect,it} from 'vitest';
import {conditionName} from '../../../src/app/online/scene/conditionNames';
it('translates the fifteen D&D conditions and preserves custom names',()=>{
 const source=['Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious'];
 expect(source.map(conditionName)).toEqual(['Cego','Enfeitiçado','Surdo','Exaustão','Amedrontado','Agarrado','Incapacitado','Invisível','Paralisado','Petrificado','Envenenado','Caído','Impedido','Atordoado','Inconsciente']);
 expect(conditionName('Marca da Névoa')).toBe('Marca da Névoa');
});
