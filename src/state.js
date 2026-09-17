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
function tryAutoApplySegment(state, p, text) {
  const opp = opponentOf(p);
  const t = text.replace(/[≪《》≫]/g, '').trim();
  let m;
  if ((m = t.match(/^(\d+)\s*드로우(?:한다)?[.。]?$/))) { drawCards(state, p, Number(m[1])); return true; }
  if ((m = t.match(/^메모리(?:를|을)?\s*\+\s*(\d+)(?:한다)?[.。]?$/))) { grantMemory(state, p, Number(m[1])); return true; }
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
    const applied = tryAutoApplySegment(state, p, seg.body);
    if (applied) {
      log(state, `(자동 처리) ${card(cardId).nameKo} 【${seg.tags.join('】【')}】: ${seg.body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId, stackUid, tags: seg.tags, text: seg.body, resolved: false });
    }
  }
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
    const applied = tryAutoApplySegment(state, p, seg.body);
    if (applied) {
      log(state, `(자동 처리, 진화원효과: ${c.nameKo}) 【${seg.tags.join('】【')}】: ${seg.body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: sourceCardId, stackUid, tags: seg.tags, text: seg.body, resolved: false, inherited: true });
    }
  }
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

// Direct memory grant (e.g. a card's "gain 1 memory"), respecting the same
// sign convention: grants to `p` move the gauge toward p's own side.
export function grantMemory(state, p, amount) {
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

export function effectiveDP(stack) {
  return (card(stack.cardId).dp || 0) + (stack.tempDP || 0) + (stack.inheritedDP || 0);
}

export function securityAttackBonus(stack) {
  const own = stack.keywords?.['시큐리티어택'] ? Number(stack.keywords['시큐리티어택']) || 0 : 0;
  const inherited = stack.inheritedKeywords?.['시큐리티어택'] ? Number(stack.inheritedKeywords['시큐리티어택']) || 0 : 0;
  return own + inherited;
}

export function hasKeyword(stack, name) {
  return !!(stack.keywords && stack.keywords[name]) || !!(stack.inheritedKeywords && stack.inheritedKeywords[name]);
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
    if (['재밍', '블로커', '관통', '재기동'].includes(label)) { out.keywords[label] = true; continue; }
    // "S 어택" (abbreviated) and "시큐리티 어택" (spelled out, common on
    // beginner/starter-deck cards) are the same keyword.
    if ((m = label.match(/^(?:S|시큐리티)\s*어택\s*\+(\d+)$/))) { out.keywords['시큐리티어택'] = (out.keywords['시큐리티어택'] || 0) + Number(m[1]); continue; }
    if ((m = label.match(/^링크\+(\d+)$/))) { out.keywords['링크+'] = (out.keywords['링크+'] || 0) + Number(m[1]); continue; } // 4-9-5: raises the 1-per-Digimon Link Card cap
    // other bare keyword tokens (e.g. 《돌진》) intentionally left unmapped for now —
    // no existing engine flag consumes them; surfaced via the effect box only.
  }
  return out;
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
  const contributors = [
    { id: stack.cardId, own: true },
    ...stack.sources.map(id => ({ id, own: false })),
    ...(stack.linkCards || []).map(l => ({ id: l.cardId, own: false })),
  ];
  for (const { id, own } of contributors) {
    const g = parseStaticGrants(own ? card(id).effectKo : card(id).inheritedKo);
    dp += g.dp;
    secAtk += g.keywords['시큐리티어택'] || 0;
    linkCap += g.keywords['링크+'] || 0;
    for (const k of ['재밍', '블로커', '관통', '재기동']) if (g.keywords[k]) flags[k] = true;
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
  if (effectiveDP(stack) <= 0) {
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
  stack.suspended = true;
  log(state, `${p} ${card(stack.cardId).nameKo} 레스트`);
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

// Returns the best (most negative) still-valid, one-time cost delta for
// evolving INTO `targetCardId`, and marks it consumed. Call this exactly
// once per resolved evolution.
export function consumeEvoCostMod(state, p, targetCardId) {
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
  const stack = { uid: 'u' + Math.random().toString(36).slice(2), cardId, sources: [], suspended: false, attackEligibleTurn: state.turnNumber + 1 };
  recomputeStackGrants(stack);
  pl.battle.push(stack);
  log(state, `${p} ${card(cardId).nameKo}을(를) 배틀 에어리어에 놓음`);
  return stack;
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

export function deleteStack(state, p, uid, toZone = 'trash') {
  const pl = state.players[p];
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
  return state.players[opp].battle
    .filter(s => s.suspended || (canHitActiveNoSource && s.sources.length === 0))
    .map(s => s.uid);
}

export function resolveDigimonBattle(state, attackerP, attackerUid, defenderUid) {
  const defenderP = opponentOf(attackerP);
  const apl = state.players[attackerP], dpl = state.players[defenderP];
  const aStack = apl.battle.find(s => s.uid === attackerUid);
  const dStack = dpl.battle.find(s => s.uid === defenderUid);
  if (!aStack || !dStack) return null;
  const attackerCardId = aStack.cardId, defenderCardId = dStack.cardId;
  const aDp = effectiveDP(aStack), dDp = effectiveDP(dStack);
  let result;
  if (aDp > dDp) result = 'attackerWins';
  else if (aDp < dDp) result = 'defenderWins';
  else result = 'tie';
  log(state, `${attackerP} ${card(aStack.cardId).nameKo}(DP${aDp}) vs ${defenderP} ${card(dStack.cardId).nameKo}(DP${dDp}) → ${result}`);
  const destroyedOnlyOpponent = result === 'attackerWins';
  if (result === 'defenderWins' || result === 'tie') deleteStack(state, attackerP, attackerUid);
  if (result === 'attackerWins' || result === 'tie') deleteStack(state, defenderP, defenderUid);
  const piercing = hasKeyword(aStack, '관통');
  return { result, aDp, dDp, attackerCardId, defenderCardId, destroyedOnlyOpponent, piercing, attackerSurvived: result === 'attackerWins' };
}

export function declareAttack(state, attackerP, stackUid) {
  const pl = state.players[attackerP];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (!stack || stack.suspended) return { ok: false, reason: 'invalid or suspended attacker' };
  if (state.turnNumber < stack.attackEligibleTurn) {
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
  const attackerDp = attackerStack ? effectiveDP(attackerStack) : 0;
  const jamming = attackerStack ? hasKeyword(attackerStack, '재밍') : false;
  const checks = 1 + (attackerStack ? securityAttackBonus(attackerStack) : 0);
  const pl = state.players[defenderP];
  const results = [];
  for (let i = 0; i < checks; i++) {
    if (pl.security.length === 0) {
      state.winner = attackerP;
      log(state, `${defenderP} 시큐리티 0에서 피격 — ${attackerP} 승리!`);
      results.push({ empty: true });
      return { checks: results, gameOver: true };
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
