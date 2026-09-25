// EX13-045 엑자몬 【진화 시】 forced-attack timing regression (live-playtesting bug report, 2026-09).
// Card text: "조그레스 진화하고 있었다면, 이 디지몬으로 어택하고, 상대의 턴 종료까지 자신의 디지몬 전부를 DP +10000.
// 그 후, 이 디지몬과 상대의 디지몬 1마리로 배틀할 수 있다." -- the ctx.startAttack() call is supposed to make the
// attack happen as part of resolving the trigger, not one turn later.
//
// ROOT CAUSE (src/main.js): ctx.startAttack used to defer the WHOLE attack (S.declareAttack + pa/state.attackCtx
// setup) into a `setTimeout(fn, 0)`. Whenever the triggering script had nothing left to `await` after calling it
// (e.g. no opponent Digimon to offer the "그 후" bonus battle against, so the script returns immediately), the
// SAME synchronous render() that follows the script's completion could already run E.checkAutoEndTurn() -- main.js
// only guarded that call with `!attackActive()` (== `!!sel.pendingAttack`), and sel.pendingAttack was still null
// at that point because the real declare hadn't run yet. That let a full turn-end (beginTurnEnd -> settleTurnEnd)
// complete BEFORE the setTimeout(0) callback ever fired. By the time the callback did fire (next JS tick, ~ms
// later), state.activePlayer had already flipped to the opponent, so S.declareAttack's 11-2-1 check
// (`attackerP !== state.activePlayer`) silently refused the attack -- no log line, attack lost outright (a
// slightly worse outcome than "fires next turn", but the same family of bug: the effect's own attack loses the
// race against turn-end because the two were never actually synchronized).
//
// Reproduced live via the browser (window.__dbg()), tracing sel.atkQueued / sel.pendingAttack / state.attackCtx /
// state.turnEnding / state.turnNumber writes around a jogress evolution into EX13-045 with memory already on p2's
// side and p2's battle area empty (fastest race window -- the "그 후" ask() never pauses so nothing blocks
// checkAutoEndTurn):
//   BEFORE fix: t=1505ms atkQueued=1 -> t=1506ms turnEnding=true -> t=1506ms turnEnding=false -> t=1506ms
//               turnNumber=2 -> t=1511ms atkQueued=0 (pendingAttack/attackCtx NEVER set -- attack lost, turn over)
//   AFTER fix:  t=1516ms atkQueued=1 -> t=1516ms pendingAttack=true -> t=1516ms attackCtx=true (SAME tick,
//               turnNumber still 1) -> t=1519ms atkQueued=0 (bracket only; the attack was already declared)
// FIX: ctx.startAttack now declares synchronously (calls attackFlow() directly, no setTimeout) so
// sel.pendingAttack/state.attackCtx exist before the script's own trigger resolves and any render() can run
// checkAutoEndTurn -- attackActive() correctly blocks turn-end from that point on, exactly like a normally
// user-declared attack already does. Re-entrancy (11-2-3: an attack already in progress) now logs instead of
// silently dropping.
//
// This headless harness (lib-s1.mjs's ctx.startAttack) never had the setTimeout race to begin with -- like
// src/cpusim.js's effAtkQ, it just queues the request (st._qaAtk) with no timer involved, and tests resolve it
// manually via attack()/atkSec(). What IS shared across every driver (main.js post-fix, cpusim.js, and this
// harness used correctly) is the ORDERING CONTRACT this file locks in: an effect-queued attack must be fully
// carried out BEFORE a driver calls E.checkAutoEndTurn(), even when memory already sits on the turn-end side --
// official Q&A id 2927 / BT18-018: "이 카드의 【진화 시】 효과, 【자신의 턴】 효과, 그리고 그것에 의해 유발된 것이
// 전부 해결된 뒤에야 턴 종료 조건이 성립한 것으로 취급합니다" (everything the evolution's own effect triggers
// resolves first; only then is the turn-end condition considered met). src/cpusim.js's applyMain() already
// respects this (exec() fully drains effAtkQ before checkAutoEndTurn runs) -- this suite proves the same is true
// at the engine level (declareAttack/resolveDigimonBattle don't themselves refuse to run just because
// isTurnAutoEnding() is already true), which is exactly what the main.js fix now also guarantees by declaring
// synchronously instead of racing a render().
// Run: node scripts/qa/qa-ex13-045-jogress-attack-timing.mjs < /dev/null
import { S, E, mk, put, drain, T, eq, ok, runAll, LOW, clean } from './lib-ex13.mjs';

T('EX13-045-timing-a', '엑자몬 조그레스 진화: 어택 요청이 같은 턴에 나오고, 상대 디지몬이 없어도 정상 해결됨 (플레이어 공격)', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'EX13-021'), b = put(st, 'p1', 'EX13-041'); // 「엑자몬」 조그레스 재료 (jogressAlias, shard130.js)
  st.players.p1.hand.push('EX13-045');
  st.players.p2.security = [LOW, LOW];
  ok('조그레스 가능', S.canJogress(a, b, 'EX13-045').ok);
  const turnBefore = st.turnNumber;
  const r = S.fuseStacks(st, 'p1', a.uid, b.uid, 'EX13-045', 0, 'hand');
  ok('조그레스 성공', !!r);
  await drain(st);
  const ex = st.players.p1.battle.find((s) => s.cardId === 'EX13-045');
  ok('엑자몬 등장', !!ex); ok('viaFusion', !!ex.viaFusion);
  eq('오류 없음', st._qaErr || [], []);
  eq('어택 요청이 같은 턴에 큐잉됨 (턴 넘어가지 않음)', [st.turnNumber, (st._qaAtk || []).length], [turnBefore, 1]);
  const req = st._qaAtk.pop();
  eq('대상 미지정 (플레이어/디지몬 중 나중에 선택)', req.direct, undefined);
  // 상대 디지몬이 없는 상태: 실제 버그가 재현되던 바로 그 레이스 구간 -- 이제라도 정상적으로 플레이어 공격이 해결되어야 함
  const secBefore = st.players.p2.security.length;
  const { atkSec } = await import('./lib-s1.mjs');
  const out = await atkSec(st, 'p1', ex.uid);
  eq('오류 없음', st._qaErr || [], []);
  eq('같은 턴 안에서 완전히 해결됨', st.turnNumber, turnBefore);
  ok('시큐리티 체크가 실제로 진행됨', !!out.checks && out.checks.length >= 1 || st.players.p2.security.length < secBefore);
});

T('EX13-045-timing-b', '엑자몬 조그레스 진화 (Q2927/BT18-018): 메모리가 이미 상대 쪽이어도, 어택+그로 인해 유발된 처리가 전부 끝난 뒤에야 턴이 끝남', async () => {
  const st = mk(); clean(st);
  const a = put(st, 'p1', 'EX13-021'), b = put(st, 'p1', 'EX13-041');
  st.players.p1.hand.push('EX13-045');
  st.players.p2.security = [LOW, LOW];
  st.memory = -3; // 6-1-4: 이미 상대(p2) 쪽 -- 턴 종료 조건이 이미 성립한 상태에서 진화가 일어남 (Q2927과 같은 상황)
  ok('턴 종료 조건이 이미 성립함', S.isTurnAutoEnding(st));
  const turnBefore = st.turnNumber;
  const r = S.fuseStacks(st, 'p1', a.uid, b.uid, 'EX13-045', 0, 'hand');
  ok('조그레스 성공', !!r);
  await drain(st);
  const ex = st.players.p1.battle.find((s) => s.cardId === 'EX13-045');
  eq('오류 없음', st._qaErr || [], []);
  eq('어택 요청 1건, 턴은 아직 그대로', [(st._qaAtk || []).length, st.turnNumber], [1, turnBefore]);
  // 계약: 드라이버는 checkAutoEndTurn을 부르기 전에 큐잉된 어택을 반드시 먼저 완전히 해결해야 한다
  // (src/cpusim.js applyMain이 exec()에서 effAtkQ를 다 비운 뒤에만 checkAutoEndTurn을 부르는 것과 동일한 순서 --
  // 이번에 고친 main.js의 ctx.startAttack 동기 선언도 같은 순서를 보장한다).
  const secBefore = st.players.p2.security.length;
  const { atkSec } = await import('./lib-s1.mjs');
  const out = await atkSec(st, 'p1', ex.uid);
  eq('오류 없음', st._qaErr || [], []);
  ok('메모리가 이미 상대 쪽이어도 어택이 정상적으로 해결됨 (Q2927)', !!out.checks && out.checks.length >= 1 || st.players.p2.security.length < secBefore);
  eq('어택이 끝날 때까지 턴은 넘어가지 않음', st.turnNumber, turnBefore);
  // 이제 어택(+그것이 유발한 모든 처리)이 완전히 끝났으니, 그제서야 턴 종료 조건을 체크해 실제로 턴이 넘어가야 한다
  const ended = E.checkAutoEndTurn(st);
  ok('어택이 끝난 뒤에는 턴 종료 조건이 성립해 턴이 넘어감', ended);
  eq('턴 번호 증가', st.turnNumber, turnBefore + 1);
});

await runAll('qa-ex13-045-jogress-attack-timing');
