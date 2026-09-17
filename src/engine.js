import * as S from './state.js';

// Full game setup: shuffle (done in newGame), coin flip, opening hands,
// mulligan support left to caller (call redrawHand before setSecurity if
// a player mulligans), then set security stacks.

export function coinFlip() {
  return Math.random() < 0.5 ? 'p1' : 'p2';
}

export function drawOpeningHand(state, p) {
  const pl = state.players[p];
  pl.hand.push(...pl.deck.splice(0, 5));
  S.log(state, `${p} 오프닝 핸드 5장`);
}

export function mulligan(state, p) {
  const pl = state.players[p];
  pl.deck.push(...pl.hand.splice(0));
  for (let i = pl.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pl.deck[i], pl.deck[j]] = [pl.deck[j], pl.deck[i]];
  }
  pl.hand.push(...pl.deck.splice(0, 5));
  S.log(state, `${p} 멀리건: 핸드 새로 5장`);
}

export function setSecurityStacks(state) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    pl.security = pl.deck.splice(0, 5);
    S.log(state, `${p} 시큐리티 스택 5장 세팅 (비공개)`);
  }
}

// 6-2-1-1: rule/effect processing due at the start of a turn (e.g. a
// Tamer's "at start of your turn, if memory <=2 set to 3") resolves BEFORE
// the Active Phase's unsuspend step — queue it the moment the turn begins.
function queueTurnStartTriggers(state) {
  const pl = state.players[state.activePlayer];
  const stacks = [pl.raising, ...pl.battle].filter(Boolean);
  for (const s of stacks) S.queueTriggersForStack(state, state.activePlayer, s, 'turnStart');
}

export function beginGame(state, firstPlayer) {
  state.firstPlayer = firstPlayer;
  state.activePlayer = firstPlayer;
  state.turnNumber = 1;
  state.phase = 'unsuspend';
  state.breedingActionTaken = false;
  S.log(state, `선공: ${firstPlayer}`);
  queueTurnStartTriggers(state);
}

const PHASE_ORDER = ['unsuspend', 'draw', 'breeding', 'main'];

export function nextPhase(state) {
  const active = state.activePlayer;
  const pl = state.players[active];
  if (state.phase === 'unsuspend') {
    pl.battle.forEach(s => { s.suspended = false; });
    // 16-11-1/16-11-5: a ≪재기동≫ (Reboot) Digimon also becomes Active during
    // the OPPONENT's Active Phase, on top of its own controller's — not just
    // whichever player's own unsuspend step this is.
    const oppBattle = state.players[S.opponentOf(active)].battle;
    for (const s of oppBattle) if (S.hasKeyword(s, '재기동')) s.suspended = false;
    S.log(state, `${active} 액티브 페이즈: 전부 액티브`);
    state.phase = 'draw';
    // First player's very first turn skips the draw phase entirely.
    if (state.turnNumber === 1 && active === state.firstPlayer) {
      S.log(state, `${active} 선공 첫 턴이라 드로우 스킵`);
      state.phase = 'breeding';
    }
    return;
  }
  if (state.phase === 'draw') {
    S.drawCards(state, active, 1, true); // mandatory draw-phase draw — deck-out here is a loss
    state.phase = 'breeding';
    return;
  }
  if (state.phase === 'breeding') {
    state.phase = 'main';
    const pl = state.players[active];
    const stacks = [pl.raising, ...pl.battle].filter(Boolean);
    for (const s of stacks) S.queueTriggersForStack(state, active, s, 'mainPhaseStart');
    return;
  }
  if (state.phase === 'main') {
    endTurn(state);
    return;
  }
}

// Auto-cascade through phases that have literally nothing to decide:
// Unsuspend and Draw are always fully mechanical. Breeding is skipped only
// when hatching AND moving are both genuinely impossible right now (an
// empty digitama deck with a full raising slot, or a raising card below
// Lv.3 with no digitama left to hatch instead).
export function autoAdvance(state) {
  let guard = 0;
  while (guard++ < 25) {
    if (state.winner) return;
    if (state.phase === 'unsuspend' || state.phase === 'draw') { nextPhase(state); continue; }
    if (state.phase === 'breeding') {
      const pl = state.players[state.activePlayer];
      // Matches the same gate hatchDigitama/moveRaisingToBattle enforce: once
      // this turn's one breeding action is used, neither is available
      // anymore, regardless of what raising/digitamaDeck look like — without
      // this check, moving (which empties raising) made canHatch look true
      // again and this stopped auto-skipping an already-finished phase.
      const canHatch = !state.breedingActionTaken && !pl.raising && pl.digitamaDeck.length > 0;
      const canMove = !state.breedingActionTaken && pl.raising && (S.card(pl.raising.cardId).level || 0) >= 3;
      if (!canHatch && !canMove) { nextPhase(state); continue; }
    }
    break;
  }
}

export function endTurn(state, viaMemoryCondition = false) {
  const finishing = state.activePlayer;
  S.runEndOfTurnEffects(state);
  S.clearExpiredModifiers(state);
  // 6-6-4: if an end-of-turn effect pushed memory back off the opponent's
  // side before the turn actually finishes ending, the turn-end is called
  // off and play continues in the same phase. This only applies to a turn
  // ending BECAUSE of the memory condition (6-6-1/6-1-4) — a manual
  // phase-advance or an explicit Pass (which fixes memory itself) always
  // ends the turn outright regardless of what end-of-turn effects do.
  if (viaMemoryCondition && !S.isTurnAutoEnding(state)) {
    S.log(state, `${finishing} 턴 종료 처리 중 메모리가 되돌아와 턴 종료 취소 (6-6-4)`);
    return;
  }
  const next = S.opponentOf(finishing);
  state.activePlayer = next;
  state.turnNumber += 1;
  state.phase = 'unsuspend';
  state.breedingActionTaken = false;
  S.log(state, `--- ${finishing} 턴 종료, ${next} 턴 ${state.turnNumber} 시작 (메모리 ${state.memory}) ---`);
  queueTurnStartTriggers(state);
}

// 6-5-1-7-1: declaring Pass during your Main Phase immediately sets the
// memory gauge to a FIXED 3 on the opponent's side (not just "whatever it
// currently is") and ends your turn. Only meaningful when memory is still
// on your own side or at 0 — once it's already on the opponent's side the
// turn-end condition (6-1-4) is already met without needing to pass.
export function declarePass(state) {
  const active = state.activePlayer;
  state.memory = active === 'p1' ? -3 : 3;
  S.log(state, `${active} 패스 선언 → 메모리 상대측 3으로 고정`);
  // Pass is just another way of satisfying the 6-1-4 memory condition — not
  // an exemption from 6-6-4's turn-end-cancellation recheck. If an
  // end-of-turn effect pushes memory back before the flip, the turn stays.
  endTurn(state, true);
}

// Call after any memory-spending action. Returns true if the turn ended.
export function checkAutoEndTurn(state) {
  if (S.isTurnAutoEnding(state)) {
    endTurn(state, true);
    return true;
  }
  return false;
}

// ---- evolution condition helper (best-effort, normal color+level path only) ----

export function canNormalEvolve(sourceCardId, targetCardId, extraColors = []) {
  const src = S.card(sourceCardId);
  const tgt = S.card(targetCardId);
  const normal = tgt.evoNormal;
  if (!normal) return { ok: false, reason: '진화 조건 없음(Lv.2 디지타마이거나 데이터 누락)' };
  if (typeof normal.level === 'number' && src.level !== normal.level) {
    return { ok: false, reason: `레벨 불일치 (필요 Lv.${normal.level}, 대상 Lv.${src.level})` };
  }
  if (normal.colors && normal.colors.length) {
    const srcColors = [...(src.colors || []), ...extraColors];
    const isAny = normal.colors.length >= 7; // all 7 color bits set = any color
    const match = isAny || normal.colors.some(c => srcColors.includes(c));
    if (!match) return { ok: false, reason: `색상 불일치 (필요 ${normal.colors.join('/')}, 대상 ${srcColors.join('/')})` };
  }
  return { ok: true, cost: normal.cost, note: '이건 "일반 진화" 조건만 체크한 것 — 카드에 특수진화/조그레스/DNA 등 대체 조건이 텍스트로 더 있을 수 있음(효과 텍스트 참고)' };
}
