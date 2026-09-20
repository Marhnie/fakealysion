// Replay ONE oracle game and print its violations with a long log tail:  node scripts/oracle-replay.mjs <seed> <game#> [levelP1,levelP2] < /dev/null
// (seed/game/levels as printed in the rule-oracle report; levels default to the mix order used by the runner: game%6)
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const { playOne } = await import('./rule-oracle.mjs');
const MIX = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'normal'], ['normal', 'easy'], ['hard', 'hard'], ['easy', 'normal']];
const [seed, game, lv] = process.argv.slice(2);
const r = await playOne({ seed: Number(seed), game: Number(game), levels: lv ? lv.split(',') : MIX[Number(game) % MIX.length] });
console.log('turns', r.turns, 'winner', r.winner, 'errors', r.errors.length);
for (const [id, v] of Object.entries(r.O.viol)) { console.log(id, v.n); for (const e of v.ex.slice(0, 1)) console.log('  step', e.step, e.action, e.detail, '\n   ', e.log.join('\n    ')); }
