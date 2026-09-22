// Ver.4.3 총합 룰 15-15-7-4 검증 (역전된 규칙):
//   구(Ver.4.2): "다른 효과를 발휘시키는 효과가 강제 효과인 경우, 선택된 다른 효과의 임의 처리 조건도 강제로 처리한다."
//   신(Ver.4.3): "다른 효과를 발휘시키는 효과가 강제 효과인 경우에도, 선택된 다른 효과의 임의 처리 조건을 처리할지는
//                여전히 플레이어가 선택할 수 있다."
// "이하의 효과에서 1개를 선택하여 발휘한다. <조건>이라면 대신 이하의 효과 전부를 발휘한다." 형태 카드(15-15-7-2/4,
// effectChoice op, allIf 분기)에서, "전부 발휘"가 강제라도 각 효과 안의 "~하는 것으로,"(임의 처리 조건, costGroup)는
// 여전히 플레이어가 거부할 수 있어야 한다 — 자동으로 강제 처리되면 안 된다.
import { S, Fx, mk, put, FILL, T, ok, runAll } from './lib-s1.mjs';

T('v43-15-15-7-4', '강제로 "전부 발휘"하는 효과 안에서도 각 효과의 임의 처리 조건은 플레이어가 선택한다', async () => {
  const st = mk();
  const tamer = put(st, 'p1', FILL); // 레스트 비용을 지불할 대상(임의 처리 조건의 비용)
  const handBefore = st.players.p1.hand.length;
  let confirmAsked = 0;
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: FILL, sourceStackUid: tamer.uid,
    choose: async (k, o) => {
      if (k === 'confirmEffect') { confirmAsked++; return false; } // 플레이어가 "아니오"를 선택
      if (k === 'multipleChoice') return 0; // 순서는 첫 번째부터
      return null;
    },
  };
  // "이하의 효과 전부를 발휘한다"의 각 효과: "이 테이머를 레스트시키는 것으로, 1드로우" 형태의 임의 처리 조건부 효과.
  const makeOption = (label) => ({ label, then: [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'draw', who: 'p1', n: 1 }] }] });
  const script = [{ op: 'effectChoice', allIf: () => true, options: [makeOption('A'), makeOption('B')] }];
  await Fx.runScript(script, ctx);

  ok('플레이어의 confirmEffect 선택이 실제로 호출됨 (자동 강제 처리로 우회되지 않음)', confirmAsked >= 1);
  ok('거부(아니오)했으므로 비용(레스트)이 지불되지 않음 — 테이머는 그대로 액티브', !tamer.suspended);
  ok('거부했으므로 이후 처리(드로우)가 실행되지 않음 — 손패 변화 없음 (Ver.4.3 15-15-7-4)', st.players.p1.hand.length === handBefore);
});

T('v43-15-15-7-4b', '반대로 수락(예)하면 비용을 지불하고 효과가 발휘된다 (정상 동작 회귀 확인)', async () => {
  const st = mk();
  const tamer = put(st, 'p1', FILL);
  st.players.p1.security = [FILL]; // 두 번째 효과의 비용(시큐리티 파기)용
  const handBefore = st.players.p1.hand.length;
  const ctx = {
    state: st, S, self: 'p1', opp: 'p2', sourceCardId: FILL, sourceStackUid: tamer.uid,
    choose: async (k, o) => { if (k === 'confirmEffect') return true; if (k === 'multipleChoice') return 0; return null; },
  };
  // 서로 다른 비용을 쓰는 두 효과 — 첫 효과가 두 번째 효과의 지불 가능 여부에 영향을 주지 않도록.
  const optA = { label: 'A', then: [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'draw', who: 'p1', n: 1 }] }] };
  const optB = { label: 'B', then: [{ op: 'costGroup', cost: [{ op: 'removeSecurity' }], then: [{ op: 'draw', who: 'p1', n: 1 }] }] };
  const script = [{ op: 'effectChoice', allIf: () => true, options: [optA, optB] }];
  await Fx.runScript(script, ctx);
  ok('수락했으므로 테이머가 레스트됨', tamer.suspended);
  ok('수락했으므로 시큐리티도 소모됨', st.players.p1.security.length === 0);
  ok('두 효과 모두 수락 -> 발휘되어 드로우 2장', st.players.p1.hand.length === handBefore + 2);
});

const { fail } = await runAll('qa-rulebook-v43-15-15-7-4');
process.exit(fail ? 1 : 0);
