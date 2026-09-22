// "상대는 효과로 디지몬을 등장시킬 수 없다"(BT8-097 홍염 등, addTimedLock(..., 'effectPlay', ...))는 잠긴 플레이어 "자신"의
// 효과를 막는 것이지, 다른 플레이어의 효과가 잠긴 쪽 필드에 카드를 등장시키는 것까지 막으면 안 된다 (BT24-017 Q5595).
// playFreeFromZone/playFreeToRaising가 잠금을 "누구 필드에 놓이는가"(zone owner)로 검사해, p1이 발휘한 효과로 p2 쪽에
// 토큰 등을 등장시키는데도 p2가 잠겨 있으면 막히던 버그. Run: node scripts/qa/qa-audit-effectplay-lock-controller.mjs < /dev/null
import { S, FILL, mk, T, eq, ok, runAll } from './lib-s1.mjs';
T(1, 'p2가 홍염류로 잠겨 있어도, p1이 발휘한 효과로 p2 쪽에 카드를 등장시킬 수 있다', async () => {
  const st = mk(); st.turnNumber = 3;
  S.addTimedLock(st, 'p2', 'effectPlay', 10);
  st.players.p2.hand.push(FILL);
  st._fxSrc = { player: 'p1' }; // 지금 발휘 중인 효과의 주체는 p1
  const stk = S.playFreeFromZone(st, 'p2', 'hand', st.players.p2.hand.length - 1, {});
  ok('p1의 효과이므로 p2의 잠금에 막히지 않고 등장', !!stk);
});
T(2, 'p2 자신의 효과라면 여전히 잠금에 막힌다', async () => {
  const st = mk(); st.turnNumber = 3;
  S.addTimedLock(st, 'p2', 'effectPlay', 10);
  st.players.p2.hand.push(FILL);
  st._fxSrc = { player: 'p2' };
  const stk = S.playFreeFromZone(st, 'p2', 'hand', st.players.p2.hand.length - 1, {});
  ok('p2 자신의 효과는 여전히 막힘', !stk);
});
await runAll('qa-audit-effectplay-lock-controller');
