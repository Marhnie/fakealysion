// Slice-5 official Q&A: ST22-06 【서로의 턴】 (Q5425, 5426): if the chosen opp digimon does not actually leave, the opp security is NOT trashed; the [턴에 1회] is spent at the moment it is chosen to be used.
import { S, E, newBoard, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames } from './lib5.mjs';
const opts = Object.values(S.CARDS).filter(c => c.category === 'option' && (c.colors || []).length === 1 && c.colors[0] === 'yellow' && (c.cost || 0) >= 1 && (c.cost || 0) <= 3);
await scenario('5425/5426', 'ST22-06: opp digimon shielded (does not leave) -> opp security unchanged; used-up for the turn', async (chk) => {
  const st = newBoard({ p1: { battle: ['ST22-06', F3[3]], hand: [opts[0].id, opts[1].id] }, p2: { battle: [F3[0]], security: F3.slice(1, 5) }, memory: 8 });
  const t = st.players.p2.battle[0]; S.grantShield(st, 'p2', t.uid, { kinds: ['all'] });
  const sec0 = st.players.p2.security.length;
  S.useOptionCard(st, 'p1', 0);
  const q1 = st.pending.filter(x => !x.resolved && x.cardId === 'ST22-06').length; chk(q1 === 1, 'triggered once: ' + q1);
  st.pending = st.pending.filter(x => x.cardId === 'ST22-06');
  // drain only the ST22-06 trigger
  await drain(st, mkChoose(st));
  chk(st.players.p2.security.length === sec0, 'opp security must not be trashed when the digimon did not leave: ' + sec0 + '->' + st.players.p2.security.length);
  chk(st.players.p2.battle.length === 1, 'digimon stays');
  S.useOptionCard(st, 'p1', 0);
  const q2 = st.pending.filter(x => !x.resolved && x.cardId === 'ST22-06').length;
  chk(q2 === 0, 'second option use the same turn must not trigger again (turn limit spent): ' + q2);
});
report();
