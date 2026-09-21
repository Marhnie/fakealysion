// slice2 round 2 helpers (on top of lib2.mjs)
import { runScenarios, FILL, S, E, Fx, C, fillOf, world } from './lib2.mjs';
export { runScenarios, FILL, S, E, Fx, C, fillOf, world };
const all = Object.values(S.CARDS);
export const byName = (n, pred = () => true) => (all.find(c => c.nameKo === n && pred(c)) || {}).id;
export const findEff = (re, pred = () => true) => (all.find(c => re.test(c.effectKo || '') && pred(c)) || {}).id;
export const lvl = (n, col) => fillOf(c => c.level === n && (!col || (c.colors || []).includes(col)))[0];
export const mk = () => { const L = []; return { L, T: (q, card, name, run, expect, extra = {}) => L.push({ q, card, name, run, expect, ...extra }) }; };
export const XA_TRAIT = 'BT9-008'; // has the X-antibody TRAIT but is not named 「X항체」
export const XA_NAME = 'BT9-109';  // the card literally named 「X항체」
