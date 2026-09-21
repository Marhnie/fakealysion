// helper: print Korean text of cards.  usage: node scripts/qa/_s2r2_show.mjs ID ID ...
import { S } from './lib2.mjs';
for (const id of process.argv.slice(2)) { const c = S.CARDS[id]; if (!c) { console.log(id, 'NONE'); continue; } console.log('== ' + id, c.nameKo, 'Lv' + c.level, c.colors, c.dp, c.playCost, (c.types||[]).join('/')); console.log(c.effectKo); if (c.inheritedKo) console.log('[inh]', c.inheritedKo); }
process.exit(0);
