// secFlipTopFaceUp: 같은 카드 번호가 시큐리티 안에서 서로 다른 깊이에 여러 장 있을 때, 다시 뒤집으면
// "위에서부터 아직 뒷면인 다음 카드"(물리적 위치)를 뒤집어야 한다 — 같은 카드번호의 매수만 세면
// 사이에 낀 다른 카드를 건너뛰고 같은 번호를 또 "뒤집은 것"으로 잘못 셀 수 있다 (EX11-043 Q5789).
// Run: node scripts/qa/qa-audit-secfliptop-position.mjs < /dev/null
import { S, FILL, mk, T, eq, ok, runAll } from './lib-s1.mjs';
const B = Object.values(S.CARDS).find(c => c.id !== FILL && c.category === 'digimon')?.id;
T(1, '시큐리티 [A,B,A](위→아래)에서 두 번째로 뒤집으면 A를 또 뒤집지 않고 B(2번째 위치)를 뒤집는다', async () => {
  const st = mk();
  st.players.p1.security = [FILL, B, FILL]; // top -> bottom
  const first = S.secFlipTopFaceUp(st, 'p1');
  eq('첫 번째: 맨 위 A(FILL) 공개', first, FILL);
  const second = S.secFlipTopFaceUp(st, 'p1');
  eq('두 번째: 2번째 위치인 B를 공개(A를 또 세지 않음)', second, B);
  const third = S.secFlipTopFaceUp(st, 'p1');
  eq('세 번째: 마지막 남은 A(맨 아래) 공개', third, FILL);
  eq('셋 다 공개됨', S.secFaceUpCount(st.players.p1), 3);
  eq('네 번째는 더 뒤집을 카드 없음', S.secFlipTopFaceUp(st, 'p1'), null);
});
await runAll('qa-audit-secfliptop-position');
