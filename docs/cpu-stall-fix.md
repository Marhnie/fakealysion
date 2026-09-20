# CPU 모드 재대전 후 멈춤(softlock) 근본 수정

## 원인
게임 상태(`state`)는 재대전/새 게임/되돌리기/불러오기 때 **새 객체로 교체**되지만, 비동기 진행 상태는 모듈 전역에 남아 있었다.
- `main.js` `pendingRunner` / `runningPendingUid`: 옛 게임의 효과 러너가 옛 state 의 프롬프트(`ctxChoose`)에서 영원히 대기하면 (게임 종료 시점에
  효과가 진행 중이던 경우) 새 게임의 러너가 `if (pendingRunner) return`에 막혀 효과가 자동 실행되지 않음 -> 12초 뒤 워치독이 복구.
  반대로 옛 러너가 뒤늦게 끝나면 `finally`가 **새 게임의 러너 플래그를 지워** 러너가 겹칠 수 있었음.
- 옛 `runPendingScript`가 지연 타이머(400/700ms) 뒤 전역 `state`로 `resolvePending(state, uid)`를 호출 -> 새 게임의 같은 uid(`p1`…) 효과를 잘못 종료/실행.
  `startAttack`의 setTimeout 도 새 `sel`을 오염.
- `cpu.js` 드라이버: `D.busyTick`이 옛 게임의 멈춘 step(옛 프롬프트/탐색 대기)에 의해 true 로 남아 새 게임에서 CPU가 행동 불가;
  `banned`/`turnKey`(`1:p2` 같은 키가 새 게임과 동일)/`actionsThisTurn`/`fxSig` 등이 게임 간에 이월.

## 재현
`scripts/ui-rematch-stress.md` 의 루프(무작위 시점 종료 -> 재대전 반복). 헤드리스: `scripts/test-rematch-driver.mjs`
(옛 게임에서 탐색이 영원히 멈춘 상태로 state 교체 -> 수정 전에는 새 게임에서 CPU가 영원히 행동하지 않음).

## 수정
- `main.js`: 러너 토큰(`runnerTok = {st}`) — state 가 바뀌면 옛 러너를 고아 처리하고 새 러너를 시작; 옛 러너의 finally 는 토큰이 다르면 플래그를 건드리지 않음.
  `runPendingScript`는 시작 시 `st0 = state`를 잡고 모든 await 이후 `stale()`이면 즉시 종료; `ctx.choose`는 stale 이면 영원히 대기(새 게임에 프롬프트를 올리지 않음).
  디버그용 `__rt` / `rt()` 흔적 제거, `window.__cpuDebug = true`로 켜는 opt-in 로그만 유지.
- `cpu.js`: `beat()`가 state 객체 교체를 감지해 드라이버의 게임별 기록(banned, turnKey, actionsThisTurn, fxSig, acting, searching …)을 초기화;
  `busyTick`을 토큰으로 바꿔 옛 step 이 새 게임의 플래그를 잡거나 지우지 못하게 함; `execute`의 finally 도 같은 state 일 때만 acting 해제.
  워치독은 최후 수단으로 유지(발동 시 콘솔 경고 `[CPU] parked effect` / `watchdog fired`).

## 검증
- `node scripts/test-rematch-driver.mjs` : 수정 전 실패 / 수정 후 통과.
- 브라우저 스트레스(무작위 시점 종료 후 재대전, 덱 6종 × 강도 3종): 결과는 아래 기록.
- `soak.mjs 40`, `audit-effects.mjs`, `test-cpu.mjs`, `check-syntax.mjs`: 아래 기록.

### 검증 결과
- 브라우저(실제 UI, CPU 모드, 덱 6종 × easy/normal/hard 순환): 111판(재대전 73회, 무작위 시점 강제 종료 -> 재대전) 연속 — stall 0, watchdog/`parked effect` 경고 0,
  페이지 오류 0. 진행 중이던 옛 효과 러너를 새 게임에서 고아 처리한 경우가 16회 관측됨(수정 전에는 이 경우마다 12초 멈춤 또는 러너 충돌).
- `node scripts/soak.mjs 40`: 고유 오류 0 / `audit-effects.mjs`: 100.0% / `test-cpu.mjs`: OK(stall 0, err 0) / `check-syntax`: OK.
- 관찰 환경 한계: 브라우저 창이 백그라운드(document.hidden)여서 타이머가 느려짐 — 그래도 통과. watch 모드는 별도 없음(사람 vs CPU 만 지원).
