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
  const opp = S.opponentOf(state.activePlayer);
  const opl = state.players[opp];
  for (const s of [opl.raising, ...opl.battle].filter(Boolean)) S.queueTriggersForStack(state, opp, s, 'turnStartOpp');
}

export function beginGame(state, firstPlayer) {
  state.firstPlayer = firstPlayer;
  state.activePlayer = firstPlayer;
  state.turnNumber = 1;
  state.phase = 'unsuspend';
  state.breedingActionTaken = false;
  S.resetTurnEffectUses(state);
  S.log(state, `선공: ${firstPlayer}`);
  queueTurnStartTriggers(state);
}

const PHASE_ORDER = ['unsuspend', 'draw', 'breeding', 'main'];

export function nextPhase(state) {
  const active = state.activePlayer;
  const pl = state.players[active];
  if (state.phase === 'unsuspend') {
    // "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — a one-time skip
    // of just THIS unsuspend cycle, consumed here so the stack unsuspends
    // normally again from the NEXT cycle onward. "상대의 테이머 전부는
    // 액티브가 되지 않는다." is the continuous version instead — re-checked
    // every cycle, never consumed.
    pl.battle.forEach(s => {
      if (s.skipNextUnsuspend) { s.skipNextUnsuspend = false; return; }
      if (S.isPreventedFromUnsuspending(state, active, s)) return;
      s.suspended = false;
    });
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
    const opp = S.opponentOf(active);
    const opl = state.players[opp];
    for (const s of [opl.raising, ...opl.battle].filter(Boolean)) S.queueTriggersForStack(state, opp, s, 'mainPhaseStartOpp');
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
    // Never cascade past a phase that still has triggered effects waiting to
    // resolve (e.g. turn-start effects queued the moment the turn began, or
    // a mainPhaseStart trigger) — otherwise unsuspend/draw/breeding all fly
    // by in one synchronous tick before the player ever sees what fired.
    // Once autoRunMandatoryPending() clears state.pending on a later render,
    // this resumes the cascade from wherever it left off.
    if (state.pending.length > 0) return;
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
  // 【자신의/상대의/서로의 턴 종료 시】 — ~196 printed segments that were never
  // queued anywhere (only scheduled one-shot end-of-turn fns ran).
  for (const pp of ['p1', 'p2']) {
    const ppl = state.players[pp];
    const kinds = pp === finishing ? ['turnEndOwn', 'turnEndBoth'] : ['turnEndOpp', 'turnEndBoth'];
    for (const s of [ppl.raising, ...ppl.battle].filter(Boolean)) for (const k of kinds) S.queueTriggersForStack(state, pp, s, k);
  }
  const next = S.opponentOf(finishing);
  state.activePlayer = next;
  state.turnNumber += 1;
  state.phase = 'unsuspend';
  state.breedingActionTaken = false;
  S.resetTurnEffectUses(state);
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

// A card can print several alternate "〔진화〕 <조건> : 코스트 N" lines (special
// evolutions keyed on a specific name/trait rather than the plain
// level+color path evoNormal captures) — e.g. "〔진화〕 「페닉스몬」 : 코스트 2"
// (exact name) or "〔진화〕 특징 「CS」를 가진 Lv.5 : 코스트 3" (trait+level).
// Scans the card's own raw text for every such line, on top of evoNormal.
function parseEvoConditions(targetCardId) {
  const tgt = S.card(targetCardId);
  const conditions = [];
  if (tgt.evoNormal) conditions.push({ ...tgt.evoNormal, raw: tgt.evoNormal.conditionText || '' });
  const text = tgt.effectKo || '';
  for (const m of text.matchAll(/〔진화〕\s*([^:：\n]+?)\s*[:：]\s*코스트\s*(\d+)/g)) {
    const desc = m[1].trim();
    const cost = Number(m[2]);
    const cond = { cost, raw: desc };
    const lvM = desc.match(/Lv\.(\d+)/);
    if (lvM) cond.level = Number(lvM[1]);
    const includesM = desc.match(/명칭에\s*「([^」]+)」(?:을|를)?\s*포함/);
    if (includesM) cond.nameIncludes = includesM[1];
    const traitM = desc.match(/특징\s*「([^」]+)」(?:을|를)?\s*가진/);
    if (traitM) cond.trait = traitM[1];
    const bareNameM = desc.match(/^「([^」]+)」$/);
    if (bareNameM) cond.nameExact = bareNameM[1];
    conditions.push(cond);
  }
  return conditions;
}

// Tries evoNormal AND every special "〔진화〕 <이름/특징 조건>" line printed on
// the target — returns the first one the source actually satisfies. Unlike
// canNormalEvolve, a failed result here means the drop should be BLOCKED,
// not silently allowed for free — there's no condition left that could
// justify it.
export function canEvolveAny(sourceCardId, targetCardId, extraColors = [], restriction = null) {
  const src = S.card(sourceCardId);
  const tgt = S.card(targetCardId);
  // A continuous "이 디지몬은 (X색)/「X」으로만 진화할 수 있다." restriction on
  // the SOURCE stack (see S.evolveTargetRestriction) — checked against the
  // TARGET card, independent of whichever printed condition below it uses.
  if (restriction) {
    if (restriction.cannotEvolve) return { ok: false, reason: '진화 제한: 이 디지몬은 진화할 수 없음' };
    if (restriction.colors && !restriction.colors.some(c => (tgt.colors || []).includes(c))) {
      return { ok: false, reason: `진화 제한: ${restriction.colors.join('/')} 인 디지몬으로만 진화 가능` };
    }
    if (restriction.nameExact && tgt.nameKo !== restriction.nameExact) {
      return { ok: false, reason: `진화 제한: 「${restriction.nameExact}」로만 진화 가능` };
    }
    if (restriction.nameIncludes && !tgt.nameKo.includes(restriction.nameIncludes)) {
      return { ok: false, reason: `진화 제한: 명칭에 「${restriction.nameIncludes}」를 포함하는 디지몬으로만 진화 가능` };
    }
  }
  const conditions = parseEvoConditions(targetCardId);
  if (!conditions.length) return { ok: false, reason: '진화 조건 없음(Lv.2 디지타마이거나 데이터 누락)' };
  const srcColors = [...(src.colors || []), ...extraColors];
  for (const cond of conditions) {
    if (typeof cond.level === 'number' && src.level !== cond.level) continue;
    if (cond.nameExact && src.nameKo !== cond.nameExact) continue;
    if (cond.nameIncludes && !src.nameKo.includes(cond.nameIncludes)) continue;
    if (cond.trait && !(src.types || []).some(t => t.includes(cond.trait))) continue;
    if (cond.colors && cond.colors.length) {
      const isAny = cond.colors.length >= 7;
      if (!isAny && !cond.colors.some(c => srcColors.includes(c))) continue;
    }
    return { ok: true, cost: cond.cost, raw: cond.raw };
  }
  return { ok: false, reason: `어떤 진화 조건도 만족 못함 (대상: ${src.nameKo} Lv.${src.level})` };
}
