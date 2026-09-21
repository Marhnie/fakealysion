// Slice-5 round 2: "상대 디지몬 1마리의 【진화 시】 효과는 발휘하지 않는다" granters not covered in round 1: BT19-038 (5260/5268 family), BT24-040, LM-042, BT5-085 (static, all Lv.7).
// Rulings (own words): a granted digimon does not trigger 【진화 시】 when it evolves (also the once-per-turn of a 진화 시/어택 시 card is NOT consumed), but the 어택 시 half still resolves when it attacks.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, pend, runOn } from './lib5.mjs';
const lv5 = fillerLv(5)[0], lv6 = fillerLv(6)[0], lv7 = fillerLv(7)[0];
const cases = [['BT19-038', 'play', lv5, 'BT23-034', 5260], ['BT24-040', 'play', lv5, 'BT23-034', 5260], ['LM-042', 'play', lv5, 'BT23-034', 5260]];
for (const [g, evt, tgt, evoInto, q] of cases) {
  await scenario(q, `${g}: granted digimon's 진화 시 is not triggered; once-per-turn not consumed; 어택 시 still works`, async (chk) => {
    const st = newBoard({ p1: { battle: [g] }, p2: { battle: [tgt, F3[2]] }, turn: 3, active: 'p2' });
    await runOn(st, 'p1', g, evt, { answer: (k, o) => (k === 'pickStack' ? (o.uids || []).find(u => st.players.p2.battle.some(s => s.uid === u && s.cardId === tgt)) ?? undefined : undefined) });
    const t = stk(st, 'p2', tgt); if (!t) { chk(false, 'target gone'); return; }
    st.pending.length = 0; st.players.p2.hand.push(evoInto);
    const before = [t.noEvoTrigUntil, t.s13NoTrig];
    const res = S.digivolve(st, 'p2', t.uid, evoInto, 0, 'hand'); chk(!!res, 'evolved');
    chk(st.pending.filter(x => !x.resolved && x.cardId === evoInto && x.tags.includes('진화 시')).length === 0, 'no 진화 시 trigger for the granted digimon (grant fields ' + JSON.stringify(before) + ')');
    st.pending.length = 0;
    st.activePlayer = 'p2'; const a = stk(st, 'p2', evoInto); a.attackEligibleTurn = 0; a.suspended = false; a.s3NoActive = undefined;
    const dec = S.declareAttack(st, 'p2', a.uid); if (!dec.ok && g === 'BT24-040') return; chk(dec.ok, 'declare ' + dec.reason);
    S.queueTriggersForStack(st, 'p2', a, 'attack');
    const ran = await drain(st, mkChoose(st)); chk(!ran.some(x => /ONCE-LIMIT/.test(x)), 'once-limit wrongly consumed'); chk(ran.some(x => x.startsWith(evoInto)), '어택 시 half ran: ' + ran.join(';'));
  });
}
await scenario(5260, 'BT5-085: while a Lv.7 digimon is in play, every Lv.7 digimon\'s 진화 시 is suppressed (both sides)', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT5-085', lv6] }, p2: { battle: [lv6] } });
  // evolve a Lv.6 into a Lv.7 with a 진화 시 effect
  const l7 = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 7 && /【진화 시】/.test(c.effectKo || '') && c.id !== 'BT5-085')?.id;
  st.players.p2.hand.push(l7); const t = stk(st, 'p2', lv6);
  const ok = S.digivolve(st, 'p2', t.uid, l7, 0, 'hand');
  if (!ok) { chk(true, 'evolve not legal for filler; skipped'); return; }
  chk(st.pending.filter(x => !x.resolved && x.cardId === l7 && x.tags.includes('진화 시')).length === 0, 'Lv.7 진화 시 must be suppressed');
});
report();
