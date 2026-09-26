// Unresolved-b (5) / Q3699: EX6-006's inherited "-3 to the paid play cost" is also usable when an EFFECT plays the digimon (paid play).
import { S, E, Fx, C, FILL, mk, put, setHand, drain, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const demon = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('7대마왕') && c.cost >= 5 && !c.isParallel && !c.id.includes('~'))?.id;
const mkCtx = (st, a) => ({ state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: a.cardId, sourceStackUid: a.uid, choose: makeChoose(st) });
T(3699, 'EX6-006 source in the breeding area: a paid effect-play (s8_playOrUse -2 / s2_playDiscounted) offers the -3 option and uses the once', async () => {
  ok('fixture', !!demon);
  for (const script of [[{ op: 's8_playOrUse', zones: ['hand'], delta: -2 }], [{ op: 's2_playDiscounted', discount: 2, pred: () => true }]]) {
    const st = mk(); const a = put(st, 'p1', FILL); const rs = S._s4.makeStack(FILL, 1); rs.sources = ['EX6-006']; st.players.p1.raising = rs; S.recomputeStackGrants(rs);
    setHand(st, 'p1', [demon]); st.memory = 10; const cost = C(demon).cost;
    const asked = []; st._qaAns = { confirmEffect: (o) => { asked.push(o.prompt); return true; } };
    await Fx.runScript(script, mkCtx(st, a));
    ok('option offered', asked.some(p => p.includes('대죄의 문'))); ok('digimon played', st.players.p1.battle.some(s => s.cardId === demon));
    eq('memory spent = cost -2 -3', 10 - st.memory, Math.max(0, cost - 5));
    ok('once consumed', Object.values(rs.turnEffectUses || {}).some(v => v === 1));
    const st2 = mk(); const a2 = put(st2, 'p1', FILL); const rs2 = S._s4.makeStack(FILL, 1); rs2.sources = ['EX6-006']; st2.players.p1.raising = rs2; S.recomputeStackGrants(rs2);
    setHand(st2, 'p1', [demon]); st2.memory = 10; st2._qaAns = { confirmEffect: false };
    await Fx.runScript(script, mkCtx(st2, a2)); eq('declined: memory spent = cost -2 only', 10 - st2.memory, Math.max(0, cost - 2)); ok('declined: once kept', !Object.values(rs2.turnEffectUses || {}).some(v => v >= 1));
  }
});
runAll('qa-unres-b-ex6006');
