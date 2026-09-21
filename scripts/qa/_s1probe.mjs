import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const L = Number(process.env.L || 260);
for (const id of process.argv.slice(2)) { const c = S.CARDS[id]; if (!c) { console.log(id, 'MISSING'); continue; } const f = (s) => String(s || '').replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').slice(0, L);
  console.log(`${id} ${c.nameKo} ${c.category[0]}${c.level ?? ''} c${c.cost ?? ''} dp${c.dp ?? ''} ${c.colors.join('/')} ${(c.types||[]).join(',')}\n E:${f(c.effectKo)}\n I:${f(c.inheritedKo)}`); }
