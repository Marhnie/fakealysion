import * as S from '../src/state.js';
import { init, makeRng, makeDriver } from '../scripts/lib-driver.mjs';
await init();
const seen = {};
function walk(o, path, depth, seenSet) {
  if (o === null || typeof o !== 'object' && typeof o !== 'function') return;
  if (typeof o === 'function') { const k = path.replace(/\d+/g, '#'); seen['FN ' + k] = (seen['FN ' + k] || 0) + 1; return; }
  if (seenSet.has(o)) { const k = path.replace(/\d+/g, '#'); seen['SHARED/CYCLE ' + k] = 1; return; }
  seenSet.add(o);
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) seen['CLASS ' + proto.constructor.name + ' ' + path.replace(/\d+/g, '#')] = 1;
  for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (!d.enumerable && !(Array.isArray(o) && k === 'length')) seen['NONENUM ' + path.replace(/\d+/g, '#') + '.' + String(k)] = 1; walk(o[k], path + '.' + String(k), depth + 1, seenSet); }
}
for (let g = 0; g < 40; g++) {
  const rng = makeRng(g + 1), d = makeDriver(rng);
  const st = d.newRandomGame();
  for (let i = 0; i < 400 && !st.winner; i++) { await d.step(st); walk(st, 'state', 0, new Set()); }
}
console.log(Object.keys(seen).sort().join('\n'));
