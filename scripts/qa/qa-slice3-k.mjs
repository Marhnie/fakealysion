// Slice3 Q&A conformance part K: LM / misc simultaneous-trigger conditions.
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const findC = (pred, n = 1) => cards.filter(pred).slice(0, n).map(c => c.id);

// Q3989: two LM-002 at main-phase start with 7 cards in hand: effects resolve one after another, the second sees 8 cards -> only 1 draw in total
await sc('Q3989', 'LM-002 x2: hand 7 -> only the first draws (second re-checks hand size)', async () => {
  const st = newState(); const a = put(st, 'p1', ['LM-002']); const b = put(st, 'p1', ['LM-002']); st.players.p1.hand = FILL.slice(0, 7);
  S.queueTriggersForStack(st, 'p1', a, 'mainPhaseStart'); S.queueTriggersForStack(st, 'p1', b, 'mainPhaseStart'); await drain(st);
  return eq('hand', st.players.p1.hand.length, 8);
});
// Q3990: LM-002 in the sources twice on one attacker: only one draw at hand 7
await sc('Q3990', 'LM-002 x2 as sources: hand 7 -> 1 draw only', async () => {
  const st = newState(); const a = put(st, 'p1', [FILL[0], 'LM-002', 'LM-002']); st.players.p1.hand = FILL.slice(0, 7);
  await trig(st, 'p1', a, 'attack'); return eq('hand', st.players.p1.hand.length, 8);
});
// Q2952: BT18-028 on play: opp digimon without sources cannot rest; one that later gains a source can rest again (and later arrivals w/o source are covered)
await sc('Q2952', 'BT18-028: source-less opp digimon cannot rest; gaining a source frees it; newcomers covered', async () => {
  const st = newState(); const o = put(st, 'p2', [FILL[1]]); const me = put(st, 'p1', ['BT18-028']); await trig(st, 'p1', me, 'play');
  const a = S.canRestByRule(st, 'p2', o); o.sources.push(FILL[2]); const b = S.canRestByRule(st, 'p2', o); const late = put(st, 'p2', [FILL[3]]); const c = S.canRestByRule(st, 'p2', late);
  return all(eq('bare locked', a, false), eq('with source free', b, true), eq('newcomer locked', c, false));
});
// Q2910: BT18-009 on play: opp cannot gain memory except through Tamer effects
await sc('Q2910', 'BT18-009: opp digimon effect cannot add memory for opp; tamer effect can', async () => {
  const st = newState(); const me = put(st, 'p1', ['BT18-009']); await trig(st, 'p1', me, 'play');
  const dig = put(st, 'p2', [FILL[1]]); const tam = put(st, 'p2', [findC(c => c.category === 'tamer')[0]]); st.memory = 0;
  const run = async (stk) => { const ctx = { state: st, S, E, self: 'p2', opp: 'p1', sourceCardId: stk.cardId, sourceStackUid: stk.uid, trigger: {}, startAttack() {}, choose: async () => null }; await Fx.runScript(Fx.compileToScript('메모리 +1.'), ctx); };
  await run(dig); const a = st.memory; await run(tam); const b = st.memory;
  return all(eq('digimon effect blocked (memory stays 0 from p1 view)', a, 0), eq('tamer effect works (p2 +1 = -1 from p1 view)', b, -1));
});
finish('slice3-k');
