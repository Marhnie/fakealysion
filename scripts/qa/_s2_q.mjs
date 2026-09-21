import { S, C, FILL } from './lib2.mjs';
const all = Object.values(S.CARDS);
const f = (expr) => { const fn = new Function('c', 'return ' + expr); return all.filter(c => { try { return fn(c); } catch { return false; } }).slice(0, +process.argv[3] || 8).map(c => `${c.id} ${c.nameKo} ${c.category[0]} L${c.level} c${c.cost} dp${c.dp} ${(c.colors||[]).join('/')} [${(c.effectKo||'').length}]`).join('\n'); };
console.log(f(process.argv[2]));
