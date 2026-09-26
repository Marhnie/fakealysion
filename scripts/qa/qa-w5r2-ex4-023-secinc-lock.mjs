// Official Q&A id 3464 (EX4-023 아구몬 박사 【상대의 턴】): 상대가 「BT9-103 금강」으로 시큐리티를 늘릴 수 없게 한 경우에도 이 효과는 발휘할 수 있지만, 오픈한 카드는 시큐리티 위에 놓지 못하고 룰에 의해 파기된다.
import { S, E, Fx, C, mk, put, setHand, T, eq, ok, runAll, makeChoose } from './lib-s1.mjs';
const lv = (n) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === n && c.dp && !c.effectKo && !c.inheritedKo && !c.isParallel)?.id;
async function fire(st, locked) {
  const doc = put(st, 'p1', 'EX4-023'); const l4 = lv(4); setHand(st, 'p1', [l4]); if (locked) (st.s1Rules ||= []).push({ kind: 'noSecurityIncrease', blocked: 'p1', until: st.turnNumber + 1 });
  doc.s39PlayLv = C(l4).level;
  const seg = S.parseEffectSegments(C('EX4-023').effectKo).segments.find(s => s.tags.includes('상대의 턴'));
  const script = Fx.lookupCardSpecific('EX4-023', seg.tags, seg.body, false); const ctx = { state: st, S, E, self: 'p1', opp: 'p2', sourceCardId: 'EX4-023', sourceStackUid: doc.uid, trigger: {}, choose: makeChoose(st) };
  await Fx.runScript(script, ctx); return l4;
}
T(3464, 'EX4-023: 시큐리티를 늘릴 수 없으면 오픈한 카드는 시큐리티가 아니라 트래시로', async () => {
  const st = mk(); const l4 = await fire(st, true);
  eq('시큐리티 그대로', st.players.p1.security.length, 0); eq('트래시로', st.players.p1.trash.includes(l4), true); eq('패에서 빠짐', st.players.p1.hand.length, 0);
});
T('3463', 'EX4-023: 제한이 없으면 패의 같은 Lv. 카드가 시큐리티 위에 놓인다', async () => {
  const st = mk(); const l4 = await fire(st, false);
  eq('시큐리티 +1', st.players.p1.security.length, 1); eq('그 카드', st.players.p1.security[0], l4);
});
await runAll('qa-w5r2-ex4-023');
