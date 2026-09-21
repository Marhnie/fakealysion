// Slice-5 official Q&A: DP-0 handling (Q5293 BT23-035, 5557/5573/5629 "DP-5000 to all + play DP5000-", 5584 effect-made DP0, 5452 BT16-101).
// Expected (own words): "all opponent digimon DP -N" also covers digimon that enter later this turn; a digimon that arrives with DP<=0 vanishes at the next rule check, BEFORE its own 【등장 시】 resolves (so that effect does not happen).
import { S, E, newBoard, addStack, stk, mkChoose, drain, fire, scenario, report, F3, fillerLv, nm, runOn, zoneNames, dp } from './lib5.mjs';
const w = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 3 && c.dp && c.dp <= 6000 && /【등장 시】/.test(c.effectKo || '') && /드로우/.test(c.effectKo || '') && !/소멸|레스트/.test(c.effectKo));
console.log('fixture', w && w.id, w && nm(w.id), w && w.dp, w && w.effectKo.slice(0, 60));
await scenario(5293, 'BT23-035: DP-6000 on all opp digimon; a DP<=6000 digimon played later this turn vanishes before its 등장 시 resolves', async (chk) => {
  const st = newBoard({ p1: { battle: ['BT23-035'], security: F3.slice(0, 4) }, p2: { battle: [F3[2]], hand: [w.id], deck: F3.slice(0, 6) }, active: 'p1' });
  await runOn(st, 'p1', 'BT23-035', 'digivolve', {});
  const hand0 = st.players.p2.hand.length;
  st.players.p2.hand.push(w.id); const i = st.players.p2.hand.length - 1;
  const s = S.playDigimonFresh(st, 'p2', i);
  if (st._rcPending) S.flushRuleChecks(st); else S.ruleSweepDP(st, null);
  chk(!st.players.p2.battle.some(x => x.cardId === w.id), 'newly played digimon must be deleted by the rule check');
  const deck0 = st.players.p2.deck.length;
  const ran = await drain(st, mkChoose(st));
  chk(st.players.p2.deck.length === deck0, 'its 등장 시 (draw) must not resolve: deck ' + deck0 + '->' + st.players.p2.deck.length + ' ran=' + ran.join(';'));
});
report();
