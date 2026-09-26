// Official Q&A id 3454 (EX4-014 가오스몬 【자신의 턴】[턴에 1회]): 「블루 플레어」 카드가 등장해서 유발한 효과가 발휘되기 전에 다른 효과로 「트와일라잇」 카드가 등장하면 두 트리거는 각각 별개로 유발하고,
// 나중에 유발한 쪽(트와일라잇: 트래시의 디지크로스 디지몬을 패로)이 먼저 발휘되어 [턴에 1회]를 사용한 뒤라 먼저 유발한 ≪1 드로우≫는 발휘하지 않는다. (예전엔 큐잉 시점에 1회를 소모해 두 번째 트리거가 아예 생기지 않았다.)
import { S, E, Fx, C, mk, put, setHand, setTrash, T, eq, ok, runAll, makeChoose, drain } from './lib-s1.mjs';
const withType = (t) => Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes(t) && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id
  || Object.values(S.CARDS).find(c => c.category === 'digimon' && (c.types || []).includes(t) && c.dp && !c.isParallel && c.id !== 'EX4-014')?.id;
const xrosCard = Object.values(S.CARDS).find(c => c.category === 'digimon' && /디지크로스\s*-/.test(c.effectKo || '') && c.dp)?.id;
const pendingOf = (st) => st.pending.filter(x => !x.resolved && x.cardId === 'EX4-014');
async function resolveOne(st, t) { const seg = S.parseEffectSegments(C('EX4-014').effectKo).segments.find(s => s.tags.includes('자신의 턴')); const script = Fx.lookupCardSpecific('EX4-014', t.tags, t.text, false); const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX4-014', sourceStackUid: t.stackUid, trigger: t, choose: makeChoose(st) }; await Fx.runScript(script, ctx); S.resolvePending(st, t.uid); }
T(3454, 'EX4-014: 블루 플레어 → 트와일라잇 순으로 등장: 트리거 2개가 모두 생기고, 나중 것이 먼저 발휘되면 드로우는 못 한다', async () => {
  const bf = withType('블루 플레어'), tw = withType('트와일라잇'); ok('픽스처', !!bf && !!tw && !!xrosCard && bf !== tw);
  const st = mk(); put(st, 'p1', 'EX4-014'); setHand(st, 'p1', [bf, tw]); setTrash(st, 'p1', [xrosCard]);
  S.playFreeFromZone(st, 'p1', 'hand', 0, {}); S.playFreeFromZone(st, 'p1', 'hand', 0, {});
  const ps = pendingOf(st); eq('트리거 2개 큐잉', ps.length, 2);
  const deck0 = st.players.p1.deck.length, hand0 = st.players.p1.hand.length;
  // resolve the LATER trigger (Twilight) first, then the earlier one (Blue Flare)
  const bfT = ps.find(t => { const s = st.players.p1.battle.find(x => x.uid === t.evt.stackUid); return s && (C(s.cardId).types || []).includes('블루 플레어'); });
  const twT = ps.find(t => t !== bfT);
  await resolveOne(st, twT); await resolveOne(st, bfT);
  eq('트래시의 디지크로스 카드가 패로', st.players.p1.hand.includes(xrosCard), true);
  eq('드로우는 하지 못함', st.players.p1.deck.length, deck0);
});
await runAll('qa-w5r2-ex4-014');
