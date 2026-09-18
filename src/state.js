// Core game state model + primitive mutators.
// This module has NO knowledge of specific card effect text — it only
// implements the generic mechanics (zones, memory gauge, phases, evolution
// stacking, security checks). Card-specific effects are resolved manually
// through the generic tools exposed here (draw, trash, reveal, security
// add/remove, memory delta, de-evolve) and triggered from the UI.

export let CARDS = {};
export let DECKS = {};

export async function loadData() {
  const [cardsRes, decksRes] = await Promise.all([
    fetch('./data/cards_full.json'), // full official DB, transformed from dgchub.com export — see scripts/build-cards.mjs
    fetch('./data/decks.json'),
  ]);
  CARDS = await cardsRes.json();
  DECKS = await decksRes.json();
}

export function card(id) {
  return CARDS[id] || { id, nameKo: id, category: 'unknown', colors: [], types: [] };
}

// Split a card's raw effect text into tagged segments using the official
// bracket markers, e.g. "【등장 시】【진화 시】 텍스트... 【소멸 시】 텍스트...".
// Returns [{ tags: ['등장 시','진화 시'], body: '텍스트...' }, ...]. Any text
// before the first bracket (usually the digivolve condition line, which is
// already structured in evoNormal) is returned separately as `preamble`.
export function parseEffectSegments(text) {
  if (!text) return { preamble: '', segments: [] };
  // A 【...】 group only starts a NEW segment when it sits at a real clause
  // boundary (start of the text, or right after a line break). Mid-sentence
  // 【...】 — inside a 「...」 quoted "grant this ability" block, or used as a
  // bare noun reference like "이 카드의 【시큐리티】 효과" — must stay part of
  // the segment body, not be mistaken for another trigger on THIS card.
  //
  // A zone marker like "[패]"/"[트래시]" can sit BEFORE the 【...】 group on
  // the same line (e.g. "[패]【카운터】 …", printed on 【카운터】 cards to say
  // it's usable from hand) — without accounting for it, the boundary check
  // sees "]" right before "【" instead of a real line start and silently
  // drops the whole segment into the preamble, making it invisible to every
  // trigger/effect consumer. Treat "boundary, then a bracket marker" as
  // still a valid boundary for the 【...】 that follows.
  const re = /(?:【([^】]+)】)+/g;
  const groups = [];
  let m;
  while ((m = re.exec(text))) {
    let boundaryIndex = m.index;
    let zoneMarker = null;
    if (boundaryIndex > 0 && text[boundaryIndex - 1] !== '\n') {
      const before = text.slice(0, boundaryIndex);
      const bracket = before.match(/\[([^\[\]]*)\]\s*$/);
      if (bracket) {
        const bracketStart = boundaryIndex - bracket[0].length;
        if (bracketStart === 0 || text[bracketStart - 1] === '\n') { boundaryIndex = bracketStart; zoneMarker = bracket[1]; }
      }
    }
    const atBoundary = boundaryIndex === 0 || text[boundaryIndex - 1] === '\n';
    if (!atBoundary) continue;
    const fullMatch = m[0];
    const tags = [...fullMatch.matchAll(/【([^】]+)】/g)].map(x => x[1]);
    groups.push({ index: boundaryIndex, endOfHeader: m.index + fullMatch.length, tags, zoneMarker });
  }
  if (groups.length === 0) return { preamble: text.trim(), segments: [] };
  const preamble = text.slice(0, groups[0].index).trim();
  const segments = groups.map((g, i) => {
    const end = i + 1 < groups.length ? groups[i + 1].index : text.length;
    // zoneMarker: the "[패]"/"[트래시]" etc. printed immediately before this
    // segment's 【...】 tag, if any — says which zone the card must be in
    // for this specific ability to be usable (e.g. 【카운터】 from hand).
    // null means no such restriction was printed.
    return { tags: g.tags, body: text.slice(g.endOfHeader, end).trim(), zoneMarker: g.zoneMarker };
  });
  return { preamble, segments };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function expandDeck(mainOrDigitama) {
  const out = [];
  for (const [id, qty] of Object.entries(mainOrDigitama)) {
    for (let i = 0; i < qty; i++) out.push(id);
  }
  return out;
}

let uidCounter = 1;
function nextUid() {
  return 'u' + (uidCounter++);
}

function emptyPlayer(deckKeyOrDef) {
  const deckDef = typeof deckKeyOrDef === 'string' ? DECKS[deckKeyOrDef] : deckKeyOrDef;
  return {
    deckName: deckDef.name,
    hand: [],
    deck: shuffle(expandDeck(deckDef.main)),
    trash: [],
    security: [],
    digitamaDeck: shuffle(expandDeck(deckDef.digitama)),
    raising: null, // Stack | null
    battle: [], // Stack[]
    memoryLocks: [], // free-text reminders (e.g. "opponent can't gain memory except via tamer")
  };
}

export function newGame(deckKeyP1, deckKeyP2) {
  return {
    turnNumber: 1,
    activePlayer: 'p1', // set properly after coin flip by caller
    firstPlayer: 'p1',
    phase: 'setup', // setup | unsuspend | draw | breeding | main | ended
    memory: 0, // positive = p1's banked side, negative = p2's banked side
    winner: null,
    breedingActionTaken: false, // 6-4: hatch OR move, not both, per breeding phase visit — reset each turn
    players: { p1: emptyPlayer(deckKeyP1), p2: emptyPlayer(deckKeyP2) },
    log: [],
    pending: [], // pending effect triggers awaiting manual/auto resolution
    pendingVanishFlash: [], // names of stacks deleteStack() just sent to trash, for a one-shot UI toast
  };
}

let pendingUid = 1;

// Korean trigger-tag substrings (as printed in 【...】 brackets) that are
// relevant to a given game event. A segment is queued if ANY of its tags
// contains one of these substrings.
const TRIGGER_TAGS = {
  play: ['등장 시'],
  digivolve: ['진화 시'],
  delete: ['소멸 시'],
  attack: ['어택 시', '공격 시'],
  mainPhaseStart: ['메인 페이즈 시작 시', '메인 페이즈 개시 시'],
  turnStart: ['자신의 턴 시작 시', '자신의 턴 개시 시'],
  security: ['시큐리티'],
  use: ['메인'],
  move: ['이동했을 때', '이동 시'],
  linked: ['링크했을 때', '링크 시'],
  attackEnd: ['어택 종료 시'],
  counter: ['카운터'],
  bothTurns: ['서로의 턴', '상대의 턴', '자신의 턴'],
};

// Whole-segment (not substring) patterns that fully describe an unconditional
// single action, safe to force-apply with no player choice involved. If a
// segment's text is ANYTHING more than one of these (extra clauses, choice
// wording), it is deliberately left for manual/pending resolution instead —
// better to surface it than silently apply half an effect.
function tryAutoApplySegment(state, p, text, sourceCardId) {
  const opp = opponentOf(p);
  const t = text.replace(/[≪《》≫]/g, '').trim();
  let m;
  // 16-17 ≪딜레이≫: this segment isn't an immediate effect of using the card —
  // it's only usable later via discardForDelay (see compileToScript's matching
  // guard). Absorb it silently so it doesn't queue as an unresolvable pending item.
  if (/^딜레이\s*\([^()]*\)/.test(t)) return true;
  if ((m = t.match(/^(\d+)\s*드로우(?:한다)?[.。]?$/))) { drawCards(state, p, Number(m[1])); return true; }
  if ((m = t.match(/^메모리(?:를|을)?\s*\+\s*(\d+)(?:한다)?[.。]?$/))) { grantMemory(state, p, Number(m[1]), sourceCardId); return true; }
  if ((m = t.match(/^메모리(?:를|을)?\s*-\s*(\d+)(?:한다)?[.。]?$/))) { grantMemory(state, p, -Number(m[1])); return true; }
  if ((m = t.match(/^(?:자신의\s*)?덱\s*위(?:에서)?(?:\s*부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)?[.。]?$/))) { trashTopOfDeck(state, p, Number(m[1])); return true; }
  if ((m = t.match(/^상대(?:의)?\s*덱\s*위(?:에서)?(?:\s*부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)?[.。]?$/))) { trashTopOfDeck(state, opp, Number(m[1])); return true; }
  if (/^(?:자신의\s*)?패(?:를)?\s*전부\s*파기(?:한다|할\s*수\s*있다)?[.。]?$/.test(t)) {
    const n = state.players[p].hand.length; for (let i = 0; i < n; i++) trashFromHand(state, p, 0); return true;
  }
  return false;
}

export function queueTriggersFor(state, p, cardId, eventKind, stackUid = null) {
  const c = card(cardId);
  const wantTags = TRIGGER_TAGS[eventKind] || [];
  const { segments } = parseEffectSegments(c.effectKo);
  for (const seg of segments) {
    const hit = seg.tags.some(tag => wantTags.some(w => tag.includes(w)));
    if (!hit) continue;
    if (isDelaySegment(seg.body)) continue; // 16-17: only usable later via discardForDelay, not on use
    const applied = tryAutoApplySegment(state, p, seg.body, cardId);
    if (applied) {
      log(state, `(자동 처리) ${card(cardId).nameKo} 【${seg.tags.join('】【')}】: ${seg.body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId, stackUid, tags: seg.tags, text: seg.body, resolved: false });
    }
  }
}

function isDelaySegment(body) {
  return /^[≪《]\s*딜레이\s*[≫》]\s*\([^()]*\)/.test(body.trim());
}

// A Digimon gets the inherited (진화원) effects of EVERY card in its
// evolution stack, not just its own printed text (4-3-3). Scans a source
// card's `inheritedKo` field for matching-tag segments the same way
// queueTriggersFor scans a top card's `effectKo`.
function queueInheritedTriggersFor(state, p, sourceCardId, eventKind, stackUid) {
  const c = card(sourceCardId);
  if (!c.inheritedKo) return;
  const wantTags = TRIGGER_TAGS[eventKind] || [];
  const { segments } = parseEffectSegments(c.inheritedKo);
  for (const seg of segments) {
    const hit = seg.tags.some(tag => wantTags.some(w => tag.includes(w)));
    if (!hit) continue;
    if (isDelaySegment(seg.body)) continue; // 16-17: only usable later via discardForDelay, not on use
    const applied = tryAutoApplySegment(state, p, seg.body, sourceCardId);
    if (applied) {
      log(state, `(자동 처리, 진화원효과: ${c.nameKo}) 【${seg.tags.join('】【')}】: ${seg.body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: sourceCardId, stackUid, tags: seg.tags, text: seg.body, resolved: false, inherited: true });
    }
  }
}

// "이 디지몬은 이 디지몬의 진화원에 있는 명칭에 「X」을 포함하는 카드의 효과
// 전부를 얻는다." (always 【서로의 턴】, i.e. always active) — this Digimon
// gains a matching source's OWN printed effect text wholesale, not just its
// normal 4-3-3 inherited (진화원) text. Confirmed 14 occurrences, always
// printed identically in both effectKo and inheritedKo of the same card.
function fullEffectInheritTarget(effectKo) {
  const m = (effectKo || '').match(/이\s*디지몬은\s*이\s*디지몬의\s*진화원에\s*있는\s*명칭에\s*「([^」]+)」\s*(?:을|를)?\s*포함하는\s*카드의\s*효과\s*전부를\s*얻는다/);
  return m ? m[1] : null;
}

// The one entry point that should be used for any real game event on a
// Digimon stack — checks both the top card's own effect text AND every
// evolution source's inherited effect text.
export function queueTriggersForStack(state, p, stack, eventKind) {
  if (!stack) return;
  queueTriggersFor(state, p, stack.cardId, eventKind, stack.uid);
  for (const sourceCardId of stack.sources) {
    queueInheritedTriggersFor(state, p, sourceCardId, eventKind, stack.uid);
  }
  const nameIncludes = fullEffectInheritTarget(card(stack.cardId).effectKo);
  if (nameIncludes) {
    for (const sourceCardId of stack.sources) {
      if (card(sourceCardId).nameKo.includes(nameIncludes)) {
        queueTriggersFor(state, p, sourceCardId, eventKind, stack.uid);
      }
    }
  }
}

// 11-3: the (non-turn) defending player's window to activate a 【카운터】
// effect, between attack declaration and Block Timing. Scans hand and
// battle-area stacks' own + inherited text for 카운터-tagged segments —
// e.g. "[패]【카운터】 《블래스트 진화》(...)". The "[패]" zone marker means
// this specific ability only works while the card is actually IN hand —
// checked against the zone actually being scanned, so a card that happens
// to also sit in the battle area doesn't wrongly offer its hand-only
// counter ability from there.
export function findCounterOptions(state, p) {
  const pl = state.players[p];
  const options = [];
  const collect = (segments, cardId, stackUid, zone) => {
    for (const seg of segments) {
      if (!seg.tags.some(t => t.includes('카운터'))) continue;
      if (seg.zoneMarker && !seg.zoneMarker.includes(zone === 'hand' ? '패' : '배틀')) continue;
      options.push({ zone, cardId, stackUid, tags: seg.tags, body: seg.body });
    }
  };
  pl.hand.forEach((cardId) => {
    collect(parseEffectSegments(card(cardId).effectKo).segments, cardId, null, 'hand');
  });
  for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
    collect(parseEffectSegments(card(stack.cardId).effectKo).segments, stack.cardId, stack.uid, 'battle');
    for (const srcId of stack.sources) {
      const c = card(srcId);
      if (!c.inheritedKo) continue;
      collect(parseEffectSegments(c.inheritedKo).segments, srcId, stack.uid, 'battle');
    }
  }
  return options;
}

// "[턴에 N회] 상대의 디지몬이 어택했을 때, 어택의 대상을 이 디지몬으로 변경할
// 수 있다." — another embedded "~했을 때" trigger nested inside a continuous
// 상대의 턴 wrapper (always tagged from the ABILITY OWNER's perspective, so
// "상대의 턴" here just means "whenever I'm not the active player", which is
// unconditionally true for a defender reacting to an incoming attack).
// Simplified to the unconditioned form only — several real prints add an
// extra requirement (highest-DP attacker, a specific trait/name on this
// stack) that would need per-card condition evaluation not attempted here.
// "이 디지몬의 (어택의) 대상은 변경되지 않는다." — the inverse of
// findRedirectOptions: makes an ATTACKING stack immune to target-redirect
// effects. Same continuous 자신/상대/서로의 턴 family.
function isAttackTargetImmune(state, p, stack) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      if (/^이\s*디지몬의?\s*어택(?:의)?\s*대상은\s*변경되지\s*않는다\.?$/.test(seg.body.trim())) return true;
    }
  }
  return false;
}

export function findRedirectOptions(state, p, attackerP, attackerUid) {
  if (attackerP != null) {
    const apl = state.players[attackerP];
    const aStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
    if (aStack && isAttackTargetImmune(state, attackerP, aStack)) return [];
  }
  const pl = state.players[p];
  const options = [];
  for (const stack of pl.battle) {
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const body = seg.body.trim();
        const limitM = body.match(/^\[턴\s*에?\s*(\d+)\s*회\]\s*(.*)$/s);
        const limit = limitM ? Number(limitM[1]) : null;
        const rest = (limitM ? limitM[2] : body).trim();
        if (!/^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택의?\s*대상을\s*이\s*디지몬으로\s*변경할\s*수\s*있다\.?$/.test(rest)) continue;
        if (limit != null) {
          const key = onceLimitKey(id, ['어택대상변경']);
          if (turnUsesRemaining(stack, key, limit) <= 0) continue;
        }
        options.push({ cardId: id, stackUid: stack.uid, limit });
      }
    }
  }
  return options;
}

// Marks a redirect option as used this turn (for its [턴에 N회] cap, if any).
export function markRedirectUsed(state, p, stackUid, cardId) {
  const pl = state.players[p];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (stack) markTurnEffectUsed(stack, onceLimitKey(cardId, ['어택대상변경']));
}

export function resolvePending(state, uid) {
  const t = state.pending.find(x => x.uid === uid);
  if (t) t.resolved = true;
  state.pending = state.pending.filter(x => !x.resolved);
}

export function log(state, msg) {
  state.log.unshift({ t: Date.now(), turn: state.turnNumber, msg });
  if (state.log.length > 300) state.log.length = 300;
}

export function opponentOf(p) {
  return p === 'p1' ? 'p2' : 'p1';
}

// ---- hand / deck primitives ----

// `isDrawPhase`: the official rule (1-2-3-2) makes deck-out a LOSS only for
// the mandatory Draw Phase draw. A card/evolution "draw N" effect that can't
// find enough cards just draws what's available (possibly zero) — no loss.
export function drawCards(state, p, n, isDrawPhase = false) {
  const pl = state.players[p];
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (pl.deck.length === 0) {
      if (isDrawPhase) {
        state.winner = opponentOf(p);
        log(state, `${p} 드로우 페이즈에 덱아웃으로 패배!`);
      }
      break;
    }
    const c = pl.deck.shift();
    pl.hand.push(c);
    drawn.push(c);
  }
  if (drawn.length) {
    log(state, `${p} 드로우 ${drawn.length}장: ${drawn.map(id => card(id).nameKo).join(', ')}`);
    // Explicit counter instead of diffing hand length — a digivolve's bonus
    // draw nets to a ZERO length change (one card spent on the evolution,
    // one drawn back), which silently hid the new card from a length-diff
    // based "just drawn" detector. main.js reads and clears this once per
    // render, so it flashes exactly the cards actually just drawn.
    pl.pendingDrawFlash = (pl.pendingDrawFlash || 0) + drawn.length;
  }
  return drawn;
}

export function trashFromHand(state, p, handIndex) {
  const pl = state.players[p];
  const [id] = pl.hand.splice(handIndex, 1);
  if (id) { pl.trash.push(id); log(state, `${p} 핸드 파기: ${card(id).nameKo}`); }
  return id;
}

export function trashTopOfDeck(state, p, n) {
  const pl = state.players[p];
  const out = [];
  for (let i = 0; i < n && pl.deck.length; i++) out.push(pl.deck.shift());
  pl.trash.push(...out);
  if (out.length) log(state, `${p} 덱 위 ${out.length}장 파기: ${out.map(id => card(id).nameKo).join(', ')}`);
  return out;
}

export function revealTop(state, p, n) {
  const pl = state.players[p];
  return pl.deck.slice(0, n);
}

// Move revealed cards: some to hand, rest to bottom (default) or top of deck.
export function resolveReveal(state, p, n, keepIdx, toHandIdxs, restTo = 'bottom') {
  const pl = state.players[p];
  const revealed = pl.deck.splice(0, n);
  const toHand = [];
  const rest = [];
  revealed.forEach((id, i) => {
    if (toHandIdxs.includes(i)) toHand.push(id); else rest.push(id);
  });
  pl.hand.push(...toHand);
  if (restTo === 'bottom') pl.deck.push(...rest); else pl.deck.unshift(...rest);
  log(state, `${p} 공개 처리: 핸드로 ${toHand.map(id=>card(id).nameKo).join(',')||'없음'} / 나머지 덱 ${restTo === 'bottom' ? '밑' : '위'}로`);
  return { toHand, rest };
}

// ---- security ----

export function securityCount(state, p) { return state.players[p].security.length; }

export function addToSecurity(state, p, cardId, position = 'top') {
  const pl = state.players[p];
  if (position === 'top') pl.security.unshift(cardId); else pl.security.push(cardId);
  log(state, `${p} 시큐리티 ${position === 'top' ? '맨 위' : '맨 밑'}에 추가: ${card(cardId).nameKo}`);
}

// Remove top security card by a non-attack EFFECT (not a check). Returns removed id.
export function trashTopSecurityByEffect(state, p) {
  const pl = state.players[p];
  const id = pl.security.shift();
  if (id) log(state, `${p} 시큐리티 맨 위 카드가 효과로 파기: ${card(id).nameKo} (효과 트리거 대상일 수 있음 — 수동 확인)`);
  pl.trash.push(id);
  return id;
}

export function trashBottomSecurityByEffect(state, p) {
  const pl = state.players[p];
  const id = pl.security.pop();
  if (id) { log(state, `${p} 시큐리티 맨 밑 카드가 효과로 파기: ${card(id).nameKo}`); pl.trash.push(id); }
  return id;
}

// ---- memory gauge ----
// Positive = p1's banked side. Spending by the ACTIVE player always shifts
// the gauge toward the OPPONENT's side: if active is p1, memory decreases;
// if active is p2, memory increases.

export function spendMemory(state, amount) {
  const active = state.activePlayer;
  const delta = active === 'p1' ? -amount : amount;
  state.memory += delta;
  state.memory = Math.max(-10, Math.min(10, state.memory));
  log(state, `${active} 코스트 ${amount} 지불 → 메모리 ${state.memory >= 0 ? '+' : ''}${state.memory}`);
  return state.memory;
}

// "상대는/서로는 테이머의 효과 이외로 메모리를 플러스할 수 없다." — checked
// against BOTH boards since "상대는" restricts the OTHER player (ability
// read from ITS controller's perspective, like isEvoCostLocked) while
// "서로는" restricts everyone including the controller's own side.
function isMemoryGainLocked(state, p) {
  for (const ownerP of ['p1', 'p2']) {
    const pl = state.players[ownerP];
    for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
      for (const { id, own } of stackContributors(stack)) {
        const text = own ? card(id).effectKo : card(id).inheritedKo;
        if (!text) continue;
        const { segments } = parseEffectSegments(text);
        for (const seg of segments) {
          if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
          const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === ownerP);
          if (!active) continue;
          const body = seg.body.trim();
          const restrictsOpponent = /^상대는\s*테이머의?\s*효과\s*이외로\s*메모리를\s*플러스할\s*수\s*없다\.?$/.test(body) && p === opponentOf(ownerP);
          const restrictsEveryone = /^서로는\s*테이머의?\s*효과\s*이외로\s*메모리를\s*플러스할\s*수\s*없다\.?$/.test(body);
          if (restrictsOpponent || restrictsEveryone) return true;
        }
      }
    }
  }
  return false;
}

// Direct memory grant (e.g. a card's "gain 1 memory"), respecting the same
// sign convention: grants to `p` move the gauge toward p's own side.
// `sourceCardId`, when given, exempts Tamer-sourced grants from the
// "테이머의 효과 이외로 메모리를 플러스할 수 없다." lock; omit it for
// system-level/manual-tool calls that aren't a specific card's own effect.
export function grantMemory(state, p, amount, sourceCardId) {
  if (amount > 0 && sourceCardId != null && card(sourceCardId).category !== 'tamer' && isMemoryGainLocked(state, p)) {
    log(state, `${p} 메모리 증가가 효과로 봉쇄됨 (테이머 효과 아님): ${card(sourceCardId).nameKo}`);
    return state.memory;
  }
  const delta = p === 'p1' ? amount : -amount;
  state.memory += delta;
  state.memory = Math.max(-10, Math.min(10, state.memory));
  log(state, `${p} 메모리 +${amount} 획득 → 게이지 ${state.memory >= 0 ? '+' : ''}${state.memory}`);
  return state.memory;
}

// After any action resolves, call this. If the gauge sits on the ACTIVE
// player's OPPONENT's side, the turn auto-ends (caller should then call
// endTurn unless there is a pending triggered effect still resolving).
export function isTurnAutoEnding(state) {
  const active = state.activePlayer;
  if (active === 'p1') return state.memory < 0;
  return state.memory > 0;
}

// ---- evolution stacks ----

// `attackEligibleTurn`: the first turn number this physical stack is allowed
// to attack. A freshly-played (from hand) Digimon can't attack the turn it
// enters play, so it's eligible starting next turn. Hatching/moving/evolving
// an EXISTING stack never resets this — a stack keeps whatever eligibility
// it already had. DNA/Jogress digivolve results are always eligible
// immediately, even if their materials just entered play this same turn.
function makeStack(cardId, turnNumber) {
  return {
    uid: nextUid(), cardId, sources: [], suspended: false, attackEligibleTurn: turnNumber + 1,
    placedTurn: turnNumber, // for ≪딜레이≫ (16-17-3: not usable the turn this card entered the battle area)
    tempDP: 0, // temporary DP modifier, cleared at cleanup (see clearTemporaryModifiers)
    keywords: {}, // { [keywordName]: 'permanent' | turnNumber-it-expires-after }
    attacksThisTurn: 0, // for [턴에 N회] "become active again" style re-attack effects
    turnEffectUses: {}, // { [effectKey]: timesUsedThisTurn } — enforces printed "[턴에 N회]" caps
    extraColors: [], // additional colors this stack counts as, e.g. "treat as Green too"
    linkCards: [], // { cardId, grantedBy } — attached Link Cards (10). NOT evolution sources.
    inheritedDP: 0, // recomputed by recomputeStackGrants from sources'/link cards' printed stat lines
    inheritedKeywords: {}, // ditto, for bare 《키워드》 grant lines
  };
}

export function grantColor(state, p, uid, color) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (!stack.extraColors.includes(color)) stack.extraColors.push(color);
  log(state, `${p} ${card(stack.cardId).nameKo}는 ${color} 색으로도 취급됨`);
}

const EFFECTIVE_TEMP_KEYWORDS = new Set(['시큐리티어택', '재밍', '관통', '블로커', '재기동']);

export function securityAttackBonus(stack) {
  const own = stack.keywords?.['시큐리티어택'] ? Number(stack.keywords['시큐리티어택']) || 0 : 0;
  const inherited = stack.inheritedKeywords?.['시큐리티어택'] ? Number(stack.inheritedKeywords['시큐리티어택']) || 0 : 0;
  return own + inherited;
}

export function hasKeyword(stack, name) {
  return !!(stack.keywords && stack.keywords[name]) || !!(stack.inheritedKeywords && stack.inheritedKeywords[name]);
}

// "특징으로 「X」를 가진 이 디지몬은 《KEYWORD》를 얻는다." / the bare
// unconditional "이 디지몬은 《KEYWORD》를 얻는다." — same continuous
// 자신/상대/서로의 턴 family as the other grants, for keywords whose
// consumer needs to check live (e.g. 충돌, which only matters exactly when
// Block Timing is being resolved) rather than through the cached
// keywords/inheritedKeywords used by hasKeyword.
export function hasContinuousKeyword(state, p, stack, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bareRe = new RegExp(`^이\\s*디지몬은\\s*[≪《]\\s*${escaped}\\s*[≫》](?:\\s*\\([^()]*\\))?\\s*(?:을|를)?\\s*얻는다\\.?$`);
  const traitRe = new RegExp(`^특징으로\\s*「([^」]+)」\\s*(?:을|를)?\\s*가진\\s*이\\s*디지몬은\\s*[≪《]\\s*${escaped}\\s*[≫》](?:\\s*\\([^()]*\\))?\\s*(?:을|를)?\\s*얻는다\\.?$`);
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const body = seg.body.trim();
      if (bareRe.test(body)) return true;
      const m = body.match(traitRe);
      if (m && (card(stack.cardId).types || []).some(t => t.includes(m[1]))) return true;
    }
  }
  return false;
}

// "[턴에 N회]"/"[턴 N회]" frequency caps were being parsed as plain
// descriptive text and never actually enforced anywhere — a card like
// ST2-11 MetalGarurumon ("【어택 시】[턴에 1회] 이 디지몬을 액티브로 한다.")
// could re-unsuspend and re-attack an unlimited number of times per turn.
// Keyed per stack, per (cardId+tags) so a source's and the top card's own
// same-named effect don't share one counter by accident.
export function onceLimitKey(cardId, tags) { return `${cardId}::${(tags || []).join(',')}`; }
export function turnUsesRemaining(stack, key, limit) {
  const used = (stack.turnEffectUses && stack.turnEffectUses[key]) || 0;
  return limit - used;
}
export function markTurnEffectUsed(stack, key) {
  stack.turnEffectUses = stack.turnEffectUses || {};
  stack.turnEffectUses[key] = (stack.turnEffectUses[key] || 0) + 1;
}
export function resetTurnEffectUses(state) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) stack.turnEffectUses = {};
  }
}

// ---- Overflow (4-19) ----
// Printed as a bare line in a card's own OR inherited text, e.g.
// "《오버플로우 《-4》》(에어리어 또는 카드 아래에서부터, 그 이외의 장소로 보내질 경우, 메모리 -4)".
// Fires the printed memory delta on the controlling player the moment THIS
// physical card actually leaves the battle area or leaves being an
// evolution-source/link-card attachment, to any other area.
function overflowDelta(cardId) {
  const c = card(cardId);
  const text = `${c.effectKo || ''}\n${c.inheritedKo || ''}`;
  const m = text.match(/오버플로우\s*[《≪]\s*([+-]?\d+)\s*[》≫]/);
  return m ? Number(m[1]) : 0;
}

export function applyOverflowIfAny(state, p, cardId) {
  const delta = overflowDelta(cardId);
  if (!delta) return;
  grantMemory(state, p, delta);
  log(state, `${p} ${card(cardId).nameKo} 《오버플로우》 발동: 메모리 ${delta >= 0 ? '+' : ''}${delta}`);
}

// ---- inherited static stat/keyword grants (4-3-3), from evolution sources
// AND from attached Link Cards (10) alike ----
// Cards print these as bare lines alongside their bracket-tagged triggered
// segments, e.g. "DP +2000\n링크: 특징 「어플몬」: 코스트 1\n《돌진》" — none of
// which parseEffectSegments captures (it only splits 【...】-tagged clauses).
function parseStaticGrants(text) {
  const out = { dp: 0, keywords: {} };
  if (!text) return out;
  for (const rawLine of text.split('\n')) {
    const t = rawLine.trim();
    if (!t) continue;
    let m;
    if ((m = t.match(/^DP\s*([+-]\d+)$/))) { out.dp += Number(m[1]); continue; }
    if (/^링크\s*[:：]/.test(t)) continue; // handled by parseLinkGrant, not a standing stat
    if (/오버플로우/.test(t)) continue; // handled by overflowDelta, an on-leave trigger not a standing stat
    // The keyword token is often followed by a plain-language parenthetical
    // explanation on the SAME line (e.g. beginner-deck cards spelling out
    // what the keyword does) — that trailing "(...)" must still count as a
    // bare grant, not get rejected as "extra prose" the way a genuine
    // triggered-effect clause would.
    const bare = t.match(/^[《≪]\s*([^》≫]+?)\s*[》≫](?:\s*\([^()]*\))?$/);
    if (!bare) continue; // a keyword line with extra prose is a triggered effect, not a bare grant — leave it
    const label = bare[1];
    if (['재밍', '블로커', '관통', '재기동', '속공', '진격'].includes(label)) { out.keywords[label] = true; continue; }
    // "S 어택" (abbreviated) and "시큐리티 어택" (spelled out, common on
    // beginner/starter-deck cards) are the same keyword.
    if ((m = label.match(/^(?:S|시큐리티)\s*어택\s*\+(\d+)$/))) { out.keywords['시큐리티어택'] = (out.keywords['시큐리티어택'] || 0) + Number(m[1]); continue; }
    if ((m = label.match(/^링크\+(\d+)$/))) { out.keywords['링크+'] = (out.keywords['링크+'] || 0) + Number(m[1]); continue; } // 4-9-5: raises the 1-per-Digimon Link Card cap
    // other bare keyword tokens (e.g. 《돌진》) intentionally left unmapped for now —
    // no existing engine flag consumes them; surfaced via the effect box only.
  }
  return out;
}

// Every card whose text can contribute a standing grant to this stack — its
// own top card (own:true, reads effectKo) plus every evolution source and
// attached Link Card (own:false, reads inheritedKo). Shared by
// recomputeStackGrants (cached, unconditional grants) and
// turnConditionalDP (live, re-evaluated every call since it depends on
// whose turn it currently is).
function stackContributors(stack) {
  // "이 디지몬은 ... 명칭에 「X」을 포함하는 카드의 효과 전부를 얻는다." — a
  // matching-name source contributes its OWN effectKo (own:true) instead of
  // just its normal 4-3-3 inheritedKo, for every continuous-grant system
  // that reads stackContributors (DP, keywords, evolve restrictions, etc.),
  // not just the one-shot trigger pipeline queueTriggersForStack handles
  // separately.
  const fullInheritName = fullEffectInheritTarget(card(stack.cardId).effectKo);
  return [
    { id: stack.cardId, own: true },
    ...stack.sources.map(id => ({ id, own: fullInheritName != null && card(id).nameKo.includes(fullInheritName) })),
    ...(stack.linkCards || []).map(l => ({ id: l.cardId, own: false })),
  ];
}

// "이 디지몬을 DP +N." printed under a bare 【자신의 턴】/【상대의 턴】/【서로의
// 턴】 tag (no other clause in the segment) is a continuous conditional stat,
// not a one-time trigger — it's active only while that turn-window condition
// holds, so unlike parseStaticGrants it can't be cached once and forgotten;
// effectiveDP re-evaluates it against the current state.activePlayer every
// call. Confirmed extremely common (140+ cards) via a full-card-DB audit.
function parseTurnConditionalDP(text) {
  const out = [];
  if (!text) return out;
  const { segments } = parseEffectSegments(text);
  for (const seg of segments) {
    if (seg.tags.length !== 1) continue;
    const tag = seg.tags[0];
    if (!['자신의 턴', '상대의 턴', '서로의 턴'].includes(tag)) continue;
    const body = seg.body.trim();
    let m = body.match(/^이\s*디지몬을\s*DP\s*([+-])\s*(\d+)\.?$/);
    if (m) { out.push({ tag, amount: (m[1] === '-' ? -1 : 1) * Number(m[2]) }); continue; }
    // "레스트 상태인 이 디지몬을 DP ±N." — same continuous grant, additionally
    // conditioned on the stack currently being suspended (confirmed 13
    // occurrences, always under 【서로의 턴】, via the full-card-DB audit).
    m = body.match(/^레스트\s*상태인\s*이\s*디지몬을\s*DP\s*([+-])\s*(\d+)\.?$/);
    if (m) { out.push({ tag, amount: (m[1] === '-' ? -1 : 1) * Number(m[2]), requireSuspended: true }); continue; }
    // "「X」이 기술되어 있는 이 디지몬을 DP ±N." / "《X》가 기술되어 있는 …" —
    // conditioned on the CURRENT top card's own printed text containing that
    // literal name/keyword token somewhere (checked against stack.cardId's
    // effectKo in turnConditionalDP, not necessarily this same text — "이
    // 디지몬" always means the current top card, regardless of whether this
    // grant is being read from its own effectKo or a source's inheritedKo).
    m = body.match(/^(?:「([^」]+)」|[《≪]([^》≫]+)[》≫])(?:이|가)\s*기술되어\s*있는\s*이\s*디지몬을\s*DP\s*([+-])\s*(\d+)\.?$/);
    if (m) { out.push({ tag, amount: (m[3] === '-' ? -1 : 1) * Number(m[4]), requireToken: m[1] || m[2] }); continue; }
  }
  return out;
}

function turnConditionalDP(state, p, stack) {
  let total = 0;
  const ownText = card(stack.cardId).effectKo || '';
  for (const { id, own } of stackContributors(stack)) {
    const grants = parseTurnConditionalDP(own ? card(id).effectKo : card(id).inheritedKo);
    for (const g of grants) {
      const active = (g.tag === '서로의 턴' || (g.tag === '자신의 턴') === (state.activePlayer === p))
        && (!g.requireSuspended || stack.suspended)
        && (!g.requireToken || ownText.includes(g.requireToken));
      if (active) total += g.amount;
    }
  }
  return total;
}

const KOR_COLOR_NAME = { 레드: 'red', 블루: 'blue', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };

// "이 디지몬은 (X색)인/「X」으로만 진화할 수 있다." — same continuous-condition
// family as parseTurnConditionalDP, restricting what this stack is allowed
// to evolve into rather than its DP. Returns the first active restriction
// found ({colors:[...]} or {nameExact}/{nameIncludes}), or null.
export function evolveTargetRestriction(state, p, stack) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const body = seg.body.trim();
      if (/^이\s*디지몬은\s*진화할\s*수\s*없다\.?$/.test(body)) return { cannotEvolve: true };
      let m = body.match(/^이\s*디지몬은\s*(레드|블루|옐로우|그린|블랙|퍼플|화이트)인\s*디지몬으로만\s*진화할\s*수\s*있다\.?$/);
      if (m) return { colors: [KOR_COLOR_NAME[m[1]]] };
      m = body.match(/^이\s*디지몬은\s*명칭에\s*「([^」]+)」\s*(?:을|를)?\s*포함하는\s*디지몬으로만\s*진화할\s*수\s*있다\.?$/);
      if (m) return { nameIncludes: m[1] };
      m = body.match(/^이\s*디지몬은\s*「([^」]+)」(?:으로만|로만)\s*진화할\s*수\s*있다\.?$/);
      if (m) return { nameExact: m[1] };
    }
  }
  return null;
}

export function effectiveDP(state, p, stack) {
  return (card(stack.cardId).dp || 0) + (stack.tempDP || 0) + (stack.inheritedDP || 0) + turnConditionalDP(state, p, stack);
}

// "이 디지몬은 액티브 상태의 상대 디지몬에게도 어택할 수 있다." (no "no
// evolution sources" qualifier, unlike the printed 무진화원액티브공격
// keyword) — same continuous-condition family, usually printed under
// 【자신의 턴】 rather than as a one-shot trigger.
export function canAttackAnyActive(state, p, stack) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      if (/이\s*디지몬은?[,]?\s*액티브\s*상태의?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다/.test(seg.body) && !/진화원을?\s*갖지\s*않는/.test(seg.body)) {
        return true;
      }
    }
  }
  return false;
}

// Recompute a stack's standing DP/keywords from THREE sources: the current
// top card's own printed bare lines (e.g. a Digimon that just innately has
// "《블로커》" on its own text — confirmed extremely common, ST1-06 etc. —
// applies to itself while it's the active top card), its evolution
// sources', and any attached link cards' inherited text. Call after
// anything that changes stack.cardId, stack.sources, or stack.linkCards.
export function recomputeStackGrants(stack) {
  let dp = 0;
  let secAtk = 0;
  let linkCap = 0;
  const flags = {};
  const contributors = stackContributors(stack);
  for (const { id, own } of contributors) {
    const g = parseStaticGrants(own ? card(id).effectKo : card(id).inheritedKo);
    dp += g.dp;
    secAtk += g.keywords['시큐리티어택'] || 0;
    linkCap += g.keywords['링크+'] || 0;
    for (const k of ['재밍', '블로커', '관통', '재기동', '속공', '진격']) if (g.keywords[k]) flags[k] = true;
  }
  stack.inheritedDP = dp;
  stack.inheritedKeywords = {
    ...flags,
    ...(secAtk ? { '시큐리티어택': secAtk } : {}),
    ...(linkCap ? { '링크+': linkCap } : {}),
  };
}

// ---- Link (10) ----
// A source card's inherited text can grant the digimon built on top of it
// the standing ability to attach ANY card matching a filter, sideways, as a
// Link Card — printed as a bare "링크: <조건>: 코스트 <N>" line, e.g.
// "링크: 특징 「어플몬」: 코스트 1". Link Cards do NOT count as evolution
// sources (10-1-3), are capped at ONE per Digimon total (4-9-5 — raised
// only by ≪링크+N≫), and are discarded the moment the host becomes a "new
// card" via further digivolving (10-4-1).
function parseLinkGrant(sourceCardId) {
  const c = card(sourceCardId);
  if (!c.inheritedKo) return null;
  const m = c.inheritedKo.match(/링크\s*[:：]\s*(.+?)\s*[:：]\s*코스트\s*(\d+)/);
  if (!m) return null;
  return { grantedBy: sourceCardId, conditionText: m[1].trim(), cost: Number(m[2]) };
}

// All link slots currently available to a stack — one per distinct
// link-granting evolution source it has accumulated so far.
export function availableLinkSlots(stack) {
  return stack.sources.map(id => parseLinkGrant(id)).filter(Boolean);
}

function queueLinkTriggers(state, p, stack, linkCardId) {
  const lc = card(linkCardId);
  const { segments } = parseEffectSegments(lc.effectKo);
  for (const seg of segments) {
    const hit = seg.tags.some(tag => tag.includes('링크 시') || tag.includes('링크했을 때'));
    if (!hit) continue;
    const applied = tryAutoApplySegment(state, p, seg.body);
    if (applied) log(state, `(자동 처리, 링크: ${lc.nameKo}) 【${seg.tags.join('】【')}】: ${seg.body}`);
    else state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: linkCardId, stackUid: stack.uid, tags: seg.tags, text: seg.body, resolved: false, linked: true });
  }
  // The host's own printed "이 디지몬이 링크했을 때" reaction (see BT21-009/018/023)
  queueTriggersFor(state, p, stack.cardId, 'linked', stack.uid);
  for (const srcId of stack.sources) queueInheritedTriggersFor(state, p, srcId, 'linked', stack.uid);
}

export function linkCardTo(state, p, uid, linkCardId, grantedBySourceId, cost, source = 'hand') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return null;
  stack.linkCards = stack.linkCards || [];
  // 4-9-5: the cap is ONE Link Card per Digimon TOTAL (raised only by
  // ≪링크+N≫), not one per granting source. Exceeding it discards existing
  // link card(s) to make room — the rulebook has the player choose which;
  // there's no picker UI yet, so this discards oldest-attached first.
  const cap = 1 + (stack.inheritedKeywords?.['링크+'] || 0);
  while (stack.linkCards.length >= cap && stack.linkCards.length > 0) {
    const [old] = stack.linkCards.splice(0, 1);
    pl.trash.push(old.cardId);
    // Overflow (4-19-1) doesn't cover Link Cards leaving (4-9-1/4-9-4) — no applyOverflowIfAny here.
    log(state, `${p} 기존 링크 카드 ${card(old.cardId).nameKo} 파기 (링크 상한 초과)`);
  }
  if (source === 'hand') {
    const idx = pl.hand.indexOf(linkCardId);
    if (idx === -1) { log(state, `핸드에 ${linkCardId} 없음`); return null; }
    pl.hand.splice(idx, 1);
  }
  if (cost > 0) spendMemory(state, cost);
  stack.linkCards.push({ cardId: linkCardId, grantedBy: grantedBySourceId });
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  log(state, `${p} ${card(stack.cardId).nameKo}에 ${card(linkCardId).nameKo} 링크 (코스트 ${cost})`);
  queueLinkTriggers(state, p, stack, linkCardId);
  return stack;
}

// 10-4-1: the host becoming a new card (further digivolve/DNA fusion)
// discards any Link Cards attached to it.
function discardLinkCardsOnNewCard(state, p, stack) {
  if (!stack.linkCards || !stack.linkCards.length) return;
  const pl = state.players[p];
  for (const l of stack.linkCards) {
    pl.trash.push(l.cardId);
    // Link Cards aren't "area" or "stacked underneath a card" (4-9-1/4-9-4),
    // so Overflow's 4-19-1 trigger locations don't cover this departure.
    log(state, `${p} ${card(l.cardId).nameKo} 링크 해제 (진화로 새로운 카드가 되어 파기)`);
  }
  stack.linkCards = [];
}

// Grant a keyword/DP buff for a limited duration. `duration`: 'turn' (clears
// at the end of the CURRENT turn), 'opponentTurn' (clears after the
// opponent's next turn ends), or 'permanent'.
export function grantKeyword(state, p, uid, keyword, value, duration = 'turn') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  const expiresAfterTurn = duration === 'permanent' ? 'permanent'
    : duration === 'opponentTurn' ? state.turnNumber + 2
    : state.turnNumber; // 'turn' — clears at end of this same turn
  // 16-4-2/16-4-3: separate Security Attack grants on the same Digimon are
  // additive (two +1 grants check +2) — unlike most keywords, where
  // re-granting is idempotent, so this one accumulates instead of
  // overwriting.
  if (keyword === '시큐리티어택') {
    stack.keywords[keyword] = (Number(stack.keywords[keyword]) || 0) + (Number(value) || 0);
  } else {
    stack.keywords[keyword] = value === undefined ? true : value;
  }
  stack.keywordExpiry = stack.keywordExpiry || {};
  const prevExpiry = stack.keywordExpiry[keyword];
  stack.keywordExpiry[keyword] = (prevExpiry === 'permanent' || expiresAfterTurn === 'permanent')
    ? 'permanent' : Math.max(prevExpiry || 0, expiresAfterTurn);
  log(state, `${p} ${card(stack.cardId).nameKo}이(가) ${keyword}${value && value !== true ? '+' + value : ''} 획득 (${duration})`);
}

export function modifyDP(state, p, uid, amount, duration = 'turn') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (amount < 0 && hasKeyword(stack, 'DP감소무효')) {
    log(state, `${p} ${card(stack.cardId).nameKo}는 DP 감소 무효 — ${amount} 무시됨`);
    return;
  }
  stack.tempDP = (stack.tempDP || 0) + amount;
  stack.dpExpiry = duration === 'permanent' ? 'permanent' : (duration === 'opponentTurn' ? state.turnNumber + 2 : state.turnNumber);
  log(state, `${p} ${card(stack.cardId).nameKo} DP ${amount >= 0 ? '+' : ''}${amount} (${duration})`);
  ruleCheckDP(state, p, stack);
}

// 17-1-3-1/17-1-3-1-1: a battle-area Digimon whose DP is reduced to 0 (or
// below) vanishes automatically the moment a rule check is possible — not
// tied to any specific card's own effect. Swept after anything that can
// move a stack's effective DP downward.
function ruleCheckDP(state, p, stack) {
  const pl = state.players[p];
  if (!pl.battle.includes(stack)) return; // rule applies to the battle area only, not the raising area
  if (effectiveDP(state, p, stack) <= 0) {
    log(state, `${p} ${card(stack.cardId).nameKo} DP 0 이하 — 룰체크로 소멸 (17-1-3-1)`);
    deleteStack(state, p, stack.uid);
  }
}

export function unsuspendStack(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.suspended = false;
  log(state, `${p} ${card(stack.cardId).nameKo} 액티브`);
}

export function restStack(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (stack.cannotBeRestedUntil === 'permanent' || (typeof stack.cannotBeRestedUntil === 'number' && state.turnNumber <= stack.cannotBeRestedUntil)) {
    log(state, `${p} ${card(stack.cardId).nameKo}는 레스트 불가 상태라 레스트되지 않음`);
    return;
  }
  stack.suspended = true;
  log(state, `${p} ${card(stack.cardId).nameKo} 레스트`);
}

// "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — a ONE-TIME skip of
// the next unsuspend cycle (consumed in engine.js's nextPhase), distinct
// from preventRest below (which blocks resting in the first place, not
// unsuspending an already-rested stack).
export function setSkipNextUnsuspend(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.skipNextUnsuspend = true;
  log(state, `${p} ${card(stack.cardId).nameKo} 다음 액티브 페이즈에 액티브 되지 않음`);
}

// "상대의 테이머 전부는 액티브가 되지 않는다." — a CONTINUOUS block (as
// opposed to setSkipNextUnsuspend's one-time consumed skip), re-evaluated
// every unsuspend cycle rather than cleared after one use. The ability
// lives on the OPPONENT's board relative to the stack being checked (same
// "read tags from the ability's own controller" pattern as isEvoCostLocked/
// isMemoryGainLocked).
export function isPreventedFromUnsuspending(state, p, stack) {
  if (card(stack.cardId).category !== 'tamer') return false;
  const abilityOwner = opponentOf(p);
  const pl = state.players[abilityOwner];
  for (const s of [pl.raising, ...pl.battle].filter(Boolean)) {
    for (const { id, own } of stackContributors(s)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === abilityOwner);
        if (!active) continue;
        if (/^상대(?:의)?\s*테이머\s*전부는\s*(?:액티브\s*페이즈에서는\s*)?액티브가\s*되지\s*않는다\.?$/.test(seg.body.trim())) return true;
      }
    }
  }
  return false;
}

// "...는 레스트할 수 없다." — same shape as restrictAttack's cannotAttackUntil.
export function preventRest(state, p, uid, expiresAfterTurn = 'permanent') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.cannotBeRestedUntil = expiresAfterTurn;
  log(state, `${p} ${card(stack.cardId).nameKo} 레스트 불가 상태 부여`);
}

// Move the top card of own deck onto own security (top). Common "Recovery"
// keyword mechanic.
export function recoverTopOfDeckToSecurity(state, p) {
  const pl = state.players[p];
  const id = pl.deck.shift();
  if (id) { pl.security.unshift(id); log(state, `${p} 리커버리: 덱 위 카드 시큐리티로 (${card(id).nameKo})`); }
  return id;
}

// Temporary DP bonus applied to WHATEVER security card gets revealed for
// player `p` (can't target a specific face-down card, so this is stored on
// the player and consulted at check-time instead of on a stack).
export function addSecurityDPMod(state, p, amount, expiresAfterTurn) {
  const pl = state.players[p];
  pl.securityDPMods = pl.securityDPMods || [];
  pl.securityDPMods.push({ amount, expiresAfterTurn });
  log(state, `${p} 시큐리티 디지몬 DP ${amount >= 0 ? '+' : ''}${amount} (체크 시 적용)`);
}

function activeSecurityDPBonus(state, p) {
  const pl = state.players[p];
  return (pl.securityDPMods || []).filter(m => m.expiresAfterTurn === 'permanent' || m.expiresAfterTurn >= state.turnNumber)
    .reduce((sum, m) => sum + m.amount, 0);
}

// Temporary reduction to the NEXT matching evolution's cost. Consulted by
// the UI when computing/pre-filling an evolution's cost.
export function addEvoCostMod(state, p, delta, filter, expiresAfterTurn) {
  const pl = state.players[p];
  pl.evoCostMods = pl.evoCostMods || [];
  pl.evoCostMods.push({ delta, filter, expiresAfterTurn, usedUp: false });
  log(state, `${p} 다음 조건에 맞는 진화 코스트 ${delta}: ${JSON.stringify(filter)}`);
}

// "상대는 지불하는 진화 코스트를 마이너스할 수 없다." — printed on player A's
// card, locking player B (A's opponent) out of evolution-cost reductions
// while active. Same continuous 자신/상대/서로의 턴 family, but the ability
// lives on the OPPONENT's board relative to the player being checked, so
// tags are read from ITS controller's perspective (자신의 턴 = the locking
// player's own turn).
function isEvoCostLocked(state, p) {
  const lockOwner = opponentOf(p);
  const pl = state.players[lockOwner];
  for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === lockOwner);
        if (!active) continue;
        if (/^상대는\s*지불하는\s*진화\s*코스트를?\s*마이너스할\s*수\s*없다\.?$/.test(seg.body.trim())) return true;
      }
    }
  }
  return false;
}

// "서로는 지불하는 등장 코스트를 마이너스할 수 없다." (BT8-071/ST12-03/
// ST13-08/EX7-015, all 서로의 턴) — symmetric play-cost-discount lock, unlike
// isEvoCostLocked's opponent-only form. Scans BOTH players' boards since
// either side's copy of this ability locks everyone equally.
function isPlayCostLocked(state) {
  for (const owner of ['A', 'B']) {
    const pl = state.players[owner];
    for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
      for (const { id, own } of stackContributors(stack)) {
        const text = own ? card(id).effectKo : card(id).inheritedKo;
        if (!text) continue;
        const { segments } = parseEffectSegments(text);
        for (const seg of segments) {
          if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
          const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === owner);
          if (!active) continue;
          if (/^서로는\s*지불하는\s*등장\s*코스트를?\s*마이너스할\s*수\s*없다\.?$/.test(seg.body.trim())) return true;
        }
      }
    }
  }
  return false;
}

// "이 디지몬이 특징 「X」를 가진 디지몬 카드로 진화할 때, 지불하는 코스트
// -N." — a CONTINUOUS evolution-cost discount conditioned on the TARGET
// card's trait, unlike the one-shot addEvoCostMod/consumeEvoCostMod pair
// above (which models a temporary discount an effect grants once, then
// consumes). Checked directly at cost-calculation time instead.
export function continuousEvoCostDiscount(state, p, stack, targetCardId) {
  const tgt = card(targetCardId);
  let total = 0;
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const body = seg.body.trim().replace(/^\[턴\s*\d+\s*회\]\s*/, '');
      const m = body.match(/^이\s*디지몬이\s*특징\s*「([^」]+)」(?:\/「([^」]+)」)?\s*(?:을|를)?\s*가진\s*디지몬\s*카드로\s*진화할\s*때,?\s*지불하는\s*코스트\s*(-\d+)\.?$/);
      if (!m) continue;
      const traits = [m[1], m[2]].filter(Boolean);
      if (traits.some(tr => (tgt.types || []).some(t => t.includes(tr)))) total += Number(m[3]);
    }
  }
  return total;
}

// "자신의 패에서 특징 「X」를 가진 디지몬 카드가 등장할 때, 이 테이머를
// 레스트시키는 것으로, 지불하는 코스트 -N." (ST20-12/ST20-13/ST21-12/
// ST21-13, all 자신의 턴) — an embedded "~할 때" trigger nested inside a
// continuous turn wrapper, paid for by resting the Tamer itself. Optional
// in principle, but since the discount is strictly beneficial and this
// engine's play flow isn't set up for a mid-play choice, auto-applies to
// the first eligible (non-suspended, trait-matching) Tamer found — mutates
// state by resting it as a side effect of computing the discount.
export function tamerPlayCostDiscount(state, p, targetCardId) {
  if (isPlayCostLocked(state)) return 0;
  const tgt = card(targetCardId);
  const pl = state.players[p];
  for (const stack of pl.battle) {
    if (stack.suspended || card(stack.cardId).category !== 'tamer') continue;
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || seg.tags[0] !== '자신의 턴') continue;
        if (state.activePlayer !== p) continue;
        const m = seg.body.trim().match(/^자신(?:의)?\s*패에서\s*특징\s*「([^」]+)」\s*(?:을|를)?\s*가진\s*디지몬\s*카드가\s*등장할\s*때,?\s*이\s*테이머를\s*레스트시키는\s*것으로,?\s*지불하는\s*코스트\s*(-\d+)\.?$/);
        if (!m) continue;
        if (!(tgt.types || []).some(t => t.includes(m[1]))) continue;
        restStack(state, p, stack.uid);
        log(state, `${p} ${card(stack.cardId).nameKo} 레스트 — ${tgt.nameKo} 등장 코스트 ${m[2]}`);
        return Number(m[2]);
      }
    }
  }
  return 0;
}

// "자신이 발휘하는 DP 소멸 효과의 상한+N." — raises the DP ceiling on this
// PLAYER's own "destroy Digimon with DP N 이하" effects (checked at the
// point a 'destroy' instruction with a dpMax filter actually runs, added to
// that filter). Scoped to the bare, unconditioned form only — several real
// prints instead scale by a per-source/trash count within the SAME
// sentence as the destroy action itself, not attempted here.
export function dpDestroyCapBoost(state, p) {
  const pl = state.players[p];
  let total = 0;
  for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
        if (!active) continue;
        const m = seg.body.trim().match(/^자신이?\s*발휘하는\s*DP\s*소멸\s*효과의?\s*상한\s*\+(\d+)\.?$/);
        if (m) total += Number(m[1]);
      }
    }
  }
  return total;
}

// Returns the best (most negative) still-valid, one-time cost delta for
// evolving INTO `targetCardId`, and marks it consumed. Call this exactly
// once per resolved evolution.
export function consumeEvoCostMod(state, p, targetCardId) {
  if (isEvoCostLocked(state, p)) return 0;
  const pl = state.players[p];
  const c = card(targetCardId);
  const mods = (pl.evoCostMods || []).filter(m => !m.usedUp && (m.expiresAfterTurn === 'permanent' || m.expiresAfterTurn >= state.turnNumber));
  for (const m of mods) {
    const f = m.filter || {};
    if (f.colors && !(c.colors || []).some(col => f.colors.includes(col))) continue;
    if (f.nameIncludes && !c.nameKo.includes(f.nameIncludes)) continue;
    if (f.fromLevel && f.toLevel && !(c.level === f.toLevel)) continue;
    m.usedUp = true;
    return m.delta;
  }
  return 0;
}

export function trashEvoSources(state, p, uid, count) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return [];
  const n = count === 'all' ? stack.sources.length : Math.min(count, stack.sources.length);
  const removed = stack.sources.splice(0, n); // sources[] is oldest-first; "from the bottom" = earliest pushed
  pl.trash.push(...removed);
  log(state, `${p} ${card(stack.cardId).nameKo} 진화원 ${removed.length}장 파기`);
  for (const id of removed) applyOverflowIfAny(state, p, id);
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  return removed;
}

// Schedule an effect to run automatically when the CURRENT active player's
// turn ends (e.g. "gain 3 memory now; lose 3 at end of turn").
export function scheduleEndOfTurn(state, fn) {
  state.endOfTurnEffects = state.endOfTurnEffects || [];
  state.endOfTurnEffects.push({ turnNumber: state.turnNumber, fn });
}

export function runEndOfTurnEffects(state) {
  const due = (state.endOfTurnEffects || []).filter(e => e.turnNumber === state.turnNumber);
  state.endOfTurnEffects = (state.endOfTurnEffects || []).filter(e => e.turnNumber !== state.turnNumber);
  for (const e of due) e.fn();
}

// Clear temporary DP/keyword grants that expired at the end of THIS turn
// (called from engine.endTurn, after runEndOfTurnEffects).
export function clearExpiredModifiers(state) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
      if (stack.dpExpiry && stack.dpExpiry !== 'permanent' && stack.dpExpiry <= state.turnNumber) {
        stack.tempDP = 0; stack.dpExpiry = null;
        ruleCheckDP(state, p, stack); // 17-1-3: a positive buff expiring can newly reveal a DP≤0 rule check
      }
      if (stack.keywordExpiry) {
        for (const [kw, exp] of Object.entries(stack.keywordExpiry)) {
          if (exp !== 'permanent' && exp <= state.turnNumber) { delete stack.keywords[kw]; delete stack.keywordExpiry[kw]; }
        }
      }
    }
  }
}

export function playDigimonFresh(state, p, handIndex, opts = {}) {
  const pl = state.players[p];
  const [id] = pl.hand.splice(handIndex, 1);
  if (!id) return null;
  const stack = makeStack(id, state.turnNumber);
  recomputeStackGrants(stack); // picks up any keyword the card innately has on its own printed text
  pl.battle.push(stack);
  log(state, `${p} ${card(id).nameKo} 신규 등장 (배틀 에어리어)`);
  queueTriggersForStack(state, p, stack, 'play');
  return stack;
}

// Using an Option card (9-1) is a distinct action from playing/evolving a
// Digimon. Per 9-1-4/9-1-5, while its first 【메인】 effect is resolving the
// card belongs to no zone; if it still belongs to no zone once that effect
// finishes, it's immediately trashed. We approximate this by trashing it
// up front — a script instruction like 'placeThisInBattle' (for cards that
// say "그 후 이 카드를 배틀 에어리어에 놓는다") relocates it out of the trash
// when it resolves.
export function useOptionCard(state, p, handIndex) {
  const pl = state.players[p];
  const [id] = pl.hand.splice(handIndex, 1);
  if (!id) return null;
  const cost = card(id).cost || 0;
  if (cost > 0) spendMemory(state, cost);
  pl.trash.push(id);
  log(state, `${p} ${card(id).nameKo} 사용 (코스트${cost})`);
  queueTriggersFor(state, p, id, 'use');
  return id;
}

export function placeThisInBattle(state, p, cardId) {
  const pl = state.players[p];
  const idx = pl.trash.lastIndexOf(cardId);
  if (idx !== -1) pl.trash.splice(idx, 1);
  // makeStack(), not a bespoke literal — a bare {uid,cardId,sources,...}
  // object missing tempDP/keywords/extraColors/etc crashes the moment this
  // newly-placed stack's own effect grants it a keyword or color (same bug
  // already fixed once for fuseStacks earlier this session).
  const stack = makeStack(cardId, state.turnNumber);
  recomputeStackGrants(stack);
  pl.battle.push(stack);
  log(state, `${p} ${card(cardId).nameKo}을(를) 배틀 에어리어에 놓음`);
  return stack;
}

// 16-17: ≪딜레이≫ — "while this card sits in the battle area, you may
// discard it to activate the effect(s) listed below it (bullet lines
// starting with '·')"; not usable the turn it was placed. Printed as its
// own separate 【메인】 segment on the SAME card that placeThisInBattle put
// there, distinct from that card's ordinary immediate-use 【메인】 effect —
// finding it here (rather than through the normal queueTriggersFor('use')
// path, which would incorrectly let it fire immediately on use) is what
// keeps the two apart.
export function parseDelayEffect(effectKo) {
  if (!effectKo) return null;
  const { segments } = parseEffectSegments(effectKo);
  for (const seg of segments) {
    if (!seg.tags.includes('메인')) continue;
    const m = seg.body.match(/^[≪《]\s*딜레이\s*[≫》]\s*\([^()]*\)\s*\n\s*(·.+)$/s);
    if (m) return m[1].replace(/^·\s*/, '').trim();
  }
  return null;
}

// Discards a battle-area stack (no evolution sources expected on these —
// they're placed Option cards) and returns the effect text to run.
export function discardForDelay(state, p, uid) {
  const pl = state.players[p];
  const idx = pl.battle.findIndex(s => s.uid === uid);
  if (idx === -1) return null;
  const [stack] = pl.battle.splice(idx, 1);
  pl.trash.push(...stack.sources, stack.cardId);
  log(state, `${p} ${card(stack.cardId).nameKo} 딜레이 효과 발동 (파기)`);
  return stack.cardId;
}

// Same trash -> hand pull as saveCardUnderTamer/placeThisInBattle: a card
// revealed via security check (or used as an Option) that says "이 카드를
// 패에 추가한다." was already pushed to pl.trash before this trigger queued.
export function addSelfToHand(state, p, cardId) {
  const pl = state.players[p];
  const idx = pl.trash.lastIndexOf(cardId);
  if (idx === -1) return false;
  pl.trash.splice(idx, 1);
  pl.hand.push(cardId);
  log(state, `${p} ${card(cardId).nameKo}을(를) 패에 추가`);
  return true;
}

// ---- Arts Digivolve (4-20) ----
// A DUAL-type card is simultaneously an Option and a Digimon. Per 9-1-5, an
// Option normally gets trashed after its last effect resolves if it still
// belongs to no zone — but a DUAL card can instead evolve for free onto an
// eligible in-play Digimon (becoming its new top card) in place of that
// trash step. STUB, intentionally unwired to any UI/compiler pattern: as of
// this dataset's snapshot (raw dump cardType enum is only
// DIGITAMA/DIGIMON/TAMER/OPTION — zero DUAL cards, zero "아츠진화" text hits
// anywhere), there is no real card to verify the condition-line wording
// against, so this mirrors digivolve()'s mechanics on a best-effort basis
// and should be re-checked against dgchub data once a real DUAL card ships.
export function artsDigivolve(state, p, dualCardId, targetStackUid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === targetStackUid ? pl.raising : pl.battle.find(s => s.uid === targetStackUid);
  if (!stack) return null;
  const idx = pl.trash.lastIndexOf(dualCardId); // useOptionCard already provisionally trashed it
  if (idx !== -1) pl.trash.splice(idx, 1);
  discardLinkCardsOnNewCard(state, p, stack);
  stack.sources.push(stack.cardId);
  stack.cardId = dualCardId;
  log(state, `${p} 《아츠진화》: ${card(dualCardId).nameKo}으로 무료 진화 (DUAL 카드)`);
  drawCards(state, p, 1); // universal digivolve bonus draw
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  queueTriggersForStack(state, p, stack, 'digivolve');
  return stack;
}

export function hatchDigitama(state, p) {
  const pl = state.players[p];
  if (state.breedingActionTaken) { log(state, `${p} 이번 육성 페이즈에는 이미 부화/이동 중 하나를 했어서 더 못함`); return null; }
  if (pl.raising) { log(state, `${p} 육성 에어리어에 이미 카드가 있어 부화 불가`); return null; }
  const id = pl.digitamaDeck.shift();
  if (!id) return null;
  pl.raising = makeStack(id, state.turnNumber);
  recomputeStackGrants(pl.raising);
  state.breedingActionTaken = true;
  log(state, `${p} 디지타마 부화: ${card(id).nameKo}`);
  return pl.raising;
}

export function moveRaisingToBattle(state, p) {
  const pl = state.players[p];
  if (state.breedingActionTaken) { log(state, `${p} 이번 육성 페이즈에는 이미 부화/이동 중 하나를 했어서 더 못함`); return null; }
  if (!pl.raising) return null;
  const c = card(pl.raising.cardId);
  if ((c.level || 0) < 3) { log(state, `${p} ${c.nameKo}는 Lv.3 미만이라 이동 불가`); return null; }
  const stack = pl.raising;
  pl.battle.push(stack);
  pl.raising = null;
  state.breedingActionTaken = true;
  log(state, `${p} ${c.nameKo} 육성→배틀 에어리어 이동`);
  queueTriggersForStack(state, p, stack, 'move');
  return true;
}

// Digivolve an existing stack (in raising or battle) using a card from hand,
// from trash/security(engine caller resolves sourcing), or "free" (no card
// removed from hand — used for search/without-paying-cost effects).
export function digivolve(state, p, stackUid, newCardId, cost, source = 'hand') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === stackUid ? pl.raising : pl.battle.find(s => s.uid === stackUid);
  if (!stack) return null;
  if (source === 'hand') {
    const idx = pl.hand.indexOf(newCardId);
    if (idx === -1) { log(state, `핸드에 ${newCardId} 없음`); return null; }
    pl.hand.splice(idx, 1);
  }
  discardLinkCardsOnNewCard(state, p, stack); // 10-4-1: this stack is about to become a new card
  stack.sources.push(stack.cardId);
  stack.cardId = newCardId;
  if (cost > 0) spendMemory(state, cost);
  log(state, `${p} ${card(stack.sources[stack.sources.length-1]).nameKo} → ${card(newCardId).nameKo} 진화 (코스트${cost}, 출처:${source})`);
  drawCards(state, p, 1); // universal digivolve bonus draw
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  // 【진화 시】/【등장 시】 (and any equivalent inherited from evolution
  // sources) only fire while the resulting card is actually in the battle
  // area — evolving a card that's still sitting in the raising area (legal,
  // just uncommon) doesn't trigger them.
  if (pl.battle.includes(stack)) queueTriggersForStack(state, p, stack, 'digivolve');
  return stack;
}

// DNA / Jogress: combine two stacks into one new stack.
export function fuseStacks(state, p, uidA, uidB, newCardId, cost, source = 'hand') {
  const pl = state.players[p];
  const idxA = pl.battle.findIndex(s => s.uid === uidA);
  const idxB = pl.battle.findIndex(s => s.uid === uidB);
  if (idxA === -1 || idxB === -1) return null;
  const [a] = pl.battle.splice(idxA, 1);
  const bIdx = pl.battle.findIndex(s => s.uid === uidB);
  const [b] = pl.battle.splice(bIdx, 1);
  discardLinkCardsOnNewCard(state, p, a); // 10-4-1: both materials become part of a new card
  discardLinkCardsOnNewCard(state, p, b);
  if (source === 'hand') {
    const hi = pl.hand.indexOf(newCardId);
    if (hi === -1) { log(state, `핸드에 ${newCardId} 없음`); pl.battle.push(a, b); return null; }
    pl.hand.splice(hi, 1);
  }
  // Built via makeStack (not a bespoke literal) so the fused result carries
  // the same field set as every other stack (tempDP/keywords/extraColors/
  // linkCards/etc.) — a bare {uid,cardId,sources,suspended,attackEligibleTurn}
  // object crashes the moment its own "진화 시" effect grants it a keyword or
  // color, since grantKeyword/grantColor assume those fields already exist.
  const fused = makeStack(newCardId, state.turnNumber);
  fused.sources = [...a.sources, a.cardId, ...b.sources, b.cardId];
  fused.suspended = false; // DNA digivolve results always enter unsuspended
  fused.attackEligibleTurn = state.turnNumber; // DNA/Jogress results can attack immediately
  pl.battle.push(fused);
  if (cost > 0) spendMemory(state, cost);
  log(state, `${p} DNA/조그레스 진화: ${card(a.cardId).nameKo}+${card(b.cardId).nameKo} → ${card(newCardId).nameKo} (코스트${cost})`);
  drawCards(state, p, 1); // universal digivolve bonus draw
  recomputeStackGrants(fused);
  ruleCheckDP(state, p, fused);
  queueTriggersForStack(state, p, fused, 'digivolve');
  return fused;
}

// 16-20: ≪세이브≫ ("you may place this card under one of your own Tamers"
// instead of it going to the trash). By the time a 【소멸 시】 trigger for
// this card resolves, deleteStack() has already pushed it into pl.trash —
// so this just pulls it back out and restacks it under the chosen Tamer,
// the same way an evolution source stacks under a Digimon (Tamer stacks
// use the identical makeStack() shape, `sources` included).
export function saveCardUnderTamer(state, p, cardId, tamerUid) {
  const pl = state.players[p];
  const tamerStack = pl.battle.find(s => s.uid === tamerUid && card(s.cardId).category === 'tamer');
  if (!tamerStack) return false;
  const idx = pl.trash.lastIndexOf(cardId);
  if (idx === -1) return false;
  pl.trash.splice(idx, 1);
  tamerStack.sources.push(cardId);
  log(state, `${p} ${card(cardId).nameKo} 《세이브》 — ${card(tamerStack.cardId).nameKo} 아래에 놓음`);
  return true;
}

// "이 디지몬이 소멸할 때, 명칭에 「X」을 포함하는 다른 디지몬 1마리를
// 소멸시키는 것으로, 소멸하지 않는다." — a barrier paid for by sacrificing
// another same-name-family Digimon on the SAME board, instead of an
// interactive choice (deleteStack has no async path, and every real print
// of this ability only ever asks for exactly 1 substitute) auto-picks the
// first eligible one it finds. Returns true if the stack survived (caller
// must abort the destruction).
function trySurviveBySacrifice(state, p, stack) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const m = seg.body.trim().match(/^이\s*디지몬이\s*소멸할\s*때,?\s*명칭에\s*「([^」]+)」\s*(?:을|를)?\s*포함하는\s*다른\s*디지몬\s*(\d+)\s*마리를?\s*소멸시키는\s*것으로,?\s*소멸하지\s*않는다\.?$/);
      if (!m) continue;
      const [, nameIncludes, nStr] = m;
      const n = Number(nStr);
      const candidates = state.players[p].battle.filter(s => s !== stack && card(s.cardId).nameKo.includes(nameIncludes));
      if (candidates.length < n) continue;
      const sacrificed = candidates.slice(0, n);
      log(state, `${p} ${card(stack.cardId).nameKo} 소멸 대신 ${sacrificed.map(s => card(s.cardId).nameKo).join(', ')} 소멸 (생존 효과)`);
      for (const s of sacrificed) deleteStack(state, p, s.uid);
      return true;
    }
  }
  return false;
}

export function deleteStack(state, p, uid, toZone = 'trash') {
  const pl = state.players[p];
  const peek = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (peek && trySurviveBySacrifice(state, p, peek)) return null;
  let stack = null;
  if (pl.raising?.uid === uid) { stack = pl.raising; pl.raising = null; }
  else {
    const idx = pl.battle.findIndex(s => s.uid === uid);
    if (idx !== -1) [stack] = pl.battle.splice(idx, 1);
  }
  if (!stack) return null;
  const linkIds = (stack.linkCards || []).map(l => l.cardId);
  const all = [...stack.sources, stack.cardId, ...linkIds];
  if (toZone === 'trash') pl.trash.push(...all);
  log(state, `${p} ${card(stack.cardId).nameKo} 스택 소멸 (진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 포함, 총 ${all.length}장 트래시)`);
  (state.pendingVanishFlash ||= []).push(card(stack.cardId).nameKo);
  // Overflow (4-19-1) only covers cards leaving the area or leaving being
  // stacked underneath a card — Link Cards are neither (4-9-1/4-9-4), so
  // they're excluded here even though they're trashed alongside the stack.
  for (const id of [...stack.sources, stack.cardId]) applyOverflowIfAny(state, p, id);
  queueTriggersForStack(state, p, stack, 'delete');
  return all;
}

// Retreat (de-evolve) N stages: peel top cards off the stack back to trash,
// revealing the previous card each time. Returns list of trashed card ids.
export function retreat(state, p, uid, stages) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return [];
  const trashed = [];
  for (let i = 0; i < stages; i++) {
    if (stack.sources.length === 0) break; // nothing left to peel
    trashed.push(stack.cardId);
    stack.cardId = stack.sources.pop();
  }
  if (trashed.length) {
    discardLinkCardsOnNewCard(state, p, stack); // the peeled-off top's link cards go too — it's no longer the host
    state.players[p].trash.push(...trashed);
    log(state, `${p} ${trashed.map(id=>card(id).nameKo).join(',')} 퇴화(트래시), 현재 최상단: ${card(stack.cardId).nameKo}`);
    for (const id of trashed) applyOverflowIfAny(state, p, id);
    recomputeStackGrants(stack);
    ruleCheckDP(state, p, stack);
  } else {
    log(state, `${p} 퇴화 시도했지만 벗길 진화원이 없어 효과 없음`);
  }
  return trashed;
}

// ---- attack / security check ----

// Mark a stack as unable to attack. `scope`: 'permanent' (printed static
// ability, e.g. "이 디지몬은 어택할 수 없다") or a turn number after which the
// restriction lifts (for "다음 상대의 턴 종료 시까지" style option effects).
export function restrictAttack(state, p, uid, expiresAfterTurn = 'permanent') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.cannotAttackUntil = expiresAfterTurn;
  log(state, `${p} ${card(stack.cardId).nameKo} 어택 불가 상태 부여`);
}

// Narrower than restrictAttack — "플레이어에게 어택할 수 없다." only blocks
// declaring the attack AGAINST THE PLAYER; this stack can still declare a
// direct attack against an eligible opposing Digimon.
export function restrictAttackPlayer(state, p, uid, expiresAfterTurn = 'permanent') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.cannotAttackPlayerUntil = expiresAfterTurn;
  log(state, `${p} ${card(stack.cardId).nameKo} 플레이어 공격 불가 상태 부여`);
}

// "이 디지몬은 플레이어에게 어택할 수 없다." printed as a bare continuous
// 자신/상대/서로의 턴 ability (as opposed to the temporary one-shot-triggered
// form above, which uses cannotAttackPlayerUntil instead).
function isAttackPlayerRestrictedByAbility(state, p, stack) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      if (/^이\s*디지몬은\s*플레이어에게\s*어택할\s*수\s*없다\.?$/.test(seg.body.trim())) return true;
    }
  }
  return false;
}

// "이 디지몬은 (진화원을 갖지 않은) 상대의 디지몬에게는 블록당하지 않는다."
// Same continuous 자신/상대/서로의 턴 family — checked per-blocker since the
// no-evo-source qualifier depends on which specific stack would block.
export function cannotBeBlockedBy(state, p, uid, blockerStack) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return false;
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const body = seg.body.trim();
      if (/^이\s*디지몬은[,]?\s*블록당하지\s*않는다\.?$/.test(body)) return true;
      if (/^이\s*디지몬은[,]?\s*상대(?:의)?\s*디지몬에게는\s*블록당하지\s*않는다\.?$/.test(body)) return true;
      if (/^이\s*디지몬은[,]?\s*진화원을?\s*갖지\s*않은\s*상대(?:의)?\s*디지몬에게는\s*블록당하지\s*않는다\.?$/.test(body) && blockerStack.sources.length === 0) return true;
    }
  }
  return false;
}

export function canAttackPlayer(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return true;
  if (stack.cannotAttackPlayerUntil === 'permanent' || (typeof stack.cannotAttackPlayerUntil === 'number' && state.turnNumber <= stack.cannotAttackPlayerUntil)) return false;
  return !isAttackPlayerRestrictedByAbility(state, p, stack);
}

// Opponent Digimon this attacker is legally allowed to target directly
// (instead of attacking the player). Official base rule (11-2-7-1): the
// target must be a RESTED (suspended) opposing Digimon. Some cards grant an
// exception letting the attacker also target ACTIVE opposing Digimon that
// have no evolution sources — tracked via the '무진화원액티브공격' keyword.
export function legalDigimonTargets(state, attackerP, attackerUid) {
  const opp = opponentOf(attackerP);
  const apl = state.players[attackerP];
  const aStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  const canHitActiveNoSource = aStack && hasKeyword(aStack, '무진화원액티브공격');
  // Unconditional variant — no "no evolution sources" restriction at all
  // (e.g. "이 디지몬은 액티브 상태의 상대 디지몬에게도 어택할 수 있다."),
  // either as a one-shot triggered grant (액티브공격 keyword) or the more
  // common continuous 자신의 턴-conditioned form (canAttackAnyActive).
  const canHitActiveAny = aStack && (hasKeyword(aStack, '액티브공격') || canAttackAnyActive(state, attackerP, aStack));
  return state.players[opp].battle
    .filter(s => s.suspended || canHitActiveAny || (canHitActiveNoSource && s.sources.length === 0))
    .map(s => s.uid);
}

// "[턴에 N회] 이 디지몬이 배틀에서 상대의 디지몬을 소멸시켰을 때, 상대의
// 시큐리티를 위에서부터 N장 파기한다." — an embedded one-shot "~했을 때"
// trigger nested inside a continuous 자신/상대/서로의 턴 wrapper (so it's
// only live during that turn window), not a bracket-tagged trigger the
// normal queueTriggersFor pipeline would ever see. Confirmed 19 occurrences
// via the full-DB audit, always this exact shape.
function parseBattleWinTrigger(text) {
  const out = [];
  if (!text) return out;
  const { segments } = parseEffectSegments(text);
  for (const seg of segments) {
    if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
    const body = seg.body.trim();
    const limitM = body.match(/^\[턴\s*에?\s*(\d+)\s*회\]\s*(.*)$/s);
    const limit = limitM ? Number(limitM[1]) : null;
    const rest = (limitM ? limitM[2] : body).trim();
    const m = rest.match(/^이\s*디지몬이\s*배틀에서\s*상대(?:의)?\s*디지몬을\s*소멸시켰을\s*때,?\s*상대(?:의)?\s*시큐리티를\s*위에서부터\s*(\d+)\s*장\s*파기한다\.?$/);
    if (m) out.push({ tag: seg.tags[0], limit, n: Number(m[1]) });
  }
  return out;
}

function runBattleWinTriggers(state, p, stack) {
  const oppP = opponentOf(p);
  for (const { id, own } of stackContributors(stack)) {
    for (const g of parseBattleWinTrigger(own ? card(id).effectKo : card(id).inheritedKo)) {
      const active = g.tag === '서로의 턴' || (g.tag === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      if (g.limit != null) {
        const key = onceLimitKey(id, ['배틀승리시큐리티파기']);
        if (turnUsesRemaining(stack, key, g.limit) <= 0) continue;
        markTurnEffectUsed(stack, key);
      }
      for (let i = 0; i < g.n; i++) trashTopSecurityByEffect(state, oppP);
      log(state, `${p} ${card(stack.cardId).nameKo} 배틀 승리 효과: ${oppP} 시큐리티 ${g.n}장 파기`);
    }
  }
}

export function resolveDigimonBattle(state, attackerP, attackerUid, defenderUid) {
  const defenderP = opponentOf(attackerP);
  const apl = state.players[attackerP], dpl = state.players[defenderP];
  const aStack = apl.battle.find(s => s.uid === attackerUid);
  const dStack = dpl.battle.find(s => s.uid === defenderUid);
  if (!aStack || !dStack) return null;
  const attackerCardId = aStack.cardId, defenderCardId = dStack.cardId;
  const aDp = effectiveDP(state, attackerP, aStack), dDp = effectiveDP(state, defenderP, dStack);
  let result;
  if (aDp > dDp) result = 'attackerWins';
  else if (aDp < dDp) result = 'defenderWins';
  else result = 'tie';
  log(state, `${attackerP} ${card(aStack.cardId).nameKo}(DP${aDp}) vs ${defenderP} ${card(dStack.cardId).nameKo}(DP${dDp}) → ${result}`);
  const destroyedOnlyOpponent = result === 'attackerWins';
  if (result === 'attackerWins') runBattleWinTriggers(state, attackerP, aStack);
  if (result === 'defenderWins' || result === 'tie') deleteStack(state, attackerP, attackerUid);
  if (result === 'attackerWins' || result === 'tie') deleteStack(state, defenderP, defenderUid);
  const piercing = hasKeyword(aStack, '관통');
  return { result, aDp, dDp, attackerCardId, defenderCardId, destroyedOnlyOpponent, piercing, attackerSurvived: result === 'attackerWins' };
}

export function declareAttack(state, attackerP, stackUid) {
  const pl = state.players[attackerP];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (!stack || stack.suspended) return { ok: false, reason: 'invalid or suspended attacker' };
  // 16-?: ≪속공≫ (Rush) is the printed exception to "a Digimon that
  // entered play this turn can't attack" (1-3-1 names this exact case as
  // the canonical example of card text overriding the base rule).
  if (state.turnNumber < stack.attackEligibleTurn && !hasKeyword(stack, '속공')) {
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 이번 턴에 등장/원본이 플레이된 카드라 공격 불가`);
    return { ok: false, reason: 'entered play this turn' };
  }
  if (stack.cannotAttackUntil === 'permanent' || (typeof stack.cannotAttackUntil === 'number' && state.turnNumber <= stack.cannotAttackUntil)) {
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 어택 불가 상태라 공격할 수 없음`);
    return { ok: false, reason: 'attack restricted' };
  }
  stack.suspended = true;
  log(state, `${attackerP} ${card(stack.cardId).nameKo}(DP${card(stack.cardId).dp}) 공격 선언`);
  return { ok: true, stack };
}

// Resolve a security check once a blocker decision has been made (or none
// available). Handles the standard DP-compare + tie rule; caller applies
// Barrier / other keyword saves separately via retreat-less deleteStack calls.
// Checks 1 + <Security Attack> bonus cards (from the attacker's keyword,
// if any). Jamming means the attacker is never deleted by a security
// digimon. Stops early if the defender is emptied out mid-sequence (a
// following check on an empty stack is what actually ends the game).
export function resolveSecurityCheck(state, attackerP, attackerUid, defenderP) {
  const apl = state.players[attackerP];
  const attackerStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  const attackerDp = attackerStack ? effectiveDP(state, attackerP, attackerStack) : 0;
  const jamming = attackerStack ? hasKeyword(attackerStack, '재밍') : false;
  const checks = 1 + (attackerStack ? securityAttackBonus(attackerStack) : 0);
  const pl = state.players[defenderP];
  const results = [];
  for (let i = 0; i < checks; i++) {
    if (pl.security.length === 0) {
      // 1-2-3-1: the win condition is "security was already 0 the moment
      // this attack was established" — i.e. before the FIRST check of this
      // attack. Running out of cards partway through this SAME attack's
      // extra checks (from a 《시큐리티 어택 +N》 bonus) isn't that: per
      // 1-3-2, being asked to do more checks than cards exist just means
      // doing as many as possible, not an instant loss (13-1-2/1-3-2).
      if (i === 0) {
        state.winner = attackerP;
        log(state, `${defenderP} 시큐리티 0에서 피격 — ${attackerP} 승리!`);
        results.push({ empty: true });
        return { checks: results, gameOver: true };
      }
      log(state, `${defenderP} 시큐리티가 ${i}장에서 바닥나 이 어택의 남은 체크(${checks - i}회분)는 진행 못함`);
      break;
    }
    const id = pl.security.shift();
    pl.trash.push(id);
    const suppressSecurityEffect = attackerStack && hasKeyword(attackerStack, '옵션시큐리티효과무효') && card(id).category === 'option';
    if (!suppressSecurityEffect) {
      // A card's 【시큐리티】 text is very often printed in the SAME "not the
      // active top card" box as its 진화원(evolution-source) effects
      // (inheritedKo/sourceEffect) — real examples confirmed (ST1-12/13/14/
      // 15). Scanning only effectKo silently missed all of these. There's
      // no stack for a card being revealed straight from security, so pass
      // stackUid=null.
      queueTriggersFor(state, defenderP, id, 'security');
      queueInheritedTriggersFor(state, defenderP, id, 'security', null);
    } else {
      log(state, `${attackerP} 효과로 이번 체크의 【시큐리티】 효과 무효화`);
    }
    const secDp = (card(id).dp || 0) + activeSecurityDPBonus(state, defenderP);
    let result;
    if (attackerDp > secDp) result = 'attackerWins';
    else if (attackerDp < secDp) result = jamming ? 'jammedSurvive' : 'defenderWins';
    else result = jamming ? 'jammedSurvive' : 'tie';
    log(state, `${defenderP} 시큐리티 체크(${i + 1}/${checks}): ${card(id).nameKo}(DP${secDp}) vs 공격측 DP${attackerDp}${jamming ? ' [재밍]' : ''} → ${result}`);
    results.push({ empty: false, revealed: id, secDp, result });
    if (result === 'defenderWins' || result === 'tie') break; // attacker died (unless saved) — remaining checks don't happen
  }
  return { checks: results, gameOver: false };
}
