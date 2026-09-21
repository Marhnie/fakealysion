import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const a = JSON.parse(fs.readFileSync('data/rulings/slice1.json', 'utf8'));
let miss = 0, noeff = 0; const missIds = new Set();
for (const e of a) { const ids = (e.cards.length ? e.cards : [e.card]).map(c => c.split(' ')[0]); const m = ids.filter(i => !S.CARDS[i]); if (m.length === ids.length) { miss++; m.forEach(x => missIds.add(x)); } else if (!ids.some(i => S.CARDS[i] && (S.CARDS[i].effectKo || S.CARDS[i].inheritedKo))) noeff++; }
console.log(a.length, 'missing all', miss, 'noeffect', noeff, [...missIds].slice(0, 30).join(','));
