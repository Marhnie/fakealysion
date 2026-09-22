# CPU끼리 구경하기 (Spectate 모드)

시작 화면의 **🍿 CPU끼리 구경하기** 카드에서 P1/P2 덱과 CPU 강도를 고르고 `🍿 구경 시작`을 누르면, 두 CPU가 끝까지 대전하는 모습을 리플레이 뷰어로 자동 재생합니다.

- 덱: 내 덱 / CPU 추천·진화 덱 / `🎲 무작위`(내 덱 + CPU 덱 중 하나) 선택 가능.
- 강도: 쉬움·보통은 몇 초 안에 끝납니다. 어려움·전문가는 수 읽기(판단당 약 0.5~1초)라 게임 하나에 수십 초~수 분이 걸립니다.
- 시뮬레이션이 8스텝 이상 쌓이면 바로 재생을 시작하고(라이브 시청), 나머지는 백그라운드에서 계속 계산합니다. 재생이 시뮬레이션을 따라잡으면 잠시 기다립니다. 뷰어의 `종료`를 누르면 시뮬레이션도 취소됩니다.
- 재생 바: `▶/⏸`(Space), 속도 0.5x/1x/2x/4x, ⏮ ◀ ▶ ⏭(←/→), 슬라이더, `💾`(리플레이 파일 저장), `이어하기`(그 스텝에서 직접 이어서 플레이), `종료`. 수동으로 스텝을 옮기면 자동 재생은 멈춥니다. 마지막 스텝에서 자동으로 멈추고, 다시 ▶를 누르면 처음부터 재생합니다.
- 스텝 표시 시간은 그 스텝의 로그 글자 수로 정합니다(약 1~5초 / 속도).

## 구조

- `src/spectate.js` — 순수 로직(브라우저+Node). `runSpectateGame({deckA, deckB, levelA, levelB, seed?, maxTurns?, maxMs?, searchMs?, onProgress?, signal?})`. `scripts/cpu-hunt.mjs playGame`과 같은 루프(`createSim` + `Cpu.planMain` / `Cpu.HOOKS.search`)로 두고, 매 행동 뒤 `SN.snapshotState`로 v2 리플레이 형식 타임라인(`{snap, dig, label, lines}`)을 기록합니다. 600스텝을 넘으면 절반으로 솎아냅니다(로그 줄은 다음 스텝으로 병합). 시간 제한(기본 300초)·턴 제한(기본 60턴)·취소(`signal.aborted`)를 지원하고, 이벤트 루프에 자주 양보합니다.
- `src/spectate-ui.js` — 시작 화면 카드(진행 표시·취소).
- `src/practice.js` — `openReplayList(list, label, {autoplay, standalone, meta, live, onExit})`, `replayLiveUpdate`, 자동 재생 컨트롤.
- 테스트: `node scripts/test-spectate.mjs < /dev/null`.
