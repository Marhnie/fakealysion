// Unresolved-b (4) / Q3348: EX2-056's "진화할 때" grant interrupts the evolution, so 《진격》 stays granted for the turn even when the evolution fails (cost cannot be paid).
import { S, E, FILL, mk, put, drain, T, eq, ok, runAll } from './lib-s1.mjs';
T(3348, 'EX2-056: unaffordable evolution into a 그라우몬 fails but the digivolve-trigger 《진격》 grant is kept', async () => {
  const st = mk(); put(st, 'p1', 'EX2-056'); const pre = put(st, 'p1', FILL); st.memory = -10; // own memory 0 -> the cost 11 (> own+10) cannot be paid
  st.players.p1.hand.push('ST7-05');
  const r = S.digivolve(st, 'p1', pre.uid, 'ST7-05', 11, 'hand');
  ok('evolution failed', !r); eq('card still in hand', st.players.p1.hand.includes('ST7-05'), true); eq('digimon unchanged', pre.cardId, FILL);
  ok('grant kept', (pre.s2Granted || []).some(g => g.label === '《진격》'));
});
T('ex2056-ok', 'EX2-056: a successful evolution still grants exactly once', async () => {
  const st = mk(); put(st, 'p1', 'EX2-056'); const pre = put(st, 'p1', FILL); st.players.p1.hand.push('ST7-05');
  const r = S.digivolve(st, 'p1', pre.uid, 'ST7-05', 0, 'hand'); ok('ok', !!r); eq('one grant', (r.s2Granted || []).filter(g => g.label === '《진격》').length, 1);
});
runAll('qa-unres-b-ex2056');
