// Core game state model + primitive mutators.
// This module has NO knowledge of specific card effect text — it only
// implements the generic mechanics (zones, memory gauge, phases, evolution
// stacking, security checks). Card-specific effects are resolved manually
// through the generic tools exposed here (draw, trash, reveal, security
// add/remove, memory delta, de-evolve) and triggered from the UI.

import { HOOKS as CARD_HOOKS } from './cards/index.js';

export let CARDS = {};
export let DECKS = {};

export async function loadData() {
  const [cardsRes, decksRes] = await Promise.all([
    fetch('./data/cards_full.json'), // full official DB, transformed from dgchub.com export — see scripts/build-cards.mjs
    fetch('./data/decks.json'),
  ]);
  CARDS = await cardsRes.json();
  DECKS = await decksRes.json();
  // Upstream data error: a few cards list their OWN level as the required source level
  // (ST1-10 페닉스몬 "Lv.6" → nothing could ever evolve into it). A normal evolution source
  // is exactly one level below, so repair those entries.
  for (const c of Object.values(CARDS)) {
    if (c.category === 'digimon' && c.evoNormal && typeof c.evoNormal.level === 'number' && c.level > 3 && c.evoNormal.level >= c.level) {
      c.evoNormal = { ...c.evoNormal, level: c.level - 1, conditionText: `Lv.${c.level - 1}` };
    }
  }
  // s6: the dgchub trait list omits the 「어플몬」 trait on Appmon Digimon (only their app-category attribute
  // — 소셜/툴/내비/엔터테인먼트/시스템/게임/라이프 — survives in `attribute`); cards printing "특징 「어플몬」" need it.
  const APPMON_ATTR = new Set(['소셜', '툴', '내비', '엔터테인먼트', '시스템', '게임', '라이프']);
  for (const c of Object.values(CARDS)) {
    if (c.category === 'digimon' && APPMON_ATTR.has(c.attribute) && !(c.types || []).includes('어플몬')) c.types = [...(c.types || []), '어플몬'];
  }
  // s6: "〈룰〉특징: 유형 「수생형」을 가진다." — a printed rule line that adds traits to the card itself.
  for (const c of Object.values(CARDS)) {
    const text = `${c.effectKo || ''}\n${c.inheritedKo || ''}`;
    if (!text.includes('〈룰〉')) continue;
    for (const line of text.split('\n')) {
      if (!/^\s*〈룰〉\s*(?:특징|유형)\s*[:：]/.test(line) || !/가진다|갖는다|가진|갖는/.test(line)) continue;
      for (const m of line.matchAll(/「([^」]+)」/g)) if (!(c.types || []).includes(m[1])) c.types = [...(c.types || []), m[1]];
    }
  }
  // 2-3-1-4: 「ACE」 written in a card name is NOT part of its name (a 「메탈그레이몬」 reference also hits
  // 「메탈그레이몬 ACE」). Central fix: nameKo is the comparison name (ACE stripped); the printed name
  // stays in nameDisplayKo for UI display (cardChip, deck builder search).
  for (const c of Object.values(CARDS)) {
    if (typeof c.nameKo === 'string' && /\s*ACE$/.test(c.nameKo)) { c.nameDisplayKo = c.nameKo; c.nameKo = c.nameKo.replace(/\s*ACE$/, ''); }
  }
  S2.fixData(CARDS); // shard2: data repairs + pseudo cards (tokens)
}

export function card(id) {
  return CARDS[id] || { id, nameKo: id, category: 'unknown', colors: [], types: [] };
}

// ---- deck construction legality (1-4-1-2, 1-4-1-3, 2-3-4-5/6 〈룰〉카드 넘버) ----
// Card-number aliasing: "〈룰〉카드 넘버: 「P-058」로도 취급하며, 덱에 「P-058」과 합계 4장까지" — this card counts
// as (a copy of) another number for the deck limit. Returns the alias id or null.
export function cardNumberAlias(id) {
  const c = CARDS[id]; if (!c) return null;
  const m = `${c.effectKo || ''}\n${c.inheritedKo || ''}`.match(/〈룰〉\s*카드\s*넘버\s*[:：]\s*「([^」]+)」\s*(?:으로|로)도\s*취급/);
  return m ? m[1] : null;
}
// Deck-limit group key: cards that are treated as each other's number share one key (the smaller/base number).
export function deckLimitKey(id) { return cardNumberAlias(id) || id; }
export function maxCopiesFor(id) {
  // default 4 (1-4-1-2-2); 〈룰〉"이 카드와 동일한 카드 넘버의 카드는 덱에 N장까지" raises it
  const c = CARDS[id];
  const m = `${c?.effectKo || ''}\n${c?.inheritedKo || ''}`.match(/동일한\s*카드\s*넘버의\s*카드는\s*덱에\s*(\d+)\s*장\s*까지/);
  return m ? Number(m[1]) : 4;
}
// Copies of `id`'s limit-group already in {main, digitama} (aliases counted together).
export function copiesTowardLimit(deckDef, id) {
  const key = deckLimitKey(id);
  let n = 0;
  for (const zone of ['main', 'digitama']) for (const [cid, q] of Object.entries(deckDef[zone] || {})) if (deckLimitKey(cid) === key) n += q;
  return n;
}
// Full legality check of a {main, digitama} deck definition. Returns { ok, errors, mainN, digitamaN }.
export function deckLegality(deckDef) {
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const mainN = sum(deckDef.main), digitamaN = sum(deckDef.digitama);
  const errors = [];
  if (mainN !== 50) errors.push(`메인덱 ${mainN}/50장 (정확히 50장이어야 함, 룰 1-4-1-2-1)`);
  if (digitamaN > 5) errors.push(`디지타마덱 ${digitamaN}/5장 (5장 이하, 룰 1-4-1-3-1)`);
  const seen = new Set();
  for (const zone of ['main', 'digitama']) for (const id of Object.keys(deckDef[zone] || {})) {
    const cd = CARDS[id];
    if (!cd) { errors.push(`${id}: 알 수 없는 카드`); continue; }
    if (zone === 'main' && cd.category === 'digitama') errors.push(`${id} ${cd.nameKo}: 디지타마 카드는 디지타마덱에만 넣을 수 있음`);
    if (zone === 'digitama' && cd.category !== 'digitama') errors.push(`${id} ${cd.nameKo}: 디지타마덱에는 디지타마 카드만 넣을 수 있음`);
    const key = deckLimitKey(id);
    if (seen.has(key)) continue; seen.add(key);
    const n = copiesTowardLimit(deckDef, id);
    const lim = Math.max(...[id, ...Object.keys({ ...(deckDef.main || {}), ...(deckDef.digitama || {}) }).filter(o => deckLimitKey(o) === key)].map(maxCopiesFor));
    if (n > lim) errors.push(`${key === id ? id : `${id}(=${key})`} ${cd.nameKo}: ${n}장 (최대 ${lim}장, 룰 1-4-1-2-2/2-3-4-6)`);
  }
  return { ok: errors.length === 0, errors, mainN, digitamaN };
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
    // A line-start 【...】 inside a still-open "(" (e.g. a token's own printed abilities spelled out in
    // a parenthetical that wraps across lines) belongs to that sentence, not a new segment of this card.
    { const before = text.slice(0, boundaryIndex); if ((before.match(/[(（]/g) || []).length > (before.match(/[)）]/g) || []).length) continue; }
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
  return s7Bound({
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
  });
}

let pendingUid = 1;

// Shard-3 extension points: cards' bespoke code (src/cards/*.js) registers watchers here instead of
// growing more regex families in this file. EVENT_HOOKS run at the top of emitGameEvent for EVERY
// game event (play/digivolve/delete/rest/attack/discard plus the extra kinds 'attackEnd',
// 'attackTargetChanged', 'securityDecrease', 'securityIncrease', 'sourcePlaced').
export const EVENT_HOOKS = [];
// Queue an already-built pending effect item (uid is assigned here).
export function queuePending(state, item) {
  const it = { resolved: false, ...item, uid: 'p' + (pendingUid++) };
  state.pending.push(it);
  return it;
}

// Korean trigger-tag substrings (as printed in 【...】 brackets) that are
// relevant to a given game event. A segment is queued if ANY of its tags
// contains one of these substrings.
const TRIGGER_TAGS = {
  play: ['등장 시'],
  digivolve: ['진화 시'],
  delete: ['소멸 시'],
  attack: ['어택 시', '공격 시'],
  // "자신의/상대의" must be spelled out: a bare '메인 페이즈 개시 시' substring
  // would also match 【상대의 메인 페이즈 개시 시】 and fire it on the wrong side.
  mainPhaseStart: ['메인 페이즈 시작 시', '자신의 메인 페이즈 개시 시', '자신의 메인페이즈 개시시'],
  mainPhaseStartOpp: ['상대의 메인 페이즈 개시 시'],
  turnStart: ['자신의 턴 시작 시', '자신의 턴 개시 시'],
  turnStartOpp: ['상대의 턴 개시 시'],
  // 【자신의/상대의/서로의 턴 종료 시】 — queued from engine.endTurn.
  turnEndOwn: ['자신의 턴 종료 시'],
  turnEndOpp: ['상대의 턴 종료 시'],
  turnEndBoth: ['서로의 턴 종료 시'],
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
  if (/^딜레이(?:\s*\([^()]*\))?(?:\s|$)/.test(t)) return true;
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


// ---- printed "~했을 때" watcher abilities inside 【자신/상대/서로의 턴】 ----
// e.g. "[턴에 1회] 상대의 디지몬이 소멸했을 때, 이 디지몬을 액티브로 할 수 있다."
// These are continuous-tagged, so the bracket-tag trigger pipeline never saw
// them (~260 segments). Game events call emitGameEvent(); every ability whose
// subject/event/condition matches queues its effect text as a normal pending
// item (compiled + auto-run by the UI when understood, shown manually if not).
const WATCH_EVENT_RE = /^(.*?)\s*(등장했을|진화했을|소멸했을|레스트했을|파기되었을|어택했을)\s*때,?\s*(.*)$/s;

export function parseWatcherTrigger(body) {
  let b = body.trim().split('\n')[0].replace(/\s*〈룰〉.*$/s, '').trim();
  let limit = null;
  const lm = b.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]\s*(.*)$/s);
  if (lm) { limit = Number(lm[1]); b = lm[2]; }
  const m = b.match(WATCH_EVENT_RE);
  if (!m) return null;
  const kindOf = { 등장했을: 'play', 진화했을: 'digivolve', 소멸했을: 'delete', 레스트했을: 'rest', 파기되었을: 'discard', 어택했을: 'attack' };
  const kind = kindOf[m[2]];
  let left = m[1].trim();
  // Alternatives ("A 또는 B" / "A 혹은 B") and 《keyword》-dependent events aren't modelled — skip rather than misapply.
  if (/또는|혹은|《/.test(left.replace(/「[^」]*」/g, '「」'))) return null;
  let causeTest = () => true;
  const cm = left.match(/(효과로|배틀에서|배틀로|배틀\s*이외로)\s*$/);
  if (cm) {
    left = left.slice(0, cm.index).trim();
    const c = cm[1].replace(/\s+/g, '');
    causeTest = c === '효과로' ? (x) => x === 'effect' || x === 'ownEffect' : c === '배틀이외로' ? (x) => x !== 'battle' : (x) => x === 'battle';
  }
  // digivolve: "<subject>이 <new-card desc>(으)로 진화했을 때"
  let newCardPred = null;
  if (kind === 'digivolve') {
    const dm = left.match(/^(.*?(?:디지몬|테이머))(?:이|가)\s+(.+?)\s*(?:으로|로)$/);
    if (dm) { const pr = evoTargetPredicate(dm[2].trim()); if (!pr) return null; newCardPred = pr; left = dm[1]; }
    else left = left.replace(/(?:이|가)\s*$/, '');
  } else left = left.replace(/(?:이|가)\s*$/, '');
  left = left.trim();
  let who = 'any', other = false, selfOnly = false, isTamer = false, subjPred = () => true, mm;
  if (/이\s*디지몬$/.test(left) && !/자신|상대/.test(left)) {
    selfOnly = true;
    const desc = left.replace(/이\s*디지몬$/, '').trim();
    if (desc) { const pr = evoTargetPredicate(desc); if (!pr) return null; subjPred = (c) => pr(c); }
  } else {
    let rest = left;
    const om = rest.match(/^(다른\s*)/); if (om) { other = true; rest = rest.slice(om[0].length).trim(); }
    if ((mm = rest.match(/^(.*?)(다른\s*)?(자신의|상대의|상대)\s*(디지몬|테이머|디지몬\/테이머|디지몬\s*또는\s*테이머)$/))) {
      if (mm[2]) other = true;
      who = mm[3] === '자신의' ? 'own' : 'opp';
      isTamer = mm[4] === '테이머';
      const desc = mm[1].replace(/다른\s*$/, (x) => { other = true; return ''; }).trim();
      if (desc) { const pr = evoTargetPredicate(desc); if (!pr) return null; subjPred = (c) => pr(c); }
    } else if ((mm = rest.match(/^(다른\s*)?자신의\s*「([^」]+)」$/))) {
      who = 'own'; if (mm[1]) other = true; const nm = mm[2]; subjPred = (c) => c.nameKo === nm;
    } else if ((mm = rest.match(/^(다른\s*)?「([^」]+)」$/))) {
      who = 'any'; if (mm[1]) other = true; const nm = mm[2]; subjPred = (c) => c.nameKo.includes(nm);
    } else if (/^(다른\s*)?디지몬$/.test(rest)) {
      who = 'any'; if (/다른/.test(rest)) other = true;
    } else if ((mm = rest.match(/^(다른\s*)?자신의\s*패$/)) && kind === 'discard') {
      who = 'own'; subjPred = () => true;
    } else return null;
  }
  // effect text, optionally gated by "그 디지몬이 <desc>를 가진다면,"
  let effect = m[3].trim();
  let condPred = null;
  const cc = effect.match(/^그\s*디지몬이\s*(.+?)\s*(?:가진다면|라면),\s*(.*)$/s);
  if (cc) { const pr = evoTargetPredicate(cc[1].replace(/\s*를?\s*가진$/, '').trim()); if (!pr) return null; condPred = pr; effect = cc[2].trim(); }
  if (!effect) return null;
  // Attack-target redirects / attack-ending reactions live in findRedirectOptions & the attack flow.
  if (kind === 'attack' && /어택\s*(?:의)?\s*대상을|어택\s*대상을|그\s*어택을|어택을\s*종료/.test(effect)) return null;
  return { limit, kind, causeTest, newCardPred, selfOnly, who, other, isTamer, subjPred, condPred, effect };
}

export function isHandledWatcherBody(body) { return !!parseWatcherTrigger(body); }

// "<desc>" descriptor -> predicate over a card (traits/name/기술/color/Lv), shared with effects.js conditions.
export function cardDescPredicate(desc) { return evoTargetPredicate(desc); }

// info: { owner, stack, cause }. `stack` may already be off the board (delete).
export function emitGameEvent(state, kind, info) {
  // 15-5-2: one trigger condition that occurs several times simultaneously (N security cards lost by ONE effect instruction) triggers once.
  if (kind === 'securityDecrease' && info.cause === 'effect' && state._secDecBatch) {
    if (state._secDecBatch.has(info.owner)) return;
    state._secDecBatch.add(info.owner);
  }
  for (const hook of EVENT_HOOKS) hook(state, kind, info);
  const subjCard = info.stack ? card(info.stack.cardId) : null;
  for (const hp of ['p1', 'p2']) {
    const hpl = state.players[hp];
    for (const holder of [hpl.raising, ...hpl.battle].filter(Boolean)) {
      for (const { id, own } of stackContributors(holder)) {
        const text = own ? card(id).effectKo : card(id).inheritedKo;
        if (!text) continue;
        const { segments } = parseEffectSegments(text);
        for (const seg of segments) {
          if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
          const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === hp);
          if (!active) continue;
          const ab = parseWatcherTrigger(seg.body);
          if (!ab || ab.kind !== kind || !ab.causeTest(info.cause)) continue;
          if (kind === 'discard' && ab.selfOnly) continue;
          if (ab.selfOnly) { if (info.stack !== holder) continue; }
          else {
            if (ab.other && info.stack && info.stack === holder) continue;
            if (ab.who === 'own' && info.owner !== hp) continue;
            if (ab.who === 'opp' && info.owner === hp) continue;
          }
          if (subjCard) {
            const isTam = subjCard.category === 'tamer';
            if (ab.isTamer !== isTam && !ab.selfOnly) continue;
            if (!ab.subjPred(subjCard)) continue;
            if (ab.newCardPred && !ab.newCardPred(subjCard)) continue;
            if (ab.condPred && !ab.condPred(subjCard)) continue;
          }
          if (ab.limit != null && turnUsesRemaining(holder, onceLimitKey(id, seg.tags), ab.limit) <= 0) continue;
          // Leading conditions/costs we can evaluate here: "이 디지몬이 레스트|액티브 상태라면," and
          // the very common "이 테이머를 레스트시키는 것으로," (rest the holder Tamer as the cost).
          let effect = ab.effect, ok = true, sm;
          if ((sm = effect.match(/^이\s*디지몬이\s*(레스트|액티브)\s*상태라면,?\s*(.*)$/s))) {
            ok = (sm[1] === '레스트') === !!holder.suspended; effect = sm[2];
          }
          if (ok && (sm = effect.match(/^이\s*테이머를\s*레스트시키는\s*것으로,?\s*(.*)$/s))) {
            ok = card(holder.cardId).category === 'tamer' && !holder.suspended; effect = sm[1];
            if (ok) holder.suspended = true;
          }
          if (!ok) continue;
          if (ab.limit != null) markTurnEffectUsed(holder, onceLimitKey(id, seg.tags));
          state.pending.push({ uid: 'p' + (pendingUid++), player: hp, cardId: id, stackUid: holder.uid, tags: seg.tags, text: effect, resolved: false, watcher: true, inherited: !own, topId: holder.cardId });
        }
      }
    }
  }
  dispatchHookEvents(state, kind, info);
}

// Top card currently on stack `uid` (any player's area) — snapshotted on queued triggers so that
// 15-4-4-3 can cancel a waiting effect whose card became a NEW card (evolved/left) before it resolved.
export function stackTopId(state, p, uid) {
  if (!uid) return null;
  const pl = state.players[p];
  const st = pl.raising?.uid === uid ? pl.raising : pl.battle.find(x => x.uid === uid);
  return st ? st.cardId : null;
}

export function queueTriggersFor(state, p, cardId, eventKind, stackUid = null) {
  const c = card(cardId);
  const wantTags = TRIGGER_TAGS[eventKind] || [];
  const { segments } = parseEffectSegments(c.effectKo);
  for (const seg of segments) {
    // s8: "[시큐리티]【서로의 턴】 …" — the zone marker (not a tag) says it is the card's 【시큐리티】 effect
    const hit = seg.tags.some(tag => wantTags.some(w => tag.includes(w))) || (eventKind === 'security' && seg.zoneMarker === '시큐리티');
    if (!hit) continue;
    if (isDelaySegment(seg.body)) continue; // 16-17: only usable later via discardForDelay, not on use
    { const mk = (seg.zoneMarker || '').includes('육성'), inR = !!(stackUid && state.players[p]?.raising?.uid === stackUid); if (stackUid && ((mk && !inR) || (inR && !mk))) continue; } // 3-4-7-4: raising-area cards' effects trigger only if they refer to the raising area ([육성]) // s6: [육성] segments only work in the raising area
    if (hookDescriptorFor(cardId, seg.tags, seg.body)?.skipTrigger) continue; // queued by its own event hook instead (s3)
    const body = resolveBattleCondition(state, seg.body);
    if (body == null) continue;
    const applied = tryAutoApplySegment(state, p, body, cardId);
    if (applied) {
      log(state, `(자동 처리) ${card(cardId).nameKo} 【${seg.tags.join('】【')}】: ${body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId, stackUid, tags: seg.tags, text: body, resolved: false, topId: stackTopId(state, p, stackUid), delStack: state._deleteStack || null, evt: { kind: eventKind } });
    }
  }
}


// "(이 디지몬이) 배틀 이외로 소멸하고 있었다면, ..." — only fires when the
// deletion wasn't a battle loss; resolved at queue time from the cause
// deleteStack recorded, since the pending item runs later without it.
// Returns the effect body to queue, or null to skip.
function resolveBattleCondition(state, body) {
  const m = body.trim().match(/^(?:이\s*디지몬이\s*)?배틀\s*이외로\s*소멸하고\s*있었다면,?\s*(.+)$/s);
  if (!m) return body;
  return state._deleteCause === 'battle' ? null : m[1];
}

function isDelaySegment(body) {
  return /^[≪《]\s*딜레이\s*[≫》](?:\s*\([^()]*\))?(?:\s|$)/.test(body.trim());
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
    if (stackUid && state.players[p]?.raising?.uid === stackUid && !(seg.zoneMarker || '').includes('육성')) continue; // 3-4-7-4
    const body = resolveBattleCondition(state, seg.body);
    if (body == null) continue;
    const applied = tryAutoApplySegment(state, p, body, sourceCardId);
    if (applied) {
      log(state, `(자동 처리, 진화원효과: ${c.nameKo}) 【${seg.tags.join('】【')}】: ${body}`);
    } else {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: sourceCardId, stackUid, tags: seg.tags, text: body, resolved: false, inherited: true, topId: stackTopId(state, p, stackUid), delStack: state._deleteStack || null, evt: { kind: eventKind } });
    }
  }
}

// "이 디지몬은 이 디지몬의 진화원에 있는 명칭에 「X」을 포함하는 카드의 효과
// 전부를 얻는다." (always 【서로의 턴】, i.e. always active) — this Digimon
// gains a matching source's OWN printed effect text wholesale, not just its
// normal 4-3-3 inherited (진화원) text. Confirmed 14 occurrences, always
// printed identically in both effectKo and inheritedKo of the same card.
function fullEffectInheritTarget(effectKo) {
  const m = (effectKo || '').match(/이\s*디지몬은\s*이\s*디지몬의\s*진화원에\s*있는\s*(?:명칭에\s*)?「([^」]+)」\s*(?:을|를)?\s*(?:포함하는\s*카드)?의\s*효과\s*전부를\s*얻는다/);
  return m ? m[1] : null;
}

// The one entry point that should be used for any real game event on a
// Digimon stack — checks both the top card's own effect text AND every
// evolution source's inherited effect text.
export function queueTriggersForStack(state, p, stack, eventKind) {
  if (!stack) return;
  if (eventKind === 'digivolve' && stack.noEvoTrigUntil != null && state.turnNumber <= stack.noEvoTrigUntil) { log(state, `${p} ${card(stack.cardId).nameKo}의 【진화 시】 효과는 발휘하지 않음 (효과)`); return; } // s8
  if (eventKind === 'digivolve' && hookSuppressTrigger(state, p, stack, '진화 시')) { log(state, `${p} ${card(stack.cardId).nameKo}의 【진화 시】 효과는 발휘하지 않음 (효과)`); return; } // s5
  if (eventKind === 'play' && hookSuppressTrigger(state, p, stack, '등장 시')) { log(state, `${p} ${card(stack.cardId).nameKo}의 【등장 시】 효과는 발휘하지 않음 (효과)`); return; }
  if (eventKind === 'attack' && hookSuppressTrigger(state, p, stack, '어택 시')) { log(state, `${p} ${card(stack.cardId).nameKo}의 【어택 시】 효과는 발휘하지 않음 (효과)`); return; } // shard2
  S2.queueGranted(state, p, stack, eventKind);
  queueTriggersFor(state, p, stack.cardId, eventKind, stack.uid);
  for (const sourceCardId of stack.sources.slice(fdCount(stack))) {
    queueInheritedTriggersFor(state, p, sourceCardId, eventKind, stack.uid);
    if (S2.fullInherit(stack, sourceCardId)) queueTriggersFor(state, p, sourceCardId, eventKind, stack.uid);
  }
  { const ik = inheritKeywordSource(stack); if (ik) queueTriggersFor(state, p, ik, eventKind, stack.uid); } // 16-47 ≪계승≫
  const nameIncludes = fullEffectInheritTarget(card(stack.cardId).effectKo);
  if (nameIncludes) {
    for (const sourceCardId of stack.sources.slice(fdCount(stack))) {
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
  if (hookRedirectImmune(state, p, stack)) return true;
  if (stack.noRedirectUntil != null && state.turnNumber <= stack.noRedirectUntil) return true; // s8: "어택의 대상은 변경되지 않는다" (effect-applied)
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

// Qualifier phrase of "어택의 대상을 <…> 자신의 디지몬 N마리로 변경": 레스트 상태인 /
// 특징 「X」를 가진 / 명칭에 「X」를 포함하는 / 「X」이 기술되어 있는. Returns a
// stack predicate, or null when anything is left unparsed (OR-combinations,
// unknown wording) so an unrecognised variant is never misapplied.
function redirectCandidatePredicate(q) {
  q = q.trim();
  const preds = [];
  let m;
  if (/거나|또는/.test(q.replace(/「[^」]*」/g, '「」').replace(/」\s*(?:또는)\s*「/g, ''))) return null;
  if (/레스트\s*상태인/.test(q)) { preds.push(st => st.suspended); q = q.replace(/레스트\s*상태인/, ''); }
  if ((m = q.match(/특징(?:으로|에|은)?\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*(가진|가지고|포함하는)/))) {
    const list = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    const incl = m[2] === '포함하는';
    preds.push(st => (card(st.cardId).types || []).some(ty => list.some(x => incl ? ty.includes(x) : ty === x)));
    q = q.replace(m[0], '');
  }
  if ((m = q.match(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함하는/))) {
    const list = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    preds.push(st => list.some(x => card(st.cardId).nameKo.includes(x)));
    q = q.replace(m[0], '');
  }
  if ((m = q.match(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술되어\s*있는/))) {
    const list = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    preds.push(st => list.some(x => card(st.cardId).nameKo.includes(x)));
    q = q.replace(m[0], '');
  }
  if (q.replace(/[\s,]/g, '') || !preds.length) return null; // leftover text = something we don't understand
  return st => preds.every(f => f(st));
}

// True when `body` is a defender-side attack-redirect reaction that
// findRedirectOptions can evaluate (used by the coverage audit).
export function isHandledRedirectBody(body) {
  const b = body.trim();
  const lm = b.match(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*(.*)$/s);
  const rest = (lm ? lm[1] : b).trim();
  if (/^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택의?\s*대상을\s*이\s*디지몬으로\s*변경할\s*수\s*있다\.?$/.test(rest)) return true;
  const am = rest.match(/^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택\s*(?:의)?\s*대상을\s*(.*?)\s*자신(?:의)?\s*디지몬\s*\d+\s*마리로\s*변경(?:할\s*수\s*있다|한다)\.?$/);
  return !!am && !!redirectCandidatePredicate(am[1]);
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
        const limitM = body.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]\s*(.*)$/s);
        const limit = limitM ? Number(limitM[1]) : null;
        const rest = (limitM ? limitM[2] : body).trim();
        let targets;
        if (/^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택의?\s*대상을\s*이\s*디지몬으로\s*변경할\s*수\s*있다\.?$/.test(rest)) {
          targets = [stack.uid];
        } else {
          // "…어택의 대상을 [레스트 상태인] [특징/명칭 조건의] 자신의 디지몬 N마리로 변경(할 수 있다|한다)"
          const am = rest.match(/^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택\s*(?:의)?\s*대상을\s*(.*?)\s*자신(?:의)?\s*디지몬\s*\d+\s*마리로\s*변경(?:할\s*수\s*있다|한다)\.?$/);
          const pred = am ? redirectCandidatePredicate(am[1]) : null;
          if (!pred) continue;
          targets = pl.battle.filter(s => card(s.cardId).category === 'digimon' && pred(s)).map(s => s.uid);
          if (!targets.length) continue;
        }
        if (limit != null) {
          const key = onceLimitKey(id, ['어택대상변경']);
          if (turnUsesRemaining(stack, key, limit) <= 0) continue;
        }
        for (const t of targets) options.push({ cardId: id, stackUid: stack.uid, targetUid: t, limit });
      }
    }
  }
  if (attackerP != null) options.push(...s1HookCollect(state, 's1redirect', { p, attackerP, attackerUid })); // shard1
  return options;
}

// ≪흡수진화 -N≫ printed on the card being evolved INTO: "자신의 디지몬이 패의
// 이 카드로 진화할 때, 자신의 디지몬 1마리를 레스트시키는 것으로, 지불하는 진화
// 코스트를 -N 한다." Returns { delta, candidates } (uids of other active
// Digimon that could pay the rest cost); the UI asks before applying.
export function absorbEvolveOption(state, p, evolvingStack, targetCardId) {
  const m = (card(targetCardId).effectKo || '').match(/[《≪]\s*흡수진화\s*(-\d+)\s*[》≫]/);
  if (!m) return null;
  const candidates = state.players[p].battle
    .filter(s => s !== evolvingStack && !s.suspended && card(s.cardId).category === 'digimon').map(s => s.uid);
  // 16-10-5: the Digimon being evolved (the new evolution source) may itself be the one rested — listed last so another Digimon is preferred by default.
  if (evolvingStack && !evolvingStack.suspended && card(evolvingStack.cardId).category === 'digimon' && state.players[p].battle.includes(evolvingStack)) candidates.push(evolvingStack.uid);
  const oppCandidates = s1HookAny(state, 's1absorbOpp', { p }) ? state.players[opponentOf(p)].battle.filter(s => !s.suspended && card(s.cardId).category === 'digimon').map(s => s.uid) : []; // shard1 BT3-056
  return (candidates.length || oppCandidates.length) ? { delta: Number(m[1]), candidates, oppCandidates } : null;
}

// ≪트레이닝≫: "메인 중, 이 디지몬을 레스트시키는 것으로, 자신의 덱 위에서부터 1장을
// 이 디지몬의 진화원 아래에 뒷면으로 놓는다. 이 효과는 육성 에어리어에서도 발휘할
// 수 있다." — an activated main-phase action (UI button), not a trigger.
export function useTraining(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack || stack.suspended || !hasKeyword(stack, '트레이닝') || !pl.deck.length) return false;
  restStack(state, p, uid);
  if (!stack.suspended) return false; // rest was blocked
  const id = pl.deck.shift();
  stack.sources.unshift(id);
  recomputeStackGrants(stack);
  log(state, `${p} ${card(stack.cardId).nameKo} 《트레이닝》 — 덱 위 1장을 진화원 아래에 놓음`);
  emitGameEvent(state, 'faceDownSource', { owner: p, stack, cause: null }); // s8: "진화원에 뒷면인 카드가 놓였을 때"
  return true;
}

// Activated 【메인】 abilities printed on Digimon/Tamer cards (161 segments; only Option cards'
// 【메인】 was ever reachable from the UI). Lists what this stack can activate right now, with
// [턴 N회] caps and "[육성]/[배틀]" zone markers respected; the UI button just queues the
// segment as a normal pending effect (costs, confirms, and limits then run as usual).
export function activatableMainAbilities(state, p, stack, zoneKind) {
  if (p !== state.activePlayer || state.phase !== 'main') return [];
  if (!['digimon', 'tamer'].includes(card(stack.cardId).category)) return [];
  const out = [];
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    for (const seg of parseEffectSegments(text).segments) {
      { const hdA = hookDescriptorFor(id, seg.tags, seg.body); if (hdA && hdA.activate) { // s7: descriptor.activate -> a printed non-【메인】 ability usable as a main-phase action
        const lmA = seg.body.trim().match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
        if (!(lmA && turnUsesRemaining(stack, onceLimitKey(id, seg.tags), Number(lmA[1])) <= 0)) out.push({ cardId: id, tags: seg.tags, text: seg.body.trim() });
        continue; } }
      if (!seg.tags.includes('메인') || seg.tags.some(t => !['메인', '등장 시', '진화 시'].includes(t)) || isDelaySegment(seg.body) || (() => { const hd = hookDescriptorFor(id, seg.tags, seg.body); return !!hd && !hd.events; })()) continue;
      if (seg.zoneMarker && (seg.zoneMarker.includes('패') || seg.zoneMarker.includes('트래시'))) continue; // hand/trash abilities: see zoneMainAbilities
      if (seg.zoneMarker && !((seg.zoneMarker.includes('육성') && zoneKind === 'raising') || (seg.zoneMarker.includes('배틀') && zoneKind === 'battle'))) continue;
      const lm = seg.body.trim().match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/);
      if (lm && turnUsesRemaining(stack, onceLimitKey(id, seg.tags), Number(lm[1])) <= 0) continue;
      out.push({ cardId: id, tags: seg.tags, text: seg.body.trim() });
    }
  }
  // s6: descriptor.extraMain(state, hp, holder) -> [{cardId, tags, text}]: 【메인】 effects the holder gains from elsewhere (e.g. its evolution sources).
  for (const { hp, holder, d } of activeHooks(state)) if (d.extraMain && hp === p && holder === stack) out.push(...(d.extraMain(state, hp, holder) || []));
  return out;
}

// ≪연계≫: "이 디지몬이 어택했을 때, 다른 자신의 디지몬 1마리를 레스트시키는
// 것으로, 이 어택 동안 이 디지몬에게 레스트시킨 디지몬의 DP를 플러스하고,
// 《S 어택 +1》을 얻는다." — optional, so the UI offers it per attack.
export function chainOptions(state, p, attackerUid) {
  const pl = state.players[p];
  const a = pl.battle.find(s => s.uid === attackerUid);
  if (!a || !hasKeyword(a, '연계')) return [];
  return pl.battle.filter(s => s !== a && !s.suspended && card(s.cardId).category === 'digimon').map(s => s.uid);
}

export function useChain(state, p, attackerUid, otherUid) {
  const pl = state.players[p];
  const a = pl.battle.find(s => s.uid === attackerUid);
  const o = pl.battle.find(s => s.uid === otherUid);
  if (!a || !o || o.suspended || !hasKeyword(a, '연계')) return false;
  const dp = effectiveDP(state, p, o);
  restStack(state, p, otherUid);
  if (!o.suspended) return false; // 16-24-3: rest is the (optional) cost — if it didn't happen, no DP/S 어택 bonus
  emitGameEvent(state, 'chainRest', { owner: p, stack: o, cause: 'effect' }); // shard2
  modifyDP(state, p, attackerUid, dp, 'turn');
  grantKeyword(state, p, attackerUid, '시큐리티어택', 1, 'turn');
  log(state, `${p} ${card(a.cardId).nameKo} 《연계》 — ${card(o.cardId).nameKo} 레스트, DP+${dp}, S 어택 +1`);
  return true;
}

// ≪돌진≫: "이 디지몬이 어택했을 때, 어택의 대상을 가장 DP가 높은 액티브 상태인
// 상대의 디지몬 1마리로 변경할 수 있다." Returns the uid to redirect to (first
// on a DP tie), or null if the attacker lacks the keyword / no legal target /
// the attacker is immune to redirects.
export function chargeRedirectTarget(state, attackerP, attackerUid) { return chargeRedirectTargets(state, attackerP, attackerUid)[0] || null; }
// ALL legal 《돌진》 targets: the highest-DP active Digimon — on a DP tie the (attacking) player picks which one.
export function chargeRedirectTargets(state, attackerP, attackerUid) {
  const apl = state.players[attackerP];
  const aStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  if (!aStack || !hasKeyword(aStack, '돌진') || isAttackTargetImmune(state, attackerP, aStack)) return [];
  const opp = opponentOf(attackerP);
  const cands = state.players[opp].battle
    .filter(s => !s.suspended && card(s.cardId).category === 'digimon' && !stackHasContinuousAbility(state, opp, s, RE_CANNOT_BE_ATTACKED) && !s3Flag(state, s, 'unattackable'));
  if (!cands.length) return [];
  const top = Math.max(...cands.map(c => effectiveDP(state, opp, c)));
  return cands.filter(c => effectiveDP(state, opp, c) === top).map(c => c.uid);
}

// Marks a redirect option as used this turn (for its [턴에 N회] cap, if any).
export function markRedirectUsed(state, p, stackUid, cardId) {
  const pl = state.players[p];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (stack) markTurnEffectUsed(stack, onceLimitKey(cardId, ['어택대상변경']));
}

export function resolvePending(state, uid) {
  const t = state.pending.find(x => x.uid === uid);
  if (t && !t.resolved) {
    // 18-3: perpetual loop guard. Nobody can supply a stop declaration in this simulator, so a single turn resolving an
    // absurd number of triggered effects is treated as an infinite loop with no stopping means -> draw (18-3-2).
    if (state._resolvedTurn !== state.turnNumber) { state._resolvedTurn = state.turnNumber; state._resolvedCount = 0; }
    if (++state._resolvedCount > 1500 && !state.winner) { state.winner = 'draw'; log(state, '영구 순환 발생 — 멈출 수단이 없어 무승부 (18-3-2)'); }
  }
  if (t) t.resolved = true;
  state.pending = state.pending.filter(x => !x.resolved);
  purgeTokens(state);
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

// 3-1-3-9-2: a Digitama card that ends up in a non-public zone other than the deck/digitama deck (hand, security)
// goes to the BOTTOM of its owner's digitama deck instead; one sent to the deck (3-1-3-9-1) goes to the digitama deck too.
// Card-moving code paths are many, so this is enforced as a rule-check sweep (called from engine.autoAdvance).
export function normalizeDigitamaZones(state) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const z of ['hand', 'deck', 'security']) {
      for (let i = pl[z].length - 1; i >= 0; i--) {
        if (CARDS[pl[z][i]]?.category !== 'digitama') continue;
        const [id] = pl[z].splice(i, 1);
        pl.digitamaDeck.push(id);
        log(state, `${p} 디지타마 카드 ${card(id).nameKo}: ${z}에는 놓을 수 없어 디지타마 덱 맨 아래로 (룰 3-1-3-9)`);
      }
    }
  }
}

export function trashFromHand(state, p, handIndex) {
  const pl = state.players[p];
  const [id] = pl.hand.splice(handIndex, 1);
  if (id) { pl.trash.push(id); log(state, `${p} 핸드 파기: ${card(id).nameKo}`); emitGameEvent(state, 'discard', { owner: p, stack: null, cause: 'effect', cardId: id }); }
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
// 15-15-3-6 / 3-1-3-4: the owner chooses the order of revealed cards returned to the deck. `restOrder` (optional) is a permutation of
// indices into the returned-cards list (listed first = topmost of that group); use resolveRevealOrdered to have the player choose it.
export async function resolveRevealOrdered(state, choose, p, n, keepIdx, toHandIdxs, restTo = 'bottom') {
  const revealed = state.players[p].deck.slice(0, n);
  const rest = revealed.filter((id, i) => !toHandIdxs.includes(i));
  let order = null;
  if (restTo !== 'trash' && rest.length > 1 && typeof choose === 'function') {
    order = await choose('orderCards', { player: p, ids: rest, prompt: `덱 ${restTo === 'bottom' ? '아래' : '위'}로 되돌릴 카드 ${rest.length}장의 순서를 정하세요 (위쪽부터)` });
    if (!Array.isArray(order) || order.length !== rest.length) order = null;
  }
  return resolveReveal(state, p, n, keepIdx, toHandIdxs, restTo, order);
}
export function resolveReveal(state, p, n, keepIdx, toHandIdxs, restTo = 'bottom', restOrder = null) {
  const pl = state.players[p];
  const revealed = pl.deck.splice(0, n);
  const toHand = [];
  let rest = [];
  revealed.forEach((id, i) => {
    if (toHandIdxs.includes(i)) toHand.push(id); else rest.push(id);
  });
  if (restOrder && restOrder.length === rest.length && restOrder.every(i => Number.isInteger(i) && i >= 0 && i < rest.length)) rest = restOrder.map(i => rest[i]);
  pl.hand.push(...toHand);
  if (restTo === 'trash') pl.trash.push(...rest); else if (restTo === 'bottom') pl.deck.push(...rest); else pl.deck.unshift(...rest);
  log(state, `${p} 공개 처리: 핸드로 ${toHand.map(id=>card(id).nameKo).join(',')||'없음'} / 나머지 덱 ${restTo === 'bottom' ? '밑' : '위'}로`);
  return { toHand, rest };
}

// ---- security ----

export function securityCount(state, p) { return state.players[p].security.length; }

export function addToSecurity(state, p, cardId, position = 'top') {
  const pl = state.players[p];
  if (position === 'top') pl.security.unshift(cardId); else pl.security.push(cardId);
  log(state, `${p} 시큐리티 ${position === 'top' ? '맨 위' : '맨 밑'}에 추가: ${card(cardId).nameKo}`);
  emitGameEvent(state, 'securityIncrease', { owner: p, stack: null, cause: 'effect' });
}

// Remove top security card by a non-attack EFFECT (not a check). Returns removed id.
export function trashTopSecurityByEffect(state, p) {
  const pl = state.players[p];
  const id = pl.security.shift();
  if (id) { log(state, `${p} 시큐리티 맨 위 카드가 효과로 파기: ${card(id).nameKo} (효과 트리거 대상일 수 있음 — 수동 확인)`); pl.trash.push(id); emitGameEvent(state, 'securityDiscard', { owner: p, stack: null, cause: 'effect' }); emitGameEvent(state, 'securityDecrease', { owner: p, stack: null, cause: 'effect' }); }
  return id;
}

export function trashBottomSecurityByEffect(state, p) {
  const pl = state.players[p];
  const id = pl.security.pop();
  if (id) { log(state, `${p} 시큐리티 맨 밑 카드가 효과로 파기: ${card(id).nameKo}`); pl.trash.push(id); emitGameEvent(state, 'securityDiscard', { owner: p, stack: null, cause: 'effect' }); emitGameEvent(state, 'securityDecrease', { owner: p, stack: null, cause: 'effect' }); }
  return id;
}

// ---- memory gauge ----
// Positive = p1's banked side. Spending by the ACTIVE player always shifts
// the gauge toward the OPPONENT's side: if active is p1, memory decreases;
// if active is p2, memory increases.

// 1-3-11-1 / 4-2-2: a card whose cost cannot be paid can't be declared. The gauge stops at 10 on the
// opponent's side, so the most the ACTIVE player can pay is (own-side memory + 10).
export function canPayCost(state, cost) {
  if (!(cost > 0)) return true;
  const own = state.activePlayer === 'p1' ? state.memory : -state.memory;
  return cost <= own + 10;
}

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
  const th = hookTurnEndThreshold(state, active); // e.g. "턴 종료 조건이, 메모리가 상대 쪽의 3 이상이 된다"
  if (active === 'p1') return state.memory <= -th;
  return state.memory >= th;
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

// Bare 《키워드》 lines the engine has a real consumer for (static grants).
const KEYWORD_FLAGS = ['재밍', '블로커', '관통', '재기동', '속공', '진격', '길동무', '방벽', '아머퍼지', '회피', '스케이프고트', '불굴', '돌진', '연계', '빙장', '충돌', '트레이닝', '볼텍스', '에그제큐트', '천승', '수호', '급습', '프로그레스'];
const EFFECTIVE_TEMP_KEYWORDS = new Set(['시큐리티어택', '재밍', '관통', '블로커', '재기동', '길동무', '방벽', '아머퍼지', '회피', '스케이프고트', '불굴', '돌진', '연계']);

export function securityAttackBonus(stack) {
  const own = stack.keywords?.['시큐리티어택'] ? Number(stack.keywords['시큐리티어택']) || 0 : 0;
  const inherited = stack.inheritedKeywords?.['시큐리티어택'] ? Number(stack.inheritedKeywords['시큐리티어택']) || 0 : 0;
  return own + inherited + s7ContSAttack(stack);
}

export function hasKeyword(stack, name) {
  return !!(stack.keywords && stack.keywords[name]) || !!(stack.inheritedKeywords && stack.inheritedKeywords[name]) || s7ContKw(stack, name);
}

// "특징으로 「X」를 가진 이 디지몬은 《KEYWORD》를 얻는다." / the bare
// unconditional "이 디지몬은 《KEYWORD》를 얻는다." — same continuous
// 자신/상대/서로의 턴 family as the other grants, for keywords whose
// consumer needs to check live (e.g. 충돌, which only matters exactly when
// Block Timing is being resolved) rather than through the cached
// keywords/inheritedKeywords used by hasKeyword.
export function hasContinuousKeyword(state, p, stack, keyword) {
  const kwRe = keyword.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const re = new RegExp(`^(.*?)\\s*이\\s*디지몬(?:은|이)\\s*[≪《]\\s*${kwRe}\\s*[≫》](?:\\s*\\([^()]*\\))?\\s*(?:을|를)?\\s*얻는다\\.?$`, 's');
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      const m = seg.body.trim().split('\n')[0].replace(/\s*〈룰〉.*$/s, '').trim().match(re);
      if (!m) continue;
      const desc = m[1].trim();
      if (!desc) return true;
      const pred = evoTargetPredicate(desc);
      if (pred && pred(card(stack.cardId))) return true;
    }
  }
  return false;
}

// True when `body` is a continuous "<조건> 이 디지몬은 《키워드》를 얻는다" grant
// for a keyword whose consumer checks it live (used by the coverage audit).
export function isHandledContinuousKeywordBody(body) {
  const m = body.trim().split('\n')[0].replace(/\s*〈룰〉.*$/s, '').trim()
    .match(/^(.*?)\s*이\s*디지몬(?:은|이)\s*[≪《]\s*(충돌|회피|아머\s*퍼지|방벽|스케이프고트|불굴)\s*[≫》](?:\s*\([^()]*\))?\s*(?:을|를)?\s*얻는다\.?$/s);
  if (!m) return false;
  return !m[1].trim() || !!evoTargetPredicate(m[1].trim());
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
    // A line may hold SEVERAL bare keyword tokens ("《S 어택 +1》《블로커》",
    // "《충돌》《관통》《프래그먼트《3》》(설명)") — 172 real lines; the old
    // single-token pattern silently dropped every one of them. One nested
    // bracket level is allowed inside a token.
    const tokRe = /^\s*[《≪]\s*((?:[^》≫《≪]|[《≪][^》≫]*[》≫])+?)\s*[》≫](?:\s*\([^()]*\))?/;
    const labels = [];
    let rest = t, tm;
    while ((tm = rest.match(tokRe))) { labels.push(tm[1].trim()); rest = rest.slice(tm[0].length); }
    // A keyword line with extra prose is a triggered effect, not a bare grant — leave it.
    // (빙장 alone is tolerated followed by its 〈룰〉 note.)
    if (!labels.length || (rest.trim() && !(labels.length === 1 && labels[0] === '빙장'))) continue;
    for (const rawLabel of labels) {
      const label = rawLabel.replace(/\s+/g, '') === '아머퍼지' ? '아머퍼지' : rawLabel;
      if ((m = label.match(/^프래그먼트\s*[《≪]\s*(\d+)\s*[》≫]$/))) { out.keywords['프래그먼트'] = Math.max(out.keywords['프래그먼트'] || 0, Number(m[1])); continue; }
      if (KEYWORD_FLAGS.includes(label)) { out.keywords[label] = true; continue; }
      // "S 어택" (abbreviated) and "시큐리티 어택" (spelled out, common on
      // beginner/starter-deck cards) are the same keyword.
      if ((m = label.match(/^(?:S|시큐리티)\s*어택\s*\+(\d+)$/))) { out.keywords['시큐리티어택'] = (out.keywords['시큐리티어택'] || 0) + Number(m[1]); continue; }
      if ((m = label.match(/^링크\s*\+(\d+)$/))) { out.keywords['링크+'] = (out.keywords['링크+'] || 0) + Number(m[1]); continue; } // 4-9-5: raises the 1-per-Digimon Link Card cap
    }
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
// s6: synthetic card "<id>~<tag>" whose effect text is only the source's single-tag 【tag】 segments (so continuous scanners see just those).
function gainedEffectsId(id, tag) {
  const sid = `${id}~${tag}`;
  if (CARDS[sid]) return CARDS[sid].effectKo ? sid : null;
  const segs = parseEffectSegments(card(id).effectKo).segments.filter(sg => sg.tags.length === 1 && sg.tags[0] === tag);
  const c = card(id);
  CARDS[sid] = { ...c, id: sid, effectKo: segs.map(sg => `【${tag}】 ${sg.body}`).join('\n'), inheritedKo: '' };
  CARD_HOOKS[sid] = (CARD_HOOKS[id] || []).filter(d => d.tag === tag && (d.src || 'effectKo') === 'effectKo');
  return CARDS[sid].effectKo ? sid : null;
}
function stackContributors(stack) {
  // "이 디지몬은 ... 명칭에 「X」을 포함하는 카드의 효과 전부를 얻는다." — a
  // matching-name source contributes its OWN effectKo (own:true) instead of
  // just its normal 4-3-3 inheritedKo, for every continuous-grant system
  // that reads stackContributors (DP, keywords, evolve restrictions, etc.),
  // not just the one-shot trigger pipeline queueTriggersForStack handles
  // separately.
  const fullInheritName = fullEffectInheritTarget(card(stack.cardId).effectKo);
  // s6: descriptor.gainFrom(sourceCardId) [+ gainTag]: this top card also gains the printed 【gainTag】 effects of matching sources (EX10-059).
  const gained = [];
  for (const d of CARD_HOOKS[stack.cardId] || []) {
    if (!d.gainFrom || (d.src || 'effectKo') !== 'effectKo') continue;
    for (const id of stack.sources.slice(fdCount(stack))) if (d.gainFrom(id)) { const sid = gainedEffectsId(id, d.gainTag || '서로의 턴'); if (sid) gained.push({ id: sid, own: true }); }
  }
  const inheritSrc = inheritKeywordSource(stack); // 16-47 ≪계승≫: the topmost matching source lends ALL its effects (once)
  let inheritUsed = false;
  return [
    { id: stack.cardId, own: true },
    ...gained,
    // shard5: face-down (뒷면) sources sit at the bottom (index 0..fdCount-1) and lend no effects.
    ...stack.sources.slice(fdCount(stack)).map(id => ({ id, own: (fullInheritName != null && card(id).nameKo.includes(fullInheritName)) || S2.fullInherit(stack, id) || (!inheritUsed && id === inheritSrc && (inheritUsed = true)) })),
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

// Real prints overwhelmingly spell Yellow as "옐로" (227 occurrences in the
// card DB vs 1 for "옐로우") — both keys map here, and every regex using
// this alternation matches "옐로(?:우)?" (longer spelling tried first) so
// Yellow-specific restrictions actually match instead of silently failing.
const KOR_COLOR_NAME = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };

// "이 디지몬은 (X색)인/「X」으로만 진화할 수 있다." — same continuous-condition
// family as parseTurnConditionalDP, restricting what this stack is allowed
// to evolve into rather than its DP. Returns the first active restriction
// found ({colors:[...]} or {nameExact}/{nameIncludes}), or null.
// s8: wraps the printed-text restriction with (1) an effect-applied "진화할 수 없다" timer and (2) hook-provided
// ALTERNATIVE evolution rules ("진화 조건을 무시하고 진화 코스트 N으로 …로 진화할 수 있다"): restriction.alt = [{cost, test(tgtCard, srcCard)}].
export function evolveTargetRestriction(state, p, stack) {
  for (const lk of state.evolveLocks || []) if (lk.player === p && state.turnNumber <= lk.until && (card(stack.cardId).level || 0) <= lk.levelMax && card(stack.cardId).category === 'digimon') return { cannotEvolve: true };
  if (stack.cannotEvolveUntil != null && state.turnNumber <= stack.cannotEvolveUntil) return { cannotEvolve: true };
  if (S2.evolveBan(state, p, stack)) return { cannotEvolve: true }; // shard2
  for (const { hp, holder, d } of activeHooks(state)) if (d.noEvolve && hp === p && holder === stack && d.noEvolve(state, hp, holder)) return { cannotEvolve: true }; // s5
  const base = evolveTargetRestrictionBase(state, p, stack);
  if (base && base.cannotEvolve) return base;
  const alt = [];
  for (const { hp, holder, d } of activeHooks(state)) if (hp === p && d.evoAlt) { const a = d.evoAlt(state, hp, holder, stack); if (a) alt.push(a); }
  return alt.length ? { ...(base || {}), alt } : base;
}
function evolveTargetRestrictionBase(state, p, stack) {
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
      let m = body.match(/^이\s*디지몬은\s*(레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)인\s*디지몬으로만\s*진화할\s*수\s*있다\.?$/);
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
  const ov = stack.dpBaseOverride; // "원래 DP를 N으로 변경" (until: last turn number it applies)
  const base = ov && state.turnNumber <= ov.until ? ov.value : (card(stack.cardId).dp || 0);
  return s7DpFloor(state, p, stack, base + (stack.tempDP || 0) + (stack.inheritedDP || 0) + turnConditionalDP(state, p, stack) + hookDP(state, p, stack) + s7DpSum(state, stack) + lateDpAllSum(state, p, stack));
}

// 15-11-2-2: a continuing "all of your/their Digimon get DP±N" effect also reaches Digimon that enter later.
// modifyDPAll applies to the stacks present at resolution (tempDP) and records the mod here; a stack NOT among
// those present (a later arrival) gets the same amount dynamically while the effect lasts.
export function addDpAllMod(state, p, amount, duration) {
  const pl = state.players[p];
  const until = duration === 'permanent' ? 1e9 : duration === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
  (pl.dpAllLate = pl.dpAllLate || []).push({ amount, until, uids: pl.battle.map(s => s.uid) });
}
function lateDpAllSum(state, p, stack) {
  const mods = state.players[p].dpAllLate;
  if (!mods || !mods.length) return 0;
  let sum = 0;
  for (let i = mods.length - 1; i >= 0; i--) {
    const m = mods[i];
    if (m.until < state.turnNumber) { mods.splice(i, 1); continue; }
    if (!m.uids.includes(stack.uid) && state.players[p].battle.includes(stack)) sum += m.amount;
  }
  return sum;
}

// "이 디지몬은 액티브 상태의 상대 디지몬에게도 어택할 수 있다." (no "no
// evolution sources" qualifier, unlike the printed 무진화원액티브공격
// keyword) — same continuous-condition family, usually printed under
// 【자신의 턴】 rather than as a one-shot trigger.
export function canAttackAnyActive(state, p, stack) {
  if (hookAttackAnyActive(state, p, stack)) return true;
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (!active) continue;
      if (hookDescriptorFor(id, seg.tags, seg.body)) continue; // conditional variants are evaluated by their bespoke descriptor (hookAttackAnyActive)
      if (/이\s*디지몬은?[,]?\s*액티브\s*상태(?:의|인)?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다/.test(seg.body) && !/진화원을?\s*갖지\s*않는/.test(seg.body)) {
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
    for (const k of KEYWORD_FLAGS) if (g.keywords[k]) flags[k] = true;
    if (g.keywords['프래그먼트']) flags['프래그먼트'] = Math.max(flags['프래그먼트'] || 0, g.keywords['프래그먼트']);
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
  const m = c.inheritedKo.match(/링크\s*(?:[:：]|〉)\s*(.+?)\s*[:：]\s*코스트\s*(\d+)/); // '링크: …' and the '〈링크〉…' spelling
  if (!m) return null;
  return { grantedBy: sourceCardId, conditionText: m[1].trim(), cost: Number(m[2]) };
}

// All link slots currently available to a stack — one per distinct
// link-granting evolution source it has accumulated so far.
// 10-1-1/10-1-3-1: the Link condition + Link cost are printed on the card BEING LINKED (its own "링크: <조건>: 코스트 N"
// line); the chosen Digimon must satisfy that condition. Returns { ok, cost, reason }.
export function linkCheck(state, p, host, linkCardId) {
  const lc = card(linkCardId);
  if (!host || card(host.cardId).category !== 'digimon') return { ok: false, reason: '링크 대상은 디지몬이어야 함 (10-1-1)' };
  if (lc.category !== 'digimon') return { ok: false, reason: '링크 능력이 없는 카드' };
  const g = parseLinkGrant(linkCardId);
  if (!g) return { ok: false, reason: '링크 조건이 없는 카드' };
  const pr = evoTargetPredicate(g.conditionText);
  if (pr && !pr(card(host.cardId))) return { ok: false, reason: `링크 조건 불일치 (${g.conditionText})` };
  return { ok: true, cost: g.cost };
}

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
  // s8: the link card's OWN inherited 【링크 시】 (printed in inheritedKo on most link-capable Digimon) fires when it becomes the link card.
  if (lc.inheritedKo) for (const seg of parseEffectSegments(lc.inheritedKo).segments) {
    if (!seg.tags.some(tag => tag.includes('링크 시') || tag.includes('링크했을 때'))) continue;
    if (seg.tags.length === 1 && ['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
    const applied = tryAutoApplySegment(state, p, seg.body);
    if (applied) log(state, `(자동 처리, 링크 진화원효과: ${lc.nameKo}) 【${seg.tags.join('】【')}】: ${seg.body}`);
    else state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: linkCardId, stackUid: stack.uid, tags: seg.tags, text: seg.body, resolved: false, linked: true, inherited: true });
  }
  // The host's own printed "이 디지몬이 링크했을 때" reaction (see BT21-009/018/023)
  queueTriggersFor(state, p, stack.cardId, 'linked', stack.uid);
  for (const srcId of stack.sources) queueInheritedTriggersFor(state, p, srcId, 'linked', stack.uid);
}

// 4-9-5: when a new Link Card would exceed the cap, the PLAYER chooses which existing link card to discard.
// Returns the index into stack.linkCards to discard (or undefined when no discard is needed); pass it as linkCardTo's `discardIdx`.
export async function linkDiscardIdx(state, p, uid, choose) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack || !(stack.linkCards || []).length) return undefined;
  const cap = 1 + (stack.inheritedKeywords?.['링크+'] || 0);
  if (stack.linkCards.length < cap) return undefined;
  if (stack.linkCards.length === 1 || typeof choose !== 'function') return 0;
  const i = await choose('pickLinkCard', { player: p, ids: stack.linkCards.map(l => l.cardId), prompt: `링크 상한 초과 — 파기할 기존 링크 카드를 선택하세요 (룰 4-9-5)` });
  return Number.isInteger(i) && i >= 0 && i < stack.linkCards.length ? i : 0;
}
export function linkCardTo(state, p, uid, linkCardId, grantedBySourceId, cost, source = 'hand', discardIdx = undefined) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return null;
  if (source === 'hand' && (!pl.hand.includes(linkCardId) || !canPayCost(state, cost))) { log(state, pl.hand.includes(linkCardId) ? `${p} 링크 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)` : `핸드에 ${linkCardId} 없음`); return null; }
  stack.linkCards = stack.linkCards || [];
  // 4-9-5: the cap is ONE Link Card per Digimon TOTAL (raised only by
  // ≪링크+N≫), not one per granting source. Exceeding it discards existing
  // link card(s) to make room — the rulebook has the player choose which;
  // there's no picker UI yet, so this discards oldest-attached first.
  const cap = 1 + (stack.inheritedKeywords?.['링크+'] || 0);
  while (stack.linkCards.length >= cap && stack.linkCards.length > 0) {
    const [old] = stack.linkCards.splice(Number.isInteger(discardIdx) && discardIdx >= 0 && discardIdx < stack.linkCards.length ? discardIdx : 0, 1);
    discardIdx = undefined;
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
  dispatchHookEvents(state, 'linked', { owner: p, stack, linkCardId }); // s8: "이/자신의 디지몬이 링크되었을 때" watchers
  return stack;
}

// 6-5-1-4 / 10-1-1: link a Digimon that is in the BATTLE area (its top card) to another own Digimon. The rest of the leaving stack (evolution
// sources, its own link cards) goes to the trash and its 'leaves the battle area' triggers fire. Returns the host stack or null.
export function linkFromBattle(state, p, srcUid, hostUid, cost) {
  const pl = state.players[p];
  const src = pl.battle.find(s => s.uid === srcUid), host = pl.battle.find(s => s.uid === hostUid);
  if (!src || !host || src === host) return null;
  const chk = linkCheck(state, p, host, src.cardId);
  if (!chk.ok) { log(state, `${p} 링크 불가: ${chk.reason}`); return null; }
  if (!canPayCost(state, cost)) { log(state, `${p} 링크 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); return null; }
  pl.battle.splice(pl.battle.indexOf(src), 1);
  const extra = [...src.sources, ...(src.linkCards || []).map(l => l.cardId)];
  pl.trash.push(...extra);
  for (const id of src.sources) applyOverflowIfAny(state, p, id);
  hookLeaveTriggers(state, p, src, 'link');
  return linkCardTo(state, p, hostUid, src.cardId, src.cardId, cost, 'battle');
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
  if (effectBlocked(state, p, stack, 'other')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과를 받지 않아 ${keyword}을(를) 얻지 않음 (15-15-5-4)`); return; }
  const expiresAfterTurn = duration === 'permanent' ? 'permanent'
    : duration === 'opponentTurn' ? state.turnNumber + 1
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

// 2-5-3: a card that has no DP can't have DP added to or subtracted from it (unless an effect gave it an original DP).
export function stackHasDP(state, stack) {
  const ov = stack.dpBaseOverride;
  return card(stack.cardId).dp != null || !!(ov && state.turnNumber <= ov.until);
}
export function modifyDP(state, p, uid, amount, duration = 'turn') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (!stackHasDP(state, stack)) { log(state, `${p} ${card(stack.cardId).nameKo}는 DP를 가지지 않아 DP를 증감할 수 없음 (룰 2-5-3)`); return; }
  if (amount < 0 && s1Flag(state, stack, 'noNegDP')) { log(state, `${p} ${card(stack.cardId).nameKo}는 DP가 마이너스되지 않음`); return; } // shard1
  if (amount < 0 && effectBlocked(state, p, stack, 'dpDown')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과로 DP가 감소하지 않음`); return; }
  if (amount < 0 && hasKeyword(stack, 'DP감소무효')) {
    log(state, `${p} ${card(stack.cardId).nameKo}는 DP 감소 무효 — ${amount} 무시됨`);
    return;
  }
  stack.tempDP = (stack.tempDP || 0) + amount;
  stack.dpExpiry = duration === 'permanent' ? 'permanent' : (duration === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber);
  log(state, `${p} ${card(stack.cardId).nameKo} DP ${amount >= 0 ? '+' : ''}${amount} (${duration})`);
  ruleCheckDP(state, p, stack);
}

// 17-1-3-1/17-1-3-1-1: a battle-area Digimon whose DP is reduced to 0 (or
// below) vanishes automatically the moment a rule check is possible — not
// tied to any specific card's own effect. Swept after anything that can
// move a stack's effective DP downward.
// 17-1-2-2: rule checks are not performed while an effect is being processed (runScript depth > 0); they are
// remembered and run once the outermost effect finishes (flushRuleChecks, called from effects.js runScript).
export function flushRuleChecks(state) {
  const list = state._rcPending; state._rcPending = null;
  if (!list) return;
  const seen = new Set();
  const known = new Set(state.pending.map(x => x.uid));
  for (const { p, uid } of list) {
    if (seen.has(p + uid)) continue; seen.add(p + uid);
    const pl = state.players[p];
    const st = pl.battle.find(s => s.uid === uid);
    if (st) ruleCheckDP(state, p, st);
  }
  // 15-4-3-3: 【소멸 시】 etc. triggered by a rule-check deletion trigger simultaneously with the effects already waiting
  // (they are not "derived" triggers of the effect that just resolved, so they stay in the same resolution tier).
  for (const x of state.pending) if (!known.has(x.uid)) x.rcSim = true;
}
function ruleCheckDP(state, p, stack) {
  if (state._rcDepth > 0) { (state._rcPending = state._rcPending || []).push({ p, uid: stack.uid }); return; }
  const pl = state.players[p];
  if (!pl.battle.includes(stack)) return; // rule applies to the battle area only, not the raising area
  // 17-1-3-2-5: Link Cards beyond the Link cap (e.g. the ≪링크+N≫ source is gone) are discarded (no deletion).
  const linkCap = 1 + (stack.inheritedKeywords?.['링크+'] || 0);
  while ((stack.linkCards || []).length > linkCap) { const ex = stack.linkCards.pop(); pl.trash.push(ex.cardId); log(state, `${p} ${card(ex.cardId).nameKo} 링크 상한 초과로 파기 (17-1-3-2-5)`); }
  // 17-1-3-2-6 / 17-1-3-2-7: Link Cards whose printed Link condition the host no longer meets, or whose category
  // isn't the linkable one (Digimon), are discarded. Conservative: only when the condition parses to a predicate.
  if ((stack.linkCards || []).length && card(stack.cardId).category === 'digimon') {
    for (const l of [...stack.linkCards]) {
      let bad = card(l.cardId).category !== 'digimon';
      if (!bad) { const g = parseLinkGrant(l.cardId); const pr = g && evoTargetPredicate(g.conditionText); bad = !!pr && !pr(card(stack.cardId)); }
      if (!bad) continue;
      stack.linkCards.splice(stack.linkCards.indexOf(l), 1);
      if (!CARDS[l.cardId]?.isToken) pl.trash.push(l.cardId);
      recomputeStackGrants(stack);
      log(state, `${p} ${card(l.cardId).nameKo} 링크 조건/카테고리가 맞지 않아 룰체크로 파기 (17-1-3-2-6/7)`);
    }
  }
  // 17-1-3-1-1 only concerns DIGIMON with DP; a Tamer/Option has no DP and is never "DP 0 -> deleted".
  if (['tamer', 'option'].includes(card(stack.cardId).category)) return;
  if (!stackHasDP(state, stack)) { // 2-5-3: no DP at all (e.g. BT18-086) — nothing to reduce to 0, but 17-1-3-2-1: such a Digimon in the battle area is DISCARDED (not deleted: no 【소멸 시】)
    const bi = pl.battle.indexOf(stack);
    if (bi !== -1 && card(stack.cardId).category === 'digimon') {
      pl.battle.splice(bi, 1);
      pl.trash.push(...[...stack.sources, stack.cardId, ...(stack.linkCards || []).map(l => l.cardId)].filter(x => !CARDS[x]?.isToken));
      log(state, `${p} ${card(stack.cardId).nameKo}: DP가 없는 디지몬이 배틀 에어리어에 있어 룰체크로 파기 (17-1-3-2-1)`);
    }
    return;
  }
  if (effectiveDP(state, p, stack) <= 0) {
    log(state, `${p} ${card(stack.cardId).nameKo} DP 0 이하 — 룰체크로 소멸 (17-1-3-1)`);
    deleteStack(state, p, stack.uid);
  }
}

export function unsuspendStack(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (hookNoUnsuspend(state, p, stack)) return;
  if (stack.cannotUnsuspendUntil != null && state.turnNumber <= stack.cannotUnsuspendUntil) { log(state, `${p} ${card(stack.cardId).nameKo}는 액티브되지 않는 상태`); return; } // s8: 액티브 봉인
  const wasRested = stack.suspended;
  stack.suspended = false;
  log(state, `${p} ${card(stack.cardId).nameKo} 액티브`);
  if (wasRested) emitGameEvent(state, 'active', { owner: p, stack, cause: 'effect' });
}

// 11-2-5 / 12-1-4: a Digimon that can't be rested can't declare an attack or block. (Rule-driven rest, so effect-immunity doesn't apply.)
export function canRestByRule(state, p, stack) {
  if (!stack) return false;
  if (hookCannotRest(state, p, stack) || hookNoRest(state, p, stack)) return false;
  if (stack.cannotBeRestedUntil === 'permanent' || (typeof stack.cannotBeRestedUntil === 'number' && state.turnNumber <= stack.cannotBeRestedUntil)) return false;
  return true;
}

export function restStack(state, p, uid, cause = 'effect') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (cause !== 'block' && effectBlocked(state, p, stack, 'rest')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과를 받지 않아 레스트되지 않음`); return; }
  if (hookCannotRest(state, p, stack) || hookNoRest(state, p, stack)) { log(state, `${p} ${card(stack.cardId).nameKo}는 효과로 레스트할 수 없음`); return; }
  if (stack.cannotBeRestedUntil === 'permanent' || (typeof stack.cannotBeRestedUntil === 'number' && state.turnNumber <= stack.cannotBeRestedUntil)) {
    log(state, `${p} ${card(stack.cardId).nameKo}는 레스트 불가 상태라 레스트되지 않음`);
    return;
  }
  const wasActive = !stack.suspended;
  stack.suspended = true;
  log(state, `${p} ${card(stack.cardId).nameKo} 레스트`);
  if (wasActive) emitGameEvent(state, 'rest', { owner: p, stack, cause });
}

// "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — a ONE-TIME skip of
// the next unsuspend cycle (consumed in engine.js's nextPhase), distinct
// from preventRest below (which blocks resting in the first place, not
// unsuspending an already-rested stack).
export function setSkipNextUnsuspend(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  if (effectBlocked(state, p, stack, 'other')) return;
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
  if (hookNoUnsuspend(state, p, stack)) return true;
  if (s1UnsuspendGate(state, p, stack)) return true; // shard1
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
  if (effectBlocked(state, p, stack, 'other')) return;
  stack.cannotBeRestedUntil = expiresAfterTurn;
  log(state, `${p} ${card(stack.cardId).nameKo} 레스트 불가 상태 부여`);
}

// Move the top card of own deck onto own security (top). Common "Recovery"
// keyword mechanic.
export function recoverTopOfDeckToSecurity(state, p) {
  const pl = state.players[p];
  if (s1SecIncreaseBlocked(state, p)) { log(state, `${p} 시큐리티를 늘릴 수 없음 (효과 제한)`); return null; } // shard1
  const id = pl.deck.shift();
  if (id) { pl.security.unshift(id); log(state, `${p} 리커버리: 덱 위 카드 시큐리티로 (${card(id).nameKo})`); emitGameEvent(state, 'securityIncrease', { owner: p, stack: null, cause: 'effect' }); } // 16-6: the security count rose
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
export function isPlayCostLocked(state) {
  for (const owner of ['p1', 'p2']) {
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

const COLOR_WORD = '레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트';

// Parses the "which card is being evolved INTO" descriptor of a continuous
// evolve-cost discount ("특징으로 「A」/「B」를 가진 디지몬 카드로", "명칭에
// 「X」를 포함하거나 특징 「Y」를 가진 카드로", "블랙인 카드로", "Lv.6의 ..."
// etc.) into a predicate over the target card, or null if any part isn't
// understood (so an unparsed ability just doesn't apply, never misapplies).
// OR-alternatives split on 거나/또는; constraints within one alternative AND.
function evoTargetPredicate(desc) {
  desc = desc.trim();
  if (!desc) return () => true;
  if (/트래시의|뒷면|이\s*턴|다음에/.test(desc)) return null;
  desc = desc.replace(/」\s*(?:또는|이나)\s*「/g, '」/「');
  const clauses = desc.split(/(?:거나|카드나|카드\s*또는)\s*|\s*또는\s*(?=특징|명칭)/).map(x => x.trim()).filter(Boolean);
  const quoted = (str) => [...str.matchAll(/「([^」]+)」/g)].map(m => m[1]);
  const preds = [];
  for (let c of clauses) {
    c = c.replace(/^패의\s*/, '').replace(/\s*(?:으로|로)\s*$/, '');
    const cons = [];
    let m;
    if ((m = c.match(/특징(?:으로|에|은)?\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*(가진|가지|포함하는|포함하|갖는)?/))) {
      const list = quoted(m[1]), incl = /포함/.test(m[2] || '');
      cons.push(t => (t.types || []).some(ty => list.some(x => incl ? ty.includes(x) : ty === x)));
    }
    if ((m = c.match(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함/))) {
      const list = quoted(m[1]);
      cons.push(t => list.some(x => t.nameKo.includes(x)));
    }
    if ((m = c.match(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술되어/))) {
      const list = quoted(m[1]);
      cons.push(t => list.some(x => t.nameKo.includes(x)));
    }
    const stripped = c.replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\/?)+/g, '').replace(/명칭에\s*(?:「[^」]+」\/?)+/g, '');
    if ((m = stripped.match(new RegExp(String.raw`((?:${COLOR_WORD})(?:\/(?:${COLOR_WORD}))*)\s*(?:인|의|을\s*포함하는|를\s*포함하는)`)))) {
      const cols = m[1].split('/').map(x => KOR_COLOR_NAME[x]);
      cons.push(t => (t.colors || []).some(x => cols.includes(x)));
    }
    if ((m = stripped.match(/Lv\.(\d+)/))) { const lv = Number(m[1]); cons.push(t => t.level === lv); }
    if (/다색|2색/.test(stripped)) cons.push(t => (t.colors || []).length >= 2);
    if (!cons.length && (m = c.match(/^((?:「[^」]+」\/?)+)$/))) {
      const list = quoted(m[1]);
      cons.push(t => list.includes(t.nameKo));
    }
    if (!cons.length) return null;
    preds.push(t => cons.every(f => f(t)));
  }
  return preds.length ? (t => preds.some(f => f(t))) : null;
}

const EVO_DISCOUNT_RE = new RegExp(String.raw`^(레스트\s*상태인\s*)?(이\s*디지몬(?:\s*또는\s*자신의\s*테이머)?|자신의\s*디지몬)(?:이|가)\s*(.*?)\s*진화할\s*때에?,?\s*(?:(${COLOR_WORD})인\s*자신의\s*테이머가\s*있다면,?\s*)?지불하는\s*(?:진화\s*)?코스트\s*(?:를\s*)?([+-]\s*\d+)\s*(?:한다)?\.?$`, 's');

// True when `body` is a continuous evolve-cost discount/penalty that
// continuousEvoCostDiscount can actually evaluate (used by the coverage
// audit so it mirrors the real parser instead of a hand-copied regex).
export function isHandledEvoDiscountBody(body) {
  let b = body.trim().split('\n')[0].trim();
  const lm = b.match(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*(.*)$/s);
  if (lm) b = lm[1];
  if (/^진화원을\s*갖지\s*않은\s*상대(?:의)?\s*디지몬이\s*진화할\s*때,?\s*지불하는\s*진화\s*코스트\s*\+\d+\.?$/.test(b)) return true;
  const m = b.match(EVO_DISCOUNT_RE);
  return !!m && !!evoTargetPredicate(m[3].replace(/\s*(?:으로|로)\s*$/, ''));
}

// "이 디지몬이 [특징 「X」를 가진 디지몬 카드]로 진화할 때, 지불하는 (진화)
// 코스트 -N." family (~50 real cards) — a CONTINUOUS evolution-cost discount,
// unlike the one-shot addEvoCostMod/consumeEvoCostMod pair above. Checked at
// the real evolve moment (called once from main.js), so "[턴에 N회]" limits
// are enforced here via the shared turnEffectUses counter. Also covers the
// mirror-image opponent penalty "진화원을 갖지 않은 상대의 디지몬이 진화할
// 때, 지불하는 진화 코스트 +N." (read from the ability owner's board).
export function continuousEvoCostDiscount(state, p, stack, targetCardId) {
  const tgt = card(targetCardId);
  let total = 0;
  const scan = (owner, ownStack, forOpponentPenalty) => {
    for (const { id, own } of stackContributors(ownStack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === owner);
        if (!active) continue;
        // Some prints append a trailing "〈룰〉…" rules line to the same segment.
        let body = seg.body.trim().split('\n')[0].trim();
        let limit = null;
        const lm = body.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]\s*(.*)$/s);
        if (lm) { limit = Number(lm[1]); body = lm[2]; }
        let delta = null;
        if (forOpponentPenalty) {
          const pm = body.match(/^진화원을\s*갖지\s*않은\s*상대(?:의)?\s*디지몬이\s*진화할\s*때,?\s*지불하는\s*진화\s*코스트\s*(\+\d+)\.?$/);
          if (pm && stack.sources.length === 0) delta = Number(pm[1]);
        } else {
          const m = body.match(EVO_DISCOUNT_RE);
          if (!m) continue;
          if (m[1] && !ownStack.suspended) continue;
          const pred = evoTargetPredicate(m[3].replace(/\s*(?:으로|로)\s*$/, ''));
          if (!pred || !pred(tgt)) continue;
          if (m[4]) {
            const col = KOR_COLOR_NAME[m[4]];
            if (!state.players[owner].battle.some(s => card(s.cardId).category === 'tamer' && (card(s.cardId).colors || []).includes(col))) continue;
          }
          delta = Number(m[5].replace(/\s+/g, ''));
        }
        if (delta == null) continue;
        if (limit != null) {
          const key = onceLimitKey(id, seg.tags);
          if (turnUsesRemaining(ownStack, key, limit) <= 0) continue;
          markTurnEffectUsed(ownStack, key);
        }
        total += delta;
      }
    }
  };
  scan(p, stack, false);
  const opp = opponentOf(p);
  const oppPl = state.players[opp];
  for (const s of [oppPl.raising, ...oppPl.battle].filter(Boolean)) scan(opp, s, true);
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

// "[턴 N회] 특징 「X」를 가진 디지몬 카드가 등장할 때, 지불하는 코스트 -N
// 할 수 있다." (BT22-079/080, BT23-073, all inheritedKo, printed with a
// "[육성]" zone marker — only active while the source card is physically
// sitting in the Breeding Area). Unlike tamerPlayCostDiscount, there's no
// activation cost at all (no resting), just a once-per-turn cap tracked via
// the same turnEffectUses mechanism the UI's parseOnceLimit uses elsewhere.
// Trait matched EXACTLY (not .includes(), unlike the sibling functions
// above) — "이터" is a substring of the unrelated real trait "리버레이터",
// so a loose substring match here would misfire on it.
export function traitPlayCostDiscount(state, p, targetCardId) {
  if (isPlayCostLocked(state)) return 0;
  const tgt = card(targetCardId);
  const pl = state.players[p];
  for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
    const inRaising = stack === pl.raising;
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || seg.tags[0] !== '자신의 턴') continue;
        if (state.activePlayer !== p) continue;
        if (seg.zoneMarker === '육성' && !inRaising) continue;
        const limitM = seg.body.trim().match(/^[\[〔]턴\s*(\d+)\s*회[\]〕]\s*(.+)$/s);
        if (!limitM) continue;
        const m = limitM[2].match(/^특징\s*「([^」]+)」\s*(?:을|를)?\s*가진\s*디지몬\s*카드가\s*등장할\s*때,?\s*지불하는\s*코스트\s*(-\d+)\s*할\s*수\s*있다\.?$/);
        if (!m) continue;
        if (!(tgt.types || []).includes(m[1])) continue;
        const key = onceLimitKey(id, seg.tags);
        if (turnUsesRemaining(stack, key, Number(limitM[1])) <= 0) continue;
        markTurnEffectUsed(stack, key);
        log(state, `${p} ${card(id).nameKo} 특징 할인 — ${tgt.nameKo} 등장 코스트 ${m[2]}`);
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
//
// `stackUid`, when given, also checks a second, narrower shape: "메모리가 N
// 이하인 동안, 이 디지몬의 DP 소멸 효과의 상한 +N." (BT17-008/010, BT19-007/
// 009, all inheritedKo) — scoped to just THAT ONE stack's own destroy
// effects (not player-wide) and gated on the controller's EFFECTIVE memory
// (the shared gauge is positive = p1's side, so p2 reads it negated).
export function dpDestroyCapBoost(state, p, stackUid) {
  const pl = state.players[p];
  let total = s1HookSum(state, 's1dpCap', { p }); // shard1
  for (const stack of [pl.raising, ...pl.battle].filter(Boolean)) {
    for (const { id, own } of stackContributors(stack)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
        if (!active) continue;
        let m = seg.body.trim().match(/^자신이?\s*발휘하는\s*DP\s*소멸\s*효과의?\s*상한\s*\+(\d+)\.?$/);
        if (m) { total += Number(m[1]); continue; }
        if (stack.uid !== stackUid) continue;
        m = seg.body.trim().match(/^이\s*디지몬의\s*DP\s*소멸\s*효과의?\s*상한\s*\+(\d+)\.?$/);
        if (m) { total += Number(m[1]); continue; }
        m = seg.body.trim().match(/^메모리가\s*(-?\d+)\s*이하인\s*동안,?\s*이\s*디지몬의\s*DP\s*소멸\s*효과의?\s*상한\s*\+(\d+)\.?$/);
        if (m) {
          const effMemory = p === 'p1' ? state.memory : -state.memory;
          if (effMemory <= Number(m[1])) total += Number(m[2]);
        }
      }
    }
  }
  return total;
}

// Returns the best (most negative) still-valid, one-time cost delta for
// evolving INTO `targetCardId`, and marks it consumed. Call this exactly
// once per resolved evolution.
// Snapshot/restore of the one-time evolve-cost mods' "used" flags, so a rejected evolution/jogress (e.g. unpayable cost) does not burn the discount.
export function snapshotEvoCostMods(state, p) { return (state.players[p].evoCostMods || []).map(m => [m, !!m.usedUp]); }
export function restoreEvoCostMods(snap) { for (const [m, u] of snap) m.usedUp = u; }
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

// 《디지버스트》: after the sources are paid, each trashed card's own "이 디지몬이 발휘한
// 《디지버스트》로 이 카드가 파기되었을 때, <효과>" (BT4-008 etc.) queues its effect.
export function queueDigiburstTrashed(state, p, cardId, stackUid) {
  const c = card(cardId);
  for (const f of ['inheritedKo', 'effectKo']) {
    if (!c[f]) continue;
    for (const seg of parseEffectSegments(c[f]).segments) {
      const m = seg.body.trim().match(/^이\s*디지몬이\s*발휘한\s*《디지버스트》로\s*이\s*카드가\s*파기되었을\s*때,?\s*(.+)$/s);
      if (m) state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId, stackUid, tags: seg.tags, text: m[1].trim(), resolved: false });
    }
  }
}

// Which sources a 《디지버스트》 should trash: those carrying a digiburst-trashed payoff first, then oldest.
export function digiburstPickSources(stack, n) {
  const has = (id) => /발휘한\s*《디지버스트》로\s*이\s*카드가\s*파기되었을\s*때/.test(`${card(id).inheritedKo || ''}${card(id).effectKo || ''}`);
  const order = stack.sources.map((id, i) => ({ id, i, pri: has(id) ? 0 : 1 })).sort((a, b) => a.pri - b.pri || a.i - b.i).slice(0, n);
  return order.map(x => x.i);
}

// 《디지버스트 N》: the PLAYER chooses which N sources are trashed (digiburstPickSources is only the headless fallback).
export async function digiburstChooseSources(state, p, stack, n, choose) {
  if (n >= stack.sources.length || typeof choose !== 'function') return digiburstPickSources(stack, n);
  const r = await choose('pickSourcesMulti', { player: p, uid: stack.uid, ids: stack.sources.slice(), n, prompt: `《디지버스트》 — 파기할 진화원 ${n}장을 선택하세요` });
  if (Array.isArray(r) && r.length === n && r.every(i => Number.isInteger(i) && i >= 0 && i < stack.sources.length) && new Set(r).size === n) return r;
  return digiburstPickSources(stack, n);
}

export function trashEvoSources(state, p, uid, count, from = 'bottom', pickIdx = null) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return [];
  if (effectBlocked(state, p, stack, 'other') || effectBlocked(state, p, stack, 'srcTrash')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과를 받지 않아 진화원이 파기되지 않음`); return []; }
  { const alt = pickIdx == null ? S2.sourceTrashRedirect(state, p, stack) : null; if (alt) return trashEvoSources(state, p, alt.uid, count, from, null); } // shard2 (BT10-084)
  if (state._fxSrc) { // shard1 (BT9-109): protected sources can't be trashed by effects
    const prot = stack.sources.map((id, i) => (s1ProtectedSource(state, p, stack, id) ? i : -1)).filter(i => i >= 0);
    if (prot.length) {
      const free = stack.sources.map((id, i) => i).filter(i => !prot.includes(i));
      const nn = count === 'all' ? free.length : Math.min(count, free.length);
      pickIdx = pickIdx ? pickIdx.filter(i => !prot.includes(i)) : (from === 'top' ? free.slice(free.length - nn) : free.slice(0, nn));
      count = pickIdx.length;
    }
  }
  const n = count === 'all' ? stack.sources.length : Math.min(count, stack.sources.length);
  // sources[] is oldest-first: "from the bottom" = earliest pushed, "from the top" = latest.
  let removed;
  const fd0 = fdCount(stack); // shard5: keep the face-down bottom block count in sync
  let fdGone = 0;
  if (pickIdx) { removed = []; for (const i of [...pickIdx].sort((a, b) => b - a)) { if (i < fd0) fdGone++; removed.unshift(...stack.sources.splice(i, 1)); } }
  else if (from === 'top') { removed = stack.sources.splice(stack.sources.length - n, n); fdGone = Math.max(0, fd0 - stack.sources.length); }
  else { removed = stack.sources.splice(0, n); fdGone = Math.min(fd0, n); }
  if (fd0) stack.s5fd = Math.max(0, fd0 - fdGone);
  pl.trash.push(...removed);
  log(state, `${p} ${card(stack.cardId).nameKo} 진화원 ${removed.length}장 파기`);
  if (removed.length) emitGameEvent(state, 'sourcesTrashed', { owner: p, stack, cause: state._fxSrc ? 'effect' : null, from, ids: removed, srcPlayer: state._fxSrc?.player });
  for (const id of removed) applyOverflowIfAny(state, p, id);
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  return removed;
}

// Schedule an effect to run automatically when the CURRENT active player's
// turn ends (e.g. "gain 3 memory now; lose 3 at end of turn").
// meta (all optional): { player: who the delayed effect belongs to (default: the turn player), cardId, label,
//   expire: true -> pure duration expiry (no trigger/ordering; runs when the turn actually finishes) }.
// Non-expire entries are held effects ("이 턴 종료 시 …", 18-1): at turn end they wait in state.pending like any
// trigger so the turn player can order them against 【턴 종료 시】 effects (18-1-2 / 4-3-2).
export function scheduleEndOfTurn(state, fn, meta = {}) {
  state.endOfTurnEffects = state.endOfTurnEffects || [];
  state.endOfTurnEffects.push({ turnNumber: state.turnNumber, fn, ...meta });
}

// Turn end phase (6-6-1): held end-of-turn effects due now become pending items (resolved via item.schedFn).
export function queueScheduledTurnEnd(state, finishing) {
  const all = state.endOfTurnEffects || [];
  const due = all.filter(e => e.turnNumber === state.turnNumber && !e.expire);
  state.endOfTurnEffects = all.filter(e => !due.includes(e));
  for (const e of due) {
    state.pending.push({ uid: 'p' + (pendingUid++), player: e.player || finishing, cardId: e.cardId || '예약 효과', stackUid: null, tags: ['__턴종료예약'], text: e.label || '이 턴 종료 시 예약된 효과', resolved: false, schedFn: e.fn });
  }
}

// Duration expiries scheduled with expire:true run when the turn actually finishes (6-6-3).
export function runExpiringEndOfTurnEffects(state) {
  const all = state.endOfTurnEffects || [];
  const due = all.filter(e => e.turnNumber === state.turnNumber);
  state.endOfTurnEffects = all.filter(e => e.turnNumber !== state.turnNumber);
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

// ---- 디지크로스 (DigiXros, rule 7-2) ----
// "디지크로스 -N: 「A」×「B」×특징으로 「X」를 가진 디지몬 카드 2장" — while playing this
// Digimon from hand, place any of the listed cards (from hand and/or the battle
// area) under it; each placed card lowers the play cost by N.
export function parseDigiXros(cardId) {
  const line = (card(cardId).effectKo || '').split('\n').map(l => l.trim()).find(l => /^디지크로스\s*-\s*\d+\s*[:：]/.test(l));
  if (!line) return null;
  const m = line.match(/^디지크로스\s*-\s*(\d+)\s*[:：]\s*(.+)$/);
  if (!m) return null;
  const reqs = [];
  for (let item of m[2].split('×')) {
    item = item.trim();
    if (!item) continue;
    let mm;
    if ((mm = item.match(new RegExp(String.raw`^(?:(${COLOR_WORD})인\s*)?「([^」]+)」`)))) { reqs.push({ name: mm[2], color: mm[1] ? KOR_COLOR_NAME[mm[1]] : null, count: 1 }); continue; }
    if ((mm = item.match(/^《([^》]+)》(?:이|가)\s*기술되어\s*있는\s*디지몬\s*카드\s*(\d+|∞)\s*장/))) { reqs.push({ keyword: mm[1], count: mm[2] === '∞' ? 99 : Number(mm[2]) }); continue; }
    if ((mm = item.match(/^특징(?:으로)?\s*((?:「[^」]+」\s*(?:또는|\/)?\s*)+)(?:를|을)\s*(가진|포함하는)\s*((?:명칭이|카드\s*넘버가)\s*서로\s*다른\s*)?디지몬\s*카드\s*(\d+|∞)\s*장/))) {
      reqs.push({ traits: [...mm[1].matchAll(/「([^」]+)」/g)].map(x => x[1]), includes: mm[2] === '포함하는', distinct: !!mm[3], count: mm[4] === '∞' ? 99 : Number(mm[4]) });
      continue;
    }
    break; // text after the requirement list (keywords, notes) — stop parsing
  }
  return reqs.length ? { per: Number(m[1]), reqs } : null;
}

// Greedy plan of which materials to place (hand first, then battle-area stacks).
// `handIndex` is the card being played (excluded from the materials).
// ---- 어셈블리 (Assembly, 7-3) ----
// "어셈블리 -N: <조건> (N장) …" — while playing this Digimon from hand, place EXACTLY the required cards from the TRASH under it (all or nothing,
// 7-3-2-4) to lower the play cost by N (a fixed amount, not per card).
const ASM_COLORS = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
function parseAssemblyItem(txt, inheritCore) {
  const names = (m) => [...m.matchAll(/「([^」]+)」/g)].map(x => x[1]);
  let t = txt.trim(), count = 1, distinct = null;
  let m = t.match(/(\d+)\s*장\s*$/); if (m) { count = Number(m[1]); t = t.slice(0, m.index); }
  if (/명칭이\s*서로\s*다른/.test(t)) distinct = 'name';
  else if (/카드\s*넘버가\s*서로\s*다른/.test(t)) distinct = 'number';
  else if (/Lv\.\s*이\s*(?:서로\s*)?다른/.test(t)) distinct = 'level';
  const atoms = [];
  const NL = String.raw`((?:「[^」]+」\/?\s*)+)`;
  let rest = t;
  const take = (re, fn) => { const mm = rest.match(re); if (mm) { atoms.push(fn(names(mm[1]))); rest = rest.replace(mm[0], ' '); } };
  take(new RegExp(String.raw`명칭에\s*${NL}(?:을|를)?\s*포함`), (l) => (c) => l.some(x => c.nameKo.includes(x)));
  take(new RegExp(String.raw`특징에\s*${NL}(?:을|를)?\s*포함`), (l) => (c) => (c.types || []).some(ty => l.some(x => ty.includes(x))));
  take(new RegExp(String.raw`특징(?:으로)?\s*${NL}(?:을|를)?\s*가(?:진|지고)`), (l) => (c) => (c.types || []).some(ty => l.includes(ty)));
  take(new RegExp(String.raw`${NL}(?:의\s*기술이\s*있는|(?:이|가)\s*기술되어\s*있)`), (l) => (c) => l.some(x => c.nameKo.includes(x)));
  if (!atoms.length && /「/.test(rest)) { const l = names(rest); if (l.length) atoms.push((c) => l.includes(c.nameKo)); }
  let lvTest = null;
  if ((m = t.match(/Lv\.\s*(\d+)\s*(이하|이상)?/))) { const n = Number(m[1]); lvTest = m[2] === '이하' ? (c) => c.level != null && c.level <= n : m[2] === '이상' ? (c) => c.level != null && c.level >= n : (c) => c.level === n; }
  let colTest = null;
  if ((m = t.match(/(레드|블루|옐로우|옐로|그린|블랙|퍼플|화이트)인/))) { const col = ASM_COLORS[m[1]]; colTest = (c) => (c.colors || []).includes(col); }
  const cat = /디지몬\s*카드/.test(t) ? 'digimon' : /테이머\s*카드/.test(t) ? 'tamer' : null;
  let core = atoms.length ? (c) => atoms.some(f => f(c)) : null;
  if (!core) core = inheritCore || (lvTest || colTest || cat ? () => true : null);
  if (!core) return null;
  const test = (c) => core(c) && (!lvTest || lvTest(c)) && (!colTest || colTest(c)) && (!cat || c.category === cat);
  return { test, count, distinct, hasCore: atoms.length > 0, coreFn: atoms.length ? core : null };
}
export function parseAssembly(cardId) {
  const line = (card(cardId).effectKo || '').split('\n').map(l => l.trim()).find(l => /^어셈블리\s*-\s*\d+\s*[:：]/.test(l));
  if (!line) return null;
  const m = line.match(/^어셈블리\s*-\s*(\d+)\s*[:：]\s*(.+)$/);
  let desc = m[2].replace(/\s*등장할\s*때,.*$/, '').trim();
  const alts = desc.split(/\s+\/\s+/); // "「A」 / 특징에 「TS」를 가진 테이머 카드": one slot satisfied by either
  let reqs = [];
  if (alts.length > 1) {
    const items = alts.map(a => parseAssemblyItem(a, null));
    if (items.some(x => !x)) return null;
    reqs = [{ test: (c) => items.some(x => x.test(c)), count: 1, distinct: null }];
  } else {
    const parts = desc.split(/\s*×\s*|\s+[xX]\s+/);
    let core0 = null;
    for (let i = 0; i < parts.length; i++) {
      const it = parseAssemblyItem(parts[i], i > 0 ? core0 : null);
      if (!it) return null;
      if (i === 0 && it.coreFn) core0 = it.coreFn;
      reqs.push(it);
    }
  }
  return { per: Number(m[1]), reqs };
}
// Find cards in `pool` (array of cardIds) that satisfy every requirement exactly (assignment search). Returns the picked ids (requirement order) or null.
export function solveAssembly(asm, pool) {
  const slots = []; asm.reqs.forEach((r, ri) => { for (let k = 0; k < r.count; k++) slots.push(ri); });
  const used = new Array(pool.length).fill(false), chosen = [];
  const distinctOk = (ri, ids) => {
    const d = asm.reqs[ri].distinct; if (!d) return true;
    const keys = ids.map(id => d === 'name' ? card(id).nameKo : d === 'number' ? id : card(id).level);
    return new Set(keys).size === keys.length;
  };
  // prefilter: every requirement needs enough (distinct) candidates; then a bounded search (a trash never has more than ~50 cards)
  const keyOf = (ri, id) => { const d = asm.reqs[ri].distinct; return d === 'name' ? card(id).nameKo : d === 'number' ? id : d === 'level' ? card(id).level : id + '#'; };
  for (let ri = 0; ri < asm.reqs.length; ri++) {
    const cand = pool.filter(id => asm.reqs[ri].test(card(id)));
    const n = asm.reqs[ri].distinct ? new Set(cand.map(id => keyOf(ri, id))).size : cand.length;
    if (n < asm.reqs[ri].count) return null;
  }
  let steps = 0;
  const dfs = (si) => {
    if (si === slots.length) return true;
    if (++steps > 200000) return false;
    const ri = slots[si];
    const tried = new Set();
    for (let i = 0; i < pool.length; i++) {
      if (used[i] || tried.has(asm.reqs[ri].distinct ? keyOf(ri, pool[i]) : pool[i])) continue;
      const c = card(pool[i]);
      if (!asm.reqs[ri].test(c)) continue;
      const prev = chosen.filter(x => x.ri === ri).map(x => x.id);
      if (!distinctOk(ri, [...prev, pool[i]])) continue;
      tried.add(asm.reqs[ri].distinct ? keyOf(ri, pool[i]) : pool[i]);
      used[i] = true; chosen.push({ ri, id: pool[i] });
      if (dfs(si + 1)) return true;
      used[i] = false; chosen.pop();
    }
    return false;
  };
  if (!dfs(0)) return null;
  return chosen.map(x => x.id);
}
// Plan for playing the hand card at `handIndex`: { per, materials:[{kind:'trash',cardId}], discount } or null (no assembly / cannot be satisfied from the trash).
export function planAssembly(state, p, handIndex) {
  const pl = state.players[p];
  const cardId = pl.hand[handIndex];
  const asm = cardId ? parseAssembly(cardId) : null;
  if (!asm) return null;
  const ids = solveAssembly(asm, pl.trash);
  if (!ids) return null;
  return { per: asm.per, materials: ids.map(id => ({ kind: 'trash', cardId: id })), discount: asm.per };
}

// Two-step DigiXros selection for UIs (7-2-2-3/4): digiXrosOptions lists every legal candidate (each with a stable `key`), then
// planDigiXrosPicked builds the plan from just the keys the player ticked (at least one; each requirement still capped by its count).
export function digiXrosOptions(state, p, handIndex, cardIdOverride = null, zone = 'hand') {
  const list = [], cnt = {};
  planDigiXros(state, p, handIndex, (id, kind) => { const k = kind + ':' + id; cnt[k] = (cnt[k] || 0) + 1; list.push({ cardId: id, kind, key: k + '#' + cnt[k] }); return false; }, cardIdOverride, zone);
  return list;
}
export function planDigiXrosPicked(state, p, handIndex, keys, cardIdOverride = null, zone = 'hand') {
  const cnt = {};
  return planDigiXros(state, p, handIndex, (id, kind) => { const k = kind + ':' + id; cnt[k] = (cnt[k] || 0) + 1; return keys.has(k + '#' + cnt[k]); }, cardIdOverride, zone);
}
// 7-2-2-3/4: `ask(cardId, kind)` (optional, sync) lets the player pick which of the matching candidates to place — omit it for the greedy maximum.
// `cardIdOverride`: plan for a card that is not in hand (effect-driven play from the trash, 7-2-2-13).
export function planDigiXros(state, p, handIndex, ask = null, cardIdOverride = null, zone = 'hand') {
  const pl = state.players[p];
  const cardId = cardIdOverride || pl.hand[handIndex];
  const xr = cardId ? parseDigiXros(cardId) : null;
  if (!xr) return null;
  const usedHand = new Set(handIndex != null && zone === 'hand' ? [handIndex] : []), usedStacks = new Set(), materials = [];
  const extras = [];
  for (const { hp, holder, d } of activeHooks(state)) if (hp === p && d.xrosExtra && !holder.suspended) { const e = d.xrosExtra(state, hp, holder, cardId); if (e) extras.push({ holder, underLeft: e.under ?? 0, trashLeft: e.trash ?? 0 }); }
  const matches =(req, c) => req.name ? (c.nameKo === req.name && (!req.color || (c.colors || []).includes(req.color)))
    : req.keyword ? (c.category === 'digimon' && `${c.effectKo || ''}
${c.inheritedKo || ''}`.includes(`《${req.keyword}`))
    : (c.category === 'digimon' && (c.types || []).some(t => req.traits.some(x => req.includes ? t.includes(x) : t === x)));
  for (const req of xr.reqs) {
    let need = req.count;
    const names = new Set();
    for (let i = 0; i < pl.hand.length && need > 0; i++) {
      if (usedHand.has(i)) continue;
      const c = card(pl.hand[i]);
      if (!matches(req, c) || (req.distinct && names.has(c.nameKo))) continue;
      if (ask && !ask(pl.hand[i], 'hand')) continue;
      usedHand.add(i); names.add(c.nameKo); need--;
      materials.push({ kind: 'hand', cardId: pl.hand[i] });
    }
    for (const st of pl.battle) {
      if (need <= 0) break;
      if (usedStacks.has(st.uid) || card(st.cardId).category !== 'digimon') continue;
      const c = card(st.cardId);
      if ((!matches(req, c) && !S2.xrosSub(state, p, st)) || (req.distinct && names.has(c.nameKo))) continue; // shard2 (BT10-111 substitute)
      if (ask && !ask(st.cardId, 'battle')) continue;
      usedStacks.add(st.uid); names.add(c.nameKo); need--;
      materials.push({ kind: 'stack', uid: st.uid, cardId: st.cardId });
    }
    // s5: tamers ("이 테이머를 레스트시키는 것으로, 자신의 테이머 아래(와 트래시)의 카드도 놓을 수 있다") lend extra materials
    for (const ex of extras) {
      for (let i = 0; i < ex.holder.sources.length && need > 0 && ex.underLeft > 0; i++) {
        const id = ex.holder.sources[i], c = card(id);
        if (!matches(req, c) || (req.distinct && names.has(c.nameKo)) || materials.some(m => m.kind === 'tamer' && m.tamerUid === ex.holder.uid && m.idx === i)) continue;
        if (ask && !ask(id, 'tamer')) continue;
        names.add(c.nameKo); need--; ex.underLeft--; ex.used = true;
        materials.push({ kind: 'tamer', tamerUid: ex.holder.uid, cardId: id, idx: i });
      }
      for (let i = 0; i < pl.trash.length && need > 0 && ex.trashLeft > 0; i++) {
        if (zone === 'trash' && i === handIndex) continue; // the card being played itself
        const id = pl.trash[i], c = card(id);
        if (!matches(req, c) || (req.distinct && names.has(c.nameKo)) || materials.some(m => m.kind === 'trash' && m.idx === i)) continue;
        if (ask && !ask(id, 'trash')) continue;
        names.add(c.nameKo); need--; ex.trashLeft--; ex.used = true;
        materials.push({ kind: 'trash', cardId: id, idx: i, tamerUid: ex.holder.uid });
      }
    }
  }
  return materials.length ? { per: xr.per, materials, discount: xr.per * materials.length, restTamers: extras.filter(e => e.used).map(e => e.holder.uid) } : null;
}

// 7-2-2-3/7-2-2-7: put DigiXros materials under a freshly played stack — hand cards by id, battle-area Digimon leave the area
// (their link cards are discarded and 'leave the battle area' triggers fire, 7-2-2-7) and bring their own sources with them.
// Returns how many material cards were actually placed (= the number "디지크로스하고 있었다면" counts, 7-2-2-9/10).
function placeXrosMaterials(state, p, stack, mats) {
  const pl = state.players[p];
  let placed = 0;
  for (const mt of mats) {
    if (mt.kind === 'hand') {
      const hi = pl.hand.indexOf(mt.cardId);
      if (hi !== -1) { pl.hand.splice(hi, 1); stack.sources.push(mt.cardId); placed++; }
    } else if (mt.kind === 'tamer') {
      const t = pl.battle.find(x => x.uid === mt.tamerUid);
      const ti = t ? t.sources.lastIndexOf(mt.cardId) : -1;
      if (ti !== -1) { t.sources.splice(ti, 1); stack.sources.push(mt.cardId); placed++; }
    } else if (mt.kind === 'trash') {
      const ti = pl.trash.lastIndexOf(mt.cardId);
      if (ti !== -1) { pl.trash.splice(ti, 1); stack.sources.push(mt.cardId); placed++; }
    } else {
      const bi = pl.battle.findIndex(x => x.uid === mt.uid);
      if (bi !== -1) {
        const [ms] = pl.battle.splice(bi, 1);
        discardLinkCardsOnNewCard(state, p, ms);
        stack.sources.push(...ms.sources, ms.cardId); placed++;
        hookLeaveTriggers(state, p, ms, 'xros'); // 7-2-2-7
      }
    }
  }
  return placed;
}

export function playDigimonFresh(state, p, handIndex, opts = {}) {
  const pl = state.players[p];
  const [id] = pl.hand.splice(handIndex, 1);
  if (!id) return null;
  const stack = makeStack(id, state.turnNumber);
  // 디지크로스: materials go under the new card (7-2-2-3/7-2-2-7) — hand cards by id,
  // battle-area Digimon leave the area and bring their own sources with them.
  const s2mat = state._s2PlayMat || []; state._s2PlayMat = null; // shard2: play-discount materials chosen via a hook (BT10-093)
  if ((opts.assembly || []).length) placeXrosMaterials(state, p, stack, [...opts.assembly].reverse()); // 7-3-2-6: the card written leftmost ends up on top
  const xrosPlaced = placeXrosMaterials(state, p, stack, [...[...(opts.materials || [])].reverse(), ...s2mat]); // 7-2-2-8: the material written LEFTMOST in the condition ends up on top (sources[] is oldest-first, so push it last)
  stack.xrosCount = xrosPlaced; // 7-2-2-9/10: number of cards placed under by DigiXros (0 = did not DigiXros); usable by "디지크로스하고 있었다면" conditions
  for (const tu of opts.restTamers || []) restStack(state, p, tu); // s5: tamers rested as the cost of lending materials
  if ((opts.materials || []).length) log(state, `${p} 디지크로스: ${(opts.materials).map(m => card(m.cardId).nameKo).join(', ')}을(를) 아래에 놓음`);
  recomputeStackGrants(stack); // picks up any keyword the card innately has on its own printed text
  stack.byEffect = { kind: 'play', effect: false, turn: state.turnNumber }; // s8: "효과로 등장했다면"
  pl.battle.push(stack);
  log(state, `${p} ${card(id).nameKo} 신규 등장 (배틀 에어리어)`);
  queueTriggersForStack(state, p, stack, 'play');
  emitGameEvent(state, 'play', { owner: p, stack, cause: null });
  return stack;
}

// Effect-driven "등장시킨다" (free play from hand/trash): must go through
// makeStack like every other stack — the old inline literal in effects.js
// lacked tempDP/keywords/extraColors (crashing later grants), never applied the
// card's own static keywords, and never queued its 【등장 시】 effects.
// "이 카드를 코스트를 지불하지 않고 등장시킨다" (the card a 【시큐리티】 check just revealed; the engine parks it in the trash).
export function playThisFreeFromTrash(state, p, cardId) {
  const pl = state.players[p];
  const idx = pl.trash.lastIndexOf(cardId);
  if (idx === -1) { log(state, `${p} ${cardId}: 이미 그 영역을 벗어나 있어 등장시킬 수 없음`); return null; }
  if (!['digimon', 'tamer'].includes(card(cardId)?.category)) return null;
  return playFreeFromZone(state, p, 'trash', idx, {});
}

// 14-2-5 / 13-1-8: release the "배틀 종료 시, …" security effects held by op 'afterBattle' as ordinary pending effects.
export function queueAfterBattle(state) {
  const q = (state.afterBattle || []).splice(0);
  for (const e of q) if (e.turn === state.turnNumber) queuePending(state, { player: e.p, cardId: e.cardId, stackUid: null, tags: ['시큐리티'], text: e.text });
}

export function playFreeFromZone(state, p, zone, index, opts = {}) {
  const pl = state.players[p];
  if (zone === 'trash' && state.s6TrashLock && state.s6TrashLock[p] != null && state.turnNumber <= state.s6TrashLock[p] && ['digimon', 'tamer'].includes(card(pl.trash[index])?.category)) { log(state, `${p} 효과로 트래시에서 디지몬/테이머를 등장시킬 수 없음`); return null; } // s6 (BT23-014)
  if (s1HookAny(state, 's1cannotPlay', { p })) { log(state, `${p} 효과로 디지몬을 등장시킬 수 없음`); return null; } // shard1
  if (pl[zone][index] && isPlayRestricted(state, p, pl[zone][index])) { log(state, `${p} ${card(pl[zone][index]).nameKo}: 효과로 등장시킬 수 없음 (DP 제한)`); return null; }
  const [id] = pl[zone].splice(index, 1);
  if (!id) return null;
  const stack = makeStack(id, state.turnNumber);
  if (opts.rested) stack.suspended = true;
  stack.playedByEffect = true; // "이 디지몬이 효과로 등장하고 있었다면" (BT15-022)
  if ((opts.materials || []).length) { // 7-2-2-13: an effect-driven play may DigiXros too (materials chosen by the caller via planDigiXros)
    stack.xrosCount = placeXrosMaterials(state, p, stack, [...opts.materials].reverse());
    for (const tu of opts.restTamers || []) restStack(state, p, tu);
    if (stack.xrosCount) log(state, `${p} 디지크로스: ${opts.materials.map(m => card(m.cardId).nameKo).join(', ')}을(를) 아래에 놓음`);
  }
  recomputeStackGrants(stack);
  pl.battle.push(stack);
  stack.s7ByEffect = true;
  log(state, `${p} ${card(id).nameKo} 코스트 없이 등장 (효과)`);
  if (opts.noTriggers) { log(state, `${p} ${card(id).nameKo}의 【등장 시】 효과는 발휘하지 않음`); return stack; }
  queueTriggersForStack(state, p, stack, 'play');
  emitGameEvent(state, 'play', { owner: p, stack, cause: 'effect' });
  return stack;
}

// Using an Option card (9-1) is a distinct action from playing/evolving a
// Digimon. Per 9-1-4/9-1-5, while its first 【메인】 effect is resolving the
// card belongs to no zone; if it still belongs to no zone once that effect
// finishes, it's immediately trashed. We approximate this by trashing it
// up front — a script instruction like 'placeThisInBattle' (for cards that
// say "그 후 이 카드를 배틀 에어리어에 놓는다") relocates it out of the trash
// when it resolves.
// 4-22 色条件: to USE an Option card the player needs, in the Battle or Breeding area, Digimon/Tamers
// that together have every color the Option has (multicolor Options need all of their colors).
// "…색 조건을 무시할 수 있다" printed on the card lifts it (conditions we can evaluate are checked).
export function optionColorOk(state, p, cardId) {
  const c = card(cardId);
  const need = c.colors || [];
  if (!need.length) return true;
  const pl = state.players[p];
  const stacks = [pl.raising, ...pl.battle].filter(Boolean).filter(st => ['digimon', 'tamer'].includes(card(st.cardId).category));
  const have = new Set(stacks.flatMap(st => (st.extraColors && st.extraColors.replace) ? st.extraColors.replace : [...(card(st.cardId).colors || []), ...(st.extraColors || [])]));
  if (need.every(col => have.has(col))) return true;
  const txt = `${c.effectKo || ''}\n${c.inheritedKo || ''}`;
  // 16-42: 《사용조건《<지정 카드>》》 — a Digimon/Tamer in the area matching the designated card lets this option ignore its color condition.
  const uc = txt.match(/[《≪]\s*사용\s*조건\s*[《≪]\s*([^》≫]+?)\s*[》≫]\s*[》≫]/);
  if (uc) { const pr = evoTargetPredicate(uc[1].trim()); if (pr && stacks.some(st => st !== pl.raising && pr(card(st.cardId)))) return true; }
  const ig = txt.match(/([^.\n]*?)(?:동안|때),?\s*이\s*카드는\s*색\s*조건을\s*무시할\s*수\s*있다/);
  if (!ig) return false;
  const cond = ig[1].trim();
  if (!cond) return true;
  if (/앞면(?:인|의)?\s*시큐리티가\s*없는/.test(cond)) return true; // face-up security isn't modelled: none exist
  const dm = cond.match(/^(.*?)\s*자신의\s*(?:디지몬|테이머)(?:이|가)\s*있는$/);
  if (dm) { const pr = evoTargetPredicate((dm[1].trim() + ' 가진').replace(/\s*(?:를|을)\s*가진$/, ' 가진')); return !pr || stacks.some(st => st !== pl.raising && pr(card(st.cardId))); } // 3-4-7-8: an effect that doesn't name the breeding area can't see its card
  return true;
}

export function useOptionCard(state, p, handIndex, opts = {}) {
  const pl = state.players[p];
  if (s1HookAny(state, 's1cannotUseOption', { p })) { log(state, `${p} 옵션 카드를 사용할 수 없음 (효과)`); return null; } // shard1
  if (pl.hand[handIndex] && !optionColorOk(state, p, pl.hand[handIndex])) {
    log(state, `${p} ${card(pl.hand[handIndex]).nameKo} 사용 불가: 색 조건 미충족 (같은 색의 디지몬/테이머가 필요, 룰 4-22)`);
    return null;
  }
  if (pl.hand[handIndex] && !canPayCost(state, Math.max(0, (card(pl.hand[handIndex]).cost || 0) + (opts.costDelta || 0)))) {
    log(state, `${p} ${card(pl.hand[handIndex]).nameKo} 사용 불가: 코스트를 지불할 수 없음 (룰 1-3-11-1)`);
    return null;
  }
  const [id] = pl.hand.splice(handIndex, 1);
  if (!id) return null;
  const cost = Math.max(0, (card(id).cost || 0) + (opts.costDelta || 0)); // s8: hook play-cost discounts (BT25-090 …)
  if (cost > 0) spendMemory(state, cost);
  pl.trash.push(id);
  log(state, `${p} ${card(id).nameKo} 사용 (코스트${cost})`);
  queueTriggersFor(state, p, id, 'use');
  emitGameEvent(state, 'optionUsed', { owner: p, stack: null, cause: null, cardId: id, useCost: cost });
  return id;
}

export function placeThisInBattle(state, p, cardId) {
  const pl = state.players[p];
  if (s1HookAny(state, 's1cannotPlay', { p })) { log(state, `${p} 효과로 디지몬을 등장시킬 수 없음`); return null; } // shard1
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
  if (card(cardId).category === 'option') emitGameEvent(state, 'optionPlaced', { owner: p, stack, cause: 'effect' }); // s6
  return stack;
}

// "이 카드를 시큐리티 아래에 앞면으로 놓는다." — an Option card overriding its
// normal post-use trash destination to instead sit at the bottom of its own
// security stack (EX8-068/069/071, BT21-095, ST21-15, EX9-072, BT22-100,
// BT24-090). Face-up vs face-down isn't modeled — this engine has no
// information-hiding between players, so it's plain equivalent to a normal
// bottom-of-security placement.
export function placeThisAtSecurityBottom(state, p, cardId) {
  const pl = state.players[p];
  const idx = pl.trash.lastIndexOf(cardId);
  if (idx !== -1) pl.trash.splice(idx, 1);
  pl.security.push(cardId);
  log(state, `${p} ${card(cardId).nameKo}을(를) 시큐리티 맨 밑에 놓음`);
}

// "자신의 시큐리티를 아래에서부터 N장 패에 추가한다." — moves cards off the
// BOTTOM of the caller's own security into their hand (distinct from
// trashTopSecurityByEffect/trashBottomSecurityByEffect, which trash rather
// than add to hand). Stops early if security runs out.
export function securityBottomToHand(state, p, n) {
  const pl = state.players[p];
  for (let i = 0; i < n; i++) {
    const id = pl.security.pop();
    if (!id) break;
    pl.hand.push(id);
    log(state, `${p} 시큐리티 맨 밑 카드를 패에 추가: ${card(id).nameKo}`);
    emitGameEvent(state, 'securityDecrease', { owner: p, stack: null, cause: 'effect' }); // s5
  }
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
    const m = seg.body.match(/^[≪《]\s*딜레이\s*[≫》]\s*(?:\([^()]*\)\s*)?\n\s*(·.+)$/s);
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
  emitGameEvent(state, 'optionTrashed', { owner: p, stack, cause: 'delay' }); // s6
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
  stack.cardId = dualCardId; stack.turnEffectUses = {}; /* 15-14-1-5-2: new card resets [턴에 N회] */
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

// 4-17-2: only a card that HAS a DP can move (a Lv.2 digitama has none; a DP-less Lv.3+ card can't either, and a digitama-category card that prints a DP can).
export function canMoveFromRaising(stack) {
  if (!stack) return false;
  const c = card(stack.cardId);
  return c.dp != null && (c.category === 'digimon' || c.category === 'digitama');
}
export function moveRaisingToBattle(state, p) {
  const pl = state.players[p];
  if (state.breedingActionTaken) { log(state, `${p} 이번 육성 페이즈에는 이미 부화/이동 중 하나를 했어서 더 못함`); return null; }
  if (!pl.raising) return null;
  const c = card(pl.raising.cardId);
  if (!canMoveFromRaising(pl.raising)) { log(state, `${p} ${c.nameKo}는 DP가 없어 이동 불가 (룰 4-17-2)`); return null; }
  if (isPlayRestricted(state, p, pl.raising.cardId)) { log(state, `${p} ${c.nameKo}: 효과로 이동시킬 수 없음 (DP 제한)`); return null; }
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
    if (!canPayCost(state, cost)) { log(state, `${p} ${card(newCardId).nameKo} 진화 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); return null; }
    pl.hand.splice(idx, 1);
  }
  discardLinkCardsOnNewCard(state, p, stack); // 10-4-1: this stack is about to become a new card
  S2.beforeDigivolve(state, p, stack); // shard2 (BT14-018 tokens)
  stack.viaFusion = false;
  stack.byEffect = { kind: 'digivolve', effect: !!state._fxSrc, turn: state.turnNumber }; // s8: "효과로 진화했다면"
  stack.sources.push(stack.cardId);
  stack.cardId = newCardId; stack.turnEffectUses = {}; /* 15-14-1-5-2: new card resets [턴에 N회] */
  if (cost > 0) spendMemory(state, cost);
  log(state, `${p} ${card(stack.sources[stack.sources.length-1]).nameKo} → ${card(newCardId).nameKo} 진화 (코스트${cost}, 출처:${source})`);
  drawCards(state, p, 1); // universal digivolve bonus draw
  recomputeStackGrants(stack);
  ruleCheckDP(state, p, stack);
  // 【진화 시】/【등장 시】 (and any equivalent inherited from evolution
  // sources) only fire while the resulting card is actually in the battle
  // area — evolving a card that's still sitting in the raising area (legal,
  // just uncommon) doesn't trigger them.
  if (pl.battle.includes(stack) || pl.raising === stack) { queueTriggersForStack(state, p, stack, 'digivolve'); if (pl.battle.includes(stack)) emitGameEvent(state, 'digivolve', { owner: p, stack, cause: null }); } // s6: [육성] triggers fire in the raising area
  return stack;
}

// DNA / Jogress: combine two stacks into one new stack.
// ---- 조그레스 (Jogress) validation: "〔조그레스〕 <A>+<B> : 코스트 N" ----
// Each side is a descriptor over a material Digimon: color list, Lv., exact
// 「name」, "명칭에 「X」를 포함하는", or "「X」가 기술되어 있는". Returns
// { cost, test(cardA, cardB) } or null when the line is missing/unparsed (the
// caller then falls back to the previous permissive behavior).
function parseJogressSide(desc) {
  desc = desc.trim();
  const cons = [];
  let m, rest = desc;
  const quoted = (str) => [...str.matchAll(/「([^」]+)」/g)].map(x => x[1]);
  if ((m = rest.match(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함하는/))) { const l = quoted(m[1]); cons.push(c => l.some(x => c.nameKo.includes(x))); rest = rest.replace(m[0], ''); }
  if ((m = rest.match(/((?:「[^」]+」\/?|\+)+)\s*(?:이|가)\s*기술되어\s*있는/))) { const l = quoted(m[1]); cons.push(c => l.some(x => c.nameKo.includes(x))); rest = rest.replace(m[0], ''); }
  if ((m = rest.match(new RegExp(String.raw`((?:${COLOR_WORD})(?:\/(?:${COLOR_WORD}))*)\s*(?:인|의)?`)))) { const cols = m[1].split('/').map(x => KOR_COLOR_NAME[x]); cons.push(c => (c.colors || []).some(x => cols.includes(x))); rest = rest.replace(m[0], ''); }
  if ((m = rest.match(/Lv\.\s*(\d+)/))) { const lv = Number(m[1]); cons.push(c => c.level === lv); rest = rest.replace(m[0], ''); }
  if (!cons.length && (m = rest.match(/^「([^」]+)」$/))) { const nm = m[1]; cons.push(c => c.nameKo === nm); rest = ''; }
  if (!cons.length) return null;
  return c => cons.every(f => f(c));
}

export function parseJogress(cardId) {
  const line = (card(cardId).effectKo || '').split('\n').find(l => /〔조그레스〕/.test(l));
  if (!line) return null;
  const m = line.match(/〔조그레스〕\s*(.+?)\s*(?::|에서)\s*(?:코스트\s*)?(\d+)/);
  if (!m) return null;
  const sides = m[1].split('+');
  if (sides.length !== 2) return null;
  // "「A」+「B」가 기술되어 있는 …" style shares one descriptor across both quoted names — bail out.
  const a = parseJogressSide(sides[0]), b = parseJogressSide(sides[1]);
  if (!a || !b) return null;
  return { cost: Number(m[2]), test: (x, y) => (a(x) && b(y)) || (a(y) && b(x)), left: a, right: b };
}

// Can `stackA` + `stackB` jogress into `cardId`? Unparsed lines stay permissive.
export function canJogress(stackA, stackB, cardId) {
  if (card(stackA.cardId).category !== 'digimon' || card(stackB.cardId).category !== 'digimon') return { ok: false, reason: '조그레스 재료는 디지몬이어야 함 (8-2-1)' };
  const j = parseJogress(cardId);
  if (!j) return { ok: true, cost: null };
  // s5: "이 디지몬은 「A」의 조그레스 진화에서 「B」·Lv.N으로도 취급한다" (hookJogressAliases) widens what a material counts as.
  const forms = (st) => [card(st.cardId), ...hookJogressAliases(st.cardId, cardId).map(a => ({ ...card(st.cardId), nameKo: a.nameKo, level: a.level ?? card(st.cardId).level }))];
  for (const ca of forms(stackA)) for (const cb of forms(stackB)) if (j.test(ca, cb)) return { ok: true, cost: j.cost };
  return { ok: false, reason: '조그레스 조건 불일치' };
}

export function fuseStacks(state, p, uidA, uidB, newCardId, cost, source = 'hand') {
  const pl = state.players[p];
  const idxA = pl.battle.findIndex(s => s.uid === uidA);
  const idxB = pl.battle.findIndex(s => s.uid === uidB);
  if (idxA === -1 || idxB === -1) return null;
  if (source === 'hand' && !canPayCost(state, cost)) { log(state, `${p} 조그레스 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); return null; }
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
  // 8-2-2-2: the card written on the LEFT of the 〔조그레스〕 condition ends up on top (last in sources[]).
  // Both stacks keep their own source order (8-2-2-3).
  const jg = parseJogress(newCardId);
  const aIsLeft = jg ? (jg.left(card(a.cardId)) && jg.right(card(b.cardId))) || !(jg.left(card(b.cardId)) && jg.right(card(a.cardId))) : true;
  const [top, bottom] = aIsLeft ? [a, b] : [b, a];
  fused.sources = [...bottom.sources, bottom.cardId, ...top.sources, top.cardId];
  fused.suspended = false; // DNA digivolve results always enter unsuspended
  fused.attackEligibleTurn = state.turnNumber; // DNA/Jogress results can attack immediately
  fused.viaFusion = true; // for "조그레스 진화하고 있었다면" conditions
  pl.battle.push(fused);
  // 8-2-2-1-3/4: a material that was attacking / being attacked no longer exists as such -> the attack has no attacker/target and ends.
  { const ac = state.attackCtx; if (ac && [a.uid, b.uid].some(u => u === ac.uid || u === ac.targetUid) && ac.terminate) ac.terminate(); }
  if (cost > 0) spendMemory(state, cost);
  log(state, `${p} DNA/조그레스 진화: ${card(a.cardId).nameKo}+${card(b.cardId).nameKo} → ${card(newCardId).nameKo} (코스트${cost})`);
  drawCards(state, p, 1); // universal digivolve bonus draw
  recomputeStackGrants(fused);
  ruleCheckDP(state, p, fused);
  queueTriggersForStack(state, p, fused, 'digivolve');
  return fused;
}

// ---- 버스트 진화 (Burst Digivolve, 8-3) ----
// "〔버스트 진화〕 「<진화할 디지몬 명칭>」 : 「<테이머>」 1명을 패로 되돌리는 것으로, 코스트 N" (BT25-104 prints the cost first, and "패에 추가하는 것으로").
export function parseBurstEvolution(cardId) {
  const line = (card(cardId).effectKo || '').split('\n').find(l => /〔버스트\s*진화〕/.test(l));
  if (!line) return null;
  const names = [...line.replace(/^.*?〔버스트\s*진화〕/, '').matchAll(/「([^」]+)」/g)].map(m => m[1]);
  if (names.length < 2) return null;
  const cm = line.match(/코스트\s*(\d+)/);
  return { targetName: names[0], tamerName: names[1], cost: cm ? Number(cm[1]) : 0 };
}
// Can `stack` burst-digivolve into `cardId`? -> { ok, cost, tamerUids } | { ok:false, reason }. (Colour restrictions "X로만 진화할 수 있다" are the caller's E.evoRestrictionCheck.)
export function burstCheck(state, p, stack, cardId) {
  const b = parseBurstEvolution(cardId);
  if (!b) return { ok: false, reason: '버스트 진화 조건 없음' };
  if (card(cardId).category !== 'digimon' || card(stack.cardId).category !== 'digimon') return { ok: false, reason: '버스트 진화는 디지몬끼리만 가능' };
  const r = evolveTargetRestriction(state, p, stack);
  if (r && r.cannotEvolve) return { ok: false, reason: '진화 제한: 이 디지몬은 진화할 수 없음' };
  if (card(stack.cardId).nameKo !== b.targetName) return { ok: false, reason: `버스트 진화 대상은 「${b.targetName}」` };
  const tamers = state.players[p].battle.filter(s => card(s.cardId).category === 'tamer' && card(s.cardId).nameKo === b.tamerName);
  if (!tamers.length) return { ok: false, reason: `배틀 에어리어에 「${b.tamerName}」가 없음` };
  return { ok: true, cost: b.cost, tamerUids: tamers.map(t => t.uid) };
}
// 8-3-3: return the tamer to hand, pay the cost, stack the card, draw 1; 8-3-2-1: at this turn's end trash the top card underneath (if it is a Digimon).
export function burstEvolve(state, p, stackUid, cardId, cost, tamerUid, source = 'hand') {
  const pl = state.players[p];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (!stack) return null;
  const chk = burstCheck(state, p, stack, cardId);
  if (!chk.ok) { log(state, `${p} 버스트 진화 불가: ${chk.reason}`); return null; }
  if (source === 'hand' && !pl.hand.includes(cardId)) return null;
  if (!canPayCost(state, cost)) { log(state, `${p} ${card(cardId).nameKo} 버스트 진화 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); return null; }
  const tUid = chk.tamerUids.includes(tamerUid) ? tamerUid : chk.tamerUids[0];
  const ti = pl.battle.findIndex(s => s.uid === tUid);
  const [tamer] = pl.battle.splice(ti, 1);
  const linkIds = (tamer.linkCards || []).map(l => l.cardId);
  pl.hand.push(tamer.cardId);
  pl.trash.push(...tamer.sources, ...linkIds);
  for (const id of [...tamer.sources, tamer.cardId]) applyOverflowIfAny(state, p, id);
  log(state, `${p} 버스트 진화: ${card(tamer.cardId).nameKo}을(를) 패로 되돌림`);
  hookLeaveTriggers(state, p, tamer, 'ownEffect');
  const evolved = digivolve(state, p, stackUid, cardId, cost, source);
  if (!evolved) return null;
  evolved.viaBurst = true;
  const uid = evolved.uid;
  scheduleEndOfTurn(state, () => {
    const s = state.players[p].battle.find(x => x.uid === uid);
    if (!s || !s.sources.length || card(s.sources[s.sources.length - 1]).category !== 'digimon') return;
    trashEvoSources(state, p, uid, 1, 'top');
  }, { player: p, cardId, label: '버스트 진화한 턴 종료 시, 진화원 위에서 1장 파기' });
  return evolved;
}

// ---- 어플 합체 (App Fusion, 8-4) ----
// "〔어플 합체〕 「A」＆「B」(＆「C」) : 코스트 N" — a Digimon linked (by ONE other kind of card) with two of the listed kinds evolves by stacking its link
// card(s) on top of it and the fusion card above them.
export function parseAppFusion(cardId) {
  const line = (card(cardId).effectKo || '').split('\n').find(l => l.includes('〔어플 합체〕'));
  if (!line) return null;
  const m = line.replace(/^.*?〔어플 합체〕/, '').match(/^\s*(.+?)\s*[:：]\s*(?:코스트\s*)?(\d+)?/);
  const names = m ? [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]) : [];
  if (names.length < 2) return null;
  return { names, cost: m[2] != null ? Number(m[2]) : 0 };
}
export function appFusionCheck(state, p, stack, cardId) {
  const inf = parseAppFusion(cardId);
  if (!inf) return { ok: false, reason: '어플 합체 조건 없음' };
  if (card(cardId).category !== 'digimon' || card(stack.cardId).category !== 'digimon') return { ok: false, reason: '어플 합체는 디지몬끼리만 가능' };
  const r = evolveTargetRestriction(state, p, stack);
  if (r && r.cannotEvolve) return { ok: false, reason: '진화 제한: 이 디지몬은 진화할 수 없음' };
  const top = card(stack.cardId).nameKo;
  if (!inf.names.includes(top)) return { ok: false, reason: `어플 합체 재료 「${inf.names.join('」「')}」 중 하나여야 함` };
  const links = (stack.linkCards || []).filter(l => l.cardId);
  const kinds = new Set(links.map(l => card(l.cardId).nameKo));
  if (kinds.size !== 1) return { ok: false, reason: '링크 카드가 정확히 1종이어야 함 (2종 조합 링크 상태)' };
  const [k] = [...kinds];
  if (k === top || !inf.names.includes(k)) return { ok: false, reason: `링크 카드가 「${inf.names.join('」「')}」 중 다른 1종이어야 함` };
  return { ok: true, cost: inf.cost };
}
// 8-4-3: pay the cost, stack the link cards over the Digimon, stack the fusion card on top, draw 1. source: 'hand' | 'trash'.
export function appFusion(state, p, stackUid, cardId, cost, source = 'hand') {
  const pl = state.players[p];
  const stack = pl.raising?.uid === stackUid ? pl.raising : pl.battle.find(s => s.uid === stackUid);
  if (!stack) return null;
  const chk = appFusionCheck(state, p, stack, cardId);
  if (!chk.ok) { log(state, `${p} 어플 합체 불가: ${chk.reason}`); return null; }
  const zone = source === 'trash' ? pl.trash : pl.hand;
  const zi = source === 'hand' ? zone.indexOf(cardId) : zone.lastIndexOf(cardId);
  if (zi === -1) return null;
  if (!canPayCost(state, cost)) { log(state, `${p} ${card(cardId).nameKo} 어플 합체 불가: 코스트 ${cost}를 지불할 수 없음 (룰 1-3-11-1)`); return null; }
  if (source === 'trash') zone.splice(zi, 1);
  const links = stack.linkCards.map(l => l.cardId);
  stack.linkCards = [];
  // sources[] is oldest-first: [...old sources, old top, link1..link(n-1)] with link n becoming the "current top" that digivolve() then pushes.
  stack.sources.push(stack.cardId, ...links.slice(0, -1));
  stack.cardId = links[links.length - 1];
  const res = digivolve(state, p, stackUid, cardId, cost, source === 'trash' ? 'trash' : 'hand');
  if (res) { res.viaAppFusion = true; log(state, `${p} 어플 합체 완료: ${card(cardId).nameKo}`); }
  return res;
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
  tamerStack.sources.unshift(cardId); // 4-4-2: bottom of the Tamer's stack (sources[0] = bottom)
  log(state, `${p} ${card(cardId).nameKo} 《세이브》 — ${card(tamerStack.cardId).nameKo} 아래에 놓음`);
  return true;
}

// "상대의 턴 종료까지 자신의 디지몬 N마리는 배틀에서 소멸하지 않는다." —
// unlike trySurviveBySacrifice (any destruction cause), this is BATTLE-loss
// specific (checked directly in resolveDigimonBattle, not deleteStack, so it
// never blocks an effect-based 소멸). turnNumber increments once per single
// player-turn (see engine.js endTurn), so a grant made during MY turn T
// needs to survive through the rest of turn T AND all of the opponent's
// following turn T+1 — i.e. valid while turnNumber <= T+1, exactly mirroring
// the existing cannotAttackUntil field's plain-number-comparison pattern
// (no separate cleanup needed — it just naturally stops matching).
export function grantBattleImmunity(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  stack.battleImmuneUntilTurn = state.turnNumber + 1;
  log(state, `${p} ${card(stack.cardId).nameKo} 상대 턴 종료까지 배틀 소멸 면역`);
}

function hasBattleImmunity(state, stack) {
  return (stack.battleImmuneUntilTurn != null && state.turnNumber <= stack.battleImmuneUntilTurn) || hookBattleImmune(state, stack); // s5
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

// ---- descriptor-carrying keywords: 《디코드《X》》 16-36, 《파티션《A&B》》 16-29, 《분리《X》》 16-46, 《계승《X》》 16-47,
// 《머티리얼 세이브 N》 16-21, 《오버클럭《X》》 16-34 — read straight from the top card's own text and every source's inherited text.
function leaveCardPred(desc, anyCategory = false) {
  desc = desc.replace(/\s+/g, ' ').trim();
  const cons = [];
  const traitRe = /특징(?:으로)?\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*(?:포함하는|가진)?/;
  const tm = desc.match(traitRe);
  const rest = desc.replace(traitRe, ' ');
  if (tm) { const l = [...tm[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); cons.push(c => (c.types || []).some(t => l.some(x => t.includes(x)))); }
  const names = [...rest.matchAll(/「([^」]+)」/g)].map(x => x[1]);
  if (names.length) cons.push(c => names.some(n => c.nameKo.includes(n)));
  const nameM = !names.length && desc.match(/명칭에\s*「([^」]+)」/);
  const lm = rest.match(/Lv\.\s*(\d+)(\s*이하)?/);
  if (lm) { const lv = Number(lm[1]); cons.push(lm[2] ? (c => c.level != null && c.level <= lv) : (c => c.level === lv)); }
  const cm = rest.replace(/「[^」]+」/g, '').match(new RegExp(`((?:${COLOR_WORD})(?:\s*\/\s*(?:${COLOR_WORD}))*)`));
  if (cm) { const cols = cm[1].split('/').map(x => KOR_COLOR_NAME[x.trim()]).filter(Boolean); if (cols.length) cons.push(c => (c.colors || []).some(x => cols.includes(x))); }
  if (!cons.length) return null;
  return (c) => (anyCategory || c.category === 'digimon') && cons.every(f => f(c));
}
const kwDescRe = (kw) => new RegExp(`[《≪]\s*${kw}\s*[《≪]?\s*([^》≫]*?)\s*[》≫]{1,2}`, 'g');
// Every printed "《kw《desc》》" / "《kw「X」》" on this stack (top card's own text + sources' inherited text): [{ id, desc }].
function keywordDescs(stack, kw) {
  const out = [], seen = new Set();
  for (const { id, own } of stackContributors(stack)) {
    const t = own ? card(id).effectKo : card(id).inheritedKo;
    for (const m of (t || '').matchAll(kwDescRe(kw))) {
      const desc = m[1].trim(), key = id + '|' + desc;
      if (desc && !seen.has(key)) { seen.add(key); out.push({ id, desc }); }
    }
  }
  return out;
}
// 16-36 / 16-29: sources that come into play for free as the stack leaves the battle area. Removed from stack.sources here
// (so they aren't trashed with it); playExtractedSources() then plays them once the stack is gone.
//   디코드: leaves by anything but battle -> 1 matching source.   파티션: leaves by neither own effect nor battle -> one source per part, all or nothing.
export function extractLeaveSourcePlays(state, p, stack, cause) {
  if (card(stack.cardId).category !== 'digimon') return [];
  const plays = [];
  const avail = () => stack.sources.map((id, i) => ({ id, i })).filter(x => x.i >= fdCount(stack));
  if (cause !== 'battle') {
    for (const { desc } of keywordDescs(stack, '디코드')) {
      const pr = leaveCardPred(desc); if (!pr) continue;
      const cand = avail().filter(x => pr(card(x.id))).pop();
      if (cand) { stack.sources.splice(cand.i, 1); plays.push({ id: cand.id, kw: '디코드' }); }
    }
  }
  if (cause !== 'battle' && cause !== 'ownEffect') {
    for (const { desc } of keywordDescs(stack, '파티션')) {
      const parts = desc.split(/[&＆]/);
      const preds = parts.map(x => leaveCardPred(x));
      if (parts.length < 2 || preds.some(x => !x)) continue;
      const picked = [], used = new Set();
      for (const pr of preds) {
        const cand = avail().filter(x => !used.has(x.i) && pr(card(x.id))).pop();
        if (!cand) { picked.length = 0; break; }
        used.add(cand.i); picked.push(cand);
      }
      if (picked.length === preds.length) { // 16-29-4: all of them or none
        for (const x of [...picked].sort((a, b) => b.i - a.i)) stack.sources.splice(x.i, 1);
        for (const x of picked) plays.push({ id: x.id, kw: '파티션' });
      }
    }
  }
  return plays;
}
export function playExtractedSources(state, p, plays) {
  for (const { id, kw } of plays || []) {
    const pl = state.players[p];
    pl.trash.push(id); // (it was just taken out of the leaving stack; playFreeFromZone works on a zone)
    const st = playFreeFromZone(state, p, 'trash', pl.trash.length - 1, {});
    if (st) log(state, `${p} 《${kw}》 — ${card(id).nameKo}을(를) 진화원에서 코스트 없이 등장`);
  }
}
// 16-21: 《머티리얼 세이브 N》 — as this Digimon vanishes, up to N sources named by its DigiXros condition go under one of the owner's Tamers (bottom).
export function extractMaterialSave(state, p, stack) {
  const c = card(stack.cardId);
  const m = ((c.effectKo || '') + '\n' + (c.inheritedKo || '')).match(/머티리얼\s*세이브\s*(\d+)/);
  if (!m) return;
  const xr = parseDigiXros(stack.cardId);
  const tamer = state.players[p].battle.find(s => card(s.cardId).category === 'tamer');
  if (!xr || !tamer) return;
  const matches = (req, cd) => req.name ? (cd.nameKo === req.name && (!req.color || (cd.colors || []).includes(req.color)))
    : req.keyword ? (cd.category === 'digimon' && `${cd.effectKo || ''}\n${cd.inheritedKo || ''}`.includes(`《${req.keyword}`))
    : (cd.category === 'digimon' && (cd.types || []).some(t => req.traits.some(x => req.includes ? t.includes(x) : t === x)));
  const picked = [];
  for (let i = stack.sources.length - 1; i >= fdCount(stack) && picked.length < Number(m[1]); i--) {
    if (xr.reqs.some(req => matches(req, card(stack.sources[i])))) picked.push(i);
  }
  if (!picked.length) return;
  const ids = picked.map(i => stack.sources[i]);
  for (const i of [...picked].sort((a, b) => b - a)) stack.sources.splice(i, 1);
  tamer.sources.unshift(...ids); // 16-21-6: goes to the very bottom of the Tamer's stack
  log(state, `${p} ${c.nameKo} 《머티리얼 세이브 ${m[1]}》 — ${ids.map(id => card(id).nameKo).join(', ')}을(를) ${card(tamer.cardId).nameKo} 아래에 놓음`);
}
// 16-47: 《계승《X》》 — the topmost source matching X: the stack gains all of that card's effects except 《계승》 itself.
// (reads only the top card's own printed text — stackContributors() calls this, so it must not call back into it)
export function inheritKeywordSource(stack) {
  const own = card(stack.cardId).effectKo || '';
  if (!/[《≪]\s*계승/.test(own)) return null;
  for (const m of own.matchAll(kwDescRe('계승'))) {
    const pr = leaveCardPred(m[1].trim()); if (!pr) continue;
    for (let i = stack.sources.length - 1; i >= fdCount(stack); i--) if (pr(card(stack.sources[i]))) return stack.sources[i];
  }
  return null;
}

// Survive-destruction keywords, all "이 디지몬이 소멸할 때, <cost>로 소멸하지
// 않는다" shaped, auto-paid like trySurviveBySacrifice (deleteStack has no async
// choice path): 회피 (rest self), 아머 퍼지 (trash top overlaid card), 방벽
// (battle only; trash own top security), 스케이프고트 (not from own effect;
// destroy another own Digimon). Returns true if the stack survived.
function trySurviveByKeyword(state, p, stack, cause) {
  const pl = state.players[p];
  const has = (key, label = key) => hasKeyword(stack, key) || hasContinuousKeyword(state, p, stack, label);
  const opt = (fn) => replAttempt(state, fn); // each optional survive is its own skippable attempt (player may decline it)
  if (has('회피') && !stack.suspended && opt(() => {
    stack.suspended = true;
    log(state, `${p} ${card(stack.cardId).nameKo} 《회피》 — 레스트하여 소멸하지 않음`);
    return true;
  })) return true;
  if (has('아머퍼지', '아머 퍼지') && stack.sources.length > 0 && opt(() => {
    const id = stack.sources.pop();
    pl.trash.push(id);
    log(state, `${p} ${card(stack.cardId).nameKo} 《아머 퍼지》 — ${card(id).nameKo} 파기하여 소멸하지 않음`);
    recomputeStackGrants(stack);
    return true;
  })) return true;
  const frag = Number(stack.inheritedKeywords?.['프래그먼트'] || 0) || Number(stack.keywords?.['프래그먼트'] || 0);
  if (frag > 0 && stack.sources.length >= frag && opt(() => { // 16-37-1: must be able to discard the full specified number
    // "진화원을 선택하여 N장 파기" — auto-picks the most recently stacked sources.
    const removed = stack.sources.splice(Math.max(0, stack.sources.length - frag), frag);
    pl.trash.push(...removed);
    log(state, `${p} ${card(stack.cardId).nameKo} 《프래그먼트 ${frag}》 — 진화원 ${removed.length}장 파기하여 소멸하지 않음`);
    recomputeStackGrants(stack);
    return true;
  })) return true;
  if (has('방벽') && cause === 'battle' && pl.security.length > 0 && opt(() => {
    trashTopSecurityByEffect(state, p);
    log(state, `${p} ${card(stack.cardId).nameKo} 《방벽》 — 시큐리티 1장 파기하여 소멸하지 않음`);
    return true;
  })) return true;
  if (cause !== 'ownEffect' && (stack.linkCards || []).length) { // 16-46 ≪분리≫: not by own effect -> discard a designated Link Card, don't leave
    for (const { desc } of keywordDescs(stack, '분리')) {
      const pr = leaveCardPred(desc, true); if (!pr) continue;
      const li = stack.linkCards.findIndex(l => pr(card(l.cardId)));
      if (li === -1) continue;
      if (!opt(() => {
        const [lc] = stack.linkCards.splice(li, 1);
        pl.trash.push(lc.cardId);
        log(state, `${p} ${card(stack.cardId).nameKo} 《분리》 — 링크 카드 ${card(lc.cardId).nameKo} 파기하여 소멸하지 않음`);
        return true;
      })) continue;
      return true;
    }
  }
  if (has('스케이프고트') && cause !== 'ownEffect') {
    const other = pl.battle.find(s => s !== stack && card(s.cardId).category === 'digimon');
    if (other && opt(() => {
      log(state, `${p} ${card(stack.cardId).nameKo} 《스케이프고트》 — ${card(other.cardId).nameKo} 소멸시켜 소멸하지 않음`);
      deleteStack(state, p, other.uid, 'trash', 'ownEffect');
      return true;
    })) return true;
  }
  return false;
}


// ---- printed "…할 때, <비용>으로 소멸하지/벗어나지 않는다" survive abilities ----
// ~110 real segments share this shape: [턴 N회] [subject] [cause] leaves/is
// destroyed → auto-paid cost → the Digimon stays. Parsed into {limit, holder
// mode, subject predicate, cause test, condition, cost{can,pay}}; anything
// not fully understood parses to null so it is never misapplied.
function surviveCost(text) {
  let m;
  text = text.trim();
  if (/^이\s*디지몬을\s*레스트시키(?:는)?$/.test(text)) return { holderCost: true, can: (st, p, h) => !h.suspended, pay: (st, p, h) => { h.suspended = true; } };
  if (/^이\s*디지몬을\s*소멸시키(?:는)?$/.test(text)) return { needsOther: true, can: (st, p, h, pr) => h !== pr, pay: (st, p, h) => { deleteStack(st, p, h.uid, 'trash', 'ownEffect'); } };
  if ((m = text.match(/^(서로|자신)의\s*시큐리티를\s*(위에서|아래에서)?(?:부터)?\s*(\d+)\s*장\s*(?:을\s*)?파기하(?:는)?$/))) {
    const n = Number(m[3]), both = m[1] === '서로', bottom = m[2] === '아래에서';
    return {
      can: (st, p) => st.players[p].security.length >= n && (!both || st.players[opponentOf(p)].security.length >= 1),
      pay: (st, p) => { const who = both ? [p, opponentOf(p)] : [p]; for (const w of who) for (let i = 0; i < n; i++) (bottom ? trashBottomSecurityByEffect : trashTopSecurityByEffect)(st, w); },
    };
  }
  if ((m = text.match(/^자신의\s*시큐리티를\s*(\d+)\s*장\s*파기하(?:는)?$/))) {
    const n = Number(m[1]);
    return { can: (st, p) => st.players[p].security.length >= n, pay: (st, p) => { for (let i = 0; i < n; i++) trashTopSecurityByEffect(st, p); } };
  }
  if ((m = text.match(/^자신의\s*시큐리티를\s*위에서(?:부터)?\s*(\d+)\s*장\s*(덱\s*아래로\s*되돌리|패로\s*가져오)(?:는)?$/))) {
    const n = Number(m[1]), toDeck = /덱/.test(m[2]);
    return {
      can: (st, p) => st.players[p].security.length >= n,
      pay: (st, p) => { for (let i = 0; i < n; i++) { const id = st.players[p].security.shift(); if (!id) break; (toDeck ? st.players[p].deck : st.players[p].hand).push(id); } },
    };
  }
  // 이 디지몬의 진화원에서 <filter> N장을 <파기|덱 아래로 되돌리는>
  if ((m = text.match(/^이\s*디지몬의\s*진화원(?:에서|의|을\s*선택하여)\s*(.*?)\s*(\d+)\s*장을?\s*(파기|덱\s*아래로\s*되돌리)하?(?:는)?$/))) {
    const desc = m[1].trim(), n = Number(m[2]), toDeck = /덱/.test(m[3]);
    let match = () => true;
    let mm;
    if (/^Lv\.이\s*같은\s*카드$/.test(desc)) match = (id, h) => card(id).level === card(h.cardId).level;
    else if ((mm = desc.match(/^Lv\.(\d+)(?:인|의)?\s*(디지몬|옵션)?\s*카드$/))) match = (id) => card(id).level === Number(mm[1]) && (!mm[2] || card(id).category === (mm[2] === '옵션' ? 'option' : 'digimon'));
    else if ((mm = desc.match(/^「([^」]+)」$/))) match = (id) => card(id).nameKo === mm[1];
    else if ((mm = desc.match(/^특징(?:으로)?\s*((?:「[^」]+」\/?)+)\s*를\s*가진\s*카드$/))) { const l = [...mm[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); match = (id) => (card(id).types || []).some(t => l.includes(t)); }
    else if (desc === '옵션 카드') match = (id) => card(id).category === 'option';
    else if (desc === '디지몬 카드') match = (id) => card(id).category === 'digimon';
    else if (desc !== '') return null;
    return {
      holderCost: true,
      pick: (h) => h.sources.map((id, i) => ({ id, i })).filter(x => match(x.id, h)).slice(-n),
      can(st, p, h) { return this.pick(h).length >= n; },
      pay(st, p, h) {
        const idxs = this.pick(h).map(x => x.i).sort((a, b) => b - a);
        const ids = [];
        for (const i of idxs) ids.push(...h.sources.splice(i, 1));
        (toDeck ? st.players[p].deck : st.players[p].trash).push(...ids);
        recomputeStackGrants(h);
      },
    };
  }
  if ((m = text.match(/^자신의\s*패\s*(\d+)\s*장을?\s*파기하(?:는)?$/))) {
    const n = Number(m[1]);
    return { can: (st, p) => st.players[p].hand.length >= n, pay: (st, p) => { for (let i = 0; i < n; i++) trashFromHand(st, p, st.players[p].hand.length - 1); } };
  }
  if ((m = text.match(/^자신의\s*트래시(?:에서)?\s*(.*?)\s*(\d+)\s*장을?\s*덱\s*아래로\s*되돌리(?:는)?$/))) {
    const desc = m[1].trim(), n = Number(m[2]);
    let match = () => true, mm;
    if ((mm = desc.match(/^명칭에\s*「([^」]+)」를?\s*포함하는\s*카드$/))) match = (id) => card(id).nameKo.includes(mm[1]);
    else if ((mm = desc.match(/^「([^」]+)」(?:이|가)\s*기술되어\s*있는\s*카드$/))) match = (id) => card(id).nameKo.includes(mm[1]);
    else if (/^디지타마\s*카드\s*이외의\s*카드$/.test(desc)) match = (id) => !/디지타마/.test(card(id).category || '');
    else if (desc !== '') return null;
    return {
      can: (st, p) => st.players[p].trash.filter(match).length >= n,
      pay: (st, p) => { const tr = st.players[p].trash; let left = n; for (let i = tr.length - 1; i >= 0 && left > 0; i--) if (match(tr[i])) { st.players[p].deck.push(...tr.splice(i, 1)); left--; } },
    };
  }
  // "[<조건>] 다른 자신의 디지몬 1마리를 소멸시키는" — sacrifice, optionally trait/name-filtered.
  if ((m = text.match(/^(.*?)(다른\s*)?자신의\s*디지몬\s*1\s*마리를\s*소멸시키(?:는)?$/)) && !/이\s*디지몬을/.test(text)) {
    const desc = m[1].trim();
    const pr = desc ? evoTargetPredicate(desc) : () => true;
    if (!pr) return null;
    const pick = (st, p, h, pro) => st.players[p].battle.find(s => s !== h && s !== pro && card(s.cardId).category === 'digimon' && pr(card(s.cardId)));
    return { needsOther: true, can: (st, p, h, pro) => !!pick(st, p, h, pro), pay: (st, p, h, pro) => deleteStack(st, p, pick(st, p, h, pro).uid, 'trash', 'ownEffect') };
  }
  if (/^가장\s*DP가\s*낮은\s*상대의\s*디지몬\s*1\s*마리를\s*소멸시키(?:는)?$/.test(text)) {
    const low = (st, p) => { const o = st.players[opponentOf(p)].battle.filter(s => card(s.cardId).category === 'digimon'); return o.sort((a, b) => effectiveDP(st, opponentOf(p), a) - effectiveDP(st, opponentOf(p), b))[0]; };
    return { can: (st, p) => !!low(st, p), pay: (st, p) => deleteStack(st, opponentOf(p), low(st, p).uid, 'trash', 'effect') };
  }
  if (/^배틀\s*에어리어의\s*자신의\s*옵션\s*카드\s*1\s*장을?\s*파기하(?:는)?$/.test(text)) {
    const opt = (st, p) => st.players[p].battle.find(s => card(s.cardId).category === 'option');
    return { can: (st, p) => !!opt(st, p), pay: (st, p) => deleteStack(st, p, opt(st, p).uid, 'trash', 'ownEffect') };
  }
  if (/^(?:이\s*디지몬의\s*)?링크\s*카드를?\s*1\s*장(?:을)?\s*파기하(?:는)?$/.test(text)) return { holderCost: true, can: (st, p, h) => (h.linkCards || []).length > 0, pay: (st, p, h) => { const lc = h.linkCards.pop(); st.players[p].trash.push(lc.cardId); } };
  if ((m = text.match(/^다른\s*자신의\s*「([^」]+)」\s*1\s*(?:마리|장)를?\s*소멸시키(?:는)?$/))) {
    const nm = m[1];
    const pick = (st, p, h) => st.players[p].battle.find(s => s !== h && card(s.cardId).nameKo.includes(nm));
    return { needsOther: true, can: (st, p, h, pr) => { const o = pick(st, p, h); return !!o && o !== pr; }, pay: (st, p, h) => deleteStack(st, p, pick(st, p, h).uid, 'trash', 'ownEffect') };
  }
  if ((m = text.match(/^자신의\s*테이머\s*아래의\s*뒷면\s*카드를\s*아래에서부터\s*(\d+)\s*장\s*파기하(?:는)?$/))) {
    const n = Number(m[1]);
    const tam = (st, p) => st.players[p].battle.find(s => card(s.cardId).category === 'tamer' && s.sources.length >= n);
    return { can: (st, p) => !!tam(st, p), pay: (st, p) => { const t = tam(st, p); st.players[p].trash.push(...t.sources.splice(0, n)); } };
  }
  return null;
}

export function parseSurviveAbility(body) {
  let b = body.trim().split('\n')[0].replace(/\s*〈룰〉.*$/s, '').trim();
  let limit = null;
  const lm = b.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]\s*(.*)$/s);
  if (lm) { limit = Number(lm[1]); b = lm[2]; }
  const tm = b.match(/^(.*?)\s*(벗어날|떠날|소멸할)\s*때,?\s*(.*)$/s);
  if (!tm) return null;
  let left = tm[1].replace(/(?:배틀\s*에어리어를|배틀에어리어를)\s*$/, '').trim();
  if (/채로/.test(left)) return null;
  let causeTest = () => true;
  const cm = left.match(/(자신의\s*효과와\s*배틀\s*이외로|자신의\s*효과\s*이외로|상대(?:의)?\s*효과로|효과로|배틀\s*이외로|배틀에서|배틀로)\s*$/);
  if (cm) {
    left = left.slice(0, cm.index).trim();
    const c = cm[1].replace(/\s+/g, '');
    if (c === '자신의효과와배틀이외로') causeTest = (x) => x !== 'ownEffect' && x !== 'battle';
    else if (c === '자신의효과이외로') causeTest = (x) => x !== 'ownEffect';
    else if (/^상대/.test(c)) causeTest = (x) => x === 'effect';
    else if (c === '효과로') causeTest = (x) => x === 'effect' || x === 'ownEffect';
    else if (c === '배틀이외로') causeTest = (x) => x !== 'battle';
    else causeTest = (x) => x === 'battle';
  }
  left = left.replace(/(?:이|가)\s*$/, '').trim();
  let mode, pred = () => true, nameEq = null, other = false, mm;
  if (/이\s*디지몬$/.test(left)) {
    mode = 'self';
    const desc = left.replace(/이\s*디지몬$/, '').trim();
    if (desc) { const pr = evoTargetPredicate(desc); if (!pr) return null; pred = (h) => pr(card(h.cardId)); }
  } else if ((mm = left.match(/^(다른\s*)?자신의\s*「([^」]+)」$/))) {
    mode = 'own'; other = !!mm[1]; nameEq = mm[2];
  } else if ((mm = left.match(/^(.*?)(다른\s*)?자신의\s*디지몬(?:\/테이머)?$/))) {
    mode = 'own'; other = !!mm[2];
    const desc = mm[1].trim();
    if (desc) { const pr = evoTargetPredicate(desc); if (!pr) return null; pred = (h) => pr(card(h.cardId)); }
  } else if ((mm = left.match(/^(다른\s*)?자신의\s*(특징.+?)\s*디지몬$/))) {
    // "자신의 특징 「X」를 가진 디지몬"
    mode = 'own'; other = !!mm[1];
    const pr = evoTargetPredicate(mm[2].trim()); if (!pr) return null; pred = (h) => pr(card(h.cardId));
  } else return null;
  // right side: [condition라면,] cost 것으로, <…> 않는다
  const rm = tm[3].match(/^(.*?)\s*것으로,?\s*(?:그\s*디지몬(?:\/테이머)?\s*(?:1(?:마리|장)(?:\(명\))?\s*)?(?:은|는)?\s*|이\s*디지몬(?:은|는)?\s*)?(?:벗어나지|소멸하지)\s*않는다\.?$/s);
  if (!rm) return null;
  let costText = rm[1].trim();
  let cond = () => true;
  const cc = costText.match(/^(.*?(?:라면|다면)),\s*(.*)$/s);
  if (cc) {
    costText = cc[2];
    let c;
    if ((c = cc[1].match(/^자신의\s*시큐리티가\s*(\d+)\s*장\s*(이상|이하)이?라면$/))) { const n = Number(c[1]), ge = c[2] === '이상'; cond = (st, p) => ge ? st.players[p].security.length >= n : st.players[p].security.length <= n; }
    else if ((c = cc[1].match(/^이\s*디지몬이\s*「([^」]+)」(?:이)?라면$/))) cond = (st, p, h) => card(h.cardId).nameKo === c[1];
    else if ((c = cc[1].match(/^이\s*디지몬의\s*진화원에\s*((?:「[^」]+」\/?)+)(?:이|가)\s*있다면$/))) { const l = [...c[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); cond = (st, p, h) => h.sources.some(id => l.some(n => card(id).nameKo.includes(n) || (card(id).types || []).includes(n))); }
    else if ((c = cc[1].match(/^이\s*디지몬의\s*진화원에\s*명칭에\s*「([^」]+)」을?\s*포함하는\s*카드가\s*있다면$/))) cond = (st, p, h) => h.sources.some(id => card(id).nameKo.includes(c[1]));
    else return null;
  }
  const cost = surviveCost(costText);
  if (!cost) return null;
  return { limit, mode, pred, nameEq, other, causeTest, cond, cost };
}

export function isHandledSurviveBody(body) {
  if (parseSurviveAbility(body)) return true;
  return /^이\s*디지몬이\s*소멸할\s*때,?\s*명칭에\s*「[^」]+」\s*(?:을|를)?\s*포함하는\s*다른\s*디지몬\s*\d+\s*마리를?\s*소멸시키는\s*것으로,?\s*(?:이\s*디지몬은\s*)?소멸하지\s*않는다\.?$/.test(body.trim());
}

// Scan every stack on `p`'s board for a printed survive ability that covers
// `protectedStack` for this deletion cause and whose cost can be paid.
function trySurviveByPrintedAbility(state, p, protectedStack, cause) {
  const pl = state.players[p];
  for (const holder of [pl.raising, ...pl.battle].filter(Boolean)) {
    for (const { id, own } of stackContributors(holder)) {
      const text = own ? card(id).effectKo : card(id).inheritedKo;
      if (!text) continue;
      const { segments } = parseEffectSegments(text);
      for (const seg of segments) {
        if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
        const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
        if (!active) continue;
        const ab = parseSurviveAbility(seg.body);
        if (!ab || !ab.causeTest(cause)) continue;
        if (ab.mode === 'self') { if (holder !== protectedStack || !ab.pred(holder)) continue; }
        else {
          if (ab.other && holder === protectedStack) continue;
          if (ab.nameEq && card(protectedStack.cardId).nameKo !== ab.nameEq) continue;
          if (!ab.nameEq && !ab.pred(protectedStack)) continue;
        }
        if (!ab.cond(state, p, holder, protectedStack)) continue;
        if (!ab.cost.can(state, p, holder, protectedStack)) continue;
        const onceKey = ab.limit != null ? onceLimitKey(id, seg.tags) : null;
        if (onceKey && turnUsesRemaining(holder, onceKey, ab.limit) <= 0) continue;
        if (!replAttempt(state, () => {
          if (onceKey) markTurnEffectUsed(holder, onceKey);
          ab.cost.pay(state, p, holder, protectedStack);
          log(state, `${p} ${card(holder.cardId).nameKo} 생존 능력 — ${card(protectedStack.cardId).nameKo} 소멸하지 않음`);
          return true;
        })) continue;
        return true;
      }
    }
  }
  return false;
}

// ===== resumable replacement-effect prompts (optional survive abilities: 《회피》/《세이브》/《디코이》/printed "…하는 것으로 소멸하지 않는다") =====
// deleteStack() is synchronous, but an OPTIONAL replacement ("you may pay X so this doesn't leave") needs a player decision.
// When REPL.interactive (the browser UI sets it; headless soak/tests keep the old auto behaviour) a top-level deleteStack first
// PROBES on a deep clone of the state: the clone's survive attempts are numbered in priority order, and the first attempt that
// succeeds AND changed the game (paid a cost) is the "hit". A hit means: park the deletion in state.pendingReplacements
// (deleteStack returns null = "not deleted for now") and let the UI ask. resumeReplacement() then either re-runs deleteStack
// with that attempt allowed (yes) or with it skipped (no; the next attempt gets probed the same way). Free/static immunities
// (no state change) are applied without asking. Nested deleteStack calls (costs that destroy other stacks) run automatically.
export const REPL = { interactive: false, depth: 0, onPending: null };
// Synchronous yes/no used INSIDE replacement hooks (shards' preventLeave): inside deleteStack the gate above already asked, so it
// answers `def`; outside (bounce paths) it falls back to a plain confirm in the browser.
export function replAsk(msg, def = true) {
  if (REPL.depth > 0 || !REPL.interactive) return def;
  try { if (typeof globalThis.confirm === 'function') return !!globalThis.confirm(msg); } catch (e) { /* ignore */ }
  return def;
}
function cloneState(o, seen = new WeakMap()) {
  if (o === null || typeof o !== 'object') return o;
  if (seen.has(o)) return seen.get(o);
  let out;
  if (Array.isArray(o)) { out = []; seen.set(o, out); for (const v of o) out.push(cloneState(v, seen)); return out; }
  if (o instanceof Set) { out = new Set(); seen.set(o, out); for (const v of o) out.add(cloneState(v, seen)); return out; }
  if (o instanceof Map) { out = new Map(); seen.set(o, out); for (const [k, v] of o) out.set(k, cloneState(v, seen)); return out; }
  out = {}; seen.set(o, out);
  for (const k of Object.keys(o)) out[k] = cloneState(o[k], seen);
  return out;
}
function replFingerprint(state) {
  const ps = ['p1', 'p2'].map(p => { const pl = state.players[p]; return [pl.hand, pl.trash, pl.security, pl.deck.length, pl.digitamaDeck.length, [pl.raising, ...pl.battle].map(s => s && [s.uid, s.cardId, s.sources, s.suspended, (s.linkCards || []).length])]; });
  return JSON.stringify([ps, state.memory]);
}
// Wraps one survive attempt inside a top-level deleteStack pass: honours the skip set, numbers attempts, records the probe hit.
function replAttempt(state, fn) {
  if (REPL.depth !== 1) return fn();
  const n = state._replN = (state._replN || 0) + 1;
  if (state._replSkip && state._replSkip.has(n)) return false;
  const probe = state._replProbe;
  const fp0 = probe && probe.hit == null ? replFingerprint(state) : null;
  const r = fn();
  if (r && probe && probe.hit == null && replFingerprint(state) !== fp0) probe.hit = n;
  return r;
}
function replGate(state, p, uid, toZone, cause) {
  const pend = (state.pendingReplacements ||= []);
  if (pend.some(x => x.p === p && x.uid === uid)) return 'defer';
  if (state._replForce === uid) return 'go';
  const decl = (state._replDecl ||= {})[uid] || [];
  const trial = cloneState(state);
  trial._replProbe = { hit: null }; trial._replSkip = new Set(decl); trial._replN = 0; trial.pendingReplacements = []; trial._replForce = null; trial._replDepth = 0;
  trial.log = []; // only the lines this probe adds (log() unshifts, newest first)
  const depth0 = REPL.depth; REPL.depth = 0;
  try { deleteStack(trial, p, uid, toZone, cause); } catch (e) { trial._replProbe.hit = null; } finally { REPL.depth = depth0; }
  const hit = trial._replProbe.hit;
  if (hit == null) return 'go';
  const st = state.players[p].raising?.uid === uid ? state.players[p].raising : state.players[p].battle.find(s => s.uid === uid);
  const lines = trial.log.map(l => l.msg).reverse();
  pend.push({ p, uid, toZone, cause, hit, decl: decl.slice(), cardId: st?.cardId, lines: lines.slice(0, 3) });
  if (typeof REPL.onPending === 'function') setTimeout(REPL.onPending, 0);
  return 'defer';
}
// UI answer: yes = let the survive ability happen (re-run with that attempt allowed); no = decline it (next one is probed).
export function resumeReplacement(state, entry, yes) {
  const pend = state.pendingReplacements || [];
  const i = pend.indexOf(entry); if (i !== -1) pend.splice(i, 1);
  const decl = (state._replDecl ||= {});
  if (yes) state._replForce = entry.uid; else (decl[entry.uid] ||= []).push(entry.hit);
  try { state._replSkip = new Set(decl[entry.uid] || []); deleteStack(state, entry.p, entry.uid, entry.toZone, entry.cause); }
  finally { state._replForce = null; state._replSkip = null; }
  if (!pend.some(x => x.uid === entry.uid)) delete decl[entry.uid];
  if (!pend.length && state._replWaiters?.length) { const w = state._replWaiters; state._replWaiters = []; w.forEach(f => f()); }
}

export function deleteStack(state, p, uid, toZone = 'trash', cause = null) {
  if (REPL.interactive && !state._replProbe && !(REPL.depth > 0) && replGate(state, p, uid, toZone, cause) === 'defer') return null;
  const top = REPL.depth === 0;
  REPL.depth++; if (top) state._replN = 0;
  try { return deleteStackCore(state, p, uid, toZone, cause); } finally { REPL.depth--; }
}
function deleteStackCore(state, p, uid, toZone, cause) {
  const pl = state.players[p];
  const peek = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (peek && (cause === 'effect' || cause === 'ownEffect') && effectBlocked(state, p, peek, 'delete', cause)) { log(state, `${p} ${card(peek.cardId).nameKo}는 상대의 효과로 소멸하지 않음`); return null; }
  if (peek && cause === 'battle' && s1BattleDeleteBlocked(state)) { log(state, `${p} ${card(peek.cardId).nameKo}는 이 턴 배틀로 소멸하지 않음`); return null; } // shard1
  if (peek && s1Flag(state, peek, 'noEffectDelete') && cause === 'effect') { log(state, `${p} ${card(peek.cardId).nameKo}는 효과로 소멸하지 않음`); return null; } // shard1
  const A = (fn) => replAttempt(state, fn); // optional survive attempts: probe / skippable (see REPL above)
  if (peek && A(() => tryDecoy(state, p, peek, cause))) return null; // s5 《디코이》
  if (peek && A(() => trySurviveBySacrifice(state, p, peek))) return null;
  if (peek && A(() => trySurviveByKeyword(state, p, peek, cause))) return null;
  if (peek && A(() => trySurviveByPrintedAbility(state, p, peek, cause))) return null;
  if (peek && hookPreventLeave(state, p, peek, cause, 'delete')) return null;
  let stack = null, fromBattle = false;
  if (pl.raising?.uid === uid) { stack = pl.raising; pl.raising = null; }
  else {
    const idx = pl.battle.findIndex(s => s.uid === uid);
    if (idx !== -1) { [stack] = pl.battle.splice(idx, 1); fromBattle = true; }
  }
  if (!stack) return null;
  // 16-36 ≪디코드≫ / 16-29 ≪파티션≫ / 16-21 ≪머티리얼 세이브≫: pull those sources out before the rest goes to the trash.
  const leavePlays = fromBattle && toZone === 'trash' ? extractLeaveSourcePlays(state, p, stack, cause) : [];
  if (fromBattle && toZone === 'trash') extractMaterialSave(state, p, stack);
  const linkIds = (stack.linkCards || []).map(l => l.cardId);
  const all = [...stack.sources, stack.cardId, ...linkIds];
  if (toZone === 'trash') pl.trash.push(...all.filter(x => !CARDS[x]?.isToken));
  playExtractedSources(state, p, leavePlays);
  log(state, `${p} ${card(stack.cardId).nameKo} 스택 소멸 (진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 포함, 총 ${all.length}장 트래시)`);
  (state.pendingVanishFlash ||= []).push(card(stack.cardId).nameKo);
  // Overflow (4-19-1) only covers cards leaving the area or leaving being
  // stacked underneath a card — Link Cards are neither (4-9-1/4-9-4), so
  // they're excluded here even though they're trashed alongside the stack.
  for (const id of [...stack.sources, stack.cardId]) applyOverflowIfAny(state, p, id);
  // last-known info for 【소멸 시】 scripts ("…이 있었다면" / "효과로 소멸하고 있었다면"): the stack is already gone by then.
  (state.deletedInfo ||= {})[stack.uid] = { cardId: stack.cardId, sources: stack.sources.slice(), cause, player: p, viaFusion: !!stack.viaFusion };
  hookLeaveTriggers(state, p, stack, cause);
  stack.s7DelCause = cause; // s7
  if (linkIds.length && (cause === 'effect' || cause === 'ownEffect')) emitGameEvent(state, 's7LinkTrashed', { owner: p, stack: null, cause: 'effect', ids: linkIds }); // s7
  state._deleteCause = cause; state._deleteStack = stack;
  try { queueTriggersForStack(state, p, stack, 'delete'); } finally { state._deleteCause = null; state._deleteStack = null; }
  emitGameEvent(state, 'delete', { owner: p, stack, cause });
  // s8: ≪천승≫ "이 디지몬이 소멸했을 때, 이 카드를 시큐리티의 위에 놓을 수 있다."
  if (toZone === 'trash' && card(stack.cardId).category === 'digimon' && (hasKeyword(stack, '천승') || hookGrantedKeywords(state, p, stack).includes('천승'))) {
    state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: stack.cardId, stackUid: null, tags: ['__천승'], text: '《천승》 이 디지몬이 소멸했을 때, 이 카드를 시큐리티의 위에 놓을 수 있다.', resolved: false });
  }
  // ≪불굴≫: "진화원을 가진 이 디지몬이 소멸했을 때, 이 카드를 코스트를 지불하지
  // 않고 등장시킨다" — the destroyed top card comes straight back as a fresh stack.
  if (toZone === 'trash' && stack.sources.length > 0 && (hasKeyword(stack, '불굴') || hasContinuousKeyword(state, p, stack, '불굴'))) {
    const fresh = placeThisInBattle(state, p, stack.cardId);
    log(state, `${p} ${card(stack.cardId).nameKo} 《불굴》 — 코스트 없이 재등장`);
    queueTriggersForStack(state, p, fresh, 'play');
  }
  return all;
}

// Retreat (de-evolve) N stages: peel top cards off the stack back to trash,
// revealing the previous card each time. Returns list of trashed card ids.
export function retreat(state, p, uid, stages) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return [];
  if (effectBlocked(state, p, stack, 'retreat') || effectBlocked(state, p, stack, 'srcTrash')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과를 받지 않아 퇴화하지 않음`); return []; }
  const trashed = [];
  for (let i = 0; i < stages; i++) {
    if (stack.sources.length === 0) break; // nothing left to peel
    if (card(stack.cardId).level != null && card(stack.cardId).level <= 3) break; // 《퇴화》 can't peel below Lv.3
    trashed.push(stack.cardId);
    stack.cardId = stack.sources.pop(); stack.turnEffectUses = {}; /* 15-14-1-5-2: new card resets [턴에 N회] */
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
  if (effectBlocked(state, p, stack, 'other')) return;
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
  if (effectBlocked(state, p, stack, 'other')) return;
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
  if (s1BlockedBy(state, p, stack, opponentOf(p), blockerStack)) return true; // shard1
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

// Generic scan for a bare continuous 자신/상대/서로의 턴 ability whose body
// matches `re`, read from the stack's OWN controller `p`'s perspective.
function stackHasContinuousAbility(state, p, stack, re) {
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    const { segments } = parseEffectSegments(text);
    for (const seg of segments) {
      if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
      const active = seg.tags[0] === '서로의 턴' || (seg.tags[0] === '자신의 턴') === (state.activePlayer === p);
      if (active && re.test(seg.body.trim())) return true;
    }
  }
  return false;
}

const RE_CANNOT_ATTACK_DIGIMON = /^이\s*디지몬은\s*상대(?:의)?\s*디지몬에게\s*어택할\s*수\s*없다\.?$/;
const RE_CANNOT_BE_ATTACKED = /^이\s*디지몬은\s*어택당하지\s*않는다\.?$/;
const RE_CANNOT_ATTACK_NO_OPP_DIGIMON = /^상대(?:의)?\s*디지몬이\s*없는\s*동안,?\s*이\s*디지몬은\s*어택할\s*수\s*없다\.?$/;

export function canAttackPlayer(state, p, uid) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return true;
  if (stack.cannotAttackPlayerUntil === 'permanent' || (typeof stack.cannotAttackPlayerUntil === 'number' && state.turnNumber <= stack.cannotAttackPlayerUntil)) return false;
  if (s1CannotAttackPlayer(state, p, stack)) return false; // shard1
  if (hookAttackPlayerBlocked(state, p, stack)) return false; // s7
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
  if (aStack && stackHasContinuousAbility(state, attackerP, aStack, RE_CANNOT_ATTACK_DIGIMON)) return [];
  return state.players[opp].battle
    .filter(s => !s3Flag(state, s, 'unattackable'))
    .filter(s => card(s.cardId).category === 'digimon' || !card(s.cardId).category)
    .filter(s => !stackHasContinuousAbility(state, opp, s, RE_CANNOT_BE_ATTACKED))
    .filter(s => !s1HookAny(state, 's1cannotBeAttacked', { p: opp, stack: s, attackerP, attacker: aStack })) // shard1
    .filter(s => s.suspended || canHitActiveAny || (canHitActiveNoSource && s.sources.length === 0) || (aStack && s1HookAny(state, 's1attackTarget', { attackerP, attacker: aStack, target: s })))
    .filter(s => !hookAttackTargetBlocked(state, attackerP, aStack, opp, s)) // s5
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
    const limitM = body.match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]\s*(.*)$/s);
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
  let aDp = effectiveDP(state, attackerP, aStack), dDp = effectiveDP(state, defenderP, dStack);
  // ≪빙장≫: vs. a non-security Digimon, compare evolution-source COUNT instead of DP.
  if (hasKeyword(aStack, '빙장') || hasKeyword(dStack, '빙장')) { aDp = aStack.sources.length; dDp = dStack.sources.length; }
  let result;
  if (aDp > dDp) result = 'attackerWins';
  else if (aDp < dDp) result = 'defenderWins';
  else result = 'tie';
  log(state, `${attackerP} ${card(aStack.cardId).nameKo}(DP${aDp}) vs ${defenderP} ${card(dStack.cardId).nameKo}(DP${dDp}) → ${result}`);
  const destroyedOnlyOpponent = result === 'attackerWins';
  if (result === 'attackerWins') runBattleWinTriggers(state, attackerP, aStack);
  if (result === 'attackerWins') s1BattleWon(state, attackerP, aStack); // shard1
  if (result === 'defenderWins' || result === 'tie') {
    if (hasBattleImmunity(state, aStack)) log(state, `${attackerP} ${card(aStack.cardId).nameKo} 배틀 소멸 면역으로 생존`);
    else deleteStack(state, attackerP, attackerUid, 'trash', 'battle');
  }
  if (result === 'attackerWins' || result === 'tie') {
    if (hasBattleImmunity(state, dStack)) log(state, `${defenderP} ${card(dStack.cardId).nameKo} 배틀 소멸 면역으로 생존`);
    else deleteStack(state, defenderP, defenderUid, 'trash', 'battle');
  }
  // ≪길동무≫: "배틀에서 이 디지몬만이 소멸했을 때, 배틀한 상대의 디지몬을 소멸시킨다"
  // — only when THIS Digimon alone was destroyed (a tie destroys both already, and
  // an immune/saved Digimon that survived doesn't count as having been destroyed).
  if (result === 'attackerWins' && hasKeyword(dStack, '길동무') && !dpl.battle.includes(dStack) && apl.battle.includes(aStack)) {
    log(state, `${defenderP} ${card(defenderCardId).nameKo} 《길동무》 — ${card(attackerCardId).nameKo}도 소멸`);
    deleteStack(state, attackerP, attackerUid, 'trash', 'effect');
  } else if (result === 'defenderWins' && hasKeyword(aStack, '길동무') && !apl.battle.includes(aStack) && dpl.battle.includes(dStack)) {
    log(state, `${attackerP} ${card(attackerCardId).nameKo} 《길동무》 — ${card(defenderCardId).nameKo}도 소멸`);
    deleteStack(state, defenderP, defenderUid, 'trash', 'effect');
  }
  // s8: "이 디지몬이 배틀에서 승리했을 때" — the winner (attacker or defender) that is still in the battle area.
  if (result === 'attackerWins' && apl.battle.includes(aStack)) emitGameEvent(state, 'battleWin', { owner: attackerP, stack: aStack, cause: null, loser: dStack });
  else if (result === 'defenderWins' && dpl.battle.includes(dStack)) emitGameEvent(state, 'battleWin', { owner: defenderP, stack: dStack, cause: null, loser: aStack });
  // 16-7-1/16-7-6: ≪관통≫ needs the attacker to have actually made the defender vanish in this battle
  // (win OR tie where the attacker was saved) and the attacker to still be in the battle area.
  const piercing = (hasKeyword(aStack, '관통') || hookGrantedKeywords(state, attackerP, aStack).includes('관통'))
    && result !== 'defenderWins' && !dpl.battle.includes(dStack) && apl.battle.includes(aStack);
  return { result, aDp, dDp, attackerCardId, defenderCardId, destroyedOnlyOpponent, piercing, attackerSurvived: result === 'attackerWins' };
}

export function declareAttack(state, attackerP, stackUid, opts = {}) {
  const pl = state.players[attackerP];
  const stack = pl.battle.find(s => s.uid === stackUid);
  if (!stack || (stack.suspended && !opts.allowSuspended)) return { ok: false, reason: 'invalid or suspended attacker' };
  if (attackerP !== state.activePlayer) return { ok: false, reason: 'not the turn player (11-2-1)' }; // 11-2-1: only the turn player declares attacks
  if (!opts.noRest && !canRestByRule(state, attackerP, stack)) { log(state, `${attackerP} ${card(stack.cardId).nameKo}는 레스트할 수 없어 어택할 수 없음`); return { ok: false, reason: 'attack restricted' }; } // s5
  // 16-?: ≪속공≫ (Rush) is the printed exception to "a Digimon that
  // entered play this turn can't attack" (1-3-1 names this exact case as
  // the canonical example of card text overriding the base rule).
  if (state.turnNumber < stack.attackEligibleTurn && !hasKeyword(stack, '속공') && !opts.ignoreEntry) { // opts.ignoreEntry: 16-33 ≪볼텍스≫ may attack even the turn it entered
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 이번 턴에 등장/원본이 플레이된 카드라 공격 불가`);
    return { ok: false, reason: 'entered play this turn' };
  }
  if (stack.cannotAttackUntil === 'permanent' || (typeof stack.cannotAttackUntil === 'number' && state.turnNumber <= stack.cannotAttackUntil)) {
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 어택 불가 상태라 공격할 수 없음`);
    return { ok: false, reason: 'attack restricted' };
  }
  if (hookNoAttack(state, attackerP, stack) || s1CannotAttack(state, attackerP, stack)) {
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 효과로 어택할 수 없음`);
    return { ok: false, reason: 'attack restricted' };
  }
  if (stackHasContinuousAbility(state, attackerP, stack, RE_CANNOT_ATTACK_NO_OPP_DIGIMON)
      && !state.players[opponentOf(attackerP)].battle.some(s => card(s.cardId).category === 'digimon')) {
    log(state, `${attackerP} ${card(stack.cardId).nameKo}는 상대 디지몬이 없는 동안 어택할 수 없음`);
    return { ok: false, reason: 'attack restricted' };
  }
  if (!opts.noRest) stack.suspended = true; // s5: "레스트시키지 않고 어택" (BT21-072)
  log(state, `${attackerP} ${card(stack.cardId).nameKo}(DP${card(stack.cardId).dp}) 공격 선언${opts.noRest ? ' (레스트하지 않음)' : ''}`);
  return { ok: true, stack };
}

// Resolve a security check once a blocker decision has been made (or none
// available). Handles the standard DP-compare + tie rule; caller applies
// Barrier / other keyword saves separately via retreat-less deleteStack calls.
// Checks 1 + <Security Attack> bonus cards (from the attacker's keyword,
// if any). Jamming means the attacker is never deleted by a security
// digimon. Stops early if the defender is emptied out mid-sequence (a
// following check on an empty stack is what actually ends the game).
// Incremental form of the security check so the UI can reveal each check as its
// own visible step (see main.js doSecurityStep); resolveSecurityCheck below just
// runs it to completion for callers that don't need the pacing.
export function beginSecurityCheck(state, attackerP, attackerUid, defenderP) {
  const apl = state.players[attackerP];
  const attackerStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  return { state, attackerP, attackerUid, defenderP, total: 1 + (attackerStack ? hookSecurityAttackBonus(state, attackerP, attackerStack) : 0), i: 0, results: [], done: false, gameOver: false };
}

export function stepSecurityCheck(ctl) {
  if (ctl.done) return null;
  // 16-4 / 1-2-3-1: a Digimon whose check count has been reduced to 0 (≪S 어택 -1≫) checks nothing — and so can't win against an empty security.
  if (ctl.total <= 0 && ctl.i === 0) {
    log(ctl.state, `${ctl.attackerP} 체크할 수 있는 시큐리티 장수가 0이라 체크를 하지 않음`);
    ctl.done = true;
    return null;
  }
  const { state, attackerP, attackerUid, defenderP } = ctl;
  const apl = state.players[attackerP];
  const attackerStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  const attackerDp = attackerStack ? effectiveDP(state, attackerP, attackerStack) : 0;
  const jamming = attackerStack ? hasKeyword(attackerStack, '재밍') : false;
  const pl = state.players[defenderP];
  const i = ctl.i;
  // 13-1-5: a Digimon that is no longer in the battle area can't keep checking.
  // (also at i === 0: 11-5-1-4 / 11-2-7-4 — an attacker that already left the battle area establishes no attack, so it can neither check nor win on empty security)
  if (!attackerStack) { log(state, `${attackerP} 공격 중인 디지몬이 없어 시큐리티 체크를 진행하지 못함 (13-1-5 / 11-5-1-4)`); ctl.done = true; return null; }
  // 1-3-4 / 1-2-3-1: "0 checks" (S어택 마이너스) means no check can happen — and an empty security is no win either (11-5-1-2-1).
  if (ctl.total <= 0) { log(state, `${attackerP} 체크할 수 있는 시큐리티 체크 수가 0 이하 — 체크 없음 (11-5-1-2-1)`); ctl.done = true; return null; }
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
      ctl.results.push({ empty: true });
      ctl.done = true; ctl.gameOver = true;
      return { empty: true };
    }
    log(state, `${defenderP} 시큐리티가 ${i}장에서 바닥나 이 어택의 남은 체크(${ctl.total - i}회분)는 진행 못함`);
    ctl.done = true;
    return null;
  }
  const id = pl.security.shift();
  pl.trash.push(id);
  const wasFaceUp = secFaceUpTake(pl, id); // s5
  state.secReveal = { p: defenderP, cardId: id, up: wasFaceUp }; // s6: lets 【시큐리티】 effects ask "이 카드가 앞면이었다면"
  emitGameEvent(state, 'securityDecrease', { owner: defenderP, stack: null, cause: 'check' }); // s5
  if (wasFaceUp && attackerStack) emitGameEvent(state, 'faceUpChecked', { owner: attackerP, stack: attackerStack, defenderP, cardId: id }); // s5
  const suppressSecurityEffect = attackerStack && ((hasKeyword(attackerStack, '옵션시큐리티효과무효') && card(id).category === 'option') || hookSuppressSecurity(state, attackerP, attackerStack, id) || S2.securitySuppressed(state, attackerP, defenderP, id)); // shard2
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
  // 13-1-8-2: the 【시큐리티】 effect must fully resolve BEFORE the battle with the security Digimon (13-1-8-3). The UI sets
  // ctl.deferBattle, waits for the pending effects, then calls battleSecurityCheck; plain callers (soak/resolveSecurityCheck) battle immediately.
  if (ctl.deferBattle) { ctl.awaiting = { id, trashN: pl.trash.filter(x => x === id).length }; return { empty: false, revealed: id, awaiting: true }; }
  return battleSecurityCheck(ctl, id);
}

export function battleSecurityCheck(ctl, id) {
  const { state, attackerP, attackerUid, defenderP } = ctl;
  const apl = state.players[attackerP];
  const attackerStack = apl.raising?.uid === attackerUid ? apl.raising : apl.battle.find(s => s.uid === attackerUid);
  const pl = state.players[defenderP];
  const i = ctl.i;
  const awaiting = ctl.awaiting; ctl.awaiting = null;
  if (!attackerStack) { log(state, `${attackerP} 【시큐리티】 효과 처리 후 공격 중인 디지몬이 없어 배틀·남은 체크를 진행하지 못함 (13-1-5)`); ctl.i++; ctl.done = true; return { empty: false, revealed: id, secDp: 0, atkDp: 0, result: 'noBattle' }; }
  const attackerDp = effectiveDP(state, attackerP, attackerStack);
  const jamming = hasKeyword(attackerStack, '재밍');
  // 13-1-8-3-2: the checked card left the "no zone" limbo (played / added to hand by its own effect) -> no security Digimon, no battle.
  const leftLimbo = !!awaiting && pl.trash.filter(x => x === id).length < awaiting.trashN;
  // 13-1-8-3-2: only a Digimon card is a "security Digimon" that battles (14-2); an Option/Tamer has no DP, so it never gets security-DP bonuses and can't beat the attacker.
  const isSecDigimon = card(id).category === 'digimon' && !leftLimbo;
  const secDp = isSecDigimon ? (card(id).dp || 0) + activeSecurityDPBonus(state, defenderP) + s1HookSum(state, 's1securityDP', { p: defenderP }) : 0;
  let result;
  if (!isSecDigimon) result = 'noBattle'; // no security Digimon -> nothing happens, proceed to the next check (13-1-8-3-2)
  else if (attackerDp > secDp) result = 'attackerWins';
  else if (attackerDp < secDp) result = jamming ? 'jammedSurvive' : 'defenderWins';
  else result = jamming ? 'jammedSurvive' : 'tie';
  log(state, `${defenderP} 시큐리티 체크(${i + 1}/${ctl.total}): ${card(id).nameKo}(DP${secDp}) vs 공격측 DP${attackerDp}${jamming ? ' [재밍]' : ''} → ${result}`);
  const r = { empty: false, revealed: id, secDp, atkDp: attackerDp, result };
  ctl.results.push(r);
  ctl.i++;
  // 16-4-1/16-4-2: ≪S 어택≫ is continuous — gaining/losing it mid-check (e.g. from a 【시큐리티】 effect) changes the count now.
  ctl.total = 1 + hookSecurityAttackBonus(state, attackerP, attackerStack);
  // attacker died (unless saved) — remaining checks don't happen
  if (result === 'defenderWins' || result === 'tie' || ctl.i >= ctl.total) ctl.done = true;
  queueAfterBattle(state); // 14-2-5: 【시큐리티】 "배틀 종료 시" effects fire now
  return r;
}

export function resolveSecurityCheck(state, attackerP, attackerUid, defenderP) {
  const ctl = beginSecurityCheck(state, attackerP, attackerUid, defenderP);
  while (!ctl.done) stepSecurityCheck(ctl);
  return { checks: ctl.results, gameOver: ctl.gameOver };
}

// ===== per-card bespoke hooks (shard4+ HOOKS registry; see src/cards/index.js) =====
// HOOKS['CARD-ID'] = [{ tag, has, src:'effectKo'|'inheritedKo', limit, <handlers> }]. `tag`/`has` identify the printed segment
// (tags[0] and a body substring) so the coverage audit can count it, and gate activity (자신의/상대의/서로의 턴).
// Handlers (all optional): dp, noAttack, attackAnyActive, redirectImmune, effectImmune, preventLeave, turnEndAt,
// suppressTrigger, events{kind: fn -> true queues the segment as a normal pending effect}.
export function hookDescriptorFor(cardId, tags, body) {
  const list = CARD_HOOKS[cardId];
  if (!list) return null;
  return list.find(d => d.tag === tags[0] && (!d.has || (body || '').includes(d.has))) || null;
}
function hookActiveNow(state, hp, d) {
  if (d.tag === '자신의 턴') return state.activePlayer === hp;
  if (d.tag === '상대의 턴') return state.activePlayer !== hp;
  return true;
}
const RAISING_OK_CACHE = new Map();
function hookRaisingOk(id, d) {
  const key = `${id}|${d.src || 'effectKo'}|${d.tag}|${d.has || ''}`;
  let v = RAISING_OK_CACHE.get(key);
  if (v === undefined) {
    let seg = null;
    try { seg = findSegmentFor(id, d); } catch { seg = null; }
    v = !seg || (seg.zoneMarker || '').includes('육성'); // segment not identifiable -> keep legacy behaviour
    RAISING_OK_CACHE.set(key, v);
  }
  return v;
}
export function* activeHooks(state) {
  for (const hp of ['p1', 'p2']) {
    const pl = state.players[hp];
    // cards that act from the TRASH ("[트래시]【서로의 턴】…") — descriptor.zone === 'trash', holder is null.
    for (const tid of new Set(pl.trash)) {
      for (const d of CARD_HOOKS[tid] || []) if (d.zone === 'trash' && hookActiveNow(state, hp, d)) yield { hp, holder: null, id: tid, d };
    }
    // s7: face-up security cards acting from the security zone (descriptor.zone === 'security'), holder is null.
    for (const sid of new Set(pl.security)) {
      if (!((pl.secUp && pl.secUp[sid]) > 0)) continue;
      for (const d of CARD_HOOKS[sid] || []) if (d.zone === 'security' && hookActiveNow(state, hp, d)) yield { hp, holder: null, id: sid, d };
    }
    for (const holder of [pl.raising, ...pl.battle].filter(Boolean)) {
      for (const { id, own } of stackContributors(holder)) {
        const list = CARD_HOOKS[id];
        if (!list) continue;
        for (const d of list) {
          if (d.zone === 'trash' || d.zone === 'security') continue;
          if (((d.src || 'effectKo') === 'effectKo') !== own) continue;
          if (!hookActiveNow(state, hp, d)) continue;
          if (holder === pl.raising && !hookRaisingOk(id, d)) continue; // 3-4-7-4/3-4-7-7: raising-area cards act only through [육성] effects
          yield { hp, holder, id, d };
        }
      }
    }
  }
}
export function hookDP(state, tp, target) {
  let sum = 0;
  for (const { hp, holder, d } of activeHooks(state)) if (d.dp) sum += d.dp(state, hp, holder, target, tp) || 0;
  return sum;
}
export function hookNoAttack(state, p, stack) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.noAttack && hp === p && holder === stack && d.noAttack(state, hp, holder)) return true;
  return false;
}
export function hookAttackAnyActive(state, p, stack) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.attackAnyActive && hp === p && holder === stack && d.attackAnyActive(state, hp, holder)) return true;
  return false;
}
export function hookRedirectImmune(state, ap, aStack) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.redirectImmune && d.redirectImmune(state, hp, holder, aStack, ap)) return true;
  return false;
}
export function hookTurnEndThreshold(state, p) {
  let t = 1;
  for (const { hp, holder, d } of activeHooks(state)) if (d.turnEndAt && hp === p) t = Math.max(t, d.turnEndAt(state, hp, holder) || 1);
  return t;
}
export function hookSuppressTrigger(state, tp, target, tag) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.suppressTrigger && d.suppressTrigger(state, hp, holder, tp, target, tag)) return true;
  return false;
}
// "상대는 DP N 이하의 디지몬을 등장/이동시킬 수 없다" and "Lv.N 이하의 디지몬은 진화할 수 없다" (turn-limited, stored on the state).
export function addPlayRestriction(state, p, dpMax, untilTurn) { (state.playRestrictions ||= []).push({ player: p, dpMax, until: untilTurn }); log(state, `${p} DP ${dpMax} 이하의 디지몬을 등장/이동시킬 수 없음`); }
export function isPlayRestricted(state, p, cardId) {
  const dp = card(cardId).dp || 0;
  return (state.playRestrictions || []).some(r => r.player === p && state.turnNumber <= r.until && card(cardId).category === 'digimon' && dp <= r.dpMax);
}
export function addEvolveLock(state, p, levelMax, untilTurn) { (state.evolveLocks ||= []).push({ player: p, levelMax, until: untilTurn }); log(state, `${p} Lv.${levelMax} 이하의 디지몬은 진화할 수 없음`); }
// Once-per-turn bookkeeping for hook handlers: true (and marks) if this descriptor hasn't been used this turn by `holder`.
// Extra names/traits a stack has through printed "…명칭/특징을 얻는다" abilities (descriptor.names / descriptor.types).
export function hookStackNames(state, p, stack) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) if (d.names && hp === p && holder === stack) out.push(...(d.names(state, hp, holder) || []));
  return out;
}
export function hookStackTypes(state, p, stack) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) if (d.types && hp === p && holder === stack) out.push(...(d.types(state, hp, holder) || []));
  return out;
}
// Array handed to E.canEvolveAny as `extraColors`: the stack's extra colors plus `.replace` (원래 색 변경) and `.names` (얻은 명칭).
export function evoExtraArg(state, p, stack) {
  const a = [...(stack.extraColors || [])];
  if (stack.extraColors && stack.extraColors.replace) a.replace = stack.extraColors.replace;
  const n = hookStackNames(state, p, stack);
  if (n.length) a.names = n;
  return a;
}
export function hookUseOnce(holder, id, d, limit = 1) {
  const key = onceLimitKey(id, [d.tag, d.has || '']);
  if (turnUsesRemaining(holder, key, limit) <= 0) return false;
  markTurnEffectUsed(holder, key);
  return true;
}
// Effect immunity ("상대의 효과를 받지 않는다" family). fx source = state._fxSrc (set by the effect runner), falling back to
// "the opponent" when a deletion arrives with cause 'effect'. kind: delete|bounce|rest|dpDown|retreat|other.
export function effectBlocked(state, tp, target, kind, causeHint = null) {
  if (!target) return false;
  let src = state._fxSrc || null;
  if (!src) {
    if (causeHint === 'effect') src = { player: opponentOf(tp), category: 'unknown' };
    else return false;
  }
  if (src.player === tp) return false; // only OPPONENT effects are ever blocked by these abilities
  // 16-39 ≪프로그레스≫: while attacking, this Digimon isn't affected by the opponent's effects.
  if (state.attackCtx && state.attackCtx.attacker === tp && state.attackCtx.uid === target.uid && hasKeyword(target, '프로그레스')) return true;
  for (const sh of target.shields || []) {
    if (sh.until != null && state.turnNumber > sh.until) continue;
    if (sh.fromCategory && sh.fromCategory !== src.category) continue;
    if (sh.kinds.includes('all') || sh.kinds.includes(kind)) return true;
  }
  for (const { hp, holder, d } of activeHooks(state)) {
    if (d.effectImmune && hp === tp && d.effectImmune(state, hp, holder, target, tp, { kind, src })) return true;
  }
  return false;
}
// s8: buffs applied for a single effect-triggered attack ("~한 후 그 디지몬으로 어택") are undone when that attack ends.
export function revertAtkEndBuffs(state, p, uid) {
  const st = findStackAny(state, p, uid);
  if (!st || !st.s8AtkRevert) return;
  const a = st.s8AtkRevert; st.s8AtkRevert = 0;
  modifyDP(state, p, uid, -a, 'turn');
}
// s8: called when an attack ends — undo single-attack DP buffs; 《에그제큐트》 attackers are deleted afterwards.
export function s8AttackEnded(state, p, uid) {
  revertAtkEndBuffs(state, p, uid);
  const st = findStackAny(state, p, uid);
  if (st && st.s8ExecDelete) { st.s8ExecDelete = false; log(state, `${p} ${card(st.cardId).nameKo} 《에그제큐트》 — 어택 종료로 소멸`); deleteStack(state, p, uid, 'trash', 'ownEffect'); }
}
function findStackAny(state, p, uid) { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; }
export function grantShield(state, p, uid, shield) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return;
  (stack.shields = stack.shields || []).push(shield);
  log(state, `${p} ${card(stack.cardId).nameKo} 효과 보호 부여: ${shield.kinds.join('/')}`);
}
// Replacement hooks ("…벗어날/소멸할 때, …하는 것으로, 벗어나지/소멸하지 않는다"). Returns true when a hook prevented it.
export function hookPreventLeave(state, tp, target, cause, mode = 'delete') {
  for (const { hp, holder, d, id } of [...activeHooks(state)]) {
    if (!d.preventLeave || hp !== tp) continue;
    if (replAttempt(state, () => d.preventLeave(state, hp, holder, target, tp, cause, mode, id))) return true;
  }
  return false;
}
function findSegmentFor(cardId, d) {
  const c = card(cardId);
  const text = (d.src || 'effectKo') === 'effectKo' ? c.effectKo : c.inheritedKo;
  return parseEffectSegments(text).segments.find(sg => sg.tags[0] === d.tag && (!d.has || sg.body.includes(d.has))) || null;
}
export function queueHookSegment(state, hp, holder, id, d, info = null) {
  const seg = findSegmentFor(id, d);
  if (!seg) return;
  holder.hookEvt = info || null;
  const text = seg.body.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  state.pending.push({ uid: 'p' + (pendingUid++), player: hp, cardId: id, stackUid: holder.uid, tags: seg.tags, text, resolved: false, watcher: true, inherited: (d.src || 'effectKo') !== 'effectKo', evt: info || null });
}
export function dispatchHookEvents(state, kind, info) {
  for (const { hp, holder, id, d } of [...activeHooks(state)]) {
    const fn = d.events && d.events[kind];
    if (!fn) continue;
    if (!fn(state, hp, holder, info)) continue;
    if (d.limit != null && !hookUseOnce(holder, id, d, d.limit)) continue;
    queueHookSegment(state, hp, holder, id, d, { kind, ...info, stack: undefined, stackUid: info.stack?.uid });
  }
}
// ---- shard-3 additions to the hooks registry ----
// descriptor.restLock(state, hp, holder, target, tp) -> true: ability of hp's holder forbids OPPONENT stack `target` (controlled by tp) from resting.
export function hookCannotRest(state, tp, target) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.restLock && hp !== tp && d.restLock(state, hp, holder, target, tp)) return true;
  return false;
}
// descriptor.suppressSecurity(state, hp, holder, revealedCardId) -> true: this attacker's checked card's 【시큐리티】 effect is not activated.
export function hookSuppressSecurity(state, ap, aStack, revealedId) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.suppressSecurity && hp === ap && holder === aStack && d.suppressSecurity(state, hp, holder, revealedId)) return true;
  return false;
}
// Security Attack bonus with descriptor.sAttackFlip ("《S 어택 -》 전부를 《S 어택 +》로 변경"): a NEGATIVE net bonus flips positive.
export function hookSecurityAttackBonus(state, ap, aStack) {
  const raw = securityAttackBonus(aStack);
  let base = raw;
  if (raw < 0) for (const { hp, d } of activeHooks(state)) if (d.sAttackFlip && hp === ap) { base = -raw; break; }
  for (const { hp, holder, d } of activeHooks(state)) if (d.sAtk && hp === ap) base += d.sAtk(state, hp, holder, aStack) || 0; // shard2
  return base;
}
// descriptor.noUnsuspend(state, hp, holder) -> true: this stack never becomes active (unsuspend phase / effects).
export function hookNoUnsuspend(state, p, stack) {
  if (stack.s2NoActiveUntil != null && state.turnNumber <= stack.s2NoActiveUntil) return true; // shard2
  for (const { hp, holder, d } of activeHooks(state)) if (d.noUnsuspend && hp === p && holder === stack && d.noUnsuspend(state, hp, holder)) return true;
  // s6: descriptor.noUnsuspendOthers(state, hp, holder, target, targetOwner) -> true: the holder's ability keeps EVERY OTHER stack (either side) from becoming active.
  for (const { hp, holder, d } of activeHooks(state)) if (d.noUnsuspendOthers && holder !== stack && d.noUnsuspendOthers(state, hp, holder, stack, p)) return true;
  return false;
}
// descriptor.playDiscount(state, hp, holder, cardId) -> { label, apply() -> negative delta } | null. UI confirms then applies (cost paid inside apply).
export function hookPlayCostOptions(state, p, cardId) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) {
    if (!d.playDiscount || hp !== p || state.activePlayer !== p || isPlayCostLocked(state)) continue;
    const o = d.playDiscount(state, hp, holder, cardId);
    if (o) out.push(o);
  }
  return out;
}
// descriptor.evoDiscount(state, hp, holder, evolvingStack, targetCardId) -> number (auto, applied once) ; descriptor.evoOption(...) -> { label, apply() } (confirmed).
export function hookEvoCostDiscount(state, p, stack, targetCardId) {
  let sum = 0;
  for (const { hp, holder, d } of activeHooks(state)) if (d.evoDiscount && hp === p) sum += d.evoDiscount(state, hp, holder, stack, targetCardId) || 0;
  return sum;
}
export function hookEvoCostOptions(state, p, stack, targetCardId) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) {
    if (!d.evoOption || hp !== p) continue;
    const o = d.evoOption(state, hp, holder, stack, targetCardId);
    if (o) out.push(o);
  }
  return out;
}
// descriptor.attackerRedirect(state, hp, holder, attackerStack, curTargetUid) -> [{ targetUid|null, toPlayer, label, pay(choose) }]: the ATTACKING
// player's own reaction ("자신의 디지몬이 상대의 디지몬에게 어택했을 때, …어택의 대상을 …로 변경한다").
export function hookAttackerRedirectOptions(state, attackerP, aStack, curTargetUid) {
  const out = [];
  for (const { hp, holder, id, d } of [...activeHooks(state)]) {
    if (!d.attackerRedirect || hp !== attackerP || !holder) continue;
    for (const o of d.attackerRedirect(state, hp, holder, aStack, curTargetUid) || []) out.push({ cardId: id, stackUid: holder.uid, ...o });
  }
  return out;
}
// descriptor.redirectOptions(state, hp, holder, attackerP, attackerStack) -> [{ targetUid|null, toPlayer, limit, label, pay(choose) }]
export function hookRedirectOptions(state, defenderP, attackerP, aStack) {
  const out = [];
  for (const { hp, holder, id, d } of activeHooks(state)) {
    if (!d.redirectOptions || hp !== defenderP) continue;
    for (const o of d.redirectOptions(state, hp, holder, attackerP, aStack) || []) out.push({ cardId: id, stackUid: holder.uid, ...o });
  }
  return out;
}
// Per-stack turn-limited flags used by shard-3 effects: stack.s3[flag] = last turn number (inclusive).
export function s3Flag(state, stack, flag) { return !!(stack && stack.s3 && stack.s3[flag] != null && state.turnNumber <= stack.s3[flag]); }
export function setS3Flag(stack, flag, untilTurn) { (stack.s3 ||= {})[flag] = untilTurn; }
// Tokens (no printed card): ids start with TOKEN- and vanish when they leave the battle area.
export const isTokenId = (id) => !!CARDS[id]?.isToken;
export function purgeTokens(state) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    for (const z of ['hand', 'trash', 'deck', 'security']) if (pl[z].some(isTokenId)) pl[z] = pl[z].filter(id => !isTokenId(id));
  }
}
// Zone-printed 【메인】 abilities ("[패]【메인】"/"[트래시]【메인】") — usable from that zone during the owner's main phase.
export function zoneMainAbilities(state, p, zone) {
  if (p !== state.activePlayer || state.phase !== 'main') return [];
  const marker = zone === 'hand' ? '패' : '트래시';
  const out = [];
  state.players[p][zone].forEach((id, idx) => {
    const c = card(id);
    for (const seg of parseEffectSegments(c.effectKo).segments) {
      if (!seg.tags.includes('메인') || !seg.zoneMarker || !seg.zoneMarker.includes(marker)) continue;
      out.push({ idx, cardId: id, tags: seg.tags, text: seg.body.trim() });
    }
  });
  return out;
}

// descriptor.onLeave(state, hp, holder, cause) -> truthy: queue this segment when its holder LEAVES the battle area (holder is already off the board;
// pending.evt = { leaving: true, cause, sources: [ids the stack had], cardId }). Called from deleteStack and bounce ops.
export function hookLeaveTriggers(state, p, stack, cause) {
  for (const { id, own } of stackContributors(stack)) {
    const list = CARD_HOOKS[id];
    if (!list) continue;
    for (const d of list) {
      if (!d.onLeave || ((d.src || 'effectKo') === 'effectKo') !== own) continue;
      if (!hookActiveNow(state, p, d)) continue;
      if (!d.onLeave(state, p, stack, cause)) continue;
      queueHookSegment(state, p, stack, id, d, { leaving: true, cause, sources: stack.sources.slice(), cardId: stack.cardId });
    }
  }
}
// "【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다." granted by an effect: stack.s3.forceAtkMain = { until, src }
export function queueForcedAttacks(state, p) {
  for (const st of state.players[p].battle) {
    const f = st.s3 && st.s3.forceAtkMain;
    if (f && state.turnNumber <= f.until) queuePending(state, { player: p, cardId: f.src, stackUid: st.uid, tags: ['s3ForceAttack'], text: '【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.', watcher: true });
  }
}

// Internals exposed for shard modules (kept in one bag so shards never need to touch state.js again).
// ===== shard5 additions (face-down sources, face-up security, extra continuous hooks, 《디코이》) =====
// Face-down (뒷면) evolution sources: they always form the bottom block sources[0..fdCount-1] and lend no effects.
export function fdCount(stack) { return Math.min((stack && stack.s5fd) || 0, stack ? stack.sources.length : 0); }
// Face-up (앞면) security cards, tracked as a multiset by card id on the owner (lazily clamped to what is still in security).
export function secFaceUpCount(pl) {
  let n = 0;
  for (const [id, c] of Object.entries(pl.secUp || {})) n += Math.min(c, pl.security.filter(x => x === id).length);
  return n;
}
// Call right after `id` left the security stack: true when the removed copy was a face-up one (and clamps the multiset).
export function secFaceUpTake(pl, id) {
  const up = (pl.secUp && pl.secUp[id]) || 0;
  if (!up) return false;
  const remain = pl.security.filter(x => x === id).length;
  pl.secUp[id] = Math.min(up, remain);
  return up > remain;
}
export function secFlipTopFaceUp(state, p) {
  const pl = state.players[p];
  for (const id of pl.security) {
    const up = (pl.secUp && pl.secUp[id]) || 0;
    if (up < pl.security.filter(x => x === id).length) { (pl.secUp ||= {})[id] = up + 1; log(state, `${p} 시큐리티 위에서 ${card(id).nameKo} 앞면으로`); return id; }
  }
  return null;
}
export function secAddFaceUp(state, p, cardId, position = 'top') {
  addToSecurity(state, p, cardId, position);
  const pl = state.players[p];
  (pl.secUp ||= {})[cardId] = (pl.secUp[cardId] || 0) + 1;
}
function hookOwnerOf(state, stack) { return ['p1', 'p2'].find(pp => state.players[pp].raising === stack || state.players[pp].battle.includes(stack)) || null; }
// descriptor.noRest(state, hp, holder, target) -> the holder's own ability forbids `target` (same player) from resting.
export function hookNoRest(state, p, target) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.noRest && hp === p && d.noRest(state, hp, holder, target)) return true;
  return false;
}
// descriptor.noBlock(state, hp, holder, target) -> `target` (hp's stack) may not block.
export function hookNoBlock(state, p, target) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.noBlock && hp === p && d.noBlock(state, hp, holder, target)) return true;
  return false;
}
// descriptor.battleImmune(state, hp, holder, target) -> `target` is not deleted by battle.
export function hookBattleImmune(state, target) {
  const p = hookOwnerOf(state, target);
  if (!p) return false;
  for (const { hp, holder, d } of activeHooks(state)) if (d.battleImmune && hp === p && d.battleImmune(state, hp, holder, target)) return true;
  return false;
}
// descriptor.atkTargetBlocked(state, hp, holder, attackerP, attacker, target) -> attacker may NOT target `target` (hp's digimon).
export function hookAttackTargetBlocked(state, attackerP, attacker, defP, target) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.atkTargetBlocked && hp === defP && d.atkTargetBlocked(state, hp, holder, attackerP, attacker, target)) return true;
  return false;
}
// descriptor.grantKw(state, hp, holder, target) -> array of keyword names the holder's ability grants to `target`.
export function hookGrantedKeywords(state, p, target) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) if (d.grantKw && hp === p) out.push(...(d.grantKw(state, hp, holder, target) || []));
  return out;
}
// Static "이 디지몬은 「A」의 조그레스 진화에서 「B」·Lv.N으로도 취급한다" (descriptor.jogressAlias(targetCardId) -> [{nameKo, level}]).
export function hookJogressAliases(materialCardId, targetCardId) {
  const out = [];
  for (const d of CARD_HOOKS[materialCardId] || []) if (d.jogressAlias) out.push(...(d.jogressAlias(targetCardId) || []));
  return out;
}
// 《디코이《색》》: "X인 다른 자신의 디지몬이 상대의 효과로 소멸할 때, 이 디지몬을 소멸시키는 것으로, 그 디지몬 1마리는 소멸하지 않는다."
function decoyColors(state, stack) {
  if (stack.keywords && stack.keywords['디코이']) return Array.isArray(stack.keywords['디코이']) ? stack.keywords['디코이'] : null;
  const cols = [];
  for (const { id, own } of stackContributors(stack)) {
    if (id === 'BT8-060' || id === 'P-045' || id === 'ST12-12') continue; // shard1: conditional decoys live in HOOKS (preventLeave)
    const t = own ? card(id).effectKo : card(id).inheritedKo;
    for (const m of (t || '').matchAll(/디코이((?:\s*《[^》]+》\s*\/?)+)》/g)) for (const c of m[1].matchAll(/《([^》]+)》/g)) if (KOR_COLOR_NAME[c[1]]) cols.push(KOR_COLOR_NAME[c[1]]);
  }
  return cols.length ? cols : null;
}
function tryDecoy(state, p, stack, cause) {
  if (cause !== 'effect') return false;
  const pl = state.players[p];
  const cs = [...(card(stack.cardId).colors || []), ...(stack.extraColors || [])];
  for (const other of pl.battle) {
    if (other === stack || card(other.cardId).category !== 'digimon') continue;
    const cols = decoyColors(state, other);
    if (!cols || !cs.some(c => cols.includes(c))) continue;
    log(state, `${p} ${card(other.cardId).nameKo} 《디코이》 — 자신이 소멸하여 ${card(stack.cardId).nameKo}는 소멸하지 않음`);
    deleteStack(state, p, other.uid, 'trash', 'ownEffect');
    return true;
  }
  // 16-45 ≪수호≫: another own Digimon would be removed by an opponent's effect -> this Digimon vanishes instead, the other stays.
  for (const other of pl.battle) {
    if (other === stack || card(other.cardId).category !== 'digimon' || !hasKeyword(other, '수호')) continue;
    log(state, `${p} ${card(other.cardId).nameKo} 《수호》 — 자신이 소멸하여 ${card(stack.cardId).nameKo}는 소멸하지 않음`);
    deleteStack(state, p, other.uid, 'trash', 'ownEffect');
    return true;
  }
  return false;
}

// s5: keyword/granted effects that fire at fixed engine moments. Pending items use pseudo-tags '__…' resolved via the
// wildcard key '*::__…' (see effects.lookupCardSpecific).
// s6: "[트래시]【자신의 턴 종료 시】…" abilities printed on cards sitting in the trash.
export function queueTrashTurnEnd(state, p) {
  for (const id of new Set(state.players[p].trash)) {
    for (const seg of parseEffectSegments(card(id).effectKo).segments) {
      if (!(seg.zoneMarker || '').includes('트래시') || !seg.tags.some(t => t.includes('자신의 턴 종료 시'))) continue;
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: id, stackUid: null, tags: seg.tags, text: seg.body, resolved: false });
    }
  }
}
export function queueTurnEndKeywords(state, p) {
  const pl = state.players[p];
  for (const st of [...pl.battle]) { // 16-44 ≪급습≫ / 16-34 ≪오버클럭≫: turn-end attacks
    if (card(st.cardId).category !== 'digimon') continue;
    if (hasKeyword(st, '급습') || hookGrantedKeywords(state, p, st).includes('급습')) {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: st.cardId, stackUid: st.uid, tags: ['__급습'], text: '《급습》 자신의 턴 종료 시, 이 디지몬으로 어택할 수 있다.', resolved: false });
    }
    for (const { desc } of keywordDescs(st, '오버클럭')) {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: st.cardId, stackUid: st.uid, tags: ['__오버클럭'], text: `《오버클럭《${desc}》》 자신의 턴 종료 시, 자신의 토큰이나 ${desc}인 다른 자신의 디지몬 1마리를 소멸시키는 것으로, 이 디지몬으로 레스트하지 않고 플레이어에게 어택한다.`, overclockDesc: desc, resolved: false });
    }
  }
  for (const st of [...pl.battle]) { // s8: 《에그제큐트》 — turn end: may attack (even active opposing Digimon), then this Digimon is deleted
    if (card(st.cardId).category !== 'digimon') continue;
    if (hasKeyword(st, '에그제큐트') || hookGrantedKeywords(state, p, st).includes('에그제큐트')) {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: st.cardId, stackUid: st.uid, tags: ['__에그제큐트'], text: '《에그제큐트》 자신의 턴 종료 시, 이 디지몬으로 어택할 수 있다. 이 어택 종료 시, 이 디지몬은 소멸한다. 이 효과로는 액티브 상태인 상대의 디지몬에게도 어택할 수 있다.', resolved: false });
    }
  }
  for (const st of [...pl.battle]) {
    if (card(st.cardId).category !== 'digimon') continue;
    if (hasKeyword(st, '볼텍스') || hookGrantedKeywords(state, p, st).includes('볼텍스')) {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: st.cardId, stackUid: st.uid, tags: ['__볼텍스'], text: '《볼텍스》 자신의 턴 종료 시, 이 디지몬으로 상대의 디지몬에게 어택할 수 있다. 이 효과로는 등장한 턴에도 어택할 수 있다.', resolved: false });
    }
  }
}
export function queueMainStartGranted(state, p) {
  const pl = state.players[p];
  for (const st of [...pl.battle]) {
    if (st.s5forceAtkUntil != null && state.turnNumber <= st.s5forceAtkUntil && card(st.cardId).category === 'digimon') {
      state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: st.cardId, stackUid: st.uid, tags: ['__강제어택'], text: '【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.', resolved: false });
    }
  }
}

export const _s4 = { makeStack, nextUid, ruleCheckDP, discardLinkCardsOnNewCard, stackContributors, evoTargetPredicate, queueInheritedTriggersFor, KOR_COLOR_NAME, findSegmentFor };

// ===== shard7 engine additions (continuous keyword hook, DP-mod list, effect hatch, battle-win / security events) =====
let S7_BOUND = null; // the live game state, so stack-only helpers (hasKeyword) can consult hooks
let S7_KW_GUARD = false;
function s7Bound(state) { S7_BOUND = state; return state; }
// descriptor.kw(state, hp, holder, keywordName) -> true: this holder itself continuously has that keyword.
// descriptor.grantKw (shard5) is honoured here too so hasKeyword() sees continuous grants everywhere.
// Generic printed "【자신/상대/서로의 턴】 <조건> 이 디지몬은 《키워드》(와 《키워드》)를 얻는다." grants (16-x, 15-8-2).
// Only conditions we can evaluate exactly are supported (none / name-trait descriptor / own Tamer / own named card / own trash>=N /
// opponent hand<=N); anything else parses to null and is ignored (never misapplied).
const CONT_GRANT_CACHE = new Map();
const CONT_KW_LABELS = { '블로커': 1, '재밍': 1, '관통': 1, '재기동': 1, '속공': 1, '돌진': 1, '연계': 1, '길동무': 1, '회피': 1, '아머퍼지': 1, '방벽': 1, '스케이프고트': 1, '불굴': 1, '충돌': 1, '진격': 1, '볼텍스': 1, '에그제큐트': 1, '천승': 1, '빙장': 1, '수호': 1, '급습': 1, '프로그레스': 1 };
function contGrantCond(cond) {
  let c = cond.trim().replace(/[,，]\s*$/, '').trim();
  if (!c) return () => true;
  let m;
  if (/^자신의\s*테이머가\s*있는\s*동안$/.test(c)) return (st, p) => st.players[p].battle.some(x => card(x.cardId).category === 'tamer');
  if ((m = c.match(/^자신의\s*「([^」]+)」(?:이|가)\s*있는\s*동안$/))) return (st, p) => st.players[p].battle.some(x => card(x.cardId).nameKo.includes(m[1]));
  if ((m = c.match(/^자신의\s*트래시가\s*(\d+)\s*장\s*이상인\s*동안$/))) return (st, p) => st.players[p].trash.length >= Number(m[1]);
  if ((m = c.match(/^상대의\s*패가\s*(\d+)\s*장\s*이하인\s*동안$/))) return (st, p) => st.players[opponentOf(p)].hand.length <= Number(m[1]);
  c = c.replace(/^이\s*디지몬이\s+/, '').replace(/\s*(?:을|를)?\s*(?:가지는|가진|갖는|포함하는)?\s*동안$/, '').trim();
  const left = c.replace(/명칭에\s*(?:「[^」]+」\s*\/?\s*)+(?:을|를)?\s*포함(?:하는|하거나|하)?/g, '')
    .replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\s*\/?\s*)+(?:을|를)?\s*(?:가진|가지는|가지거나|가지|갖는)?/g, '')
    .replace(/「[^」]+」(?:이|가)\s*기술되어\s*있는/g, '').replace(/2색\s*이상의/g, '')
    .replace(/(?:거나|또는|,|\/|\s)/g, '');
  if (left) return null;
  const pr = evoTargetPredicate(c);
  return pr ? ((st, p, stack) => pr(card(stack.cardId))) : null;
}
function parseContGrants(text) {
  if (CONT_GRANT_CACHE.has(text)) return CONT_GRANT_CACHE.get(text);
  const out = [];
  for (const seg of parseEffectSegments(text).segments) {
    if (seg.tags.length !== 1 || !['자신의 턴', '상대의 턴', '서로의 턴'].includes(seg.tags[0])) continue;
    const body = seg.body.trim().split('\n')[0].replace(/\s*〈룰〉.*$/s, '').trim();
    if (/^[\[〔]/.test(body)) continue;
    const m = body.match(/^(.*?)이\s*디지몬은\s*((?:[《≪][^》≫]*(?:[《≪][^》≫]*[》≫][^》≫]*)?[》≫]\s*(?:[(（][^()（）]*[)）])?\s*(?:과|와|,)?\s*)+)(?:을|를)\s*얻는다\.?$/s);
    if (!m) continue;
    const cond = contGrantCond(m[1]);
    if (!cond) continue;
    const kws = []; let sAtk = 0;
    for (const t of m[2].replace(/[(（][^()（）]*[)）]/g, '').matchAll(/[《≪]\s*((?:[^》≫《≪]|[《≪][^》≫]*[》≫])+?)\s*[》≫]/g)) {
      const lab = t[1].replace(/\s+/g, ' ').trim(); let mm;
      if ((mm = lab.match(/^(?:S|시큐리티)\s*어택\s*\+(\d+)$/))) sAtk += Number(mm[1]);
      else if (CONT_KW_LABELS[lab.replace(/\s+/g, '')]) kws.push(lab.replace(/\s+/g, ''));
    }
    if (kws.length || sAtk) out.push({ tag: seg.tags[0], cond, kws, sAtk });
  }
  CONT_GRANT_CACHE.set(text, out);
  return out;
}
// Live evaluation for one stack: which keywords / how much S 어택 it currently has through such printed grants.
function genericContGrants(state, p, stack) {
  const flags = new Set(); let sAtk = 0;
  for (const { id, own } of stackContributors(stack)) {
    const text = own ? card(id).effectKo : card(id).inheritedKo;
    if (!text) continue;
    for (const g of parseContGrants(text)) {
      if (!(g.tag === '서로의 턴' || (g.tag === '자신의 턴') === (state.activePlayer === p))) continue;
      if (!g.cond(state, p, stack)) continue;
      for (const k of g.kws) flags.add(k);
      sAtk += g.sAtk;
    }
  }
  return { flags, sAtk };
}
function s7ContKw(stack, name) {
  const state = S7_BOUND;
  if (!state || !stack || S7_KW_GUARD) return false;
  const p = hookOwnerOf(state, stack);
  if (!p) return false;
  S7_KW_GUARD = true;
  try {
    if (genericContGrants(state, p, stack).flags.has(name)) return true;
    for (const { hp, holder, d } of activeHooks(state)) {
      if (hp !== p) continue;
      if (d.kw && holder === stack && d.kw(state, hp, holder, name)) return true;
      if (d.grantKw && (d.grantKw(state, hp, holder, stack) || []).includes(name)) return true;
    }
  } finally { S7_KW_GUARD = false; }
  return false;
}
// descriptor.kwNum(state, hp, holder) -> extra 《S 어택 +N》 continuously granted to the holder.
function s7ContSAttack(stack) {
  const state = S7_BOUND;
  if (!state || !stack || S7_KW_GUARD) return 0;
  const p = hookOwnerOf(state, stack);
  if (!p) return 0;
  let n = 0;
  S7_KW_GUARD = true;
  try {
    n += genericContGrants(state, p, stack).sAtk;
    for (const { hp, holder, d } of activeHooks(state)) if (hp === p && holder === stack && d.kwNum) n += Number(d.kwNum(state, hp, holder)) || 0;
  } finally { S7_KW_GUARD = false; }
  return n;
}
// Timed DP modifiers that don't fight over the single tempDP/dpExpiry pair: stack.s7Dp = [{amount, until}] (until = last turn number inclusive).
export function s7DpSum(state, stack) {
  let t = 0;
  for (const m of stack.s7Dp || []) if (state.turnNumber <= m.until) t += m.amount;
  return t;
}
export function s7AddDpMod(state, p, uid, amount, until) {
  const pl = state.players[p];
  const stack = pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid);
  if (!stack) return false;
  if (!stackHasDP(state, stack)) { log(state, `${p} ${card(stack.cardId).nameKo}는 DP를 가지지 않아 DP를 증감할 수 없음 (룰 2-5-3)`); return false; }
  if (amount < 0 && effectBlocked(state, p, stack, 'dpDown')) { log(state, `${p} ${card(stack.cardId).nameKo}는 상대의 효과로 DP가 감소하지 않음`); return false; }
  if (amount < 0 && hasKeyword(stack, 'DP감소무효')) { log(state, `${p} ${card(stack.cardId).nameKo}는 DP 감소 무효 — ${amount} 무시됨`); return false; }
  stack.s7Dp = (stack.s7Dp || []).filter(m => state.turnNumber <= m.until);
  stack.s7Dp.push({ amount, until });
  log(state, `${p} ${card(stack.cardId).nameKo} DP ${amount >= 0 ? '+' : ''}${amount}`);
  ruleCheckDP(state, p, stack);
  return true;
}
// "자신의 육성 에어리어를 부화할 수 있다" as a card effect: not the once-per-breeding-phase action, only needs an empty raising area.
export function s7HatchByEffect(state, p) {
  const pl = state.players[p];
  if (pl.raising) { log(state, `${p} 육성 에어리어에 이미 카드가 있어 부화 불가`); return null; }
  const id = pl.digitamaDeck.shift();
  if (!id) return null;
  pl.raising = makeStack(id, state.turnNumber);
  recomputeStackGrants(pl.raising);
  log(state, `${p} 디지타마 부화 (효과): ${card(id).nameKo}`);
  return pl.raising;
}
// descriptor.dpFloor(state, hp, holder) -> N: the holder's DP never drops below N ("DP는 1000보다 낮아지지 않고").
function s7DpFloor(state, p, stack, total) {
  let floor = null;
  for (const { hp, holder, d } of activeHooks(state)) {
    if (!d.dpFloor || hp !== p || holder !== stack) continue;
    const f = d.dpFloor(state, hp, holder);
    if (f != null) floor = floor == null ? f : Math.max(floor, f);
  }
  return floor != null && total < floor ? floor : total;
}

// s7: trash one face-up copy of `id` from the security stack (paying a security-zone ability's cost).
export function s7TrashFaceUpSecurity(state, p, id) {
  const pl = state.players[p];
  const i = pl.security.indexOf(id);
  if (i < 0) return false;
  pl.security.splice(i, 1);
  pl.trash.push(id);
  secFaceUpTake(pl, id);
  log(state, `${p} 시큐리티의 ${card(id).nameKo} 파기`);
  emitGameEvent(state, 'securityDecrease', { owner: p, stack: null, cause: 'effect' });
  return true;
}
// descriptor.linkCost(state, hp, holder, hostStack, linkCardId) -> negative delta (auto-applied, once-limited by the descriptor).
export function s7LinkCostDelta(state, p, host, linkCardId) {
  let sum = 0;
  for (const { hp, holder, id, d } of [...activeHooks(state)]) {
    if (!d.linkCost || hp !== p) continue;
    const v = d.linkCost(state, hp, holder, host, linkCardId);
    if (!v) continue;
    if (d.limit != null && !hookUseOnce(holder, id, d, d.limit)) continue;
    sum += v;
  }
  return sum;
}

// ===== shard-1 additions: s1* hook dispatch (descriptor handlers named s1*, see src/cards/shard1.js) =====
import * as S1 from './cards/shard1.js';
import * as S2 from './cards/shard2.js'; // shard2: fixData / fullInherit / xros pools / granted effects / evolve ban
let s1PendingUid = 1;
export function s1HookAny(state, name, info) {
  for (const { hp, holder, id, d } of activeHooks(state)) if (d[name] && d[name](state, hp, holder, info)) return true;
  return false;
}
export function s1HookSum(state, name, info) {
  let t = 0;
  for (const { hp, holder, d } of activeHooks(state)) if (d[name]) t += Number(d[name](state, hp, holder, info)) || 0;
  return t;
}
export function s1HookFirst(state, name, info) {
  for (const { hp, holder, d } of activeHooks(state)) if (d[name]) { const r = d[name](state, hp, holder, info); if (r) return r; }
  return null;
}
export function s1HookCollect(state, name, info) {
  const out = [];
  for (const { hp, holder, d } of activeHooks(state)) if (d[name]) { const r = d[name](state, hp, holder, info); if (r) out.push(...(Array.isArray(r) ? r : [r])); }
  return out;
}
export function s1Flag(state, st, flag) { return !!(st && st.s1 && st.s1[flag] != null && state.turnNumber <= st.s1[flag]); }
export function s1PushPending(state, item) { state.pending.push({ uid: 's1p' + (s1PendingUid++), resolved: false, watcher: true, ...item }); }
// per-player timed rules set by scripts (BT9-103): { kind, until, ... }
function s1Rules(state, kind) { return (state.s1Rules || []).filter(r => r.kind === kind && r.until >= state.turnNumber); }
export function s1SecIncreaseBlocked(state, who) {
  const src = state._fxSrc;
  return !!src && s1Rules(state, 'noSecurityIncrease').some(r => r.blocked === src.player);
}
export function s1CannotAttack(state, p, stack) { return s1Flag(state, stack, 'noAttack') || s1HookAny(state, 's1cannotAttack', { p, stack }); }
export function s1CannotAttackPlayer(state, p, stack) {
  if (s1HookAny(state, 's1cannotAttackPlayer', { p, stack })) return true;
  return s1Rules(state, 'noPlayerAttack').some(r => r.owner === p && (card(stack.cardId).cost ?? 0) <= r.maxCost);
}
export function s1BlockedBy(state, attackerP, attacker, blockerP, blocker) {
  return s1Flag(state, blocker, 'noBlock') || s1Flag(state, attacker, 'unblockable') || s1HookAny(state, 's1blocked', { attackerP, attacker, blockerP, blocker });
}
export function s1BattleDeleteBlocked(state) { return state.s1NoBattleDelete === state.turnNumber; }
export function s1EvolveAlt(state, p, stack, targetId) { return S1.evolveAlt(state, p, stack, targetId); }
export function s1EvoAuto(state, p, stack, targetId) { return S1.evoAutoDelta(state, p, stack, targetId, 'hand'); }
export function s1EvoOptions(state, p, stack, targetId) { return S1.evoOptionList(state, p, stack, targetId, 'hand'); }
export function s1PlayDiscount(state, p, targetId) { return s1HookSum(state, 's1playDiscount', { p, targetId }); }
export function s1UnsuspendGate(state, p, stack) { return s1HookAny(state, 's1unsuspendGate', { p, stack }); }
export function s1AttackTargeted(state, attackerP, attacker, targetKind, targetUid) {
  emitGameEvent(state, 'attackTarget', { owner: attackerP, stack: attacker, cause: null, targetKind, targetUid });
  const defP = opponentOf(attackerP);
  if (attacker && targetKind === 'digimon' && s1Flag(state, attacker, 'killNoSrc')) {
    const t = state.players[defP].battle.find(s => s.uid === targetUid);
    if (t && t.sources.length === 0) { log(state, `${attackerP} ${card(attacker.cardId).nameKo} 효과: 진화원이 없는 ${card(t.cardId).nameKo} 소멸`); deleteStack(state, defP, t.uid, 'trash', 'effect'); }
  }
}
export function s1BattleWon(state, p, stack) { emitGameEvent(state, 'battleWin', { owner: p, stack, cause: null }); }
// unsuspend-phase events (EX2-037 etc.): call after `stack` went rested -> active
export function s1Unsuspended(state, p, stack) { emitGameEvent(state, 'unsuspend', { owner: p, stack, cause: 'phase' }); }
export function s1ProtectedSource(state, p, stack, id) { return s1HookAny(state, 's1protectSource', { p, stack, id }); }

// descriptor.atkPlayerBlocked(state, hp, holder, attackerP, attacker) -> true: that attacker may not attack the player.
export function hookAttackPlayerBlocked(state, attackerP, attacker) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.atkPlayerBlocked && hp !== attackerP && d.atkPlayerBlocked(state, hp, holder, attackerP, attacker)) return true;
  return false;
}
// descriptor.vortexPlayer(state, hp, holder) -> true: this player's 《볼텍스》 digimon may attack the PLAYER at turn end (EX11-062).
export function hookVortexPlayer(state, p) {
  for (const { hp, holder, d } of activeHooks(state)) if (d.vortexPlayer && hp === p && d.vortexPlayer(state, hp, holder)) return true;
  return false;
}

// s7: printed "[트래시]/[시큐리티]【자신/상대/서로의 턴 종료 시】" abilities of cards sitting in the trash / face-up in security.
export function s7QueueZoneTurnEnd(state, finishing) {
  for (const p of ['p1', 'p2']) {
    const pl = state.players[p];
    const kinds = p === finishing ? ['자신의 턴 종료 시', '서로의 턴 종료 시'] : ['상대의 턴 종료 시', '서로의 턴 종료 시'];
    const zones = [['트래시', [...new Set(pl.trash)]], ['시큐리티', [...new Set(pl.security)].filter(id => (pl.secUp && pl.secUp[id]) > 0)]];
    for (const [marker, ids] of zones) {
      for (const id of ids) {
        for (const seg of parseEffectSegments(card(id).effectKo).segments) {
          if (!seg.zoneMarker || !seg.zoneMarker.includes(marker)) continue;
          if (!seg.tags.some(tg => kinds.some(k => tg.includes(k)))) continue;
          state.pending.push({ uid: 'p' + (pendingUid++), player: p, cardId: id, stackUid: null, tags: seg.tags, text: seg.body.trim(), resolved: false, zoneTurnEnd: marker });
        }
      }
    }
  }
}
