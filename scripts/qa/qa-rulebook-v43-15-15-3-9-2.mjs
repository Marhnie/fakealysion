// Ver.4.3 총합 룰 15-15-3-9-2 / 15-15-3-9-3 — "확인" 효과의 손패(패) 공개 범위·처리 순서 검증.
//   15-15-3-9-2(신설): "…단, 손패를 확인하는 경우는, 그 소유자인 플레이어와 확인하는 플레이어 양쪽에 공개한다."
//     (덱/트래시/시큐리티 등 다른 존은 기본값이 "확인하는 플레이어만 본다"지만, 손패는 예외로 소유자도 같이 본다.)
//   15-15-3-9-3(신설): "확인이 끝나면… 확인 뒤에 처리가 있으면, 되돌린 뒤에 그 처리를 한다."
//     (확인 대상을 원래 위치로 되돌리는 것이 이후 처리보다 먼저라는 순서 명시.)
//
// docs/rulebook-v43-changes.md 10절 감사 당시 "UI(main.js)가 실제로 양쪽 화면에 보여주는지는 카드별/화면별 감사가
// 안 됐다"고 미검증으로 남겼던 항목. 이번 패스에서 실제 확인해보니:
//   - 이 엔진은 "존재 화면"이 하나뿐인 로컬 시뮬레이터다(2인 모드는 항상 양쪽 손패를 같은 화면에 그대로 보여주고,
//     CPU 모드는 오직 "CPU 쪽" 손패만 사람 관전자용으로 흐리게 가릴 뿐, 자기 자신의 손패가 자기 자신에게 숨겨지는
//     경우는 애초에 없다 — src/main.js:822,1795의 isCpuSide(p) 마스킹은 상대(=CPU)쪽에만 걸린다).
//     즉 "손패 소유자는 항상 자기 손패를 볼 수 있다"는 이 엔진 구조상 자명하게 성립하고, 이번에 새로 만들 필요가
//     없었다. 반면 "확인하는 플레이어가 실제 카드를 보는가"는 기존에도 이미 성립했던 기본 동작(pickFromRevealed가
//     항상 진짜 카드 id를 넘김)이라 15-15-3-9-2 신설 이전부터 이미 옳았다.
//   - 이 QA는 그 "구조적으로 이미 옳다"는 주장을 헤드리스로 검증 가능한 상태 수준에서 증명한다: (1) 확인 패널에
//     넘어가는 카드 목록이 소유자의 실제 손패와 정확히 일치하고(정보가 축소·왜곡되지 않음), 확인 시점(선택 이전)에는
//     손패가 아직 그대로임(원래 위치에서 빼놓고 보여주는 게 아니라 제자리에서 열람만 함 — "되돌릴 것"이 애초에 없음).
//     (2) BT13-092처럼 확인 뒤에 처리가 있는 카드에서, 그 처리가 확인으로 인한 변화(파기) 이후 값을 보고 판단하는지
//     (15-15-3-9-3의 순서).
//   - "양쪽 화면에 실제로 보이는가"(DOM 렌더링) 자체는 헤드리스로 관측 불가능하다 — main.js의 pickFromRevealed
//     렌더러(약 2253번째 줄)를 브라우저에서 수동으로 한 번 훑어보는 것을 남겨둔다(아래 "수동 확인" 참고).
import { S, Fx, mk, T, eq, ok, runAll } from './lib-s1.mjs';
import '../../src/cards/index.js'; // registers OPS.s2_lookHandTrash (shard2.js) as a side effect

T('v43-15-15-3-9-2a', '손패 확인(BT11-088/BT13-092의 s2_lookHandTrash): 확인 패널에 넘어가는 카드 = 소유자의 실제 손패(정보 축소 없음), 확인 시점(선택 이전)엔 손패가 아직 그대로 — "되돌릴 대상"이 애초에 자리를 비운 적이 없음', async () => {
  const st = mk();
  const ids = [];
  for (const c of Object.values(S.CARDS)) { if (c.category === 'digimon' && !c.effectKo && !c.inheritedKo) { ids.push(c.id); if (ids.length === 3) break; } }
  st.players.p2.hand = [...ids];
  let seenRevealed = null;
  let handLenAtConfirm = null;
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: ids[0], sourceStackUid: null,
    choose: async (k, o) => {
      if (k === 'pickFromRevealed') { seenRevealed = o.revealed.slice(); handLenAtConfirm = st.players.p2.hand.length; return [0]; }
      return null;
    },
  };
  await Fx.runScript([{ op: 's2_lookHandTrash' }], ctx);
  eq('확인 패널에 공개된 목록이 상대 손패 원본(내용·순서)과 정확히 일치', seenRevealed, ids);
  eq('확인(선택) 시점엔 상대 손패가 아직 3장 그대로 — 열람은 제자리에서 이뤄짐(빼놨다 되돌리는 절차 자체가 불필요)', handLenAtConfirm, 3);
  eq('확인 뒤 실제 처리(선택한 1장 파기)로 손패가 2장으로 줄어듦', st.players.p2.hand.length, 2);
  ok('파기된 카드는 확인 패널에서 고른 바로 그 카드(ids[0])', !st.players.p2.hand.includes(ids[0]) && st.players.p2.hand.includes(ids[1]) && st.players.p2.hand.includes(ids[2]));
});

T('v43-15-15-3-9-3a', '확인 뒤 처리 순서(BT13-092 진화 시): "그 후, 상대 손패가 7장 이하라면"은 확인으로 인한 파기가 끝난 뒤(되돌린 뒤) 값을 봐야 한다 — 파기 전 손패 8장은 파기 후 7장이 되어 조건을 만족해야 함', async () => {
  const st = mk();
  const filler = Object.values(S.CARDS).find(c => c.category === 'digimon' && !c.effectKo && !c.inheritedKo).id;
  const secCard = Object.values(S.CARDS).find(c => c.category === 'digimon').id;
  st.players.p2.hand = Array(8).fill(filler); // 확인 전 8장
  st.players.p2.security = [secCard];
  const script = Fx.lookupCardSpecific('BT13-092', ['진화 시'], S.CARDS['BT13-092'].effectKo);
  ok('BT13-092::진화 시 스크립트가 등록되어 있음(s2_lookHandTrash 뒤 s2_if)', Array.isArray(script) && script.length === 2 && script[0].op === 's2_lookHandTrash');
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT13-092', sourceStackUid: null,
    choose: async (k, o) => (k === 'pickFromRevealed' ? [0] : null),
  };
  await Fx.runScript(script, ctx);
  // 파기(8->7) 직후 "그 후" 판정이 그 파기된 값(7, <=7 조건 성립)을 보고 시큐리티 맨 위 1장을 마저 패에 추가하므로,
  // 최종 손패는 8(-1+1)로 원위치한다 — 순서가 옳다는 증거는 손패 순증감이 아니라 시큐리티가 실제로 움직였는지다.
  eq('확인 뒤 처리(시큐리티 추가)까지 끝나 손패가 다시 8장(파기로 7 -> 조건 성립 -> 시큐리티 추가로 8)', st.players.p2.hand.length, 8);
  eq('파기 "그 후"(되돌린 뒤) 판정한 손패 7장 <= 7 조건을 만족해 시큐리티 맨 위가 패로 감 (시큐리티 0장) — 파기 전 값(8)을 봤다면 조건이 성립하지 않아 시큐리티가 그대로 1장 남아야 함', st.players.p2.security.length, 0);
});

T('v43-15-15-3-9-3b', '반대로 확인 전 손패가 9장이면 파기 후 8장이 되어 "7장 이하" 조건을 만족하지 못해야 한다 (순서가 뒤바뀌어 파기 전 값을 봤다면 이 케이스에서만 오작동이 드러남과 대칭적으로, 9장 케이스가 잘못 통과하지 않는지 확인)', async () => {
  const st = mk();
  const filler = Object.values(S.CARDS).find(c => c.category === 'digimon' && !c.effectKo && !c.inheritedKo).id;
  const secCard = Object.values(S.CARDS).find(c => c.category === 'digimon').id;
  st.players.p2.hand = Array(9).fill(filler); // 확인 전 9장 -> 파기 후 8장(7장 이하 아님)
  st.players.p2.security = [secCard];
  const script = Fx.lookupCardSpecific('BT13-092', ['진화 시'], S.CARDS['BT13-092'].effectKo);
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: 'BT13-092', sourceStackUid: null,
    choose: async (k, o) => (k === 'pickFromRevealed' ? [0] : null),
  };
  await Fx.runScript(script, ctx);
  eq('확인으로 1장 파기되어 손패 9 -> 8', st.players.p2.hand.length, 8);
  eq('8장은 "7장 이하"가 아니므로 시큐리티는 그대로(패로 추가되지 않음)', st.players.p2.security.length, 1);
});

const { fail } = await runAll('qa-rulebook-v43-15-15-3-9-2');
process.exit(fail ? 1 : 0);
