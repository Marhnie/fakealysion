// print card text (Korean DB) for ids given on argv
import { S } from './s3lib.mjs';
for (const id of process.argv.slice(2)) { const c = S.CARDS[id]; if (!c) { console.log(id, 'MISSING'); continue; } console.log(`[${id} ${c.nameKo} ${c.category} Lv${c.level} c${c.cost} dp${c.dp} ${(c.colors||[]).join('/')} ${(c.types||[]).join('/')}]\n ${(c.effectKo||'').replace(/\n/g,'\n ')}${c.inheritedKo ? '\n INH: ' + c.inheritedKo : ''}`); }
process.exit(0);
