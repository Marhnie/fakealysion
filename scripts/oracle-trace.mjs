// Trace effect resolutions of one oracle game:  node scripts/oracle-trace.mjs <seed> <game> [cardIdRegex] < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const { playOne } = await import('./rule-oracle.mjs');
const MIX = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'normal'], ['normal', 'easy'], ['hard', 'hard'], ['easy', 'normal']];
const [seed, game, re] = process.argv.slice(2); const rx = new RegExp(re || '.');
globalThis.__fxTrace = (t, ph, state) => { if (!rx.test(t.cardId)) return; const dps = ['p1', 'p2'].map((p) => p + ':' + state.players[p].battle.filter((s) => S.card(s.cardId).category === 'digimon').map((s) => S.card(s.cardId).nameKo + '(' + S.effectiveDP(state, p, s) + (s.suspended ? ',R' : '') + ')').join(' ')).join(' | '); console.log(ph, 'T' + state.turnNumber, t.cardId, JSON.stringify(t.tags), 'inh=' + !!t.inherited, JSON.stringify(String(t.text).slice(0, 120)), '\n     ', dps, 'mem', state.memory); };
await playOne({ seed: Number(seed), game: Number(game), levels: MIX[Number(game) % MIX.length] });
