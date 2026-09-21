import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
for (const id of process.argv.slice(2)) { const c = S.CARDS[id]; if (!c) { console.log(id, 'MISSING'); continue; } console.log(`${id} ${c.nameKo} [${c.category} Lv${c.level ?? '-'} cost${c.cost ?? '-'} dp${c.dp ?? '-'} ${c.colors}]\n  E: ${c.effectKo}\n  I: ${c.inheritedKo}\n  S: ${c.securityKo ?? ''}`); }
