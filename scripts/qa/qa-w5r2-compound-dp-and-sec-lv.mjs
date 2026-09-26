// Card-text fidelity found while auditing the EX2-EX8 Q&A slice (idx 2668-3334):
//  * EX8-073 듀크몬 X항체 【진화 시/어택 시】: 「진화원에 「듀크몬」/「X항체」가 있다면, 이 디지몬을 DP+4000 하고, 상대의 디지몬 1마리를 DP-4000」 — 컴파일러가 첫 DP 변경만 내고 두 번째(상대 DP-4000)를 버렸다.
//  * EX6-031 샤카몬 【등장 시】【진화 시】 「디지몬 전부에게 《S 어택 -1》」 — 한 마리에게만 부여했다.
//  * EX6-028 세라피몬ACE 【서로의 턴】: 「자신의 시큐리티 매수 이하의 Lv.의 상대의 디지몬 1마리를 패로 되돌린다」 — Lv. 상한 조건이 통째로 빠져 어떤 디지몬이든 되돌렸다.
import { S, E, Fx, C, mk, put, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
async function run(st, cardId, tag, selfUid, ans) {
  const seg = S.parseEffectSegments(C(cardId).effectKo).segments.find(s => s.tags.includes(tag));
  const script = Fx.lookupCardSpecific(cardId, seg.tags, seg.body, false) || Fx.compileToScript(seg.body);
  const seen = []; const base = makeChoose(st);
  const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: cardId, sourceStackUid: selfUid, trigger: {}, choose: async (k, o) => { seen.push([k, o]); return (ans && ans[k] !== undefined) ? (typeof ans[k] === 'function' ? ans[k](o) : ans[k]) : base(k, o); } };
  await Fx.runScript(script, ctx); return seen;
}
T(3975, 'EX8-073: 진화원에 X항체가 있으면 자신 DP+4000 그리고 상대 디지몬 1마리 DP-4000 (둘 다)', async () => {
  const st = mk(); const me = put(st, 'p1', 'EX8-073', { src: ['BT9-109'] }); const o = put(st, 'p2', lv(5)); const dp0 = S.effectiveDP(st, 'p2', o), me0 = S.effectiveDP(st, 'p1', me);
  await run(st, 'EX8-073', '진화 시', me.uid);
  eq('상대 DP -4000', S.effectiveDP(st, 'p2', o), dp0 - 4000); eq('자신 DP +4000', S.effectiveDP(st, 'p1', me), me0 + 4000);
});
T('3975b', 'EX8-073: 진화원에 듀크몬/X항체가 없으면 아무 효과도 없다', async () => {
  const st = mk(); const me = put(st, 'p1', 'EX8-073'); const o = put(st, 'p2', lv(5)); const dp0 = S.effectiveDP(st, 'p2', o);
  await run(st, 'EX8-073', '진화 시', me.uid);
  eq('상대 DP 그대로', S.effectiveDP(st, 'p2', o), dp0);
});
T(3747, 'EX6-028: 시큐리티 매수 이하 Lv. 의 상대 디지몬만 패로 되돌릴 수 있다', async () => {
  const st = mk(); const me = put(st, 'p1', 'EX6-028'); const hi = put(st, 'p2', lv(6)), lo = put(st, 'p2', lv(3)); st.players.p1.security = ['ST1-01', 'ST1-01', 'ST1-01'];
  const seen = await run(st, 'EX6-028', '서로의 턴', me.uid);
  const pk = seen.find(x => x[0] === 'pickStack');
  ok('Lv.3은 후보', pk && pk[1].uids.includes(lo.uid)); ok('Lv.6은 후보 아님(시큐리티 3장)', pk && !pk[1].uids.includes(hi.uid));
  ok('Lv.6은 그대로', st.players.p2.battle.some(s => s.uid === hi.uid)); ok('Lv.3은 패로', !st.players.p2.battle.some(s => s.uid === lo.uid) && st.players.p2.hand.includes(C(lo.cardId).id));
});
T('3751', 'EX6-031: 【등장 시】 디지몬 전부에게 《S 어택 -1》 — 양쪽 모든 디지몬이 받는다', async () => {
  const st = mk(); const me = put(st, 'p1', 'EX6-031'); const a = put(st, 'p1', lv(4)); const o = put(st, 'p2', lv(5)); const o2 = put(st, 'p2', lv(3));
  await run(st, 'EX6-031', '등장 시', me.uid);
  for (const [p, s] of [['p1', me], ['p1', a], ['p2', o], ['p2', o2]]) eq(p + ' ' + s.cardId + ' S어택 -1', S.securityAttackBonus(s), -1);
});
// EX6-031 샤카몬 【등장 시】【진화 시】 「디지몬 전부에게 《S 어택 -1》」 — 한 마리에게만 부여하던 것을 양쪽 모든 디지몬에게 부여.
T('ex6-031', 'EX6-031: 【등장 시】 디지몬 전부에게 《S 어택 -1》 — 양쪽 모든 디지몬이 받는다', async () => {
  const st = mk(); const me = put(st, 'p1', 'EX6-031'); const a = put(st, 'p1', lv(4)); const o = put(st, 'p2', lv(5)); const o2 = put(st, 'p2', lv(3));
  await run(st, 'EX6-031', '등장 시', me.uid);
  for (const [p, s] of [['p1', me], ['p1', a], ['p2', o], ['p2', o2]]) eq(p + ' ' + s.cardId + ' S어택 -1', S.securityAttackBonus(s), -1);
});
// EX4-072 디지털 트랜스레이터 【시큐리티】 「자신의 트래시에서 디지몬 카드 1장을 패로 되돌리고, 이 카드를 패에 추가한다」 — "되돌리고" 철자에서 트래시 회수가 통째로 빠져 있었다.
T('ex4-072-sec', 'EX4-072 【시큐리티】: 트래시의 디지몬 카드 1장을 패로 되돌리고 이 카드도 패에 추가', async () => {
  const st = mk(); const d = lv(4); st.players.p1.trash = [d, 'EX4-072'];
  const seg = S.parseEffectSegments(C('EX4-072').inheritedKo).segments.find(s => s.tags.includes('시큐리티'));
  const script = Fx.compileToScript(seg.body);
  await Fx.runScript(script, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX4-072', sourceStackUid: null, trigger: {}, choose: makeChoose(st) });
  ok('트래시의 디지몬이 패로', st.players.p1.hand.includes(d)); ok('이 카드도 패로', st.players.p1.hand.includes('EX4-072')); eq('트래시 비움', st.players.p1.trash.includes(d), false);
});
await runAll('qa-w5r2-compound-dp-and-sec-lv');
