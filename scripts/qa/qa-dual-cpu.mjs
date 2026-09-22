// CPU-vs-CPU headless games with DUAL-heavy decks (docs/dual-cards.md): the CPU must use dual cards as Options, may Arts-Digivolve, never play them for free, and never throw.
// Run: node scripts/qa/qa-dual-cpu.mjs [games=6] < /dev/null
import * as fs from 'fs';
import * as S from '../../src/state.js';
import * as E from '../../src/engine.js';
import * as Cpu from '../../src/cpu.js';
import { createSim } from '../../src/cpusim.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 6);
const cards = Object.values(S.CARDS).filter((c) => !c.isParallel);
const duals = cards.filter((c) => c.dual).map((c) => c.id);
const eggs = cards.filter((c) => c.category === 'digitama' && c.level === 2).slice(0, 12).map((c) => c.id);
const lv3 = cards.filter((c) => c.category === 'digimon' && c.level >= 3 && c.level <= 5 && c.cost != null && !c.dual && !c.effectKo && !c.inheritedKo).map((c) => c.id);
const rnd = (n) => Math.floor(Math.random() * n);
const mkDeck = (name) => { const main = {}, dig = {}; for (const d of duals) main[d] = 2; let n = 38; while (n < 50) { const id = lv3[rnd(lv3.length)]; main[id] = (main[id] || 0) + 1; n++; } for (let i = 0; i < 5; i++) { const e = eggs[rnd(eggs.length)]; dig[e] = (dig[e] || 0) + 1; } return { name, main, digitama: dig }; };
const errors = [];
let usedAsOption = 0, artsEvo = 0, freePlays = 0, games = 0, stalls = 0;
const seen = new Set();
for (let g = 0; g < N; g++) {
  const state = S.newGame(mkDeck('A'), mkDeck('B'));
  const cfgs = { p1: { level: 'normal', search: false, banned: new Set() }, p2: { level: g % 2 ? 'hard' : 'normal', search: false, banned: new Set() } };
  const sim = createSim(state, { cfgOf: (p) => cfgs[p], onError: (w, e) => errors.push(w + ': ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')), stats: { actions: 0, attacks: 0, blocks: 0, counters: 0, turns: 0 } });
  E.drawOpeningHand(state, 'p1'); E.drawOpeningHand(state, 'p2'); const first = E.coinFlip(); E.setSecurityStacks(state); E.beginGame(state, first);
  const scan = () => { for (const l of state.log) { if (seen.has(l)) continue; seen.add(l); if (/《아츠 진화》:/.test(l.msg)) artsEvo++; if (/ 사용 \(코스트/.test(l.msg) && duals.some((id) => l.msg.includes(S.card(id).nameKo))) usedAsOption++; if (/등장\b/.test(l.msg) && / 등장 코스트가 없어/.test(l.msg)) freePlays++; } };
  for (let t = 0; t < 40 && !state.winner; t++) {
    const p = state.activePlayer, cfg = cfgs[p]; cfg.banned = new Set();
    try { await sim.beginTurn(p); if (state.winner) break; await sim.mainLoop(p, async () => Cpu.planMain(state, p, cfg)); } catch (e) { errors.push('turn: ' + String(e.stack).split('\n').slice(0, 3).join(' | ')); break; }
    scan();
    if (Date.now() % 1 === 0 && t > 35) stalls++;
  }
  scan(); games++;
  for (const p of ['p1', 'p2']) if (state.players[p].limbo) errors.push('limbo not settled at game end: ' + state.players[p].limbo);
}
console.log(`dual CPU games ${games}: dual used as option ${usedAsOption}x, Arts evolutions ${artsEvo}x, refused free plays ${freePlays}x, errors ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 5)) console.log('ERR', e);
process.exit(errors.length || usedAsOption === 0 ? 1 : 0);
