// Ver.4.3 총합 룰 2-3-3-3/2-3-3-4 검증: "≪X≫를 가진 카드"를 참조하는 효과는 그 키워드 효과를
// "항상"(상시) 가진 카드만 참조할 수 있다 — 다른 효과로 일시적/영구적으로 "얻은" 카드는 참조 대상이 아니다.
// (Ver.4.2까지는 이 구분이 총합 룰에 없어서, hasKeyword를 그대로 쓰는 "참조" 로직이 일시 부여까지 잘못 포함시켰다.)
//
// 이 스크립트는 특정 카드의 스크립트가 아니라 state.js/effects.js의 일반 로직(hasAlwaysKeyword, matchesFilter의
// keywordHas)을 직접 검증한다: 구 해석(hasKeyword, 부여 포함)과 신 해석(hasAlwaysKeyword, 상시만)이 실제로
// 다른 결과를 내는 보드를 만들고, 엔진이 신 해석을 구현하는지 확인한다.
import { S, Fx, C, mk, put, T, eq, ok, runAll, FILL } from './lib-s1.mjs';

// EX4-045: 첫 줄이 바로 "《블로커》" — 인쇄된(상시) 블로커를 가진 실카드.
const PRINTED_BLOCKER = 'EX4-045';
ok('fixture: EX4-045 prints bare 《블로커》', /^《블로커》/.test(C(PRINTED_BLOCKER).effectKo.trim()));
// 블로커가 인쇄되어 있지 않은 평범한 디지몬(필러 카드) — 이번 턴 효과로만 블로커를 "얻는다".
ok('fixture: FILL has no printed keyword text', !C(FILL).effectKo && !C(FILL).inheritedKo);

T('v43-2-3-3-3', '상시로 ≪블로커≫를 가진 카드 vs 효과로 일시 획득한 카드 — hasAlwaysKeyword 구분', async () => {
  const st = mk();
  const printed = put(st, 'p1', PRINTED_BLOCKER);
  const granted = put(st, 'p1', FILL);
  S.grantKeyword(st, 'p1', granted.uid, '블로커', undefined, 'turn'); // "이번 턴 ≪블로커≫를 얻는다"류 일시 부여

  // 두 카드 모두 "지금 블로커를 갖고 있다"는 사실 자체(=자신의 행동 가능 여부, hasKeyword)는 참이어야 한다 —
  // 이건 15-15-7-4 계열이 아니라 2-3-3-3이 다루는 "참조" 문제와는 다른 질문이다.
  ok('printed stack currently has 블로커 (hasKeyword)', S.hasKeyword(printed, '블로커'));
  ok('granted stack currently has 블로커 (hasKeyword)', S.hasKeyword(granted, '블로커'));

  // 그러나 "≪블로커≫를 가진 카드"를 참조/필터링하는 효과(2-3-3-3, Ver.4.3)는 printed만 인정해야 한다.
  ok('printed stack counts as ALWAYS having 블로커 (hasAlwaysKeyword)', S.hasAlwaysKeyword(printed, '블로커'));
  ok('granted (temp-only) stack must NOT count as always having 블로커 (Ver.4.3 2-3-3-3)', !S.hasAlwaysKeyword(granted, '블로커'));

  // matchesFilter의 filter.keywordHas 경로(실제 카드 텍스트 "≪블로커≫를 가진 …"를 컴파일한 결과가 쓰는 필터)도
  // 같은 결론을 내야 한다: EX13-051류 카드가 "≪블로커≫를 가진 다른 자신의 디지몬"을 대상으로 삼을 때, 일시
  // 부여로 블로커를 얻은 디지몬은 대상이 아니다.
  const filter = { keywordHas: '블로커' };
  ok('matchesFilter: printed-Blocker stack matches keywordHas filter', Fx.FX_HELPERS.matchesFilter(S, printed, filter, st));
  ok('matchesFilter: temp-granted stack must NOT match keywordHas filter (Ver.4.3)', !Fx.FX_HELPERS.matchesFilter(S, granted, filter, st));
});

T('v43-2-3-3-3b', '영구(permanent) 부여도 "참조"에는 포함되지 않는다 — 부여 지속시간과 무관', async () => {
  const st = mk();
  const granted = put(st, 'p1', FILL);
  S.grantKeyword(st, 'p1', granted.uid, '블로커', undefined, 'permanent'); // "영구히 ≪블로커≫를 얻는다" 부여여도
  ok('permanently-granted-by-effect stack still has the keyword for its own play (hasKeyword)', S.hasKeyword(granted, '블로커'));
  ok('but is still NOT "always has" for reference purposes (Ver.4.3 2-3-3-3 — the example explicitly excludes 얻는 효과 regardless of duration)', !S.hasAlwaysKeyword(granted, '블로커'));
});

const { fail } = await runAll('qa-rulebook-v43-2-3-3-3');
process.exit(fail ? 1 : 0);
