// prints board texts mentioning evolution cost at the violation
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const { playOne } = await import('./rule-oracle.mjs');
const [seed, game, lv, chk] = process.argv.slice(2);
globalThis.__hook = (state, id) => { if (id === chk) { for (const p of ['p1','p2']) for (const st of [state.players[p].raising, ...state.players[p].battle].filter(Boolean)) { const c = S.card(st.cardId); console.log(p, st.cardId, c.nameKo, 'src', st.sources.join(), '|', (c.effectKo||'').replace(/\n/g,' / ').slice(0,300)); } } };
const r = await playOne({ seed: Number(seed), game: Number(game), levels: lv.split(',') });
