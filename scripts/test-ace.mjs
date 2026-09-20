// ACE cards (《오버플로우》 4-19 + inherited effects). Run from repo root: node scripts/test-ace.mjs < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const cards = Object.values(S.CARDS);
const filler = cards.filter(c => c.category === 'digimon' && c.level === 3).slice(0, 20).map(c => c.id);
function newState() {
  const deck = (n) => { const main = {}; for (let i = 0; i < 20; i++) main[filler[i]] = 1; return { name: n, main, digitama: {} }; };
  const st = S.newGame(deck('A'), deck('B'));
  for (const p of ['p1', 'p2']) { const pl = st.players[p]; pl.hand = []; pl.trash = []; pl.security = []; pl.battle.length = 0; pl.deck = [...filler.slice(0, 15)]; pl.raising = null; }
  st.turnNumber = 3; st.activePlayer = 'p1'; st.phase = 'main'; st.memory = 0; return st;
}
function put(st, p, ids) { const s = S._s4.makeStack(ids[0], 1); s.sources = ids.slice(1); s.attackEligibleTurn = 0; st.players[p].battle.push(s); S.recomputeStackGrants(s); return s; }
let fail = 0; const eq = (m, a, b) => { if (a !== b) { fail++; console.log('FAIL', m, a, b); } };
const TOP = 'ST13-10';
const ace = cards.filter(c => /오버플로우/.test(c.inheritedKo || ''));
eq('ACE count', ace.length >= 83, true);
for (const c of ace) {
  const N = Number(c.inheritedKo.match(/오버플로우\s*《\s*([+-]?\d+)/)[1]);
  for (const [p, sg] of [['p1', 1], ['p2', -1]]) {
    let st = newState(); let h = put(st, p, [TOP, c.id]); S.deleteStack(st, p, h.uid, 'trash', 'effect'); eq(c.id + ' del-as-source ' + p, st.memory, sg * N);
  }
  let st = newState(); let h = put(st, 'p1', [TOP, c.id]); S.trashEvoSources(st, 'p1', h.uid, 1, 'bottom'); eq(c.id + ' trashSrc', st.memory, N);
  st = newState(); st.players.p1.hand.push(c.id); S.playDigimonFresh(st, 'p1', 0); eq(c.id + ' play=no overflow', st.memory, 0); // 4-19-3
}
// EX9-013: overflow + S attack on the SAME line -> inherited 《S 어택 +1》 must still apply
{ const st = newState(); const h = put(st, 'p1', [TOP, 'EX9-013']); eq('EX9-013 inherited S attack', S.securityAttackBonus(h), 1); }
// other inherited lines
{ const st = newState(); const h = put(st, 'p1', [TOP, 'LM-043']); eq('LM-043 충돌', S.hasKeyword(h, '충돌'), true); }
{ const st = newState(); const h = put(st, 'p1', [TOP, 'BT19-050']); eq('BT19-050 DP+4000 own turn', S.effectiveDP(st, 'p1', h) - S.card(TOP).dp, 4000); st.activePlayer = 'p2'; eq('BT19-050 opp turn', S.effectiveDP(st, 'p1', h) - S.card(TOP).dp, 0); }
{ const st = newState(); const h = put(st, 'p1', [TOP, 'LM-026']); eq('LM-026 cap', S.dpDestroyCapBoost(st, 'p1', h.uid), 5000); }
{ const st = newState(); const h = put(st, 'p1', [TOP, 'BT19-037']); put(st, 'p2', ['ST13-12']); S.queueTriggersForStack(st, 'p1', h, 'attack'); eq('BT19-037 queued 어택 시', st.pending.filter(x => !x.resolved && x.cardId === 'BT19-037').length, 1); }
{ const st = newState(); const h = put(st, 'p1', [TOP, 'P-191']); S.queueTriggersForStack(st, 'p1', h, 'turnEndOwn'); eq('P-191 queued 턴 종료 시', st.pending.filter(x => !x.resolved && x.cardId === 'P-191').length, 1); }
console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
process.exit(fail ? 1 : 0);
