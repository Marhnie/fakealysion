// Print card data by id or Korean name:  node scripts/oracle-card.mjs BT8-085 스팅몬 < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
for (const c of Object.values(S.CARDS)) if (process.argv.slice(2).some((a) => a === c.id || a === c.nameKo)) console.log(c.id, c.nameKo, c.category, 'Lv', c.level, 'DP', c.dp, 'cost', c.cost, JSON.stringify(c.colors), '\n  E:', (c.effectKo || '').replace(/\n/g, ' / '), '\n  I:', (c.inheritedKo || '').replace(/\n/g, ' / '));
