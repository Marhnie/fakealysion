// ≪퇴화≫ 룰 16-12 / 4-7-6 재확인. Run: node scripts/qa/qa-retreat-rules.mjs < /dev/null
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';
const digi = (lv) => Object.values(S.CARDS).filter(c => c.category === 'digimon' && c.level === lv && c.dp && !c.effectKo && !c.inheritedKo)[0]?.id;
const L3 = digi(3), L4 = digi(4), L5 = digi(5), L6 = digi(6);
const XA = 'BT9-109', TAM = Object.values(S.CARDS).find(c => c.category === 'tamer' && !c.effectKo)?.id;
T(1, '퇴화 3: 위에서부터 한 장씩, Lv.3에 닿으면 거기서 멈춘다 (16-12-4/-6)', async () => {
  const st = mk(); const s = put(st, 'p1', L6, { src: [L3, L4, L5] }); // top L6, sources bottom->top: L3 L4 L5
  const r = S.retreat(st, 'p1', s.uid, 3);
  eq('현재 최상단', s.cardId, L3); eq('파기 순서', r, [L6, L5, L4]); eq('진화원 남음', s.sources.length, 0);
});
T(2, '퇴화 2: 정확히 2장만 (선언한 수)', async () => {
  const st = mk(); const s = put(st, 'p1', L6, { src: [L3, L4, L5] }); S.retreat(st, 'p1', s.uid, 2);
  eq('최상단', s.cardId, L4); eq('진화원', s.sources, [L3]);
});
T(3, '최상단이 Lv.3이면 퇴화해도 더 파기하지 않는다', async () => {
  const st = mk(); const s = put(st, 'p1', L3, { src: [L3] }); const r = S.retreat(st, 'p1', s.uid, 1);
  eq('파기 없음', r.length, 0); eq('최상단', s.cardId, L3);
});
T(4, '퇴화로 위에 X항체 같은 DP 없는 카드가 최상단이 되면 그 카드와 아래 진화원이 모두 파기되고 소멸로 취급하지 않는다 (Q&A 참조)', async () => {
  const st = mk(); const s = put(st, 'p1', L5, { src: [L3, L4, XA] }); // XA sits on top of the sources
  S.retreat(st, 'p1', s.uid, 1);
  ok('스택이 사라짐 또는 DP 있는 디지몬이 최상단', !st.players.p1.battle.includes(s) || S.card(s.cardId).dp != null);
  eq('소멸 이벤트 아님 (필드에 좀비 없음)', st.players.p1.battle.filter(x => x.uid === s.uid && S.card(x.cardId).dp == null).length, 0);
});
T(5, '진화원이 전부 뒷면일 때 퇴화: 뒷면 카드가 최상단이 되어선 안 된다', async () => {
  const st = mk(); const s = put(st, 'p1', L5, { src: [L4] }); s.s5fd = 1; // the only source is face-down
  const r = S.retreat(st, 'p1', s.uid, 1);
  ok('최상단이 그대로거나 파기 없음', r.length === 0 && s.cardId === L5);
});
T(6, '퇴화 후 DP -N 효과는 남아 있고 새 최상단의 DP로 계산된다', async () => {
  const st = mk(); const s = put(st, 'p1', L5, { src: [L4, L3] }); S.modifyDP(st, 'p1', s.uid, -1000, 'turn');
  const before = S.effectiveDP(st, 'p1', s); S.retreat(st, 'p1', s.uid, 1);
  eq('DP = 새 카드 DP - 1000', S.effectiveDP(st, 'p1', s), S.card(s.cardId).dp - 1000);
});
await runAll('qa-retreat-rules');
