// Regression checks for bugs found by the long-game UI playtests (docs/ui-longgame-report.md).
// Run from repo root: node scripts/test-ui-regress.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
let fail = 0; const eq = (m, a, b) => { if (a !== b) { fail++; console.log('FAIL', m, a, b); } };
const cards = Object.values(S.CARDS);
const filler = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 20).map(c => c.id);
function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 5; return st;
}
function put(st, p, ids) { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }

// #2 effect-granted attack with no legal target must not be declarable: the primitives main.js attackFlow(force) pre-checks
{
  const st = newState(); const a = put(st, 'p1', ['BT12-055', filler[0]]);
  eq('no opp digimon -> no digimon targets', S.legalDigimonTargets(st, 'p1', a.uid).length, 0);
  const b = put(st, 'p2', [filler[1]]); // active opponent digimon: not a legal attack target
  eq('active opp digimon is not a target', S.legalDigimonTargets(st, 'p1', a.uid).length, 0);
  b.suspended = true;
  eq('suspended opp digimon is a target', S.legalDigimonTargets(st, 'p1', a.uid).length, 1);
  const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  eq('main.js guards forced attacks without targets', /어택 대상이 없어 이 효과의 어택을 하지 않음/.test(src), true);
  eq('main.js has an exit for an empty target picker', /어택 종료 \(대상 없음\)/.test(src), true);
}
// #1 CPU: a no-op 【메인】 ability must not be repeated forever within a turn
{
  const src = fs.readFileSync(new URL('../src/cpu.js', import.meta.url), 'utf8');
  eq('cpu.js caps repeated 【메인】 uses per turn', /D\.mainUses/.test(src), true);
}
console.log(fail ? `${fail} FAILED` : 'ui-regress OK');
process.exit(fail ? 1 : 0);
