// Official Q&A id 3835 (EX7-014 볼케닉드라몬 【진화 시】 「DP 6000 이하의 디지몬을 등장시킬 수 없으며, 이동시킬 수 없다」): 효과로도 DP 6000 이하의 디지몬을 배틀 에어리어에서
// 육성 에어리어로 이동시킬 수 없다 (P-143 두리몬 【자신의 턴 종료 시】).
import { S, E, Fx, C, mk, put, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
async function run(st, cardId, tag, uid) {
  const seg = S.parseEffectSegments(C(cardId).effectKo).segments.find(s => s.tags.includes(tag)); const script = Fx.lookupCardSpecific(cardId, seg.tags, seg.body, false);
  await Fx.runScript(script, { state: st, S, E, self: 'p2', opp: 'p1', sourceCardId: cardId, sourceStackUid: uid, trigger: {}, choose: makeChoose(st) });
}
T(3835, 'P-143: EX7-014의 제한이 걸려 있으면 육성 에어리어로 이동 불가 / 없으면 이동', async () => {
  let st = mk(); let d = put(st, 'p2', 'P-143'); (st.playRestrictions ||= []).push({ player: 'p2', dpMax: 6000, until: st.turnNumber + 1 });
  await run(st, 'P-143', '자신의 턴 종료 시', d.uid);
  eq('이동 못 함', st.players.p2.raising, null); eq('배틀 에어리어에 남음', st.players.p2.battle.includes(d), true);
  st = mk(); d = put(st, 'p2', 'P-143'); await run(st, 'P-143', '자신의 턴 종료 시', d.uid);
  eq('제한 없으면 이동', st.players.p2.raising === d, true);
});
// Q3834 (EX7-014 vs EX5-058 옥토몬): the restriction stops the OPPONENT from playing DP<=6000 digimon; my own Octomon placing a 「후지쓰몬」 token on the opponent's board is still allowed.
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
T(3834, 'EX5-058: DP 제한이 걸린 상대의 필드에 자신의 효과로 토큰을 등장시킬 수 있다', async () => {
  const st = mk(); const oct = put(st, 'p1', 'EX5-058'); (st.playRestrictions ||= []).push({ player: 'p2', dpMax: 6000, until: st.turnNumber + 1 });
  put(st, 'p2', lv(4));
  const seg = S.parseEffectSegments(C('EX5-058').effectKo).segments.find(s => s.tags.includes('등장 시')); const script = Fx.lookupCardSpecific('EX5-058', seg.tags, seg.body, false);
  await Fx.runScript(script, { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX5-058', sourceStackUid: oct.uid, trigger: {}, choose: makeChoose(st) });
  ok('상대 필드에 토큰 등장', st.players.p2.battle.some(s => S.isTokenId(s.cardId)));
});
await runAll('qa-w5r2-ex7-014');
