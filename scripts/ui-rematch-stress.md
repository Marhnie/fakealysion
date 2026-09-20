# 브라우저 재대전 스트레스 (CPU 멈춤 회귀 확인)

1. `preview_start digimon-sim` 후 탭 하나만 사용, 페이지 리로드.
2. 콘솔(또는 javascript_tool)에서 `await import('/scripts/uibot.js')` 로 사람 봇(`bots.step`) 로드.
3. 아래 루프를 실행한다 (게임마다 덱 6종 × CPU 강도 3종 순환, 무작위 시점에서 `state.winner`를 강제로 세팅해 효과/CPU 탐색이 진행 중인 채로
   종료 화면 → `🔁 같은 덱으로 재대전`을 누른다 = 최악의 재대전 상황).
   - 감시: `window.__cpuDebug = true` (고아 러너 복구 시 `[cpu-debug]` 로그), `console.warn`에서 `parked effect` / `watchdog fired`가 **0회**여야 한다.
   - 정지 판정: 30초 동안 (turn, phase, memory, log.length, pending, uiChoice) 시그니처가 변하지 않으면 stall.
4. 통과 기준: 100판 이상 연속, stall 0, watchdog/parked 경고 0, `__errs` 비어 있음.
5. 추가 시나리오(수동): 종료 화면 새 게임, 이어하기(저장 불러오기), 진행 중 되돌리기(undo), CPU 강도 변경, 리로드 후 이어하기.

헤드리스 회귀: `node scripts/test-rematch-driver.mjs < /dev/null` (검색이 영원히 멈춘 옛 게임 → 새 state 로 교체해도 CPU 드라이버가 새 게임에서 행동해야 함).
