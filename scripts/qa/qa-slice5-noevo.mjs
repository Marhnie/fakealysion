// Slice-5 official Q&A: "【진화 시】 효과는 발휘하지 않는다" grants (Q5258-5262, 5266-5270, 5282-5286, 5369-5373, 5410-5414).
// Expected (own words): a digimon carrying the grant does not trigger/resolve its 【진화 시】 effect; the effect's once-per-turn is NOT consumed by the missed evolve timing;
// the same card's 【어택 시】 half of a combined 【진화 시】【어택 시】 effect still works when attacking.
import { S, E, newBoard, addStack, stk, mkChoose, drain, fire, evo, scenario, report, F3, fillerLv, pend } from './lib5.mjs';
const lv5 = fillerLv(5)[0];
async function granted(st) { // p1's ST22-04 on-play targets p2's digimon
  const s = stk(st, 'p1', 'ST22-04'); await fire(st, 'p1', s, 'play', mkChoose(st));
}
for (const [src, q] of [['ST22-04', '5410-5414'], ['BT23-034', '5282-5286']]) {
  await scenario(q, `${src}: granted digimon's 진화 시 effect does not trigger on evolving`, async (chk) => {
    const st = newBoard({ p1: { battle: [src] }, p2: { battle: [lv5] } });
    await fire(st, 'p1', stk(st, 'p1', src), 'play', mkChoose(st));
    const t = stk(st, 'p2', lv5);
    // evolve target into BT23-034 (진화 시: DP-6000 + noTrig, [턴 1회])
    S.digivolve(st, 'p2', t.uid, 'BT23-034', 0, 'hand') || (st.players.p2.hand.push('BT23-034'), S.digivolve(st, 'p2', t.uid, 'BT23-034', 0, 'hand'));
    const n = st.pending.filter(x => !x.resolved && x.cardId === 'BT23-034' && x.tags.includes('진화 시')).length;
    chk(n === 0, `evolve trigger queued ${n} (want 0)`);
  });
}
await scenario('5282-5286 control', 'without the grant the 진화 시 trigger is queued (sanity of the scenario)', async (chk) => {
  const st = newBoard({ p1: { battle: [] }, p2: { battle: [lv5] } });
  const t = stk(st, 'p2', lv5); st.players.p2.hand.push('BT23-034'); S.digivolve(st, 'p2', t.uid, 'BT23-034', 0, 'hand');
  chk(st.pending.filter(x => !x.resolved && x.cardId === 'BT23-034' && x.tags.includes('진화 시')).length === 1, 'control trigger missing');
});
// Q5262/5286: missed 진화 시 timing does not consume the [턴 1회]; the 어택 시 half still works afterwards this turn
await scenario('5262/5286', 'BT23-034: evolve under grant, then attack -> 어택 시 half still resolves (once not consumed)', async (chk) => {
  const st = newBoard({ p1: { battle: ['ST22-04'] }, p2: { battle: [lv5, F3[0]] }, active: 'p2' });
  // grant is cast by p1 during p2's turn window: reuse the p1 play trigger, then let p2 (active) evolve + attack
  await fire(st, 'p1', stk(st, 'p1', 'ST22-04'), 'play', mkChoose(st));
  const t = stk(st, 'p2', lv5); st.players.p2.hand.push('BT23-034'); S.digivolve(st, 'p2', t.uid, 'BT23-034', 0, 'hand');
  st.pending.length = 0;
  const s = stk(st, 'p2', 'BT23-034'); s.attackEligibleTurn = 0;
  const dec = S.declareAttack(st, 'p2', s.uid); chk(dec.ok, 'declare ' + dec.reason);
  S.queueTriggersForStack(st, 'p2', s, 'attack');
  const q = st.pending.filter(x => !x.resolved && x.cardId === 'BT23-034').length;
  chk(q >= 1, 'attack trigger not queued: ' + q);
  const ran = await drain(st, mkChoose(st));
  chk(!ran.some(x => /ONCE-LIMIT/.test(x)), 'once-limit wrongly consumed: ' + ran.join(';'));
});
report();
