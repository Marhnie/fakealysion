// Audit batch g5/tier1_batch1 — EX10-061 (아포카리몬) official rulings Q5783/Q5784.
// Bug found: the card's untagged rule line ("이 카드가 등장할 때, 자신의 시큐리티에서 명칭이 서로 다른 특징 「어둠의
// 4천왕」을 가진 앞면의 카드 1장씩을 이 카드 아래에 놓는 것으로, 놓은 카드 1장마다, 지불하는 코스트 -4") had NO
// implementation anywhere (no handPlayOption hook, no generic compiler pattern for a per-card "장마다 -N" hand-play
// cost) — the card could never actually receive this discount when played from hand. Fixed by:
//   - src/cards/shard38.js: a new EX10-061 '__handPlay' handPlayOption hook, mirroring the existing "명칭이 서로
//     다른 것 1장씩 / 있으면 전부, 아니면 안 함" all-or-nothing selection already used by the card's own 【등장 시】
//     script (shard65.js) per Q5785/5786.
//   - src/state.js: placeXrosMaterials() gained a `kind: 'security'` branch (mirroring the existing hand/tamer/trash
//     branches) so a face-up security card chosen this way is actually removed from security and lands under the
//     new stack, the same deferred-apply pattern BT10-093 already uses via state._s2PlayMat.
// Run: node scripts/qa/qa-audit-g5-t1b1-ex10061-handplay-cost.mjs < /dev/null
import { S, mk, T, eq, ok, runAll } from './lib-s1.mjs';

const BASE_COST = S.CARDS['EX10-061'].cost; // 17

T('5784a', 'EX10-061: 시큐리티에 명칭이 다른 「어둠의 4천왕」 2장 → 모두 아래에 놓고 코스트 -8', async () => {
  const st = mk();
  st.players.p1.hand.push('EX10-061');
  S.secAddFaceUp(st, 'p1', 'BT15-031', 'bottom'); // 메탈시드라몬
  S.secAddFaceUp(st, 'p1', 'BT15-052', 'bottom'); // 피노키몬
  const opts = S.hookPlayCostOptions(st, 'p1', 'EX10-061');
  ok('옵션 1개 제시됨', opts.length === 1);
  const delta = await opts[0].apply(async () => null);
  eq('코스트 -8', delta, -8);
  // removal is deferred (same pattern as BT10-093's state._s2PlayMat) until the stack is actually created below
  const idx = st.players.p1.hand.indexOf('EX10-061');
  const cost = Math.max(0, BASE_COST + delta);
  S.spendMemory(st, cost);
  const stack = S.playDigimonFresh(st, 'p1', idx);
  ok('두 카드 모두 진화원 아래에 놓임', stack.sources.includes('BT15-031') && stack.sources.includes('BT15-052'));
  eq('시큐리티에서 2장 모두 제거됨', st.players.p1.security.length, 0);
});

T('5783a', 'EX10-061: 시큐리티에 「어둠의 4천왕」 1장뿐이면 그 1장만 놓고 코스트 -4', async () => {
  const st = mk();
  st.players.p1.hand.push('EX10-061');
  S.secAddFaceUp(st, 'p1', 'BT15-031', 'bottom');
  const opts = S.hookPlayCostOptions(st, 'p1', 'EX10-061');
  ok('옵션 1개 제시됨', opts.length === 1);
  const delta = await opts[0].apply(async () => null);
  eq('코스트 -4', delta, -4);
  const idx = st.players.p1.hand.indexOf('EX10-061');
  const stack = S.playDigimonFresh(st, 'p1', idx);
  eq('그 1장만 진화원 아래에 놓임', stack.sources, ['BT15-031']);
});

T('none', 'EX10-061: 앞면의 「어둠의 4천왕」 시큐리티가 없으면 옵션 자체가 제시되지 않는다', async () => {
  const st = mk();
  st.players.p1.hand.push('EX10-061');
  const opts = S.hookPlayCostOptions(st, 'p1', 'EX10-061');
  eq('옵션 없음', opts.length, 0);
});

T('facedown', 'EX10-061: 시큐리티의 카드가 뒷면(비공개)이면 사용할 수 없다', async () => {
  const st = mk();
  st.players.p1.hand.push('EX10-061');
  S.addToSecurity ? S.addToSecurity(st, 'p1', 'BT15-031', 'bottom') : st.players.p1.security.push('BT15-031'); // face-down (no secAddFaceUp)
  const opts = S.hookPlayCostOptions(st, 'p1', 'EX10-061');
  eq('뒷면 카드는 후보에서 제외됨', opts.length, 0);
});

await runAll('qa-audit-g5-t1b1-ex10061-handplay-cost');
