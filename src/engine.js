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
    // 5-2-1-6: cards are placed one at a time; the deck's top card ends up at the security's BOTTOM (security[0] = top).
    pl.security = pl.deck.splice(0, 5).reverse();
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
  if (state.turnEnding) return; // turn end resolving (6-6-2): phase is frozen
  const active = state.activePlayer;
  const pl = state.players[active];
  if (state.phase === 'unsuspend') {
    // "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — a one-time skip
    // of just THIS unsuspend cycle, consumed here so the stack unsuspends
    // normally again from the NEXT cycle onward. "상대의 테이머 전부는
    // 액티브가 되지 않는다." is the continuous version instead — re-checked
    // every cycle, never consumed.
    const wokeUp = [];
    [...pl.battle, ...(pl.raising ? [pl.raising] : [])].forEach(s => { // 6-2-1: ALL own cards in the areas (breeding area included)
      if (s.skipNextUnsuspend) { s.skipNextUnsuspend = false; return; }
      if (s.cannotUnsuspendUntil != null && state.turnNumber <= s.cannotUnsuspendUntil) return; // s8: 액티브 봉인 (~상대의 턴 종료까지)
      if (S.isPreventedFromUnsuspending(state, active, s)) return;
      if (s.suspended) wokeUp.push(s); // shard1: 'unsuspend' events (EX2-037)
      s.suspended = false;
    });
    for (const s of wokeUp) S.s1Unsuspended(state, active, s);
    // 16-11-1/16-11-5: a ≪재기동≫ (Reboot) Digimon also becomes Active during
    // the OPPONENT's Active Phase, on top of its own controller's — not just
    // whichever player's own unsuspend step this is.
    const oppBattle = state.players[S.opponentOf(active)].battle;
    const oppP = S.opponentOf(active);
    for (const s of oppBattle) {
      if (!s.suspended || !(S.hasKeyword(s, '재기동') || S.hookGrantedKeywords(state, oppP, s).includes('재기동') || S.hasContinuousKeyword(state, oppP, s, '재기동'))) continue;
      // an "액티브가 되지 않는다" effect still beats ≪재기동≫
      if ((s.cannotUnsuspendUntil != null && state.turnNumber <= s.cannotUnsuspendUntil) || S.isPreventedFromUnsuspending(state, oppP, s)) continue;
      s.suspended = false;
      S.s1Unsuspended(state, oppP, s);
    }
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
    S.queueForcedAttacks(state, active);
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
  S.normalizeDigitamaZones(state); // 3-1-3-9
  let guard = 0;
  while (guard++ < 25) {
    if (state.winner) return;
    if (state.turnEnding) return; // 6-6-2: turn end resolving — the phase stays put until settleTurnEnd() finishes it
    // Never cascade past a phase that still has triggered effects waiting to
    // resolve (e.g. turn-start effects queued the moment the turn began, or
    // a mainPhaseStart trigger) — otherwise unsuspend/draw/breeding all fly
    // by in one synchronous tick before the player ever sees what fired.
    // Once autoRunMandatoryPending() clears state.pending on a later render,
    // this resumes the cascade from wherever it left off.
    if (state.pending.length > 0) return;
    // 6-1-4-1 / 6-2-1-2: the turn-end condition (memory on the opponent's side) holds in ANY phase —
    // e.g. a turn-start effect that pushes memory over ends the turn before unsuspend. (Main phase is
    // handled by the caller, which also knows about in-progress attacks/choices.)
    if (state.phase !== 'main' && S.isTurnAutoEnding(state)) { endTurn(state, true); continue; }
    if (state.phase === 'unsuspend' || state.phase === 'draw') { nextPhase(state); continue; }
    if (state.phase === 'breeding') {
      const pl = state.players[state.activePlayer];
      // Matches the same gate hatchDigitama/moveRaisingToBattle enforce: once
      // this turn's one breeding action is used, neither is available
      // anymore, regardless of what raising/digitamaDeck look like — without
      // this check, moving (which empties raising) made canHatch look true
      // again and this stopped auto-skipping an already-finished phase.
      const canHatch = !state.breedingActionTaken && !pl.raising && pl.digitamaDeck.length > 0;
      const canMove = !state.breedingActionTaken && pl.raising && S.canMoveFromRaising(pl.raising);
      if (!canHatch && !canMove) { nextPhase(state); continue; }
    }
    break;
  }
}

// Turn end is a two-step process (rules 6-6-1..6-6-4):
//   1. beginTurnEnd  — the turn-end condition is met; the game stays in the SAME phase, still the finishing
//      player's turn (state.turnEnding is set). 【자신의/상대의/서로의 턴 종료 시】 effects, held "이 턴 종료 시"
//      effects (18-1) and turn-end keywords (《급습》/《볼텍스》/《에그제큐트》…) are queued as ordinary pending
//      triggers (turn player's first, ordered like any simultaneous triggers — 4-3-2).
//   2. settleTurnEnd/finishTurnEnd — once nothing is left to resolve (6-6-2) the turn really finishes: "이 턴 종료까지"
//      durations expire and the opponent's turn begins (6-6-3) — unless memory is no longer on the opponent's side (6-6-4).
export function beginTurnEnd(state, viaMemoryCondition = false) {
  if (state.turnEnding || state.winner) return;
  const finishing = state.activePlayer;
  state.turnEnding = { player: finishing, via: !!viaMemoryCondition, expired: false };
  S.log(state, `--- ${finishing} 턴 종료 시 (${state.phase} 페이즈 그대로, 6-6-1) ---`);
  for (const pp of ['p1', 'p2']) {
    const ppl = state.players[pp];
    const kinds = pp === finishing ? ['turnEndOwn', 'turnEndBoth'] : ['turnEndOpp', 'turnEndBoth'];
    for (const s of [ppl.raising, ...ppl.battle].filter(Boolean)) for (const k of kinds) S.queueTriggersForStack(state, pp, s, k);
  }
  S.s7QueueZoneTurnEnd(state, finishing); // s7: [트래시]/[시큐리티] turn-end abilities
  S.queueTurnEndKeywords(state, finishing); // s5: 《볼텍스》
  S.queueTrashTurnEnd(state, finishing); // s6: [트래시]【자신의 턴 종료 시】
  S.queueScheduledTurnEnd(state, finishing); // 18-1: held "이 턴 종료 시 …" effects join the same simultaneous-trigger queue
}

// Finishes a begun turn end if nothing is left to resolve. Returns true when the turn actually finished.
// (Callers that can have an attack / open choice in progress must gate on that themselves — main.js does.)
export function settleTurnEnd(state) {
  const te = state.turnEnding;
  if (!te || state.winner) return false;
  if (state.pending.some(t => !t.resolved)) return false; // 6-6-2: still resolving, stay in the phase
  if (!te.expired) {
    // 6-6-4: an end-of-turn effect pushed memory back to the finishing player's side (or 0) -> the turn does not
    // end and play continues in the same phase. Only for a turn ending BECAUSE of the memory condition; a plain
    // phase-advance (non-via) always ends. Nothing has expired yet, so the cancel leaves all durations intact.
    if (te.via && !S.isTurnAutoEnding(state)) {
      state.turnEnding = null;
      S.log(state, `${te.player} 턴 종료 처리 중 메모리가 되돌아와 턴 종료 취소 (6-6-4)`);
      return false;
    }
    te.expired = true;
    S.runExpiringEndOfTurnEffects(state);
    S.clearExpiredModifiers(state); // "이 턴 종료까지" durations end now; rule checks this exposes resolve before the turn flips
    if (state.pending.some(t => !t.resolved)) return false;
  }
  state.turnEnding = null;
  const finishing = te.player;
  const next = S.opponentOf(finishing);
  state.activePlayer = next;
  state.turnNumber += 1;
  state.phase = 'unsuspend';
  state.breedingActionTaken = false;
  S.resetTurnEffectUses(state);
  S.log(state, `--- ${finishing} 턴 종료, ${next} 턴 ${state.turnNumber} 시작 (메모리 ${state.memory}) ---`);
  queueTurnStartTriggers(state);
  return true;
}

export function endTurn(state, viaMemoryCondition = false) {
  beginTurnEnd(state, viaMemoryCondition);
  settleTurnEnd(state);
}

// 6-5-1-7-1: declaring Pass during your Main Phase immediately sets the
// memory gauge to a FIXED 3 on the opponent's side (not just "whatever it
// currently is") and ends your turn. Only meaningful when memory is still
// on your own side or at 0 — once it's already on the opponent's side the
// turn-end condition (6-1-4) is already met without needing to pass.
export function declarePass(state) {
  if (state.turnEnding) return; // already in the turn-end phase
  const active = state.activePlayer;
  state.memory = active === 'p1' ? -3 : 3;
  S.log(state, `${active} 패스 선언 → 메모리 상대측 3으로 고정`);
  // Pass is just another way of satisfying the 6-1-4 memory condition — not
  // an exemption from 6-6-4's turn-end-cancellation recheck. If an
  // end-of-turn effect pushes memory back before the flip, the turn stays.
  endTurn(state, true);
}

// 1-2-4/1-2-5: a player may concede at any time; the loss is immediate and triggers no effects.
export function surrender(state, p) {
  if (state.winner) return;
  state.winner = S.opponentOf(p);
  state.pending.length = 0;
  S.log(state, `${p} 투항 — ${state.winner} 승리 (룰 1-2-4)`);
}

// Call after any memory-spending action. Returns true if the turn ended.
export function checkAutoEndTurn(state) {
  // 6-1-4-1: the turn ends only when nothing is left to resolve — a just-queued 【등장 시】/【진화 시】 (which may
  // itself move the memory back) must resolve first; main.js render() re-checks once the queue is empty.
  if (state.turnEnding || state.pending.some(t => !t.resolved)) return false;
  if (S.isTurnAutoEnding(state)) {
    endTurn(state, true);
    return true; // NOTE: only "begun" — with turn-end effects waiting, the turn finishes later via settleTurnEnd()
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
  for (const m of text.matchAll(/〔진화〕\s*((?:「[^」\n]*」|[^:：\n「])+?)\s*[:：]\s*코스트\s*(\d+)/g)) { // 「벨페몬: 슬립 모드」 — a colon inside 「」 is part of the name
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
// s8: restriction.alt = [{cost, test(tgtCard, srcCard)}] — hook-granted alternative evolution ("진화 조건을 무시하고 진화 코스트 N으로 …로
// 진화할 수 있다"); it competes with the printed conditions and the cheaper legal option wins.
export function canEvolveAny(sourceCardId, targetCardId, extraColors = [], restriction = null) {
  const base = canEvolveAnyBase(sourceCardId, targetCardId, extraColors, restriction);
  if (restriction && restriction.alt && !restriction.cannotEvolve && !S.isTokenId(sourceCardId)) {
    const src = S.card(sourceCardId), tgt = S.card(targetCardId);
    for (const a of restriction.alt) {
      if (!a.test(tgt, src)) continue;
      if (!base.ok || a.cost < base.cost) return { ok: true, cost: a.cost, raw: '진화 조건 무시(효과)' };
    }
  }
  return base;
}
// 8-1-2-2: restrictions ("진화할 수 없다"/"X로만 진화할 수 있다") are NOT evolution conditions, so even effects that ignore the
// evolution condition must respect them. Returns {ok:true} or {ok:false, reason}.
export function evoRestrictionCheck(targetCardId, restriction = null) {
  const tgt = S.card(targetCardId);
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
  return { ok: true };
}
function canEvolveAnyBase(sourceCardId, targetCardId, extraColors = [], restriction = null) {
  const src = S.card(sourceCardId);
  const tgt = S.card(targetCardId);
  if (S.isTokenId(sourceCardId)) return { ok: false, reason: '토큰 위에는 카드를 겹칠 수 없음 (룰 4-21-3)' };
  const rc = evoRestrictionCheck(targetCardId, restriction);
  if (!rc.ok) return rc;
  const conditions = parseEvoConditions(targetCardId);
  if (!conditions.length) return { ok: false, reason: '진화 조건 없음(Lv.2 디지타마이거나 데이터 누락)' };
  const sat =satisfiedEvoConditions(sourceCardId, targetCardId, extraColors, restriction);
  let best = null; // canEvolveAny keeps returning the cheapest satisfied condition (callers that need the player's choice use evolutionMethods)
  for (const c of sat) if (!best || c.cost < best.cost) best = { ok: true, cost: c.cost, raw: c.raw };
  if (best) return best;
  return { ok: false, reason: `어떤 진화 조건도 만족 못함 (대상: ${src.nameKo} Lv.${src.level})` };
}
// 8-1-2-1 / 8-1-3-1: EVERY printed condition (evoNormal + each 〔진화〕 line) the source satisfies, with its printed cost.
function satisfiedEvoConditions(sourceCardId, targetCardId, extraColors = [], restriction = null) {
  const src = S.card(sourceCardId);
  const tgt = S.card(targetCardId);
  if (S.isTokenId(sourceCardId) || !evoRestrictionCheck(targetCardId, restriction).ok) return [];
  const conditions = parseEvoConditions(targetCardId);
  // .replace: 원래 색 변경 효과(얻은 색은 그대로 추가). .names (from S.evoExtraArg -> S.effectiveInfo): every name the stack counts as
  // (원래 명칭 변경 + 〈룰〉 「X」로도 취급 + 「명칭 전부를 얻는다」); .inclNames: 〈룰〉 「X」를 포함하는 것으로도 취급;
  // .traits: printed 특징(속성/형태 포함) + hook-granted ones. Falls back to the printed card.
  const srcColors = [...(extraColors.replace || src.colors || []), ...extraColors];
  const srcNames = (extraColors.names && extraColors.names.length) ? extraColors.names : [extraColors.nameReplace || src.nameKo];
  const srcInclNames = extraColors.inclNames || [];
  const srcTraits = extraColors.traits || src.types || [];
  const out = [];
  for (const cond of conditions) {
    // printed 〔진화〕 lines: evaluate the WHOLE descriptor ("특징 「A」/「B」를 가진 Lv.5", "「A」/특징 「B」를 가진 Lv.4", "…특징 「X항체」를 갖지 않은 Lv.5",
    // "자신의 「A」가 있는 동안, 「B」" …) with the shared descriptor parser; the field-by-field checks below only cover what it cannot parse.
    const isNormalCond = cond === conditions[0] && !!tgt.evoNormal;
    // "〔진화〕 특징으로 「X」를 가진 카드가 아래에 N장 있는 「Name」" (P-185/BT18-018/BT18-042): needs the source STACK's under-cards (extraColors.under)
    const um = isNormalCond ? null : String(cond.raw || '').match(/^(?:(?:특징으로?|특징)\s*「([^」]+)」\s*(?:를|을)?\s*가진\s*)?카드가\s*아래에\s*(\d+)장\s*있는\s*「([^」]+)」\s*$/);
    if (um) {
      if (!srcNames.includes(um[3])) continue;
      const cnt = (extraColors.under || []).filter(id => !um[1] || (S.card(id).types || []).includes(um[1])).length;
      if (cnt >= Number(um[2])) out.push({ cost: cond.cost, raw: cond.raw, isNormal: false });
      continue;
    }
    { const gm = isNormalCond ? null : String(cond.raw || '').match(/^(.*?(?:동안|있다면)),\s*/); if (gm && restriction && restriction.evoGate && !restriction.evoGate(gm[1])) continue; } // state-dependent gate (EX10-023 「자신의 「최지석」이 있는 동안」 …)
    const pr = isNormalCond ? null : S.cardDescPredicate(String(cond.raw || '').replace(/^.*?(?:동안|있다면),\s*/, ''));
    if (pr) {
      const variants = [...new Set([...srcNames, ...srcInclNames])];
      if (!variants.some(n => pr({ ...src, nameKo: n, types: srcTraits, colors: srcColors }))) continue;
      out.push({ cost: cond.cost, raw: cond.raw, isNormal: false });
      continue;
    }
    if (typeof cond.level === 'number' && src.level !== cond.level) continue;
    if (cond.nameExact && !srcNames.includes(cond.nameExact)) continue;
    if (cond.nameIncludes && !srcNames.some(n => n.includes(cond.nameIncludes)) && !srcInclNames.some(n => n.includes(cond.nameIncludes))) continue;
    if (cond.trait && !srcTraits.some(t => t.includes(cond.trait))) continue;
    if (cond.colors && cond.colors.length) {
      const isAny = cond.colors.length >= 7;
      if (!isAny && !cond.colors.some(c => srcColors.includes(c))) continue;
    }
    out.push({ cost: cond.cost, raw: cond.raw, isNormal: cond === conditions[0] && !!tgt.evoNormal });
  }
  return out;
}

// 8-1-2-1 / 8-1-3-1: ALL the ways `sourceCardId` can evolve into `targetCardId`, so the player can pick one (the evolution cost is the one printed
// on the chosen condition, then cost modifiers apply on top). ctx = { state, p, stack } additionally offers the state-dependent methods:
// 《버스트 진화》 (8-3), 《어플 합체》 (8-4) and effect-granted alternatives (s1EvolveAlt). restriction.alt = [{cost,test}] are hook-granted alternatives too.
// -> [{ id, kind:'normal'|'special-line'|'burst'|'app'|'alt', label, baseCost, conditionText, ignoresCondition, sideEffect }]; [] when none applies.
// Plain methods with an identical cost are merged (choosing between them changes nothing); burst/app always stay separate (they have side effects).
export function evolutionMethods(sourceCardId, targetCardId, extraColors = [], restriction = null, ctx = null) {
  const out = [];
  const seenCost = new Set();
  const addPlain = (m) => { if (seenCost.has(m.baseCost)) return; seenCost.add(m.baseCost); out.push(m); };
  const sat = satisfiedEvoConditions(sourceCardId, targetCardId, extraColors, restriction);
  sat.forEach((c, i) => addPlain({ id: (c.isNormal ? 'normal' : 'line') + i, kind: c.isNormal ? 'normal' : 'special-line', label: c.isNormal ? '일반 진화' : '특수 진화 조건', baseCost: c.cost, conditionText: c.raw || '', ignoresCondition: false, sideEffect: false }));
  const okBase = !restriction || !restriction.cannotEvolve;
  if (restriction && restriction.alt && okBase && !S.isTokenId(sourceCardId)) {
    const src = S.card(sourceCardId), tgt = S.card(targetCardId);
    restriction.alt.forEach((a, i) => { if (a.test(tgt, src)) addPlain({ id: 'alt-r' + i, kind: 'alt', label: '효과로 진화 조건 무시', baseCost: a.cost, conditionText: '진화 조건 무시', ignoresCondition: true, sideEffect: false }); });
  }
  if (ctx && ctx.state && ctx.stack) {
    const { state, p, stack } = ctx;
    const alt = S.s1EvolveAlt(state, p, stack, targetCardId); // shard1: 진화조건 무시 + 고정 코스트 (8-1-2-2: restrictions still apply)
    if (alt && evoRestrictionCheck(targetCardId, restriction).ok && !(restriction && restriction.cannotEvolve)) addPlain({ id: 'alt-s1', kind: 'alt', label: '효과로 진화 조건 무시', baseCost: alt.cost, conditionText: '진화 조건 무시', ignoresCondition: true, sideEffect: false });
    if (evoRestrictionCheck(targetCardId, restriction).ok) {
      const burst = S.parseBurstEvolution(targetCardId) ? S.burstCheck(state, p, stack, targetCardId) : null;
      if (burst && burst.ok) out.push({ id: 'burst', kind: 'burst', label: '《버스트 진화》', baseCost: burst.cost, conditionText: '테이머를 패로 되돌림', ignoresCondition: false, sideEffect: true, tamerUids: burst.tamerUids });
      const appf = S.parseAppFusion(targetCardId) ? S.appFusionCheck(state, p, stack, targetCardId) : null;
      if (appf && appf.ok) out.push({ id: 'app', kind: 'app', label: '《어플 합체》', baseCost: appf.cost, conditionText: '링크 카드를 위에 겹침', ignoresCondition: false, sideEffect: true });
    }
  }
  return out;
}
