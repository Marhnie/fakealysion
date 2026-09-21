# 유니크 엠블럼 《딜레이》가 발동하지 않던 문제

## 증상
BT22-096/098, EX10-069, BT23-098, BT24-089, EX11-072, P-227~P-232, P-237 등 「유니크 엠블럼」을 배틀 에어리어에 놓은 뒤,
다음 자신의 턴에 지정한 테이머가 레스트/등장해도 딜레이 확인창이 뜨지 않음 ("자동 인식 실패" 표시로 대기만 함).

## 원인
- 엔진(state.js 워처/훅)은 정상: 트리거 문장 `《딜레이》.` 이 pending 에 정상 큐잉됨 (같은 턴 배치 여부 `placedTurn` 도 정상).
- `src/main.js` 의 `scriptFor(trigger)` 가 이 문장을 `compileToScript` 로 컴파일하면 빈 스크립트 `[]` (딜레이는 룰 16-17 상 즉시 효과가 아님).
- `autoRunMandatoryPending` 은 `scriptFor(t).length` 가 0 이면 러너를 시작하지 않으므로, `runPendingScript` 안의
  딜레이 분기(확인 → 파기 → 불릿 효과)에 도달하지 못했음.

## 수정
`src/main.js` `scriptFor`: 컴파일 결과가 비어 있고 `Effects.delayBulletPlan(...)` 이 존재하면 자리표시 스크립트 `[{ op: 'delayTrigger' }]` 반환
(실제 처리는 기존 `runPendingScript` 딜레이 분기가 담당: 놓인 턴이면 "놓인 턴에는 사용할 수 없어" 로그 후 종료, 이후 턴이면 확인창 → 파기 → 불릿).

## 검증
- `node scripts/qa/qa-emblem-flow.mjs < /dev/null` : 13장 전부 (사용 → 배치 → 같은 턴 불가 → 이후 턴 트리거 큐잉 → 거절 시 유지 → 수락 시 트래시 + 불릿 실행) 통과.
- 실제 브라우저(localhost:5588, `window.__dbg()`): BT22-096(야오 친란 레스트), P-227(류타로우 등장)에서 같은 턴은 발동 안 됨, 이후 턴에는
  확인창 → 파기 → 진화 대상 선택창까지 확인.
- audit-effects, soak 40, test-cpu 이상 없음.

## 참고
러너가 없는 헤드리스 경로(`scripts/qa/lib-s1.mjs` drain)는 딜레이 분기를 흉내내지 않으므로 qa-emblem-flow 가 자체 미러(`runDelayPending`)를 사용한다.
