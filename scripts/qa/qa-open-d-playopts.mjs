// open-d (2): bespoke effect-driven paid plays (shard3 playPay, shard17 reveal-play) offer the shared play-cost options (hook options such as EX6-006, tamer/trait discounts) + DigiXros.
// Run: node scripts/qa/qa-open-d-playopts.mjs < /dev/null
import { S, E, Fx, C, FILL, mk, put, setHand, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const demon = Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes('7대마왕') && c.cost >= 7 && !c.isParallel && !c.id.includes('~'));
S.CARDS['TST-D1'] = { ...demon, id: 'TST-D1', level: 6, types: [...demon.types, '머신형'], effectKo: '', inheritedKo: '' }; // a 7대마왕 that also matches BT15-096's 머신형 filter
const mach = 'TST-D1';
const mkCtx = (st, a) => ({ state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: a.cardId, sourceStackUid: a.uid, choose: makeChoose(st) });
T('od-play-1', 'BT15-096 (shard3 playPay, cost -3): EX6-006 hook option is offered and its -3 applies on top', async () => {
  ok('fixture', !!mach);
  const script = Fx.lookupCardSpecific('BT15-096', ['메인'], '[딜레이] 등장 코스트 -3 하여 등장시킬 수 있다');
  ok('script', !!script);
  const build = (yes) => { const st = mk(); const a = put(st, 'p1', FILL); const rs = S._s4.makeStack(FILL, 1); rs.sources = ['EX6-006']; st.players.p1.raising = rs; S.recomputeStackGrants(rs); setHand(st, 'p1', [mach]); st.memory = 10; const asked = []; st._qaAns = { confirmEffect: (o) => { asked.push(o.prompt); return yes; } }; return { st, a, asked }; };
  const cost = C(mach).cost;
  let { st, a, asked } = build(true); await Fx.runScript(script, mkCtx(st, a));
  ok('option offered', asked.some(p => p.includes('대죄의 문'))); ok('played', st.players.p1.battle.some(s => s.cardId === mach)); eq('memory = cost -3 -3', 10 - st.memory, Math.max(0, cost - 6));
  ({ st, a, asked } = build(false)); await Fx.runScript(script, mkCtx(st, a)); ok('declined still plays', st.players.p1.battle.some(s => s.cardId === mach)); eq('memory = cost -3', 10 - st.memory, Math.max(0, cost - 3));
});
runAll('qa-open-d-playopts');
