import { SCRIPTS as CARD_SCRIPTS, OPS as CARD_OPS } from './cards/index.js';
const S_COLOR_EN = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
// Structured effect DSL interpreter.
// A "script" is an array of instructions. Each instruction is a plain object
// with an `op`. Instructions that need a target the player must pick return
// control via an async choice callback (ctx.choose) so the UI can render a
// picker and resume execution afterward.
//
// Instruction set (op):
//   draw            { who, n }
//   trashDeckTop    { who, n }
//   gainMemory      { who, n }
//   addSecurity     { who, position, from: 'hand'|'thisCard'|'topOfDeck', filter? }
//   removeSecurity  { who, position }                      -> returns removed cardId
//   revealTop       { who, n, pick: {min,max,filter}, restTo }
//   trashHand       { who, n, filter? }                    -> choose which to trash
//   destroy         { target: 'self'|'opponent', mode:'choose'|'all'|'lowestDP', filter? }
//   retreat         { target: 'self'|'opponent', n, mode:'choose' }
//   playFree        { who, zone:'hand'|'trash', filter?, costDelta? }
//   grantKeyword    { target:'thisStack'|'filter', keyword, scope:'turn'|'opponentTurn'|'permanent' }
//   condition       { if:{...}, then:[...], else:[...] }
//   choice          { prompt, options:[{label, then:[...]}] }
//
// `ctx` shape: { state, S, self, opp, sourceCardId, sourceStackUid, choose }
// `ctx.choose(kind, payload)` returns a Promise resolved by the UI with the
// player's pick; the caller (main.js) supplies the real implementation.

// `target` is a printed card id (hand/trash/deck/revealed) or a STACK object (battle/breeding). For a stack the check goes through
// S.effectiveInfo (원래 명칭/색 변경, 〈룰〉 alias names, hook-granted names/traits/colors, 디지몬으로도 취급) — `state` is then required
// (falls back to the printed card when omitted). Printed cards use S.cardNameInfo (〈룰〉 aliases) and `types` (특징 incl. 속성/형태).
const BEAST_TRAIT_EXCL = ['수장룡형', '수생형', '수생포유류형', '정보수집 타입', '정보수집 유형'];
function matchesFilter(S, target, filter, state) {
  if (!filter) return true;
  const isStack = target && typeof target === 'object' && target.cardId != null;
  const cardId = isStack ? target.cardId : target;
  if (filter.anyOf && !filter.anyOf.some(sub => matchesFilter(S, target, sub, state))) return false;
  const c = S.card(cardId);
  const eff = isStack && state ? S.effectiveInfo(state, target) : null;
  const names = eff ? eff.names : S.cardNames(cardId);
  const inclNames = eff ? eff.inclNames : S.cardNameInfo(cardId).incl;
  const traits = eff ? eff.traits : (c.types || []);
  const colors = eff ? eff.colors : (c.colors || []);
  const nameHas = (n) => names.some(x => x.includes(n)) || inclNames.some(x => x.includes(n));
  if (filter.level != null && c.level !== filter.level) return false;
  if (filter.levelMax != null && (c.level || 0) > filter.levelMax) return false;
  if (filter.levelMin != null && (c.level || 0) < filter.levelMin) return false;
  if (filter.colors && !colors.some(col => filter.colors.includes(col))) return false;
  // Cards store their 특징 in `types` (유형 + 속성 + 형태 folded in by loadData; there is no `traits` field).
  if (filter.trait && !traits.includes(filter.trait)) return false;
  if (filter.traitAny && !filter.traitAny.some(t => traits.includes(t))) return false;
  if (filter.traitIncludes && !filter.traitIncludes.some(t => traits.some(ty => ty.includes(t) && !(t === '수' && BEAST_TRAIT_EXCL.includes(ty))))) return false; // 「수」를 포함(「수장룡형」/「수생형」/「수생포유류형」/「정보수집 타입」은 제외)
  if (filter.nameAny && !filter.nameAny.some(nameHas)) return false;
  if (filter.exactAny && !filter.exactAny.some(n => names.includes(n))) return false;
  if (filter.keywordText && !`${c.effectKo || ''}
${c.inheritedKo || ''}`.includes(`《${filter.keywordText}`)) return false;
  if (filter.category && !(eff ? eff.isCategory(filter.category) : c.category === filter.category)) return false;
  // DP filters on a battle-area stack mean its CURRENT DP (모디파이어 포함); printed DP only for cards outside the battle area
  let dpNow = c.dp || 0;
  if ((filter.dpMax != null || filter.dpMin != null || filter.dp != null) && isStack && state) { const ow = ['p1', 'p2'].find(p => state.players[p].battle.includes(target) || state.players[p].raising === target); if (ow) dpNow = S.effectiveDP(state, ow, target); }
  if (filter.dpMax != null && dpNow > filter.dpMax) return false;
  if (filter.dpMin != null && dpNow < filter.dpMin) return false;
  if (filter.dp != null && dpNow !== filter.dp) return false;
  if (isStack) { // stack-state filters (only meaningful for battle-area targets)
    if (filter.suspended != null && !!target.suspended !== filter.suspended) return false;
    if (filter.noSources && (target.sources || []).length) return false;
    if (filter.hasSources && !(target.sources || []).length) return false;
    if (filter.srcMax != null && (target.sources || []).length > filter.srcMax) return false;
    if (filter.srcMin != null && (target.sources || []).length < filter.srcMin) return false;
  }
  if (filter.costMax != null && (c.cost || 0) > filter.costMax) return false;
  if (filter.costMin != null && (c.cost || 0) < filter.costMin) return false;
  if (filter.costEq != null && (c.cost || 0) !== filter.costEq) return false;
  if (filter.colorCount != null && colors.length !== filter.colorCount) return false; // "블랙을 포함하는 2색의 카드"
  if (filter.desc) { const dpred = S.cardDescPredicate(filter.desc); if (dpred && !dpred(c)) return false; } // free-form descriptor the compiler couldn't turn into keys
  if (filter.name && !names.includes(filter.name)) return false;
  if (filter.nameIncludes && !nameHas(filter.nameIncludes)) return false;
  if (filter.exclNames && filter.exclNames.some(n => names.includes(n))) return false; // "이 효과로는 자신의 테이머와 같은 명칭의 카드는 등장시킬 수 없다" (exclSame, resolved in runOne)
  return true;
}


// "A와 B 1장씩" — one card for EACH criterion (a card fills only one slot). The player picks per criterion (prompt names it); a card is
// only offered for a slot when the remaining slots can still be filled as fully as possible (so a card fitting both criteria isn't
// wasted on the wrong one). cards = array of card ids; returns the chosen indices (into cards) in group order.
function maxSlotMatching(S, cards, avail, slots) { // slots: [filter]; avail: indices; -> max #slots fillable by distinct cards
  const match = new Map(); // card index -> slot index
  const tryK = (k, seen) => {
    for (const ci of avail) {
      if (seen.has(ci) || !matchesFilter(S, cards[ci], slots[k])) continue;
      seen.add(ci);
      if (!match.has(ci) || tryK(match.get(ci), seen)) { match.set(ci, k); return true; }
    }
    return false;
  };
  let n = 0;
  for (let k = 0; k < slots.length; k++) if (tryK(k, new Set())) n++;
  return n;
}
async function pickByGroups(ctx, who, cards, groups, kind, basePrompt, mkEligible) {
  const { S } = ctx;
  const slots = [];
  for (const g of groups) for (let k = 0; k < (g.max || 1); k++) slots.push({ g, k, filter: g.filter });
  const chosen = [];
  for (let si = 0; si < slots.length; si++) {
    const sl = slots[si];
    const avail = cards.map((_, i) => i).filter(i => !chosen.includes(i));
    const rest = slots.slice(si + 1).map(x => x.filter);
    const cand = avail.filter(i => matchesFilter(S, cards[i], sl.filter));
    if (!cand.length) continue;
    const best = maxSlotMatching(S, cards, avail, slots.slice(si).map(x => x.filter));
    const el = cand.filter(i => 1 + maxSlotMatching(S, cards, avail.filter(x => x !== i), rest) >= best);
    const lbl = sl.g.label ? `${sl.g.label} ${sl.g.max > 1 ? `${sl.k + 1}/${sl.g.max}` : '1'}장` : '';
    const prompt = `${basePrompt}${lbl ? ` — ${lbl}` : ''}`;
    const sel = await ctx.choose(kind, mkEligible ? mkEligible(el, prompt) : { player: who, revealed: cards, eligible: el.map(i => ({ id: cards[i], i })), min: 0, max: 1, prompt });
    for (const i of (sel || [])) if (el.includes(i) && !chosen.includes(i)) chosen.push(i);
  }
  return chosen;
}

// "자신의 패/트래시(/이 디지몬의 진화원)에서 A와 B 1장씩을 <덱 아래로 되돌린다 | 이 디지몬의 진화원에 놓는다 | 코스트 없이 등장시킨다>" — instr:
//   { op:'moveEach', from:['hand'|'trash'|'sources'], groups:[{filter,max,label}], dest:'deckBottom'|'thisSources'|'play', pos:'top'|'bottom', ordered, required, rested, noTriggers }
// from 'sources' = this stack's evolution sources (or, when the stack already left the field, the sources recorded in the trigger event that now lie in the trash).
function moveEachEntries(ctx, instr) {
  const { state } = ctx;
  const pl = state.players[ctx.self];
  const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid);
  const evtIds = ctx.trigger?.evt?.sources;
  const out = [];
  for (const z of instr.from) {
    if (z !== 'sources') { pl[z].forEach((id, i) => out.push({ z, i, id })); continue; }
    if (st) st.sources.forEach((id, i) => out.push({ z: 'sources', i, id }));
    else if (evtIds) { const pool = evtIds.slice(); pl.trash.forEach((id, i) => { const k = pool.indexOf(id); if (k >= 0) { pool.splice(k, 1); out.push({ z: 'trash', i, id, left: true }); } }); }
  }
  return { st, entries: out.filter(e => instr.groups.some(g => matchesFilter(ctx.S, e.id, g.filter))) };
}
const moveEachSlots = (instr) => instr.groups.reduce((a, g) => a + (g.max || 1), 0);
function moveEachPayable(ctx, instr) {
  const { entries, st } = moveEachEntries(ctx, instr);
  const slots = []; for (const g of instr.groups) for (let k = 0; k < (g.max || 1); k++) slots.push(g.filter);
  if (instr.dest === 'thisSources' && !st) return false;
  return maxSlotMatching(ctx.S, entries.map(e => e.id), entries.map((_, i) => i), slots) >= slots.length;
}

// Battle-area stacks of `who` an effect may target: Digimon only (unless filter.category says otherwise), narrowed by the filter
// (current DP, state, sources…), by `excludeSelf` ("다른 …") and by an extreme ("가장 DP가 낮은 …": filter.extreme = { stat, dir }).
function candidateStacks(ctx, who, instr) {
  const { S, state } = ctx;
  let f = instr.filter;
  if (f?.ref) { // "소멸시킨 디지몬의 Lv. 이하" / "파기한 카드의 등장 코스트 이하" / "그 디지몬의 DP 이하": the value recorded when that Digimon/card was chosen
    const info = f.ref === 'discard' ? ctx._lastDiscardInfo : ctx._lastPickInfo;
    const { ref, refStat, refEq, ...rest } = f;
    const key = refStat === 'dp' ? (refEq ? 'dp' : 'dpMax') : refStat === 'level' ? (refEq ? 'level' : 'levelMax') : (refEq ? 'costEq' : 'costMax');
    f = info && info[refStat] != null ? { ...rest, [key]: info[refStat] } : rest;
  }
  if (f?.dpMaxSelf) { const src = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); f = { ...f, dpMax: src ? S.effectiveDP(state, ctx.self, src) : 0 }; } // "이 디지몬의 DP 이하의 …"
  let arr = state.players[who].battle.filter(s => (f?.category || instr.anyKind ? true : S.card(s.cardId).category === 'digimon') && (!instr.excludeSelf || s.uid !== ctx.sourceStackUid) && matchesFilter(S, s, f, state));
  const ex = f?.extreme;
  if (ex && arr.length) {
    const val = (s) => ex.stat === 'level' ? (S.card(s.cardId).level || 0) : ex.stat === 'cost' ? (S.card(s.cardId).cost || 0) : S.effectiveDP(state, who, s);
    const best = ex.dir === 'min' ? Math.min(...arr.map(val)) : Math.max(...arr.map(val));
    arr = arr.filter(s => val(s) === best);
  }
  return arr;
}

const FILTER_COLOR = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };

// Parses a card-noun phrase like "특징으로 「X」를 가진 퍼플인 Lv.4 이하의 디지몬
// 카드" into a matchesFilter filter. Returns null when the phrase contains an
// OR-combination it can't faithfully express (better to over-allow like before
// than to silently forbid legal picks).
function parseCardFilter(phrase) {
  if (!phrase) return null;
  phrase = phrase.replace(/Lv\.\s+(\d)/g, 'Lv.$1').replace(/」\s*(?:또는|이나)\s*「/g, '」/「');
  phrase = phrase.replace(/(레드|블루|옐로우?|그린|블랙|퍼플|화이트)\s*(?:또는|이나)\s*(?=(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))/g, '$1/'); // "옐로 또는 퍼플의 …" = 옐로/퍼플 (OR of colors)
  const flat = phrase.replace(/「[^」]*」/g, '「」').replace(/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))*(?:인|의)/g, 'C');
  if (/또는|거나/.test(flat) || /(?<!」)\/|\/(?!「)/.test(flat)) {
    // "<A 카드> 또는 <B 카드>" — two complete card phrases: an OR of two filters (BT11-086 …); anything vaguer stays null
    const parts = phrase.split(/\s+또는\s+/).map(x => x.trim());
    if (parts.length === 2 && parts.every(x => /카드$/.test(x))) { const fs = parts.map(parseCardFilter); if (fs.every(Boolean)) return { anyOf: fs }; }
    return null;
  }
  const f = {};
  let m;
  if (/테이머\s*카드/.test(phrase)) f.category = 'tamer';
  else if (/옵션\s*카드/.test(phrase)) f.category = 'option';
  else if (/디지몬/.test(phrase)) f.category = 'digimon';
  if ((m = phrase.match(/특징(?:으로|에|은)?\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*(가진|가지|갖는|포함하는)/))) {
    const list = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    if (m[2] === '포함하는') f.traitIncludes = list; else f.traitAny = list;
  }
  if ((m = phrase.match(/《([^》]+)》(?:이|가)\s*기술되어\s*있는/))) f.keywordText = m[1];
  if ((m = phrase.match(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함/))) f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
  const rest = phrase.replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\/?)+/g, '').replace(/명칭에\s*(?:「[^」]+」\/?)+/g, '');
  // short forms after "A와 B"-lists: "「오메가몬」을 포함하는 디지몬 카드" (= 명칭에 …), "《진격》을 가진 디지몬 카드"
  if (!f.nameAny && (m = rest.match(/^\s*((?:「[^」]+」\/?)+)\s*(?:을|를)\s*포함하는/))) f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
  if (!f.keywordText && (m = rest.match(/《([^》]+)》\s*(?:을|를)\s*(?:가진|갖는)/))) f.keywordText = m[1];
  if ((m = rest.match(/((?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))*)(?:인|의)/))) f.colors = m[1].split('/').map(x => FILTER_COLOR[x]);
  if ((m = rest.match(/Lv\.(\d+)\s*이하/))) f.levelMax = Number(m[1]);
  else if ((m = rest.match(/Lv\.(\d+)\s*이상/))) f.levelMin = Number(m[1]);
  else if ((m = rest.match(/Lv\.(\d+)/))) f.level = Number(m[1]);
  if ((m = rest.match(/(?:등장\s*)?코스트\s*(\d+)\s*이하/))) f.costMax = Number(m[1]);
  else if ((m = rest.match(/(?:사용|등장)\s*코스트\s*(\d+)(?:의|인)\s/))) f.costEq = Number(m[1]); // "사용 코스트 7의 옵션 카드"
  if ((m = rest.match(/(레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:을|를)\s*포함하는\s*(\d)\s*색/))) { f.colors = [FILTER_COLOR[m[1]]]; f.colorCount = Number(m[2]); } // "블랙을 포함하는 2색의 카드"
  return Object.keys(f).length ? f : null;
}

// ---- effect-runner infrastructure shared by all card scripts ----
// * state._fxSrc = who/what is resolving an effect right now (for "상대의 효과를 받지 않는다" immunity checks in state.js)
// * pickStack choices over the OPPONENT's stacks drop targets that are immune to the running op (state._fxOp)
// * after each top-level op, hand/evolution-source growth is emitted as game events ('handIncrease', 'sourcesAdded')
const FX_KIND_OF_OP = { destroy: 'delete', destroySum: 'delete', retreat: 'retreat', returnToHandStripSources: 'bounce', bounceToDeckBottomStripSources: 'bounce', rest: 'rest', restAll: 'rest', modifyDP: 'dpDown', modifyDPAll: 'dpDown', setDP: 'dpDown', trashEvoSources: 'other' };
let fxDepth = 0;
function fxSourceOf(ctx) {
  const { state, S } = ctx;
  let cat = S.card(ctx.sourceCardId)?.category;
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid);
    if (st) cat = S.card(st.cardId)?.category;
  }
  return { player: ctx.self, category: cat, cardId: ctx.sourceCardId, isDigimon: cat === 'digimon' };
}
const PICK_KINDS = new Set(['pickStack', 'pickStackAnySide', 'pickFromHand', 'pickFromZoneIndex', 'pickFromRevealed']);
function wrapChoose(ctx) {
  if (ctx._fxWrapped) return;
  ctx._fxWrapped = true;
  const orig = ctx.choose;
  ctx.choose = async (kind, payload) => {
    // 1-3-6: when a rule/effect makes you choose cards, you must choose at least 1 — unless the effect text is an
    // optional one ("…할 수 있다" / "N장까지"). The UI hides its cancel button for required picks that have candidates.
    if (PICK_KINDS.has(kind) && payload && payload.required === undefined && ctx.trigger && typeof ctx.trigger.text === 'string') {
      const optional = /수\s*있다|까지|없어도|않아도|않을\s*수/.test(ctx.trigger.text.replace(/\([^()]*\)/g, ''));
      payload = { ...payload, required: !optional };
    }
    const { state, S } = ctx;
    if (kind === 'pickStack' && payload && Array.isArray(payload.uids) && payload.player && payload.player !== ctx.self) {
      const fk = payload.fxKind || FX_KIND_OF_OP[state._fxOp] || 'other';
      const pl = state.players[payload.player];
      const uids = payload.uids.filter(u => { const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === u); return !st || !S.effectBlocked(state, payload.player, st, fk); });
      if (payload.uids.length && !uids.length) { S.log(state, '대상이 될 수 있는 디지몬이 없음 (상대의 효과를 받지 않음)'); return null; }
      payload = { ...payload, uids };
    }
    if (kind === 'pickStackAnySide' && payload && Array.isArray(payload.entries)) {
      const fk = FX_KIND_OF_OP[state._fxOp] || 'other';
      const entries = payload.entries.filter(e => { if (e.player === ctx.self) return true; const pl = state.players[e.player]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === e.uid); return !st || !S.effectBlocked(state, e.player, st, fk); });
      payload = { ...payload, entries };
    }
    if (kind === 'confirmEffect' && state._forceOptional > 0) { S.log(state, '강제 효과가 발휘한 효과의 임의 처리 조건은 강제로 처리함 (룰 15-15-7-4)'); return true; }
    const res = await orig(kind, payload);
    if (kind === 'pickStack' && res && payload?.player) { ctx._lastPick = { player: payload.player, uid: res }; recordPickInfo(ctx, payload.player, res); } // "그 디지몬…" refers to the Digimon chosen last
    else if (kind === 'pickStackAnySide' && res && res.uid) ctx._lastPick = { player: res.player, uid: res.uid };
    return res;
  };
}
function recordPickInfo(ctx, player, uid) {
  const { state, S } = ctx; const pl = state.players[player];
  const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === uid);
  if (st) { const c = S.card(st.cardId); ctx._lastPickInfo = { level: c.level ?? 0, dp: S.effectiveDP(state, player, st), cost: c.cost || 0 }; }
}
// the Digimon a later "그 디지몬" points at: the one picked last in this script, else the event subject of a watcher trigger
function resolveLast(ctx) {
  const { state } = ctx;
  const find = (pp, uid) => { const pl = state.players[pp]; return [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === uid) ? { player: pp, uid } : null; };
  if (ctx._lastPick) { const r = find(ctx._lastPick.player, ctx._lastPick.uid); if (r) return r; }
  const eu = ctx.trigger?.evtStackUid;
  if (eu) return find('p1', eu) || find('p2', eu);
  return null;
}
function fxSnapshot(state) {
  const snap = {};
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    snap[pp] = { hand: pl.hand.length, deck: pl.deck.length, stacks: new Map([pl.raising, ...pl.battle].filter(Boolean).map(st => [st.uid, { cardId: st.cardId, sources: st.sources.slice() }])) };
  }
  return snap;
}
function fxEmit(ctx, instr, snap) {
  const { state, S } = ctx;
  const skipHand = /evolve|jogress|digivolve|fuse/i.test(instr.op);
  const cat = fxSourceOf(ctx).category;
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    if (pl.deck.length > snap[pp].deck) S.emitGameEvent(state, 'deckIncrease', { owner: pp, stack: null, cause: 'effect', srcPlayer: ctx.self }); // s8: "덱이 (자신의 효과로) 늘어났을 때"
    if (!skipHand && pl.hand.length > snap[pp].hand) S.emitGameEvent(state, 'handIncrease', { owner: pp, stack: null, cause: 'effect', srcPlayer: ctx.self, srcCategory: cat, added: pl.hand.length - snap[pp].hand });
    for (const st of [pl.raising, ...pl.battle].filter(Boolean)) {
      const before = snap[pp].stacks.get(st.uid);
      if (!before || before.cardId !== st.cardId || st.sources.length <= before.sources.length) continue;
      const pool = before.sources.slice();
      const added = [];
      for (const id of st.sources) { const i = pool.indexOf(id); if (i >= 0) pool.splice(i, 1); else added.push(id); }
      if (added.length) S.emitGameEvent(state, 'sourcesAdded', { owner: pp, stack: st, cause: 'effect', added, srcPlayer: ctx.self, srcCategory: cat });
    }
  }
}

// 15-8-4-4-1 / 15-7-3: can the optional processing condition ("…하는 것으로,") of a costGroup be performed IN FULL right now?
export function costGroupPayable(ctx, instr) {
  const { state, S } = ctx;
  const st = state.players[ctx.self].battle.find(x => x.uid === ctx.sourceStackUid) || (state.players[ctx.self].raising?.uid === ctx.sourceStackUid ? state.players[ctx.self].raising : null);
  return instr.cost.every(c => {
    if (c.op === 'trashHand') return state.players[c.who === 'opponent' ? ctx.opp : ctx.self].hand.filter(id => matchesFilter(S, id, c.filter)).length >= c.n;
    if (c.op === 'removeSecurity') return state.players[c.who === 'opponent' ? ctx.opp : ctx.self].security.length >= instr.cost.filter(x => x.op === 'removeSecurity' && (x.who || 'self') === (c.who || 'self')).reduce((a, x) => a + (x.n || 1), 0); // 15-7-3: no partial cost
    if (c.op === 'restStack') return !!st && !st.suspended;
    if (c.op === 'destroy' && c.mode === 'choose') return candidateStacks(ctx, ctx.self, c).length >= instr.cost.filter(x => x.op === 'destroy' && x.mode === 'choose').length; // sacrifice: enough legal picks
    if (c.op === 'destroy') return !!st;
    if (c.op === 'rest' && c.target === 'self') return candidateStacks(ctx, ctx.self, { ...c, anyKind: !c.digimonOnly }).length >= instr.cost.filter(x => x.op === 'rest' && x.target === 'self').reduce((a, x) => a + (x.n || 1), 0);
    if (c.op === 'unsuspend' && c.thisStack !== false) return !!st && !!st.suspended;
    if (c.op === 'moveEach') return moveEachPayable(ctx, c); // every listed criterion needs its own card (15-7-3: no partial cost)
    if (c.op === 'securityTopToHand') return state.players[ctx.self].security.length >= (c.n || 1);
    if (c.op === 'trashEvoSources' && c.thisStack) return !!st && st.sources.length >= c.count;
    return true;
  });
}
// A 【메인】 (activated) ability that has an optional processing condition may only be DECLARED while that condition can be executed (15-8-4-4-1).
export function mainAbilityPayable(state, S, p, stackUid, cardId, tags, text) {
  let script;
  try { script = lookupCardSpecific(cardId, tags, text) || compileToScript(text); } catch (e) { return true; }
  const first = (script || [])[0];
  if (!first || first.op !== 'costGroup') return true;
  return costGroupPayable({ state, S, self: p, opp: S.opponentOf(p), sourceStackUid: stackUid }, first);
}

export async function runScript(script, ctx) {
  const { state, S } = ctx;
  wrapChoose(ctx);
  const prevSrc = state._fxSrc;
  if (!prevSrc) S.beginCause(state); // 15-8-5-4: a new cause (effect resolution) — immediate effects may be used once again
  state._fxSrc = fxSourceOf(ctx);
  state._rcDepth = (state._rcDepth || 0) + 1; // 17-1-2-2: no rule check while an effect is being processed
  try {
    for (const instr of script || []) {
      await runOne(instr, ctx);
    }
  } finally {
    state._fxSrc = prevSrc;
    if (--state._rcDepth <= 0) { state._rcDepth = 0; S.flushRuleChecks(state); }
  }
}

const RES_SKIP = new Set(['condition', 'costGroup', 'effectChoice', 'oppMayPay', 'noop', 'afterBattle']);
function resSnap(state, self) {
  const o = self === 'p1' ? 'p2' : 'p1', P = state.players;
  return { sb: P[self].battle.length, ob: P[o].battle.length, sh: P[self].hand.length, oh: P[o].hand.length, st: P[self].trash.length, ot: P[o].trash.length, susp: [...P.p1.battle, ...P.p2.battle].filter(x => x.suspended).length, ss: P[self].security.length, os: P[o].security.length };
}
function resDiff(a, b, op) {
  return { deleted: Math.max(0, a.sb - b.sb) + Math.max(0, a.ob - b.ob), played: Math.max(0, b.sb - a.sb), discarded: op === 's13_trimTo' ? Math.max(0, a.sh - b.sh) + Math.max(0, a.oh - b.oh) + Math.max(0, a.ss - b.ss) + Math.max(0, a.os - b.os) : op === 'trashHand' || op === 'oppMayPay' ? Math.max(0, a.sh - b.sh) + Math.max(0, a.oh - b.oh) : op === 'removeSecurity' ? Math.max(0, a.ss - b.ss) + Math.max(0, a.os - b.os) : 0,
    added: Math.max(0, b.sh - a.sh), rested: Math.max(0, b.susp - a.susp), bounced: Math.max(0, b.oh - a.oh) + Math.max(0, b.sh - a.sh) };
}
async function runOne(instr, ctx) {
  const { state } = ctx;
  if (instr.exclSame) { // "이 효과로는 자신의 테이머/디지몬과 같은 명칭의 카드는 등장시킬 수 없다": the names on the board now become an excluded-name filter
    const cat = instr.exclSame === 'tamer' ? 'tamer' : 'digimon';
    const names = state.players[ctx.self].battle.filter(s => ctx.S.card(s.cardId).category === cat).flatMap(s => ctx.S.effectiveInfo(state, s).names);
    return runOne({ ...instr, exclSame: null, filter: { ...(instr.filter || {}), exclNames: names } }, ctx);
  }
  if (instr.capPer) { // "N마다 이 효과의 상한 ±M": shift the op's DP / Lv. / 등장 코스트 ceiling by count × M
    const { per, delta, stat } = instr.capPer, d = perCount(ctx, per) * delta, key = { dp: 'dpMax', level: 'levelMax', cost: 'costMax' }[stat];
    const adj = instr.op === 'destroySum' ? { ...instr, limit: instr.limit + d } : { ...instr, filter: { ...instr.filter, [key]: (instr.filter?.[key] ?? 0) + d } };
    return runOne({ ...adj, capPer: null }, ctx);
  }
  if (instr.per) { // "N장/마리마다": scale a numeric op, repeat a targeting op
    const k = perCount(ctx, instr.per);
    const base = { ...instr, per: null };
    if (k <= 0) { ctx.S.log(state, `${ctx.self} 마다 효과: 대상 수가 부족해 0회`); return; }
    if (base.op === 'gainMemory' || base.op === 'draw' || base.op === 'trashDeckTop') return runOne({ ...base, n: (base.n || 1) * k }, ctx);
    if (base.op === 'modifyDP' && base.thisStack) return runOne({ ...base, amount: base.amount * k }, ctx);
    if (base.op === 'modifyDPAll') return runOne({ ...base, amount: base.amount * k }, ctx);
    for (let i = 0; i < k; i++) await runOne(base, ctx);
    return;
  }
  wrapChoose(ctx);
  const top = fxDepth === 0;
  const snap = top ? fxSnapshot(state) : null;
  const prevOp = state._fxOp;
  state._fxOp = instr.op;
  fxDepth++;
  if (top) state._secDecBatch = new Set(); // 15-5-2: simultaneous multi-security loss inside one instruction triggers once
  const resBefore = RES_SKIP.has(instr.op) ? null : resSnap(state, ctx.self);
  try { await runOneCore(instr, ctx); }
  finally { fxDepth--; state._fxOp = prevOp; if (top) state._secDecBatch = null; }
  if (resBefore) ctx._res = resDiff(resBefore, resSnap(state, ctx.self), instr.op); // what THIS instruction did, for a later "이 효과로 …했다면"

  // a deletion parked on an optional survive prompt (state.deleteStack → pendingReplacements) must be settled before the next op runs
  if (state.pendingReplacements?.length) await new Promise(r => (state._replWaiters ||= []).push(r));
  if (top) fxEmit(ctx, instr, snap);
}

async function runOneCore(instr, ctx) {
  const { state, S } = ctx;
  const who = instr.who === 'opponent' ? ctx.opp : instr.who === 'self' ? ctx.self : instr.who || ctx.self;
  switch (instr.op) {
    case 'draw':
      S.drawCards(state, who, instr.n);
      break;
    case 'trashDeckTop':
      S.trashTopOfDeck(state, who, instr.n);
      break;
    case 'gainMemory':
      S.grantMemory(state, who, instr.n, ctx.sourceCardId);
      break;
    case 'addSecurity': {
      if (S.s1SecIncreaseBlocked(state, who)) { S.log(state, `${who} 시큐리티를 늘릴 수 없음 (효과 제한)`); break; } // shard1
      let cardId = instr.cardId;
      if (instr.from === 'thisCard') cardId = ctx.sourceCardId;
      if (instr.from === 'hand') {
        const pick = await ctx.choose('pickFromHand', { player: who, filter: instr.filter, prompt: instr.prompt || '시큐리티에 놓을 카드 선택' });
        if (!pick) break;
        const pl = state.players[who];
        const idx = pl.hand.indexOf(pick);
        if (idx !== -1) pl.hand.splice(idx, 1);
        cardId = pick;
      }
      if (instr.from === 'topOfDeck') cardId = state.players[who].deck.shift();
      if (cardId) S.addToSecurity(state, who, cardId, instr.position || 'top');
      break;
    }
    case 'removeSecurity': {
      const id = instr.position === 'bottom' ? S.trashBottomSecurityByEffect(state, who) : S.trashTopSecurityByEffect(state, who);
      instr._result = id;
      break;
    }
    case 'revealTop': {
      const revealed = S.revealTop(state, who, instr.n);
      const eligible = revealed.map((id, i) => ({ id, i })).filter(x => matchesFilter(S, x.id, instr.pick?.filter));
      let chosenIdxs;
      if (instr.pick?.groups) { // several "<조건> N장과 <조건> N장" groups: pick up to N per group, a card counts for one group only
        chosenIdxs = await pickByGroups(ctx, who, revealed, instr.pick.groups, 'pickFromRevealed', instr.prompt || '공개된 카드 중 가져갈 카드 선택');
      } else chosenIdxs = await ctx.choose('pickFromRevealed', {
        player: who, revealed, eligible, min: instr.pick?.min ?? 0, max: instr.pick?.max ?? eligible.length,
        prompt: instr.prompt || '공개된 카드 중 가져갈 카드 선택',
      });
      const rvRes = await S.resolveRevealOrdered(state, ctx.choose, who, instr.n, chosenIdxs || [], chosenIdxs || [], instr.restTo || 'bottom');
      if (instr.pick?.action === 'play' && rvRes?.toHand?.length) { // "…코스트를 지불하지 않고 등장시킬 수 있다": the chosen cards were moved to hand above — play exactly those
        const plR = state.players[who];
        for (let k = 0; k < rvRes.toHand.length; k++) {
          const ix = plR.hand.length - (rvRes.toHand.length - k);
          if (ix >= 0 && plR.hand[ix] === rvRes.toHand[k] && S.card(plR.hand[ix]).category !== 'option') S.playFreeFromZone(state, who, 'hand', ix, { rested: !!instr.pick.rested, noTriggers: !!instr.pick.noTriggers });
        }
      }
      break;
    }
    case 'trashHand': {
      const pl = state.players[who];
      const eligibleIdxs = pl.hand.map((id, i) => i).filter(i => matchesFilter(S, pl.hand[i], instr.filter));
      const chosen = await ctx.choose('pickFromHandIndexes', { player: who, eligibleIdxs, n: instr.n, prompt: instr.prompt || `핸드에서 ${instr.n}장 파기` });
      { const firstId = (chosen || []).length ? pl.hand[chosen[0]] : null; if (firstId) { const dc = S.card(firstId); ctx._lastDiscardInfo = { level: dc.level ?? 0, cost: dc.cost || 0, dp: dc.dp || 0 }; } }
      (chosen || []).sort((a, b) => b - a).forEach(i => S.trashFromHand(state, who, i));
      break;
    }
    case 'destroy': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const pl = state.players[targetPlayer];
      let uids = pl.battle.filter(s => S.card(s.cardId).category === 'digimon').map(s => s.uid); // "디지몬을 소멸" never targets Tamers/Options in the battle area
      // "자신이 발휘하는 DP 소멸 효과의 상한+N." raises the ceiling on the
      // ACTIVATING player's own dpMax-filtered destroy effects.
      let filter = instr.filter;
      if (filter?.dpMax != null) {
        const boost = S.dpDestroyCapBoost(state, ctx.self, ctx.sourceStackUid);
        if (boost) filter = { ...filter, dpMax: filter.dpMax + boost };
      }
      if (filter || instr.excludeSelf) uids = candidateStacks(ctx, targetPlayer, { filter, excludeSelf: instr.excludeSelf }).map(s => s.uid);
      const dcause = targetPlayer === ctx.self ? 'ownEffect' : 'effect';
      const destroyedBefore = pl.battle.length;
      try {
      if (instr.mode === 'last') {
        const lp = resolveLast(ctx); if (lp) S.deleteStack(state, lp.player, lp.uid, 'trash', lp.player === ctx.self ? 'ownEffect' : 'effect');
      } else if (instr.mode === 'thisStack') {
        S.deleteStack(state, targetPlayer, ctx.sourceStackUid, 'trash', dcause);
      } else if (instr.mode === 'all') {
        uids.forEach(uid => S.deleteStack(state, targetPlayer, uid, 'trash', dcause));
      } else if (instr.mode === 'lowestDP') {
        const withDp = pl.battle.filter(s => uids.includes(s.uid)).map(s => ({ uid: s.uid, dp: S.card(s.cardId).dp || 0 }));
        if (withDp.length) {
          const min = Math.min(...withDp.map(x => x.dp));
          withDp.filter(x => x.dp === min).forEach(x => S.deleteStack(state, targetPlayer, x.uid, 'trash', dcause));
        }
      } else {
        const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '소멸시킬 디지몬 선택' });
        if (pick) S.deleteStack(state, targetPlayer, pick, 'trash', dcause);
      }
      } finally { ctx._lastDestroyed = pl.battle.length < destroyedBefore; } // for "이 효과로 소멸하지 않았다면"
      break;
    }
    case 'retreat': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const pl = state.players[targetPlayer];
      // 16-12-1: ≪퇴화 N≫ — the effect's controller declares any number from 1 to N of cards to discard.
      const declareN = async (n) => {
        if (!(n > 1)) return n;
        const i = await ctx.choose('multipleChoice', { prompt: `《퇴화 ${n}》 — 몇 장 파기할까요? (1~${n})`, options: Array.from({ length: n }, (_, k) => `${k + 1}장`) });
        return (typeof i === 'number' && i >= 0 && i < n) ? i + 1 : n;
      };
      if (instr.all) {
        const nAll = await declareN(instr.n);
        for (const st of (instr.filter || instr.excludeSelf ? candidateStacks(ctx, targetPlayer, instr) : [...pl.battle])) S.retreat(state, targetPlayer, st.uid, nAll);
        break;
      }
      const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid); // 3-4-7-5: an effect that doesn't name the breeding area can't select its card
      const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '퇴화시킬 디지몬 선택' });
      if (pick) S.retreat(state, targetPlayer, pick, await declareN(instr.n));
      break;
    }
    case 'jogressEffect': {
      // "이 디지몬과 <다른 자신의 디지몬>으로 (코스트를 지불하여) 패의 <카드>로 조그레스 진화할 수 있다."
      const pl = state.players[who];
      const src = pl.battle.find(s => s.uid === ctx.sourceStackUid);
      if (!src) break;
      const legalCards = (partner) => pl.hand.map((id, i) => i).filter(i => {
        const c = S.card(pl.hand[i]);
        if (c.category !== 'digimon' || !S.parseJogress(pl.hand[i])) return false;
        if (instr.cardName && !S.cardNameIs(c, instr.cardName)) return false;
        return S.canJogress(src, partner, pl.hand[i]).ok;
      });
      const partners = pl.battle.filter(s => s !== src && S.card(s.cardId).category === 'digimon'
        && (!instr.partnerName || S.card(s.cardId).nameKo.includes(instr.partnerName)) && legalCards(s).length);
      if (!partners.length) { S.log(state, `${who} 조그레스 진화 가능한 조합이 없음`); break; }
      const partnerUid = await ctx.choose('pickStack', { player: who, uids: partners.map(s => s.uid), prompt: '조그레스 진화할 상대 디지몬 선택' });
      const partner = partners.find(s => s.uid === partnerUid);
      if (!partner) break;
      const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: legalCards(partner), prompt: '조그레스 진화할 패의 카드 선택' });
      if (idx == null) break;
      const cardId = pl.hand[idx];
      const j = S.parseJogress(cardId);
      // 8-2-2-5: the printed jogress cost still goes through evolve-cost modifiers (one-time mods are restored if the fusion is rejected).
      const evoSnap = S.snapshotEvoCostMods(state, who);
      let jcost = j ? j.cost : 0;
      if (j) jcost = Math.max(0, jcost + S.consumeEvoCostMod(state, who, cardId) + S.continuousEvoCostDiscount(state, who, src, cardId) + S.hookEvoCostDiscount(state, who, src, cardId));
      if (!S.fuseStacks(state, who, src.uid, partner.uid, cardId, jcost, 'hand')) S.restoreEvoCostMods(evoSnap);
      break;
    }
    case 'playThisFree': { // this card (revealed by a security check / sitting in the trash) enters the battle area for free
      S.playThisFreeFromTrash(state, ctx.self, ctx.sourceCardId);
      break;
    }
    case 'afterBattle': { // hold `instr.text` (as a fresh pending effect of the same card) until the current battle ends
      (state.afterBattle ||= []).push({ p: ctx.self, cardId: ctx.sourceCardId, text: instr.text, turn: state.turnNumber });
      break;
    }
    case 'playFree': {
      // BT11-086: "디지크로스하고 있었다면, 이 효과로 등장시키는 매수 +N" — extra plays only when the source stack really DigiXros'ed (xrosCount)
      const srcStk = state.players[ctx.self].battle.find(s => s.uid === ctx.sourceStackUid);
      const times = 1 + (instr.xrosBonus && srcStk && (srcStk.xrosCount || 0) >= (instr.xrosMin || 1) ? instr.xrosBonus : 0);
      for (let rep = 0; rep < times; rep++) {
      const pl = state.players[who];
      const okIdx = (z) => pl[z].map((id, i) => i).filter(i => matchesFilter(S, pl[z][i], instr.filter) && S.card(pl[z][i]).category !== 'option');
      const zone = instr.zone === 'trash' ? 'trash' : instr.zone === 'any' ? (okIdx('hand').length ? 'hand' : 'trash') : 'hand';
      const eligibleIdxs = okIdx(zone);
      const chosenIdx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt: instr.prompt || `${zone === 'trash' ? '트래시' : '핸드'}에서 무료로 등장시킬 카드 선택` });
      if (chosenIdx == null) break; // (declining stops the whole optional sequence)
      // 7-2-2-13: an effect-driven play may DigiXros too — offer the candidate materials one by one (at least 1, otherwise no DigiXros).
      let xrosOpts = {};
      const playId = pl[zone][chosenIdx];
      if (playId && S.card(playId).category === 'digimon' && S.parseDigiXros(playId)) {
        const cands = S.digiXrosOptions(state, who, chosenIdx, playId, zone);
        if (cands.length) {
          const go = await ctx.choose('multipleChoice', { prompt: `${S.card(playId).nameKo}: 《디지크로스》 — 재료를 아래에 놓고 등장시키시겠습니까?`, options: ['한다', '하지 않는다'] });
          if (go === 0) {
            const keys = new Set();
            for (const o of cands) {
              if (cands.length === 1) { keys.add(o.key); break; }
              const k = await ctx.choose('multipleChoice', { prompt: `${S.card(o.cardId).nameKo} (${o.kind === 'hand' ? '패' : o.kind === 'battle' ? '배틀 에어리어' : o.kind === 'tamer' ? '테이머 아래' : '트래시'})을(를) 아래에 놓겠습니까?`, options: ['놓는다', '놓지 않는다'] });
              if (k === 0) keys.add(o.key);
            }
            const plan = keys.size ? S.planDigiXrosPicked(state, who, chosenIdx, keys, playId, zone) : null;
            if (plan) xrosOpts = { materials: plan.materials, restTamers: plan.restTamers || [] };
          }
        }
      }
      const playedSt = S.playFreeFromZone(state, who, zone, chosenIdx, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, ...xrosOpts });
      if (playedSt) { ctx._lastPick = { player: who, uid: playedSt.uid }; recordPickInfo(ctx, who, playedSt.uid); } // (그 디지몬 / 이 효과로 등장한 디지몬)
      }
      break;
    }
    case 'grantText': { // 「【태그】 효과」의 효과를 준다/얻는다: the text fires as a pending effect at the matching engine event (queueGranted)
      const until = instr.until === 'opponentTurn' ? (state.activePlayer === ctx.self ? state.turnNumber + 1 : state.turnNumber) : state.turnNumber;
      const give = (st, owner) => { (st.s2Granted = st.s2Granted || []).push({ trigger: instr.trigger, label: instr.label, until, ...(/이\s*카드/.test(instr.label) ? { cardId: st.cardId } : {}) }); S.log(state, `${owner} ${S.card(st.cardId).nameKo}에게 효과 부여: ${instr.label.slice(0, 40)}`); }; // "이 카드" = the granted Digimon's top card
      if (instr.thisStack) { const st = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); if (st) give(st, ctx.self); break; }
      const sides = instr.side === 'both' ? [ctx.self, ctx.opp] : [instr.side === 'opponent' ? ctx.opp : ctx.self];
      for (const sd of sides) {
        const cands = candidateStacks(ctx, sd, { ...instr, anyKind: false });
        if (instr.all) { for (const st of cands) give(st, sd); continue; }
        const picked = [];
        for (let k = 0; k < (instr.n || 1); k++) {
          const uids = cands.map(x => x.uid).filter(u => !picked.includes(u));
          if (!uids.length) break;
          const uid = await ctx.choose('pickStack', { player: sd, uids, prompt: '효과를 부여할 디지몬 선택' });
          if (!uid) break;
          picked.push(uid); give(cands.find(x => x.uid === uid), sd);
        }
      }
      break;
    }
    case 'atTurnEnd': { // held effect: runs when this turn / the opponent's coming turn ends (18-1)
      const ref = resolveLast(ctx);
      const turnNumber = instr.when === 'opp' ? (state.activePlayer === ctx.self ? state.turnNumber + 1 : state.turnNumber) : state.turnNumber;
      const c2 = { ...ctx, _lastPick: ref || undefined, _fxWrapped: true };
      (state.endOfTurnEffects ||= []).push({ turnNumber, player: ctx.self, cardId: ctx.sourceCardId, label: instr.when === 'opp' ? '다음 상대의 턴 종료 시 예약 효과' : '이 턴 종료 시 예약 효과', fn: () => { runScript(instr.then, c2).catch(() => {}); } });
      S.log(state, `${ctx.self} 예약: ${instr.when === 'opp' ? '다음 상대의 턴' : '이 턴'} 종료 시 효과`);
      break;
    }
    case 'spawnToken': { // 「X」(디지몬·…) 토큰 N마리를 (코스트를 지불하지 않고) 등장시킨다
      const pwT = instr.who === 'opponent' ? ctx.opp : ctx.self;
      const def = instr.def;
      if (instr.optional && !(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `「${def.name}」 토큰 ${instr.n}마리를 등장시킬까요?` }))) break;
      const tid = 'TOKEN-' + def.name;
      if (!S.CARDS[tid]) S.CARDS[tid] = { id: tid, cardId: tid, nameKo: def.name, category: 'digimon', level: def.level ?? null, cost: def.cost ?? 0, dp: def.dp, colors: def.colors, types: def.types || [], form: def.form || null, attribute: def.attribute || null, effectKo: def.effectKo || '', inheritedKo: '', evoNormal: null, isToken: true };
      for (let k = 0; k < (instr.n || 1); k++) { const plT = state.players[pwT]; plT.hand.push(tid); S.playFreeFromZone(state, pwT, 'hand', plT.hand.length - 1, { rested: !!instr.rested }); }
      break;
    }
    case 'unsuspend': {
      if (instr.last) { const lp = resolveLast(ctx); if (lp) S.unsuspendStack(state, lp.player, lp.uid); break; }
      const upl = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const targetUid = instr.target === 'thisStack' ? ctx.sourceStackUid : await ctx.choose('pickStack', { player: upl, uids: (instr.filter || instr.excludeSelf ? candidateStacks(ctx, upl, { ...instr, anyKind: !instr.digimonOnly }) : state.players[upl].battle).map(s => s.uid), prompt: instr.prompt || '액티브로 만들 디지몬 선택' });
      if (targetUid) S.unsuspendStack(state, upl, targetUid);
      break;
    }
    case 'rest': {
      // "디지몬 1마리를 레스트시킬 수 있다." with no 상대/자신 prefix at all
      // means the ACTING player's choice of either side's Digimon — common
      // on cards that follow up with "이 효과로 자신의 디지몬이 레스트했다면"
      // (only makes sense if resting your own was actually an option).
      if (instr.target === 'either') {
        const entries = [
          ...state.players[ctx.self].battle.map(s => ({ player: ctx.self, uid: s.uid })),
          ...state.players[ctx.opp].battle.map(s => ({ player: ctx.opp, uid: s.uid })),
        ];
        const picked = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '레스트시킬 디지몬 선택 (자신/상대 무관)' });
        if (picked) S.restStack(state, picked.player, picked.uid);
        break;
      }
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = (instr.filter || instr.excludeSelf ? candidateStacks(ctx, targetPlayer, { ...instr, anyKind: !instr.digimonOnly }) : state.players[targetPlayer].battle).map(s => s.uid);
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '레스트시킬 디지몬 선택' });
        if (!targetUid) break;
        S.restStack(state, targetPlayer, targetUid);
        // "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — extremely
        // common tacked onto a rest effect (confirmed via the audit: a
        // dozen+ cards all print this exact "레스트시킨다. ... 액티브가 되지
        // 않는다." combo).
        const xrosSrc = state.players[ctx.self].battle.find(s => s.uid === ctx.sourceStackUid); // BT15-012: 「N장 디지크로스하고 있었다면 …액티브가 되지 않는다」
        if (instr.skipNextUnsuspend || (instr.skipIfXros != null && xrosSrc && (xrosSrc.xrosCount || 0) >= instr.skipIfXros)) S.setSkipNextUnsuspend(state, targetPlayer, targetUid);
      }
      break;
    }
    case 'restAll': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      for (const s of [...state.players[targetPlayer].battle]) {
        if (matchesFilter(S, s, instr.filter, state)) S.restStack(state, targetPlayer, s.uid);
      }
      break;
    }
    case 'modifyDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid); // tamers/options in the battle area are not "디지몬" targets
      if (instr.last) { const lp = resolveLast(ctx); if (lp) S.modifyDP(state, lp.player, lp.uid, instr.amount, instr.duration || 'turn'); break; }
      const targetUid = instr.target !== 'opponent' && instr.thisStack ? ctx.sourceStackUid
        : !uids.length ? null : await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || `DP ${instr.amount >= 0 ? '+' : ''}${instr.amount} 받을 디지몬 선택` });
      if (targetUid) S.modifyDP(state, targetPlayer, targetUid, instr.amount, instr.duration || 'turn');
      break;
    }
    case 'modifyDPAll': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      if (instr.filter || instr.excludeSelf) { for (const s of candidateStacks(ctx, targetPlayer, instr)) S.modifyDP(state, targetPlayer, s.uid, instr.amount, instr.duration || 'turn'); break; } // filtered: only the matching Digimon present now
      S.addDpAllMod(state, targetPlayer, instr.amount, instr.duration || 'turn'); // 15-11-2-2: reaches Digimon that enter later (records the present set first)
      for (const s of [...state.players[targetPlayer].battle]) S.modifyDP(state, targetPlayer, s.uid, instr.amount, instr.duration || 'turn');
      break;
    }
    case 'saveUnderTamer': {
      // 16-20: optional — no Tamer in play means it's simply unusable, not
      // a choice to surface.
      const tamerUids = state.players[ctx.self].battle.filter(s => S.card(s.cardId).category === 'tamer').map(s => s.uid);
      if (!tamerUids.length) break;
      const cardName = S.card(ctx.sourceCardId).nameKo;
      const useIt = await ctx.choose('multipleChoice', { prompt: `${cardName}: 《세이브》(자신의 테이머 아래에 놓기) 사용?`, options: ['사용', '사용 안 함'] });
      if (useIt !== 0) break;
      const tamerUid = tamerUids.length === 1 ? tamerUids[0]
        : await ctx.choose('pickStack', { player: ctx.self, uids: tamerUids, prompt: '세이브할 테이머 선택' });
      if (tamerUid) S.saveCardUnderTamer(state, ctx.self, ctx.sourceCardId, tamerUid);
      break;
    }
    case 'blastEvolve': {
      // 16-26: "evolve your Digimon into this hand card for free" — the
      // COST is waived, but which cards this can target still follows the
      // normal evolution rules (evoNormal / printed 〔진화〕 conditions),
      // same check the drag-drop digivolve path uses. Only stacks that
      // actually satisfy some printed condition are offered as choices.
      const pl = state.players[ctx.self];
      const eligible = pl.battle.filter(s => ctx.E.canEvolveAny(s.cardId, ctx.sourceCardId, S.evoExtraArg(state, ctx.self, s), S.evolveTargetRestriction(state, ctx.self, s)).ok);
      if (!eligible.length) break;
      const targetUid = eligible.length === 1 ? eligible[0].uid
        : await ctx.choose('pickStack', { player: ctx.self, uids: eligible.map(s => s.uid), prompt: `《블래스트 진화》 — ${S.card(ctx.sourceCardId).nameKo}로 진화시킬 디지몬 선택` });
      if (targetUid) S.digivolve(state, ctx.self, targetUid, ctx.sourceCardId, 0, 'hand');
      break;
    }
    case 'blastJogress': { // 16-31
      const me = ctx.self, plJ = state.players[me], newId = ctx.sourceCardId;
      const bm = (S.card(newId).effectKo || '').match(/블(?:래|라)스트\s*조그레스\s*[《≪]\s*「([^」]+)」\s*\+\s*「([^」]+)」/);
      const jg = S.parseJogress(newId);
      if (!bm || !jg) break;
      const cost = jg.cost || 0;
      const options = []; // { stack, handIdx }
      for (const [bn, hn] of [[bm[1], bm[2]], [bm[2], bm[1]]]) {
        for (const stk of plJ.battle) {
          if (S.card(stk.cardId).category !== 'digimon' || !S.cardNameIs(stk.cardId, bn)) continue;
          plJ.hand.forEach((hid, hi) => { if (hid !== newId || plJ.hand.indexOf(newId) !== hi) { if (S.cardNameIs(hid, hn) && S.card(hid).category === 'digimon' && S.canJogress(stk, { cardId: hid }, newId).ok) options.push({ stack: stk, handIdx: hi }); } });
        }
      }
      if (!options.length) { S.log(state, `${me} 《블래스트 조그레스》 — 조건을 만족하는 디지몬/패의 카드가 없음`); break; }
      if (cost > 0 && !S.canPayCost(state, cost)) { S.log(state, `${me} 《블래스트 조그레스》 — 코스트 ${cost}를 지불할 수 없음`); break; }
      if (!(await ctx.choose('confirmEffect', { player: me, prompt: `《블래스트 조그레스》 — ${S.card(newId).nameKo}(으)로 조그레스 진화할까요? (코스트 ${cost})` }))) break;
      const opt = options[0];
      const hid = plJ.hand[opt.handIdx];
      plJ.hand.splice(opt.handIdx, 1);
      const tmp = S._s4.makeStack(hid, state.turnNumber); tmp.attackEligibleTurn = 0;
      plJ.battle.push(tmp);
      const fused = S.fuseStacks(state, me, opt.stack.uid, tmp.uid, newId, cost, 'hand');
      if (!fused) { plJ.battle.splice(plJ.battle.indexOf(tmp), 1); plJ.hand.push(hid); }
      break;
    }
    case 'grantKeyword': {
      let targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      if (instr.last) { const lp = resolveLast(ctx); if (lp) S.grantKeyword(state, lp.player, lp.uid, instr.keyword, instr.value, instr.duration || 'turn'); break; }
      if (instr.all) { for (const st of candidateStacks(ctx, targetPlayer, instr)) S.grantKeyword(state, targetPlayer, st.uid, instr.keyword, instr.value, instr.duration || 'turn'); break; }
      let targetUid = instr.thisStack ? ctx.sourceStackUid : null;
      if (!targetUid) {
        const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid);
        targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || `${instr.keyword} 부여할 디지몬 선택` });
      }
      if (targetUid) S.grantKeyword(state, targetPlayer, targetUid, instr.keyword, instr.value, instr.duration || 'turn');
      break;
    }
    case 'grantBattleImmunity': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.filter(s => S.card(s.cardId).category === 'digimon').map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '배틀에서 소멸하지 않을 디지몬 선택' });
      if (targetUid) S.grantBattleImmunity(state, targetPlayer, targetUid);
      break;
    }
    case 'returnFromTrash': {
      const pl = state.players[who];
      const eligibleIdxs = pl.trash.map((id, i) => i).filter(i => matchesFilter(S, pl.trash[i], instr.filter));
      const chosenIdx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'trash', eligibleIdxs, prompt: instr.prompt || '트래시에서 핸드로 되돌릴 카드 선택' });
      if (chosenIdx == null) break;
      const [cardId] = pl.trash.splice(chosenIdx, 1);
      pl.hand.push(cardId);
      S.log(state, `${who} 트래시의 ${S.card(cardId).nameKo}을(를) 핸드로`);
      break;
    }
    case 'setDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.filter(s => S.card(s.cardId).category === 'digimon').map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || 'DP를 변경할 디지몬 선택' });
      if (targetUid) {
        const pl = state.players[targetPlayer];
        const stack = pl.battle.find(s => s.uid === targetUid);
        const base = S.card(stack.cardId).dp || 0;
        S.modifyDP(state, targetPlayer, targetUid, instr.value - base - (stack.tempDP || 0) - (stack.inheritedDP || 0), instr.duration || 'turn');
      }
      break;
    }
    case 'restrictAttack': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
      if (instr.thisStack) { S.restrictAttack(state, targetPlayer, ctx.sourceStackUid, expiresAfterTurn); break; }
      if (instr.allMatching) {
        for (const s of state.players[targetPlayer].battle) {
          if (matchesFilter(S, s, instr.filter, state) && (!instr.noEvoSources || s.sources.length === 0)) {
            S.restrictAttack(state, targetPlayer, s.uid, expiresAfterTurn);
          }
        }
        if (instr.prompt) S.log(state, instr.prompt);
        break;
      }
      let uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid);
      if (instr.filter?.hasNoSources) uids = state.players[targetPlayer].battle.filter(s => s.sources.length === 0 && S.card(s.cardId).category === 'digimon').map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '어택 불가로 만들 디지몬 선택' });
      if (targetUid) S.restrictAttack(state, targetPlayer, targetUid, expiresAfterTurn);
      break;
    }
    case 'restrictAttackPlayer': {
      // Narrower than restrictAttack — can still attack a Digimon directly.
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
      const matching = () => state.players[targetPlayer].battle.filter(s => !instr.filter || matchesFilter(S, s, instr.filter, state));
      if (instr.all) {
        for (const s of matching()) S.restrictAttackPlayer(state, targetPlayer, s.uid, expiresAfterTurn);
        break;
      }
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = matching().map(s => s.uid);
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '플레이어 공격 불가로 만들 디지몬 선택' });
        if (!targetUid) break;
        S.restrictAttackPlayer(state, targetPlayer, targetUid, expiresAfterTurn);
      }
      break;
    }
    case 'restStack':
      S.restStack(state, ctx.self, ctx.sourceStackUid);
      break;
    case 'oppMayPay': {
      // The OPPONENT decides whether to pay (discard / destroy own / trash own top security); if they decline
      // or can't, the "이 효과로 …하지 않았다면" fallback runs for the effect's owner.
      const op = ctx.opp, opl = state.players[op];
      let paid = false;
      const canPay = instr.pay === 'discard' ? opl.hand.filter(id => matchesFilter(S, id, instr.filter)).length >= instr.n
        : instr.pay === 'destroy' ? opl.battle.some(x => ['digimon', 'tamer'].includes(S.card(x.cardId).category))
        : opl.security.length >= 1;
      if (canPay && await ctx.choose('confirmEffect', { player: op, prompt: `${op}: 효과를 받는 대신 ${instr.pay === 'discard' ? `패 ${instr.n}장 파기` : instr.pay === 'destroy' ? '자신의 디지몬/테이머 1마리 소멸' : '시큐리티 1장 파기'}를 선택할까요?` })) {
        if (instr.pay === 'discard') {
          const eligible = opl.hand.map((id, i) => i).filter(i => matchesFilter(S, opl.hand[i], instr.filter));
          const chosen = await ctx.choose('pickFromHandIndexes', { player: op, eligibleIdxs: eligible, n: instr.n, prompt: `파기할 패 ${instr.n}장 선택` });
          if ((chosen || []).length >= instr.n) { (chosen || []).slice().sort((a, b) => b - a).forEach(i => S.trashFromHand(state, op, i)); paid = true; }
        } else if (instr.pay === 'destroy') {
          const uid = await ctx.choose('pickStack', { player: op, uids: opl.battle.filter(x => ['digimon', 'tamer'].includes(S.card(x.cardId).category)).map(x => x.uid), prompt: '소멸시킬 자신의 디지몬/테이머 선택' });
          if (uid) { S.deleteStack(state, op, uid, 'trash', 'effect'); paid = true; }
        } else { S.trashTopSecurityByEffect(state, op); paid = true; }
      }
      if (!paid) await runScript(instr.else, ctx);
      break;
    }
    case 'evolveEffect': {
      if (!ctx.E || !ctx.E.canEvolveAny) break;
      const pl = state.players[who];
      const evoOk = (stack, id) => (instr.ignoreCond && !S.s1HookAny(state, 's1evoIgnoreLocked', {}) && ctx.E.evoRestrictionCheck(id, S.evolveTargetRestriction(state, who, stack)).ok) || ctx.E.canEvolveAny(stack.cardId, id, S.evoExtraArg(state, who, stack), S.evolveTargetRestriction(state, who, stack)).ok;
      const cardsFor = (stack) => (instr.zone === 'trash' ? pl.trash : pl.hand).map((id, i) => i).filter(i => {
        const id = (instr.zone === 'trash' ? pl.trash : pl.hand)[i];
        return matchesFilter(S, id, instr.cardFilter) && evoOk(stack, id);
      });
      // candidate source stacks
      let stacks;
      if (instr.subject.thisStack) stacks = pl.battle.filter(x => x.uid === ctx.sourceStackUid);
      else {
        const pr = instr.subject.desc ? S.cardDescPredicate(instr.subject.desc + ' 가진') : null;
        stacks = pl.battle.filter(x => S.card(x.cardId).category === 'digimon'
          && !(instr.subject.other && x.uid === ctx.sourceStackUid)
          && (!instr.subject.name || S.effectiveInfo(state, x).nameIs(instr.subject.name))
          && (!instr.subject.desc || (pr && pr(S.card(x.cardId)))));
      }
      stacks = stacks.filter(x => cardsFor(x).length);
      if (!stacks.length) { S.log(state, `${who} 진화시킬 수 있는 조합이 없음`); break; }
      const uid = stacks.length === 1 && instr.subject.thisStack ? stacks[0].uid : await ctx.choose('pickStack', { player: who, uids: stacks.map(x => x.uid), prompt: '진화시킬 디지몬 선택' });
      const src = stacks.find(x => x.uid === uid);
      if (!src) break;
      const zoneArr = instr.zone === 'trash' ? pl.trash : pl.hand;
      const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone: instr.zone, eligibleIdxs: cardsFor(src), prompt: `${instr.zone === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택` });
      if (idx == null) break;
      const cardId = zoneArr[idx];
      const chk = ctx.E.canEvolveAny(src.cardId, cardId, ctx.S.evoExtraArg(ctx.state, null, src), null);
      let printed = chk.ok ? chk.cost : (S.card(cardId).evoNormal?.cost ?? 0);
      // 8-1-2-1: "evolve for the printed cost (-N)" — when several printed conditions apply the player chooses which one's cost is used.
      // (A fixed cost / "no cost" replaces the printed cost entirely, so there is nothing to choose.)
      if (instr.cost.mode !== 'free' && instr.cost.mode !== 'fixed' && chk.ok && ctx.E.evolutionMethods) {
        const ms = ctx.E.evolutionMethods(src.cardId, cardId, S.evoExtraArg(state, null, src), null);
        if (ms.length > 1) {
          const pick = await ctx.choose('multipleChoice', { player: who, prompt: `${S.card(src.cardId).nameKo} → ${S.card(cardId).nameKo} — 진화 조건을 선택하세요 (룰 8-1-2-1)`, options: ms.map((m, i) => `${i + 1}. ${m.label}${m.conditionText ? ` (${m.conditionText})` : ''} — 기본 코스트 ${m.baseCost}`) });
          printed = (ms[pick] || ms[0]).baseCost;
        }
      }
      const cost = instr.cost.mode === 'free' ? 0 : instr.cost.mode === 'fixed' ? instr.cost.n : instr.cost.mode === 'discount' ? Math.max(0, printed - instr.cost.n) : printed;
      // 8-x-2-5: continuous evolve-cost effects also apply to effect-driven evolution (not when "no cost is paid").
      const costAdj = instr.cost.mode === 'free' ? 0 : S.continuousEvoCostDiscount(state, who, src, cardId) + S.hookEvoCostDiscount(state, who, src, cardId);
      if (instr.zone === 'trash') zoneArr.splice(idx, 1);
      S.digivolve(state, who, src.uid, cardId, Math.max(0, cost + costAdj), instr.zone === 'trash' ? 'trash' : 'hand');
      break;
    }
    case 'destroySum': {
      // Pick opponent Digimon one at a time while the running DP/cost total stays within the limit.
      let left = instr.limit; const chosen = [];
      const statOf = (st) => instr.stat === 'dp' ? S.effectiveDP(state, ctx.opp, st) : (S.card(st.cardId).cost || 0);
      for (;;) {
        const opts = state.players[ctx.opp].battle.filter(st => S.card(st.cardId).category === 'digimon' && !chosen.includes(st.uid) && statOf(st) <= left);
        if (!opts.length) break;
        const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: opts.map(x => x.uid), prompt: `소멸시킬 디지몬 선택 (남은 ${instr.stat === 'dp' ? 'DP' : '등장 코스트'} 합계 ${left})` });
        if (!uid) break;
        const st = opts.find(x => x.uid === uid);
        if (!st) break;
        chosen.push(uid); left -= statOf(st);
      }
      for (const uid of chosen) S.deleteStack(state, ctx.opp, uid, 'trash', 'effect');
      break;
    }
    case 'mindLink': { // 16-28
      const me = ctx.self, plM = state.players[me], tam = plM.battle.find(x => x.uid === ctx.sourceStackUid);
      if (!tam || S.card(tam.cardId).category !== 'tamer') { S.log(state, `${me} 《마인드 링크》 — 이 테이머가 배틀 에어리어에 없음`); break; }
      const prM = instr.desc ? S.cardDescPredicate(instr.desc) : () => true;
      const candM = plM.battle.filter(x => x !== tam && S.card(x.cardId).category === 'digimon' && (!prM || prM(S.card(x.cardId))) && !x.sources.some(id => S.card(id).category === 'tamer'));
      if (!candM.length) { S.log(state, `${me} 《마인드 링크》 — 대상 디지몬이 없음`); break; }
      const pickM = candM.length === 1 ? candM[0].uid : await ctx.choose('pickStack', { player: me, uids: candM.map(x => x.uid), prompt: '《마인드 링크》 — 이 테이머를 진화원 아래에 놓을 디지몬 선택' });
      const tgtM = candM.find(x => x.uid === pickM);
      if (!tgtM) break;
      plM.battle.splice(plM.battle.indexOf(tam), 1);
      plM.trash.push(...tam.sources, ...(tam.linkCards || []).map(l => l.cardId)); // cards that were under the Tamer / linked to it are trashed
      tgtM.sources.unshift(tam.cardId);
      S.recomputeStackGrants(tgtM);
      S.log(state, `${me} 《마인드 링크》 — ${S.card(tam.cardId).nameKo}을(를) ${S.card(tgtM.cardId).nameKo}의 진화원 아래에 놓음`);
      break;
    }
    case 'ambush': { // 16-44: ≪급습≫ — at the end of your turn this Digimon may attack (optional, 16-44-3)
      const me = ctx.self, stA = state.players[me].battle.find(x => x.uid === ctx.sourceStackUid);
      if (!stA || stA.suspended || S.card(stA.cardId).category !== 'digimon') { S.log(state, `${me} 《급습》 — 어택할 수 없음`); break; }
      if (!(await ctx.choose('confirmEffect', { player: me, prompt: `《급습》 — ${S.card(stA.cardId).nameKo}(으)로 어택할까요?` }))) break;
      if (ctx.startAttack) ctx.startAttack(me, stA.uid);
      break;
    }
    case 'overclock': { // 16-34: ≪오버클럭≫ — delete own token / designated other Digimon, then attack the player without resting
      const me = ctx.self, plO = state.players[me], stO = plO.battle.find(x => x.uid === ctx.sourceStackUid);
      if (!stO || stO.suspended || !S.canAttackPlayer(state, me, stO.uid)) { S.log(state, `${me} 《오버클럭》 — 어택할 수 없음`); break; }
      const ocDesc = String(ctx.trigger?.overclockDesc || ''), pr = ocDesc ? S.cardDescPredicate(ocDesc) : null;
      const cands = plO.battle.filter(x => x !== stO && S.card(x.cardId).category === 'digimon' && (S.isTokenId(x.cardId) || (pr && pr(S.card(x.cardId)))));
      if (!cands.length) { S.log(state, `${me} 《오버클럭》 — 소멸시킬 토큰/대상 디지몬이 없음`); break; }
      if (!(await ctx.choose('confirmEffect', { player: me, prompt: '《오버클럭》 — 토큰 또는 지정 디지몬 1마리를 소멸시키고 레스트하지 않고 플레이어에게 어택할까요?' }))) break;
      const pick = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: me, uids: cands.map(x => x.uid), prompt: '소멸시킬 디지몬 선택' });
      if (!pick) break;
      state._overclockDelete = true; // 「《오버클럭》으로 소멸했다면」 (EX11-060) reads deletedInfo.byOverclock
      try { S.deleteStack(state, me, pick, 'trash', 'ownEffect'); } finally { state._overclockDelete = false; }
      if (state.players[me].battle.includes(stO) && ctx.startAttack) ctx.startAttack(me, stO.uid, 'PLAYER', { noRest: true });
      break;
    }
    case 'raid': { // 16-16: ≪진격≫ — memory on the opponent's side (>= 1) at activation -> this Digimon may attack (optional, 16-16-3)
      const me = ctx.self, plR = state.players[me];
      if (!(me === 'p1' ? state.memory < 0 : state.memory > 0)) { S.log(state, `${me} 《진격》 — 메모리가 상대측 1 이상이 아니라 어택할 수 없음`); break; }
      const stR = plR.battle.find(x => x.uid === ctx.sourceStackUid);
      if (!stR || stR.suspended || S.card(stR.cardId).category !== 'digimon') { S.log(state, `${me} 《진격》 — 어택할 수 있는 디지몬이 없음`); break; }
      if (instr.srcMin != null && stR.sources.length < instr.srcMin) break; // conditional 진격: "진화원이 N장 있을 때"
      if (instr.srcColor && !stR.sources.some(id => (S.card(id).colors || []).includes(instr.srcColor))) break; // "진화원에 <색>인 카드가 있을 때"
      if (!(await ctx.choose('confirmEffect', { player: me, prompt: '《진격》 — 이 디지몬으로 어택할까요?' }))) break;
      if (ctx.startAttack) ctx.startAttack(me, stR.uid, undefined, { raid: true }); // 《진격》: the attack is a raid attack (BT5-017 …)
      break;
    }
    case 'attackNow': {
      const pl = state.players[who];
      let uid = instr.thisStack ? ctx.sourceStackUid : null;
      if (!uid) uid = await ctx.choose('pickStack', { player: who, uids: pl.battle.filter(x => !x.suspended && S.card(x.cardId).category === 'digimon').map(x => x.uid), prompt: '어택할 디지몬 선택' });
      const st = uid && pl.battle.find(x => x.uid === uid);
      if (!st || st.suspended) { S.log(state, `${who} 어택할 수 있는 디지몬이 없음`); break; }
      if (ctx.startAttack) ctx.startAttack(who, uid);
      break;
    }
    case 'placeUnderTamer': {
      const pl = state.players[who];
      const tamers = pl.battle.filter(x => S.card(x.cardId).category === 'tamer');
      if (!tamers.length) { S.log(state, `${who} 자신의 테이머가 없어 카드를 놓을 수 없음`); break; }
      const tUid = tamers.length === 1 ? tamers[0].uid : await ctx.choose('pickStack', { player: who, uids: tamers.map(x => x.uid), prompt: '카드를 아래에 놓을 테이머 선택' });
      const tamer = tamers.find(x => x.uid === tUid);
      if (!tamer) break;
      for (let i = 0; i < instr.n; i++) {
        let zone = null, eligible = [];
        for (const z of instr.zones) { const e = pl[z].map((id, k) => k).filter(k => matchesFilter(S, pl[z][k], instr.filter)); if (e.length) { zone = z; eligible = e; break; } }
        if (!zone) break;
        const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: eligible, prompt: `${zone === 'trash' ? '트래시' : '패'}에서 테이머 아래에 놓을 카드 선택` });
        if (idx == null) break;
        const [id] = pl[zone].splice(idx, 1);
        tamer.sources.unshift(id); // 4-4-2: under a stacked Tamer → the BOTTOM of its stack (sources[0] = bottom)
        S.log(state, `${who} ${S.card(id).nameKo}을(를) ${S.card(tamer.cardId).nameKo} 아래에 놓음`);
      }
      break;
    }
    case 'shuffleSecurity': {
      const sec = state.players[who].security;
      for (let i = sec.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sec[i], sec[j]] = [sec[j], sec[i]]; }
      if (state.players[who].secUp) state.players[who].secUp = {}; // 1-3-10: face-up (public) cards are made hidden before shuffling
      S.log(state, `${who} 시큐리티를 셔플`);
      break;
    }
    case 'lookSecurity':
      S.log(state, `${who} 시큐리티 확인: ${state.players[who].security.map(id => S.card(id).nameKo).join(', ') || '(없음)'}`);
      break;
    case 'lockOpp': { // 상대의 턴 종료까지: 액티브가 되지 않음 / 레스트할 수 없음 / 【진화 시】 효과 발휘 불가 / DP 변화 (상대의 디지몬)
      const untilL = state.activePlayer === ctx.self ? state.turnNumber + 1 : state.turnNumber;
      let tgtL = [];
      if (instr.who === 'last') { const lp = resolveLast(ctx); const stL = lp && [state.players[lp.player].raising, ...state.players[lp.player].battle].filter(Boolean).find(x => x.uid === lp.uid); if (stL) tgtL = [{ p: lp.player, st: stL }]; }
      else if (instr.who === 'all') tgtL = candidateStacks(ctx, ctx.opp, { filter: instr.filter }).map(st => ({ p: ctx.opp, st }));
      else { const cs = candidateStacks(ctx, ctx.opp, { filter: instr.filter }); if (cs.length) { const uidL = await ctx.choose('pickStack', { player: ctx.opp, uids: cs.map(x => x.uid), prompt: instr.prompt || '상대의 턴 종료까지 효과를 받을 상대의 디지몬 선택' }); const stL = cs.find(x => x.uid === uidL); if (stL) tgtL = [{ p: ctx.opp, st: stL }]; } }
      for (const { p: pL, st: stL } of tgtL) {
        if (S.effectBlocked(state, pL, stL, 'other')) continue;
        if (instr.noActive) stL.cannotUnsuspendUntil = untilL;
        if (instr.noEvoTrig) stL.noEvoTrigUntil = untilL;
        if (instr.noRest) S.preventRest(state, pL, stL.uid, untilL);
        if (instr.dp) S.modifyDP(state, pL, stL.uid, instr.dp, 'opponentTurn');
        S.log(state, `${pL} ${S.card(stL.cardId).nameKo}: 상대의 턴 종료까지 ${[instr.noActive && '액티브가 되지 않음', instr.noRest && '레스트 불가', instr.noEvoTrig && '【진화 시】 효과 발휘 불가', instr.dp && 'DP ' + instr.dp].filter(Boolean).join(', ')}`);
      }
      break;
    }
    case 'skipUnsuspend': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.map(s => s.uid);
      if (!uids.length) break;
      const uid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '액티브가 되지 않을 디지몬 선택' });
      if (uid) S.setSkipNextUnsuspend(state, targetPlayer, uid);
      break;
    }
    case 'moveEach': {
      const pl = state.players[who];
      const { st, entries } = moveEachEntries(ctx, instr);
      instr._moved = 0; ctx._moveEachN = 0;
      const ids = entries.map(e => e.id);
      const pickedIdx = await pickByGroups(ctx, who, ids, instr.groups, 'pickFromRevealed', instr.prompt || '카드 선택', (el, prompt) => ({ player: who, revealed: ids, eligible: el.map(i => ({ id: ids[i], i })), min: 0, max: 1, prompt, ...(instr.required != null ? { required: instr.required } : {}) }));
      let chosen = pickedIdx.map(i => entries[i]);
      if (!chosen.length) break;
      if (instr.ordered && chosen.length > 1 && instr.dest !== 'play') { // "원하는 순서대로": the player orders the group (first = top)
        const ord = await ctx.choose('orderCards', { player: who, ids: chosen.map(e => e.id), prompt: instr.dest === 'deckBottom' ? '덱 아래로 되돌릴 순서 선택 (먼저 고른 카드가 위)' : '진화원에 놓을 순서 선택 (먼저 고른 카드가 위)' });
        if (Array.isArray(ord) && ord.length === chosen.length) chosen = ord.map(i => chosen[i]);
      }
      const taken = [];
      for (const e of chosen) { // remove by id from the zone it came from (indices shift as cards leave)
        const arr = e.z === 'sources' ? st.sources : pl[e.z];
        let k = arr.lastIndexOf(e.id); if (k < 0) continue;
        arr.splice(k, 1); taken.push(e);
      }
      if (st && taken.some(e => e.z === 'sources')) S.recomputeStackGrants(st);
      instr._moved = taken.length; ctx._moveEachN = taken.length;
      const sname = (e) => S.card(e.id).nameKo;
      if (instr.dest === 'deckBottom') {
        for (const e of taken) { pl.deck.push(e.id); S.log(state, `${who} ${sname(e)}을(를) 덱 아래로 되돌림`); }
      } else if (instr.dest === 'thisSources') {
        if (!st) { for (const e of taken) pl.trash.push(e.id); break; }
        for (const e of instr.pos === 'top' ? taken.slice().reverse() : taken) { if (instr.pos === 'top') st.sources.push(e.id); else st.sources.unshift(e.id); }
        S.recomputeStackGrants(st);
        S.log(state, `${who} ${taken.map(sname).join(', ')}을(를) 진화원에 놓음`);
      } else if (instr.dest === 'play') {
        for (const e of taken) {
          if (S.card(e.id).category === 'option') { pl.trash.push(e.id); continue; }
          pl.trash.push(e.id); // sources / hand cards are played through the trash slot (same trick as the other "진화원에서 등장" effects)
          S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, fromSources: e.z === 'sources' || !!e.left });
        }
      }
      break;
    }
    case 'costGroup': {
      const st = state.players[ctx.self].battle.find(x => x.uid === ctx.sourceStackUid) || (state.players[ctx.self].raising?.uid === ctx.sourceStackUid ? state.players[ctx.self].raising : null);
      const canPay = costGroupPayable(ctx, instr);
      if (!canPay) { S.log(state, `${ctx.self} 비용을 지불할 수 없어 효과를 건너뜀`); break; }
      // 15-7-2/15-7-3: an optional-processing-condition ("~ことで") cost must be performed IN FULL; if the player
      // picked fewer cards than required (or a step was blocked), nothing after the cost may run.
      const needHand = { p1: 0, p2: 0 }, needSec = { p1: 0, p2: 0 };
      const bat0 = state.players[ctx.self].battle.length, needSac = instr.cost.filter(x => x.op === 'destroy' && x.mode === 'choose').length;
      const h0 = { p1: state.players.p1.hand.length, p2: state.players.p2.hand.length }, s0 = { p1: state.players.p1.security.length, p2: state.players.p2.security.length };
      const whoKey = (c) => (c.who === 'opponent' ? ctx.opp : ctx.self);
      for (const c of instr.cost) { if (c.op === 'trashHand') needHand[whoKey(c)] += c.n || 1; if (c.op === 'removeSecurity') needSec[whoKey(c)] += c.n || 1; }
      // costs the compiler could not automate: the player confirms having paid them by hand (never run the effect for free)
      for (const c of instr.cost.filter(x => x.op === 'manualCost')) {
        if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `비용(수동 처리): ${c.text} — 지불했습니까/지불하시겠습니까?` }))) { S.log(state, `${ctx.self} 비용을 지불하지 않아 효과를 처리하지 않음`); return; }
      }
      await runScript(instr.cost.filter(x => x.op !== 'manualCost'), ctx);
      const paid = bat0 - state.players[ctx.self].battle.length >= needSac && ['p1', 'p2'].every(pp => h0[pp] - state.players[pp].hand.length >= needHand[pp] && s0[pp] - state.players[pp].security.length >= needSec[pp])
        && instr.cost.every(c => c.op !== 'restStack' || !st || st.suspended)
        && instr.cost.every(c => c.op !== 'moveEach' || c._moved >= moveEachSlots(c));
      if (!paid) { S.log(state, `${ctx.self} 비용을 전부 지불하지 못해 이후 효과를 처리하지 않음 (15-7-2)`); break; }
      await runScript(instr.then, ctx);
      break;
    }
    case 'preventRest': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
      const matching = () => state.players[targetPlayer].battle.filter(s => !instr.filter || matchesFilter(S, s, instr.filter, state));
      if (instr.all) {
        for (const s of matching()) S.preventRest(state, targetPlayer, s.uid, expiresAfterTurn);
        break;
      }
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = matching().map(s => s.uid);
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '레스트 불가로 만들 디지몬 선택' });
        if (!targetUid) break;
        S.preventRest(state, targetPlayer, targetUid, expiresAfterTurn);
      }
      break;
    }
    case 'hatch':
      S.hatchDigitama(state, who);
      break;
    case 'moveRaising':
      S.moveRaisingToBattle(state, who);
      break;
    case 'returnToHandStripSources': {
      const lastRef = instr.last ? resolveLast(ctx) : null;
      const targetPlayer = lastRef ? lastRef.player : instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dest = instr.dest || 'hand'; // 'hand' | 'deckBottom'
      const bounce = (stack) => {
        const pl = state.players[targetPlayer];
        if (!pl.battle.includes(stack)) return;
        if (S.effectBlocked(state, targetPlayer, stack, 'bounce') || S.leaveGate(state, targetPlayer, stack, targetPlayer === ctx.self ? 'ownEffect' : 'effect', 'bounce', () => bounce(stack))) return;
        pl.battle.splice(pl.battle.indexOf(stack), 1);
        const leavePlays = S.extractLeaveSourcePlays(state, targetPlayer, stack, targetPlayer === ctx.self ? 'ownEffect' : 'effect'); // 16-36/16-29
        const linkIds = (stack.linkCards || []).map(l => l.cardId);
        if (dest === 'deckBottom') pl.deck.push(stack.cardId); else pl.hand.push(stack.cardId);
        pl.trash.push(...stack.sources, ...linkIds);
        S.playExtractedSources(state, targetPlayer, leavePlays);
        S.log(state, `${targetPlayer} ${S.card(stack.cardId).nameKo} ${dest === 'deckBottom' ? '덱 아래로' : '핸드로'}, 진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 파기`);
        // Overflow (4-19-1) doesn't cover Link Cards leaving (4-9-1/4-9-4) — exclude linkIds.
        S.applyOverflowBatch(state, targetPlayer, [...stack.sources, stack.cardId]);
      };
      const matching = () => candidateStacks(ctx, targetPlayer, { filter: instr.filter && Object.keys(instr.filter).length ? instr.filter : undefined, excludeSelf: instr.excludeSelf, anyKind: false }).filter(s =>
        (!instr.filter || matchesFilter(S, s, instr.filter, state))
        && (instr.requireSuspended == null || s.suspended === instr.requireSuspended));
      if (instr.last || instr.thisStack) { const stL = state.players[targetPlayer].battle.find(x => x.uid === (instr.thisStack ? ctx.sourceStackUid : lastRef?.uid)); if (stL) bounce(stL); break; }
      if (instr.all) {
        // Snapshot uids up front — bounce() mutates pl.battle as it goes.
        for (const uid of matching().map(s => s.uid)) {
          const stack = state.players[targetPlayer].battle.find(s => s.uid === uid);
          if (stack) bounce(stack);
        }
        break;
      }
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = matching().map(s => s.uid);
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || (dest === 'deckBottom' ? '덱 아래로 되돌릴 디지몬 선택' : '핸드로 되돌릴 디지몬 선택') });
        if (!targetUid) break;
        const stack = state.players[targetPlayer].battle.find(s => s.uid === targetUid);
        if (stack) bounce(stack);
      }
      break;
    }
    case 'bounceToDeckBottomStripSources': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle
        .filter(s => {
          const { segments } = S.parseEffectSegments(S.card(s.cardId).effectKo);
          return segments.some(seg => seg.tags.some(t => t.includes(instr.filter.hasSegmentTag)));
        })
        .map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '덱 아래로 되돌릴 [소멸시] 효과 보유 디지몬 선택' });
      if (targetUid) {
        const pl = state.players[targetPlayer];
        const stack = pl.battle.find(s => s.uid === targetUid);
        const idx = pl.battle.indexOf(stack);
        pl.battle.splice(idx, 1);
        const linkIds = (stack.linkCards || []).map(l => l.cardId);
        pl.deck.push(stack.cardId); // sources are simply discarded (trashed), per "그 디지몬이 가진 진화원은 파기"
        pl.trash.push(...stack.sources, ...linkIds);
        S.log(state, `${targetPlayer} ${S.card(stack.cardId).nameKo} 덱 아래로, 진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 파기`);
        // Overflow (4-19-1) doesn't cover Link Cards leaving (4-9-1/4-9-4) — exclude linkIds.
        S.applyOverflowBatch(state, targetPlayer, [...stack.sources, stack.cardId]);
      }
      break;
    }
    case 'grantDynamicRestriction': {
      const pl = state.players[ctx.self];
      const stack = pl.raising?.uid === ctx.sourceStackUid ? pl.raising : pl.battle.find(s => s.uid === ctx.sourceStackUid);
      if (stack) {
        stack.dynamicRestrictions = stack.dynamicRestrictions || [];
        stack.dynamicRestrictions.push(instr.restriction);
        S.log(state, `${ctx.self} ${S.card(stack.cardId).nameKo}에 조건부 제약 부여: ${instr.restriction.type}`);
      }
      break;
    }
    case 'placeThisInBattle':
      S.placeThisInBattle(state, ctx.self, ctx.sourceCardId);
      break;
    case 'placeThisUnderSource': { // "그 후, 이 카드를 <조건> 자신의 디지몬의 진화원 아래에 놓는다." (EX7-066/070/071, P-180): the just-used option goes to the bottom of the chosen Digimon's sources
      const plU = state.players[ctx.self];
      const candU = candidateStacks(ctx, ctx.self, { filter: instr.filter });
      if (!candU.length) { S.log(state, `${ctx.self} 진화원 아래에 놓을 수 있는 디지몬이 없음`); break; }
      const uidU = candU.length === 1 ? candU[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: candU.map(s => s.uid), prompt: '이 카드를 진화원 아래에 놓을 디지몬 선택' });
      const stU = candU.find(s => s.uid === uidU);
      if (!stU) break;
      const ixU = plU.trash.lastIndexOf(ctx.sourceCardId);
      if (ixU !== -1) plU.trash.splice(ixU, 1);
      stU.sources.splice(S.fdCount(stU), 0, ctx.sourceCardId); // bottom of the face-up sources (above any face-down block)
      S.recomputeStackGrants(stU);
      S.log(state, `${ctx.self} ${S.card(ctx.sourceCardId).nameKo}을(를) ${S.card(stU.cardId).nameKo}의 진화원 아래에 놓음`);
      break;
    }
    case 'runOwnMain': { // "이 카드의 【메인】 효과를 발휘한다." followed by more sentences (그 후, 이 카드를 패에 추가한다): re-run this card's own 【메인】 segment first
      const seg = S.parseEffectSegments(S.card(ctx.sourceCardId)?.effectKo || '').segments.find(x => x.tags.includes('메인'));
      if (seg) await runScript(lookupCardSpecific(ctx.sourceCardId, seg.tags, seg.body) || compileToScript(seg.body), ctx);
      break;
    }
    case 'addSelfToHand':
      S.addSelfToHand(state, ctx.self, ctx.sourceCardId);
      break;
    case 'placeThisAtSecurityBottom':
      S.placeThisAtSecurityBottom(state, ctx.self, ctx.sourceCardId);
      break;
    case 'securityBottomToHand':
      S.securityBottomToHand(state, ctx.self, instr.n);
      break;
    case 'noop':
      S.log(state, `(확인) ${instr.note}`);
      break;
    case 'grantColor':
      S.grantColor(state, ctx.self, ctx.sourceStackUid, instr.color);
      break;
    case 'securityDPMod': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.duration;
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
      S.addSecurityDPMod(state, targetPlayer, instr.amount, expiresAfterTurn);
      break;
    }
    case 'evoCostMod': {
      const dur = instr.duration;
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 1 : state.turnNumber;
      S.addEvoCostMod(state, ctx.self, instr.delta, instr.filter, expiresAfterTurn);
      break;
    }
    case 'securityTopToHand': {
      const pl = state.players[who];
      for (let i = 0; i < (instr.n || 1); i++) {
        const id = pl.security.shift();
        if (!id) break;
        pl.hand.push(id);
        S.log(state, `${who} 시큐리티 맨 위 카드를 패에 추가: ${S.card(id).nameKo}`);
        S.emitGameEvent(state, 'securityDecrease', { owner: who, stack: null, cause: 'effect' }); // s5
      }
      break;
    }
    case 'recoverTop':
      S.recoverTopOfDeckToSecurity(state, who);
      break;
    case 'trashEvoSources': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      if (instr.thisStack) {
        const own = state.players[targetPlayer];
        const st = own.battle.find(x => x.uid === ctx.sourceStackUid) || (own.raising?.uid === ctx.sourceStackUid ? own.raising : null);
        if (!st) break;
        const n = Math.min(instr.count, st.sources.length);
        const idxs = (instr.digiburst || instr.choose) ? await S.digiburstChooseSources(state, targetPlayer, st, n, ctx.choose) : null;
        const removed = S.trashEvoSources(state, targetPlayer, st.uid, n, 'bottom', idxs);
        if (instr.digiburst) for (const id of removed) S.queueDigiburstTrashed(state, targetPlayer, id, st.uid);
        break;
      }
      if (instr.all) {
        for (const st of (instr.filter ? candidateStacks(ctx, targetPlayer, { ...instr, anyKind: true }) : [...state.players[targetPlayer].battle])) S.trashEvoSources(state, targetPlayer, st.uid, instr.count ?? 'all', instr.from);
        break;
      }
      const picked = [];
      for (let i = 0; i < (instr.stacks || 1); i++) {
        const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid).filter(u => !picked.includes(u));
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '진화원을 파기시킬 디지몬 선택' });
        if (!targetUid) break;
        picked.push(targetUid);
        S.trashEvoSources(state, targetPlayer, targetUid, instr.count ?? 'all', instr.from);
      }
      break;
    }
    case 'memoryBorrowAndRepay':
      S.grantMemory(state, ctx.self, instr.n, ctx.sourceCardId);
      S.scheduleEndOfTurn(state, () => S.grantMemory(state, ctx.self, -instr.n), { player: ctx.self, cardId: ctx.sourceCardId, label: `이 턴 종료 시 메모리 -${instr.n}` });
      break;
    case 'setMemoryIfLE': {
      const val = ctx.self === 'p1' ? state.memory : -state.memory;
      if (val <= instr.threshold) {
        const target = ctx.self === 'p1' ? instr.setTo : -instr.setTo;
        state.memory = target;
        S.log(state, `${ctx.self} 메모리를 ${instr.setTo}로 설정 (게이지 ${state.memory})`);
      }
      break;
    }
    case 'condition': {
      const ok = await evalCondition(instr.if, ctx);
      await runScript(ok ? instr.then : instr.else, ctx);
      break;
    }
    case 'effectChoice': { // 15-15-7-2 / 15-15-7-4
      const all = instr.allIf ? await evalCondition({ test: instr.allIf }, ctx) : false;
      if (!all) {
        const idx = await ctx.choose('multipleChoice', { options: instr.options.map(o => o.label), prompt: '발휘할 효과를 1개 선택하세요' });
        if (idx != null && instr.options[idx]) { if (instr.options[idx].then.length) await runScript(instr.options[idx].then, ctx); else S.log(state, '선택한 효과는 자동 처리할 수 없음 (수동 처리): ' + instr.options[idx].label); }
        break;
      }
      const rest = instr.options.slice();
      state._forceOptional = (state._forceOptional || 0) + 1; // 15-15-7-4: a forced effect forces the chosen effects' optional processing conditions
      try {
        while (rest.length) {
          let i = 0;
          if (rest.length > 1) { const k = await ctx.choose('multipleChoice', { options: rest.map(o => o.label), prompt: `모든 효과를 발휘합니다 — 먼저 발휘할 효과를 선택하세요 (룰 15-15-7-2, 남은 ${rest.length}개)` }); i = k == null || k < 0 || k >= rest.length ? 0 : k; }
          const [o] = rest.splice(i, 1);
          if (o.then.length) await runScript(o.then, ctx); else S.log(state, '자동 처리할 수 없는 효과 (수동 처리): ' + o.label);
        }
      } finally { state._forceOptional--; }
      break;
    }
    case 'choice': {
      const idx = await ctx.choose('multipleChoice', { options: instr.options.map(o => o.label), prompt: instr.prompt });
      if (idx != null && instr.options[idx]) await runScript(instr.options[idx].then, ctx);
      break;
    }
    default:
      if (CARD_OPS[instr.op]) await CARD_OPS[instr.op](instr, ctx, { runScript, runOne });
      break;
  }
}

// Best-effort compiler: official Korean effect text -> a DSL script.
// This is deliberately conservative — it only emits an instruction when a
// recognizable, common phrasing is found. Anything it doesn't recognize is
// simply left out of the script (the caller falls back to manual tools for
// whatever isn't covered), so a partially-understood sentence never causes
// an instruction to run with wrong/guessed parameters.
// ---- effect-driven evolution ("…로 (조건 무시/코스트 없이/코스트 -N) 진화시킬 수 있다") ----
// 154 printed effects. Parsed field by field; anything unrecognised (materials placed under a
// Tamer, "원하는 순서대로", 겹쳐진 카드 costs, "…있을 때," gates, exclusions) → null → manual.
function parseEvolveEffect(text) {
  let b = text.replace(/\([^()]*\)/g, '').replace(/〈룰〉.*$/s, '').trim();
  b = b.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  const sm = b.replace(/Lv\./g, 'Lv').match(/^([^.。]*?(?:진화시킬\s*수\s*있다|진화시킨다|진화할\s*수\s*있다))/);
  if (!sm) return null;
  const sent = sm[1].replace(//g, '.');
  if (/조그레스|디지크로스|원하는\s*순서|겹쳐|것으로|(?:있을|없을|한)\s*때|이외의|이외|서로\s*다른|선택한|그랬다면/.test(sent)) return null;
  let cost = { mode: 'normal' }, m;
  if (/코스트를\s*지불하지\s*않고/.test(sent)) cost = { mode: 'free' };
  else if ((m = sent.match(/지불하는\s*(?:진화\s*)?코스트\s*-(\d+)/))) cost = { mode: 'discount', n: Number(m[1]) };
  else if ((m = sent.match(/(?:진화\s*)?코스트\s*(\d+)\s*(?:을\s*지불하여|으로|를\s*지불하여)|(\d+)\s*코스트\s*지불하여/))) cost = { mode: 'fixed', n: Number(m[1] ?? m[2]) };
  const ignoreCond = /진화\s*조건을\s*무시/.test(sent), ignoreLevel = /Lv\.을\s*무시/.test(sent);
  // zone + card descriptor: "<zone>의 <desc>(으)로"
  const zm = sent.match(/(패|트래시)의\s*(.+?)\s*(?:으로|로)\s*(?:(?:진화\s*조건을\s*무시하고|Lv\.을\s*무시하고|코스트를\s*지불하지\s*않고|지불하는\s*진화\s*코스트\s*-\d+\s*하여|진화\s*코스트\s*\d+\s*(?:을\s*지불하여|으로)|\d+\s*코스트\s*지불하여|코스트를\s*지불하여|진화\s*코스트를\s*지불하여)\s*)*(?:진화시킬|진화할|진화시킨다)/);
  if (!zm) return null;
  const zone = zm[1] === '패' ? 'hand' : 'trash';
  const subjText = sent.slice(0, zm.index).replace(/[,\s]+$/, '').replace(/(?:을|를|은|는)$/, '').replace(/\s*자신의$/, '').replace(/(?:을|를|은|는)$/, '').trim();
  let cardFilter;
  const desc = zm[2].trim().replace(/\s*\d+\s*장$/, '');
  const qn = desc.match(/^((?:「[^」]+」\/?)+)$/);
  if (qn) cardFilter = { exactAny: [...qn[1].matchAll(/「([^」]+)」/g)].map(x => x[1]), category: 'digimon' };
  else { cardFilter = parseCardFilter(desc); if (!cardFilter) return null; cardFilter = { ...cardFilter, category: 'digimon' }; }
  // subject
  let subject;
  if (/^이\s*디지몬/.test(subjText) && !/자신/.test(subjText)) subject = { thisStack: true };
  else {
    const sm2 = subjText.match(/^(다른\s*)?(.*?)\s*자신(?:의)?\s*(?:(디지몬)|「([^」]+)」)\s*(?:\d+\s*마리)?$/);
    if (!sm2) return null;
    subject = { thisStack: false, other: !!sm2[1], desc: sm2[2].trim() || null, name: sm2[4] || null };
  }
  return { subject, zone, cardFilter, cost, ignoreCond, ignoreLevel };
}

// ---- text preparation ----
// Reminder text "(…)" and quoted granted-ability text "「【…】…」" describe OTHER things (keyword reminders, token stats, the effect a Digimon gains),
// yet every pattern scan below used to read them as if they were part of the effect ("…DP 3000·【소멸 시】 …DP -3000" inside a token definition compiled to a
// DP debuff). They are removed here; a token definition "「X」 (디지몬·…) 토큰" is kept as a marker for the spawnToken pattern.
// Printed-text idioms rewritten into forms the pattern scans already understand.
function prepRewrites(text) {
  // "…N장 오픈한다. 그 카드가 <조건>(이)라면, 패에 추가한다." -> "…그중 <조건> 1장을 패에 추가한다."
  text = text.replace(/(오픈한다\.\s*)그\s*카드가\s*([^.,]{2,60}?)(?:이라면|라면),?\s*패에\s*추가한다\./g, '$1그중 $2 1장을 패에 추가한다.');
  // "…이하의 조건을 만족하는 <명사>…" + "▷특징으로 「A」/「B」를 포함(…은 제외)" line -> the trait clause inlined (the exclusion is built into matchesFilter/evoTargetPredicate)
  const cm = text.match(/\n?[ \t]*▷\s*(특징(?:으로|에|은)?\s*(?:「[^」]+」\s*\/?\s*)+[을를]\s*포함)(?:하는(?:\s*디지몬)?)?\s*(?:\([^()]*\))?[.。]?[ \t]*(?=\n|$)/);
  if (cm && /이하의\s*조건을\s*만족하는/.test(text)) {
    const clause = cm[1].replace(/\s+/g, ' ').replace(/\s+([을를])/, '$1') + '하는';
    text = text.replace(cm[0], '').replace(/이하의\s*조건을\s*만족하는/g, clause);
  }
  return text;
}
// "(다음 상대의) 액티브 페이즈에서는 …액티브가 되지 않는다" / "상대의 턴 종료까지 이 효과로 레스트한(그) 디지몬은 액티브가 되지 않는다" (a sentence of its own, not gated by a condition) tacked on a rest effect
function skipsNextUnsuspend(t) { return (/액티브\s*페이즈에서는/.test(t) || /(?:^|[.。]\s*)상대의\s*턴\s*종료까지,?\s*(?:이\s*효과로\s*레스트한|그)\s*디지몬(?:은|는)\s*액티브가\s*되지\s*않는다/.test(t)) && /액티브가\s*되지\s*않는다/.test(t); }
function prepText(text) {
  text = prepRewrites(text);
  if (!/[(（]/.test(text) && !/「【/.test(text)) return text;
  const enc = (x) => encodeURIComponent(x).replace(/[()!'*.,~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  let out = '', i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(' || ch === '（') {
      let d = 1, j = i + 1;
      while (j < text.length && d > 0) { if (text[j] === '(' || text[j] === '（') d++; else if (text[j] === ')' || text[j] === '）') d--; j++; }
      if (d !== 0) { out += ch; i++; continue; }
      const inner = text.slice(i + 1, j - 1);
      if (/^디지몬·/.test(inner) && /^\s*토큰/.test(text.slice(j)) && /「[^」]+」\s*$/.test(out)) out = out.replace(/\s*$/, '') + `[[TOK:${enc(inner)}]]`;
      i = j; continue;
    }
    out += ch; i++;
  }
  out = out.replace(/(디지몬\/테이머|디지몬|테이머)\s*모두(?=[를은는가이의에])/g, '$1 전부');
  return out.replace(/「(【[^」]*)」/g, (m0, g) => `「효과」[[GRANT:${enc(g)}]]`);
}
// granted-effect trigger tag -> engine event kind (stack.s2Granted / queueGranted); null = not modelled (kept as a manual reminder)
const GRANT_KIND = { '소멸 시': 'delete', '어택 시': 'attack', '등장 시': 'play', '진화 시': 'digivolve', '어택 종료 시': 'attackEnd', '자신의 메인 페이즈 개시 시': 'mainPhaseStart', '자신의 턴 종료 시': 'turnEndOwn', '상대의 턴 종료 시': 'turnEndOpp' };
// "…에게 「【태그】 효과」의 효과를 준다/얻는다" -> grantText ops (the granted text becomes a pending effect when its event fires)
function compileGrants(t) {
  const grants = [...t.matchAll(/「효과」\[\[GRANT:([^\]]+)\]\]/g)].map(x => decodeURIComponent(x[1]));
  if (!grants.length || !/의\s*효과|얻는다|준다/.test(t)) return null;
  const sn = splitSentences(t).find(x => /「효과」\[\[GRANT:/.test(x)) || t;
  const dur = /(?:다음\s*)?상대의\s*턴\s*종료\s*시?\s*까지/.test(sn) ? 'opponentTurn' : 'turn';
  const ops = [];
  for (const g of grants) {
    const gm = g.match(/^【([^】]+)】\s*([\s\S]*)$/);
    const kind = gm ? GRANT_KIND[gm[1].trim()] : null;
    const label = gm ? gm[2].trim() : g;
    if (!kind || !label) return [{ op: 'noop', note: `효과 부여(수동 처리): 「${g.replace(/\s+/g, ' ').slice(0, 100)}」` }];
    let tgt = null;
    if (/(?:^|[.,]\s*)이\s*디지몬(?:은|에게|이)[^「]*「효과」/.test(sn) && !/(?:자신|상대)(?:의)?\s*디지몬/.test(sn.split('「효과」')[0].replace(/이\s*디지몬과/, ''))) tgt = { thisStack: true };
    else {
      const tgO = findTgt(sn, '상대', String.raw`디지몬(?:\/테이머)?`, String.raw`(?:에게|는|은|가)?\s*(?:,\s*)?(?:「효과」|[^「]{0,20}「효과」)`);
      const tgS = tgO ? null : findTgt(sn, '자신', '디지몬', String.raw`(?:에게|는|은|가)?\s*(?:,\s*)?(?:「효과」|[^「]{0,20}「효과」)`);
      const tg = tgO || tgS;
      if (tg) tgt = { side: tgO ? 'opponent' : 'self', all: tg.all, n: tg.n, ...tgtProps(tg) };
      else if (/^Lv|디지몬\s*전부에게/.test(sn.trim()) || /(?:^|,\s*)(?:Lv\.\d+\S*\s*)?디지몬\s*전부에게/.test(sn)) { const tgB = findTgt(sn, '', '디지몬', String.raw`(?:에게|는|은)?\s*「효과」`); if (tgB) tgt = { side: 'both', all: true, ...tgtProps(tgB) }; }
    }
    if (!tgt) return [{ op: 'noop', note: `효과 부여(수동 처리): 「${g.replace(/\s+/g, ' ').slice(0, 100)}」` }];
    if (/이\s*디지몬과\s/.test(sn.split('「효과」')[0]) && !tgt.thisStack) ops.push({ op: 'grantText', trigger: kind, label, until: dur, thisStack: true });
    ops.push({ op: 'grantText', trigger: kind, label, until: dur, ...tgt });
  }
  return ops;
}
function parseTokenDef(name, inner) {
  const parts = inner.split('·').map(x => x.trim()).filter(Boolean);
  const def = { name, cost: 0, level: null, dp: 0, colors: [], types: [], form: null, attribute: null, effectKo: '' };
  const eff = [];
  let seenDp = false;
  for (const pt of parts) {
    let m;
    if (seenDp) { eff.push(pt); continue; }
    if (pt === '디지몬') continue;
    if ((m = pt.match(/^(\d+)\s*코스트$/))) def.cost = Number(m[1]);
    else if ((m = pt.match(/^Lv\.\s*(\d+)$/))) def.level = Number(m[1]);
    else if ((m = pt.match(/^DP\s*(\d+)$/))) { def.dp = Number(m[1]); seenDp = true; }
    else if (/^(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*$/.test(pt)) def.colors = pt.split('/').map(x => FILTER_COLOR[x]);
    else if (/^(?:유년기|성장기|성숙기|완전체|궁극체|초궁극체|아머체|하이브리드체)/.test(pt)) def.form = pt;
    else if (/종$/.test(pt)) def.attribute = pt;
    else def.types.push(pt);
  }
  def.effectKo = eff.join('\n');
  return def;
}
// "그중 <A> N장과 <B> N장을" / "<A>와 <B> 1장씩" / "옐로와 퍼플의 디지몬 카드 1장씩" / "각각 1장씩" -> [{ filter, max, label }] (null when a group isn't understood).
// A "/" or "또는" inside ONE criterion is an OR (handled by the criterion's own filter); "와/과" BETWEEN criteria is an AND: one card for EACH criterion.
const COLOR_WORD = '(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)';
function parsePickGroups(desc) {
  const orig = desc.trim();
  const each = /씩|각각/.test(orig);
  desc = orig.replace(/각각\s*/g, '').replace(/씩$/, '').trim();
  // "옐로와 퍼플의 디지몬 카드": the noun phrase is shared by the listed colors -> one criterion per color
  let descs = [desc];
  const cm = desc.match(new RegExp(`(${COLOR_WORD}(?:\\s*(?:와|과)\\s*${COLOR_WORD})+)(인|의)`));
  if (cm) descs = cm[1].split(/\s*(?:와|과)\s*/).map(c => desc.replace(cm[0], c + cm[2]));
  const groups = [];
  for (const dd of descs) {
    const parts = dd.split(/(?<=」|카드|장|씩)\s*(?:과|와|,)\s*(?=\S)/).map(x => x.trim()).filter(Boolean);
    if (parts.length > 1 && !each && !parts.every(p => /\d+\s*장/.test(p))) return null; // plain "「A」와 「B」를 가진 카드 1장": not a per-criterion list
    for (const pt of parts) {
      const gm = pt.match(/^(.*?)\s*(\d+)\s*장(?:까지)?씩?$/);
      const dsc = (gm ? gm[1] : pt).trim(), max = gm ? Number(gm[2]) : 1;
      let f;
      if (/^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(dsc)) f = { exactAny: [...dsc.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
      else f = strictCardFilter(dsc);
      if (!f) return null;
      groups.push({ ...(Object.keys(f).length ? { filter: f } : {}), max, label: dsc.replace(/\s*카드$/, '').replace(/^[,\s]+/, '').replace(/(?:의|인)$/, '').trim() || '카드' });
    }
  }
  return groups.length ? groups : null;
}
// "<zone>에서 <descriptor> N장을 코스트를 지불하지 않고 등장" (hand/trash) -> playFree ops; tokens -> spawnToken; evolution-source plays stay manual
function compilePlayFree(t) {
  const sn = splitSentences(t).find(x => /\[\[TOK:/.test(x)) || splitSentences(t).find(x => /코스트를?\s*지불하지\s*않고/.test(x) && /등장/.test(x)) || t;
  const noTriggers = /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t);
  const rested = /레스트\s*상태로/.test(sn);
  let m;
  if ((m = sn.match(/(상대는\s*)?「([^」]+)」\[\[TOK:([^\]]+)\]\]\s*토큰\s*(\d+)\s*마리(?:를)?/))) {
    return [{ op: 'spawnToken', who: m[1] ? 'opponent' : 'self', def: parseTokenDef(m[2], decodeURIComponent(m[3])), n: Number(m[4]), rested, optional: /수\s*있다/.test(sn) }];
  }
  if (/진화원/.test(sn.split(/코스트를?\s*지불하지/)[0])) return [{ op: 'noop', note: `진화원의 카드를 코스트 없이 등장시키는 효과 — 수동으로 처리하세요: ${sn.replace(/\s+/g, ' ').slice(0, 100)}` }];
  const re = /(?:자신의\s*)?(패|트래시)(?:\s*(?:또는|\/)\s*(패|트래시))?(?:에서|의)?,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:씩)?(?:을|를|은)?\s*,?\s*(?:색\s*조건을\s*무시하고\s*)?(?:레스트\s*상태로\s*)?,?\s*코스트를?\s*지불하지\s*않고/s;
  if ((m = sn.match(re))) {
    const zones = new Set([m[1], m[2]].filter(Boolean));
    const zone = zones.size === 2 ? 'any' : zones.has('트래시') ? 'trash' : 'hand';
    const dsc = m[3].trim();
    if (/씩|각각/.test(m[0]) && dsc) { // "A와 B 1장씩": one card per criterion (was: one card matching A-or-B)
      const gs = parsePickGroups(`${dsc} ${m[4]}장씩`);
      if (gs && gs.length > 1) return gs.flatMap(g => Array.from({ length: g.max }, () => ({ op: 'playFree', who: 'self', zone, filter: g.filter || null, rested, noTriggers, optional: true, prompt: `${zone === 'trash' ? '트래시' : zone === 'any' ? '패/트래시' : '핸드'}에서 무료로 등장시킬 ${g.label} 선택` })));
    }
    let filter = null;
    if (dsc) {
      if (/^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(dsc)) filter = { exactAny: [...dsc.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
      else { filter = strictCardFilter(dsc); if (!filter) filter = { desc: dsc }; if (filter && !Object.keys(filter).length) filter = null; }
    }
    const ops = [];
    for (let i = 0; i < Number(m[4]); i++) ops.push({ op: 'playFree', who: 'self', zone, filter, rested, noTriggers, ...(m[5] || /수\s*있다/.test(sn) ? { optional: true } : {}) });
    return ops;
  }
  return null;
}

// ---- "<수량> N장/마리/명마다 <효과>" scaling ----
// "이 턴 동안 자신의 디지몬 1마리마다, 상대 디지몬 1마리의 DP를 -1000 한다" used to run the effect once. The count source is parsed into
// instr.per; runOne multiplies numeric ops / repeats target ops floor(count / size) times.
const PER_OPS = new Set(['gainMemory', 'modifyDP', 'modifyDPAll', 'draw', 'removeSecurity', 'destroy', 'rest', 'retreat', 'returnToHandStripSources', 'trashEvoSources', 'recoverTop', 'trashDeckTop', 'grantKeyword', 'unsuspend', 'securityTopToHand']);
function parsePerSource(phrase) {
  const ph = phrase.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = ph.match(/^(자신|상대)의\s*(앞면의\s*시큐리티|시큐리티|패|트래시)$/))) return { kind: 'zone', side: m[1] === '상대' ? 'opp' : 'own', zone: /시큐리티/.test(m[2]) ? 'security' : m[2] === '패' ? 'hand' : 'trash', ...(/앞면/.test(m[2]) ? { faceUp: true } : {}) };
  if (/^이\s*디지몬의\s*진화원의\s*색$/.test(ph)) return { kind: 'sourceColors' }; // "이 디지몬의 진화원의 색 1색마다" (BT18-102)
  if (/^이\s*효과로\s*소멸(?:한|시킨)(?:\s*(?:디지몬|테이머|디지몬\/테이머))?$/.test(ph)) return { kind: 'lastRes', key: 'deleted' }; // "이 효과로 소멸한 1마리(명)마다" (BT19-011): the previous instruction's result
  if ((m = ph.match(/^(자신|상대)의\s*(패|트래시)(?:의|에서)?\s*(.+?)\s*카드$/))) { const f = strictCardFilter(m[3] + ' 카드'); if (f) return { kind: 'zone', side: m[1] === '상대' ? 'opp' : 'own', zone: m[2] === '패' ? 'hand' : 'trash', filter: f }; return null; }
  if ((m = ph.match(/^이\s*디지몬의\s*(?:뒷면의\s*)?진화원(?:의\s*(.+?)\s*카드)?$/))) { if (/뒷면/.test(ph)) return null; if (!m[1]) return { kind: 'sources' }; const f = strictCardFilter(m[1] + ' 카드'); return f ? { kind: 'sources', filter: f } : null; }
  let exOther = false, distinctNames = false, ph2 = ph;
  ph2 = ph2.replace(/명칭이\s*서로\s*다른\s*/, () => { distinctNames = true; return ''; }); // "명칭이 서로 다른 특징으로 「…」를 가진 자신의 디지몬"
  ph2 = ph2.replace(/(^|\s)다른\s+/, (a, b) => { exOther = true; return b; }); // "다른 자신의 디지몬" / "레스트 상태인 다른 디지몬"
  if ((m = ph2.match(/^(.*?)\s*(?:(자신|상대)(?:의)?\s*)?(다른\s*)?(디지몬\/테이머|디지몬|테이머)$/)) && (m[2] || !/(?:자신|상대)/.test(m[1]))) {
    const mods = m[1] ? parseTargetMods(m[1]) : {};
    if (mods._left || mods.extreme) return null;
    return { kind: 'stacks', side: !m[2] ? 'both' : m[2] === '상대' ? 'opp' : 'own', filter: Object.keys(mods).length ? mods : undefined, excludeSelf: exOther || !!m[3], anyKind: m[4] !== '디지몬', ...(distinctNames ? { distinctNames: true } : {}) };
  }
  return null;
}
// "<기간,> <대상>을/를 <수량원> N장/마리(명)마다/당, <효과>": the counted source comes AFTER the target (BT24-041/065, AD1-016, BT25-018, BT26-081) — reorder into the "<수량원> N마리마다, <대상>을 <효과>" form
function perTrailingSource(sn) {
  const mm = sn.replace(/Lv\./g, 'Lv').match(/^((?:(?:이\s*턴\s*동안|턴\s*종료까지|다음\s*상대의\s*턴\s*종료\s*시?까지|상대의\s*턴\s*종료까지),?\s*)?)(.*?)\s*(\d+)\s*(?:장|마리|명)\s*(?:\(명\))?\s*(?:마다|당),?\s*(.+)$/s);
  if (!mm || !/^(?:상대|자신)/.test(mm[2].trim())) return null;
  const head = mm[2].replace(//g, '.'), re = /[을를]\s+/g; let k;
  while ((k = re.exec(head))) {
    const tgt = head.slice(0, k.index + 1), srcTxt = head.slice(k.index + k[0].length).replace(/디지몬\s*(?:과|와)\s*테이머/, '디지몬/테이머').trim();
    const src = /^(?:상대|자신)/.test(srcTxt) || /(?:가진|포함하는)\s*(?:상대|자신)/.test(srcTxt) ? parsePerSource(srcTxt) : null;
    if (src) return { src, pm: [null, mm[1], srcTxt, mm[3], tgt + ' ' + mm[4].replace(//g, '.')] };
  }
  return null;
}
function compilePerSentences(text) {
  if (!/마다|(?:마리|장|명)\s*(?:\(명\))?\s*당[,\s]/.test(text) || /\n\s*·/.test(text)) return null;
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  const out = []; let buf = []; let changed = false;
  const flush = () => { if (buf.length) { const t1 = prepText(buf.join(' ')); out.push(...reorderBySentences(t1, compileToScriptCore(t1))); } buf = []; }; // (no per pass again: that would recurse)
  for (let si = 0; si < sents.length; si++) {
    const sn = sents[si].replace(/^그\s*후,?\s*/, '');
    // "<수량원> N장/마리마다 이 [DP 소멸] 효과의 [Lv.|DP|등장 코스트] 상한 ±M" — shifts the limit of the effect compiled just before (op.capPer, applied by runOne)
    const capM = sn.replace(/Lv\./g, 'Lv').match(/^(.*?)\s*(\d+)\s*(?:장|마리|명|색)(?:\(명\))?\s*마다,?\s*이\s*(DP\s*소멸\s*)?효과의\s*(Lv|DP|(?:등장\s*)?코스트)?\s*상한\s*([+-])\s*(\d+)\s*[.。]?$/s);
    if (capM) {
      const csrc = parsePerSource(capM[1].replace(//g, '.'));
      const stat = capM[4] ? (capM[4].startsWith('Lv') ? 'level' : capM[4] === 'DP' ? 'dp' : 'cost') : capM[3] ? 'dp' : null;
      if (csrc && stat) {
        flush();
        const key = { dp: 'dpMax', level: 'levelMax', cost: 'costMax' }[stat];
        const flat = (arr) => arr.flatMap(o => [o, ...flat(o.then || [])]); // (an op inside a "…라면, …" condition wrapper)
        const tgt = flat(out).reverse().find(o => o.op === 'destroySum' ? o.stat === stat : (o.filter && o.filter[key] != null));
        if (tgt) { tgt.capPer = { per: { ...csrc, size: Number(capM[2]) }, delta: (capM[5] === '-' ? -1 : 1) * Number(capM[6]), stat }; changed = true; continue; }
      }
    }
    let pm = sn.replace(/Lv\./g, 'Lv\uE000').match(/^((?:(?:이\s*턴\s*동안|턴\s*종료까지|다음\s*상대의\s*턴\s*종료\s*시?까지|상대의\s*턴\s*종료까지),?\s*)?)(.*?)\s*(\d+)\s*(?:장|마리|명|색)\s*마다,?\s*(.+)$/s);
    let src = pm ? parsePerSource(pm[2].replace(/\uE000/g, '.')) : null;
    if (!src) { const alt = perTrailingSource(sn); if (alt) { pm = alt.pm; src = alt.src; } } // counted source trails the target ("상대의 디지몬 1마리를 자신의 디지몬 1마리마다/당, …")
    if (!src) { buf.push(sn); continue; }
    let rest = (pm[1] + pm[4]).replace(/\uE000/g, '.');
    if (sents[si + 1] && /액티브\s*페이즈에서는[^.]*액티브가\s*되지\s*않는다/.test(sents[si + 1]) && /레스트\s*시[키킨]/.test(rest)) rest += ' ' + sents[++si]; // companion sentence of a rest effect (skip the next unsuspend)
    const ops = compileToScript(rest);
    if (!ops.length || !ops.every(o => PER_OPS.has(o.op) && !o.per)) { buf.push(sn); continue; }
    flush();
    out.push(...ops.map(o => ({ ...o, per: { ...src, size: Number(pm[3]) } })));
    changed = true;
  }
  flush();
  return changed ? out : null;
}
function perCount(ctx, per) {
  const { state, S } = ctx;
  const who = per.side === 'opp' ? ctx.opp : ctx.self;
  let cnt = 0;
  if (per.kind === 'moved') cnt = ctx._moveEachN || 0; // "놓은 1장마다"
  else if (per.kind === 'zone') cnt = per.faceUp ? S.secFaceUpCount(state.players[who]) : state.players[who][per.zone].filter(id => matchesFilter(S, id, per.filter)).length;
  else if (per.kind === 'sourceColors') { const pl = state.players[ctx.self]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); cnt = st ? new Set(st.sources.flatMap(id => S.card(id).colors || [])).size : 0; }
  else if (per.kind === 'lastRes') cnt = (ctx._res && ctx._res[per.key]) || 0; // "이 효과로 소멸한 1마리마다": what the previous instruction did
  else if (per.kind === 'sources') { const pl = state.players[ctx.self]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); cnt = st ? st.sources.filter(id => matchesFilter(S, id, per.filter)).length : 0; }
  else if (per.kind === 'stacks') {
    const arr = (per.side === 'both' ? [ctx.self, ctx.opp] : [who]).flatMap(w => candidateStacks(ctx, w, { filter: per.filter, excludeSelf: per.excludeSelf, anyKind: per.anyKind }));
    cnt = per.distinctNames ? new Set(arr.map(s => S.card(s.cardId).nameKo)).size : arr.length; // "명칭이 서로 다른 …"
  }
  return Math.floor(cnt / (per.size || 1));
}
// ---- target descriptors: "<modifiers> 상대의 [다른] 디지몬 N마리(까지)/전부 <tail>" ----
// The modifiers in front of 상대의/자신의 (DP/Lv./코스트 이하, 레스트 상태, 진화원 없음, 색, 특징, 명칭, 가장 …낮은/높은) used to be dropped,
// so the picker offered ANY Digimon. parseTargetMods turns them into a filter (candidateStacks applies it at run time).
function parseTargetMods(pre) {
  let s = pre.replace(/\([^()]*\)/g, '').trim();
  const f = {};
  const C = '레드|블루|옐로우?|그린|블랙|퍼플|화이트';
  const take = (re, fn) => { const m = s.match(re); if (!m) return false; fn(m); s = s.slice(0, m.index).trim(); return true; };
  const dir = (x) => (x === '낮은' ? 'min' : 'max');
  for (let guard = 0; guard < 10 && s; guard++) {
    if (take(/가장\s*DP가\s*(낮은|높은)$|DP가\s*가장\s*(낮은|높은)$/, m => { f.extreme = { stat: 'dp', dir: dir(m[1] || m[2]) }; })) continue;
    if (take(/가장\s*Lv\.?\s*이\s*(낮은|높은)$|Lv\.?\s*이\s*가장\s*(낮은|높은)$/, m => { f.extreme = { stat: 'level', dir: dir(m[1] || m[2]) }; })) continue;
    if (take(/가장\s*(?:등장\s*)?코스트가\s*(낮은|높은)$/, m => { f.extreme = { stat: 'cost', dir: dir(m[1]) }; })) continue;
    if (take(/(소멸(?:시킨|한)|되돌린|파기한|이\s*효과로\s*(?:소멸|파기|되돌)한|이\s*효과로\s*등장(?:한|시킨)|그)\s*(디지몬|카드)의\s*(DP|Lv\.?|(?:등장\s*)?코스트)\s*이하(?:의|인)?$/, m => { f.ref = /파기한/.test(m[1]) ? 'discard' : 'pick'; f.refStat = /DP/.test(m[3]) ? 'dp' : /Lv/.test(m[3]) ? 'level' : 'cost'; })) continue;
    if (take(/(소멸한|소멸시킨|되돌린|파기한)\s*(디지몬|카드)와\s*같은\s*Lv\.?(?:의|인)?$/, m => { f.ref = /파기한/.test(m[1]) ? 'discard' : 'pick'; f.refStat = 'level'; f.refEq = true; })) continue;
    if (take(/이\s*디지몬(?:의)?\s*DP\s*이하(?:인|의)$/, () => { f.dpMaxSelf = true; })) continue;
    if (take(/DP\s*(\d+)\s*(이하|이상)(?:인|의)?$/, m => { f[m[2] === '이하' ? 'dpMax' : 'dpMin'] = Number(m[1]); })) continue;
    if (take(/Lv\.\s*(\d+)\s*(이하|이상)?(?:인|의)?$/, m => { f[m[2] === '이하' ? 'levelMax' : m[2] === '이상' ? 'levelMin' : 'level'] = Number(m[1]); })) continue;
    if (take(/(?:등장\s*)?코스트\s*(\d+)\s*(이하|이상)(?:인|의)?$/, m => { f[m[2] === '이하' ? 'costMax' : 'costMin'] = Number(m[1]); })) continue;
    if (take(/(레스트|액티브)\s*상태(?:인|의)$/, m => { f.suspended = m[1] === '레스트'; })) continue;
    if (take(/진화원(?:을|이)?\s*(?:갖지\s*않은|갖지\s*않는|가지지\s*않은|가지지\s*않는)$/, () => { f.noSources = true; })) continue;
    if (take(/진화원\s*매수가\s*(\d+)\s*장\s*(이하|이상)(?:의|인)?$/, m => { f[m[2] === '이하' ? 'srcMax' : 'srcMin'] = Number(m[1]); })) continue;
    if (take(/진화원(?:을)?\s*(?:가진|갖는)$/, () => { f.hasSources = true; })) continue;
    if (take(/《([^》]+)》\s*(?:를|을|이|가)\s*(?:가진|갖는)$/, m => { f.keywordText = m[1].trim(); })) continue;
    if (take(/특징(?:으로|에|은)?\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*(가진|갖는|가지는|포함하는)$/, m => { const l = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); if (m[2] === '포함하는') f.traitIncludes = l; else f.traitAny = l; })) continue;
    if (take(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술되어\s*있는$/, m => { f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); })) continue;
    if (take(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함하는$/, m => { f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); })) continue;
    if (take(new RegExp(String.raw`((?:${C})(?:\/(?:${C}))*)(?:인|의)$`), m => { f.colors = m[1].split('/').map(x => FILTER_COLOR[x]); })) continue;
    break;
  }
  Object.defineProperty(f, '_left', { value: s, enumerable: false });
  return f;
}
// Finds "<pre> <side>(의) [다른] <noun> (N마리|전부)<tail>" and returns { n, all, upTo, excludeSelf, filter? } (filter only when modifiers were found).
function findTgt(t, side, noun, tail) {
  const re = new RegExp(String.raw`((?:[^,.。\n]|Lv\.)*?)(다른\s*)?(?:${side})(?:의)?\s*(다른\s*)?(${noun})\s*(?:(\d+)\s*(?:마리|명)(?:\(명\))?(까지)?(?:씩)?|(전부))${tail}`);
  let m = t.match(re);
  if (!m) {
    const re2 = new RegExp(String.raw`(?:${side})(?:의)?\s*(다른\s*)?(${noun})\s*중,?\s*((?:[^,.。\n]|Lv\.)*?)(${noun})\s*(?:(\d+)\s*(?:마리|명)(?:\(명\))?(까지)?(?:씩)?|(전부))${tail}`);
    const m2 = t.match(re2);
    if (!m2) return null;
    const f2 = parseTargetMods(m2[3]);
    return { n: m2[5] ? Number(m2[5]) : null, all: !!m2[7], upTo: !!m2[6], excludeSelf: !!m2[1], noun: m2[4], filter: Object.keys(f2).length ? f2 : undefined, index: m2.index, left: (f2._left || '').replace(/^[\s,]*(?:그\s*후,?\s*)?/, '') };
  }
  const f = parseTargetMods(m[1]);
  return { n: m[5] ? Number(m[5]) : null, all: !!m[7], upTo: !!m[6], excludeSelf: !!(m[2] || m[3]), noun: m[4], filter: Object.keys(f).length ? f : undefined, index: m.index, left: (f._left || '').replace(/^[\s,]*(?:그\s*후,?\s*)?/, '') };
}
const tgtProps = (tg) => ({ ...(tg.filter ? { filter: tg.filter } : {}), ...(tg.excludeSelf ? { excludeSelf: true } : {}) });
// ---- keyword grants: who receives "《K》를 얻는다/준다" ----
// Subject text in front of the first 《…》 of the granting sentence: "이 디지몬은" / "그 디지몬은" (the previously chosen / event Digimon) / "<조건> 자신의|상대의 디지몬 N마리(까지)/전부는|에게".
function grantSubject(t) {
  const sn = splitSentences(t).find(x => /[≪《][^≫》]+[≫》](?:[^.。「]|「[^」]*」)*?(?:얻|준다|주고|부여)/.test(x)) || t;
  const pre = sn.split(/[≪《]/)[0].replace(/\s+$/, '');
  if (/(?:^|[,.]\s*|까지\s*|동안\s*)이\s*디지몬(?:은|에게|이|에)\s*,?$/.test(pre)) return { thisStack: true, sn };
  if (/그\s*디지몬(?:\s*1\s*마리)?(?:은|는|에게|이)\s*,?$/.test(pre)) return { last: true, sn };
  const tail = String.raw`(?:은|는|에게|에|를|을|가)?\s*,?\s*$`;
  const tgS = findTgt(pre, '자신', '디지몬', tail), tgO = findTgt(pre, '상대', '디지몬', tail);
  const tg = tgS && tgO ? (pre.lastIndexOf('상대') > pre.lastIndexOf('자신') ? tgO : tgS) : (tgS || tgO);
  if (!tg) return null;
  return { target: tg === tgO ? 'opponent' : 'self', n: tg.n, all: tg.all, upTo: tg.upTo, ...tgtProps(tg), sn };
}
// ops for one granted effect on the subject (grantKeyword / modifyDP …)
function subjectOps(gs, mk) {
  if (gs.thisStack) return [mk({ target: 'self', thisStack: true })];
  if (gs.last) return [mk({ target: 'self', last: true })];
  if (gs.all) return [mk({ target: gs.target, all: true, ...(gs.filter ? { filter: gs.filter } : {}), ...(gs.excludeSelf ? { excludeSelf: true } : {}) })];
  return Array.from({ length: gs.n || 1 }, () => mk({ target: gs.target, thisStack: false, ...(gs.filter ? { filter: gs.filter } : {}), ...(gs.excludeSelf ? { excludeSelf: true } : {}), ...(gs.upTo ? { optional: true } : {}) }));
}

// "(이 턴|다음 상대의 턴|상대의 턴) 종료 시, 그 디지몬/이 효과로 등장한 디지몬/이 디지몬을 소멸시킨다 / 패로 되돌린다": held until that turn end (atTurnEnd), not run now
const DELAYED_RE = /(?:^|(?<=[.。]\s))(?:그\s*후,?\s*)?(이\s*턴|다음\s*상대의\s*턴|상대의\s*턴|턴)\s*종료\s*시(?:에|,)?\s*,?\s*(그\s*디지몬|이\s*효과로\s*등장(?:한|시킨)\s*(?:디지몬|토큰)(?:\s*전부)?|이\s*디지몬)(?:을|를)\s*(소멸시킨다|패로\s*되돌린다|덱\s*아래로\s*되돌린다)[.。]?/g;
function compileInner(text) {
  const script = [];
  const delayed = [...text.matchAll(DELAYED_RE)];
  const t = delayed.length ? text.replace(DELAYED_RE, ' ').trim() : text;

  // 16-17 ≪딜레이≫: NOT an immediate effect of using/triggering this card —
  // it's an activatable ability of the card WHILE IT SITS IN THE BATTLE
  // AREA (discard it, from a later turn, to run the bullet effect below).
  // Without this guard, the bullet text's own action (e.g. "메모리를 +2
  // 한다.") would get pattern-matched here as if it fired immediately on
  // use, double-counting it on top of the dedicated discardForDelay flow
  // (state.js's parseDelayEffect) — this segment contributes NOTHING to
  // the normal trigger/use pipeline.
  if (/^[≪《]\s*딜레이\s*[≫》](?:\s*\([^()]*\))?(?:\s|$)/.test(t.trim())) return script;

  {
    const ev = parseEvolveEffect(t);
    if (ev) script.push({ op: 'evolveEffect', who: 'self', ...ev });
  }

  // 《디지버스트 N》(이 디지몬의 진화원을 N장 골라 파기하는 것으로 이하의 효과를 발휘한다) ·<효과>
  {
    const db = t.trim().match(/^[≪《]\s*디지버스트\s*(\d+)\s*[≫》]\s*(?:\([^()]*\))?\s*\n?\s*·?\s*(.+)$/s);
    if (db) {
      const bullet = compileToScript(db[2].trim());
      if (!bullet.length) return script;
      return [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: Number(db[1]), digiburst: true }], then: bullet }];
    }
  }

  // Simple unconditional actions (also handled as instant auto-apply in
  // state.js for whole-segment matches, but included here too so they still
  // fire correctly when part of a larger multi-clause sentence).
  let m;
  if ((m = t.match(/[≪《]\s*(\d+)\s*드로우\s*[≫》]/))) script.push({ op: 'draw', who: 'self', n: Number(m[1]) });
  if ((m = t.match(/메모리(?:를|을)?\s*\+\s*(\d+)/))) script.push({ op: 'gainMemory', who: 'self', n: Number(m[1]) });
  if ((m = t.match(/메모리(?:를|을)?\s*-\s*(\d+)/))) script.push({ op: 'gainMemory', who: 'self', n: -Number(m[1]) });

  // "DP의 합계가 N 이하가 되도록 상대 디지몬을 골라, 고른 디지몬 전부를 소멸시킨다" /
  // "등장 코스트 합계 N까지 상대의 디지몬을 소멸시킨다" — pick within a shared budget.
  if ((m = t.match(/DP의\s*합계가\s*(\d+)\s*이하가\s*되도록\s*상대(?:의)?\s*디지몬을\s*골라,?\s*고른\s*디지몬\s*전부를\s*소멸시킨다/))) {
    script.push({ op: 'destroySum', stat: 'dp', limit: Number(m[1]) });
  } else if ((m = t.match(/등장\s*코스트\s*합계\s*(\d+)\s*까지\s*상대(?:의)?\s*디지몬을\s*소멸시킨다/))) {
    script.push({ op: 'destroySum', stat: 'cost', limit: Number(m[1]) });
  } else if ((m = t.match(/DP\s*합계\s*(\d+)\s*까지\s*상대(?:의)?\s*디지몬을\s*소멸시킨다/))) {
    script.push({ op: 'destroySum', stat: 'dp', limit: Number(m[1]) });
  }

  // Destroy / delete opponent's Digimon.
  { const tgO = findTgt(t, '상대', '디지몬', String.raw`(?:를|을)?\s*소멸`), tgS = findTgt(t, '자신', '디지몬', String.raw`(?:를|을)?\s*소멸`);
    if (/^이\s*디지몬을\s*소멸시킨다[.。]?$/.test(t)) {
      script.push({ op: 'destroy', target: 'self', mode: 'thisStack' });
    } else if (tgO) {
      if (tgO.all) script.push({ op: 'destroy', target: 'opponent', mode: 'all', ...tgtProps(tgO) });
      else for (let i = 0; i < tgO.n; i++) script.push({ op: 'destroy', target: 'opponent', mode: 'choose', ...(tgO.upTo ? { optional: true } : {}), ...tgtProps(tgO) });
    } else if (/가장\s*(?:DP가\s*)?낮은[^。\n]*상대[^。\n]*디지몬[^。\n]*소멸|상대[^。\n]*가장\s*(?:DP가\s*)?낮은[^。\n]*디지몬[^。\n]*소멸/.test(t)) {
      script.push({ op: 'destroy', target: 'opponent', mode: 'lowestDP' });
    }
    if (tgS && !/^이\s*디지몬을/.test(t) && !tgS.all) {
      for (let i = 0; i < tgS.n; i++) script.push({ op: 'destroy', target: 'self', mode: 'choose', ...(tgS.upTo ? { optional: true } : {}), ...tgtProps(tgS) });
    } else if (tgS && tgS.all && !/^이\s*디지몬을/.test(t)) {
      script.push({ op: 'destroy', target: 'self', mode: 'all', ...tgtProps(tgS) });
    } }

  // Retreat / de-digivolve.
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:를)?\s*[≪《]\s*퇴화\s*(\d+)\s*[≫》]/))) {
    script.push({ op: 'retreat', target: 'opponent', n: Number(m[1]), all: true });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*(?:마리|장)(?:까지)?(?:를|을)?\s*[≪《]\s*퇴화\s*(\d+)\s*[≫》]/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'retreat', target: 'opponent', n: Number(m[2]) });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*1\s*마리를?\s*[≪《]?\s*퇴화\s*(\d+)\s*[≫》]?/))) {
    script.push({ op: 'retreat', target: 'self', n: Number(m[1]) });
  }

  // "(그 후,) 이 디지몬을 소멸시킨다" as a trailing clause (the anchored form above only matched a lone sentence).
  if (/이\s*디지몬을\s*소멸시킨다/.test(t) && !/것으로\s*,?\s*이\s*디지몬을\s*소멸시킨다/.test(t) && !script.some(o => o.op === 'destroy' && o.mode === 'thisStack')) {
    script.push({ op: 'destroy', target: 'self', mode: 'thisStack', deferLast: true });
  }
  // "이 디지몬/자신의 디지몬 N마리로 (상대의 디지몬에게) 어택할 수 있다" — an effect-granted immediate attack.
  if ((m = t.match(/(이\s*디지몬|자신(?:의)?\s*디지몬\s*\d+\s*마리)(?:으로|로)\s*(?:상대(?:의)?\s*디지몬에게\s*)?어택할\s*수\s*있다/)) && !/(?:동안|때)[^.]*어택할\s*수\s*있다/.test(t.replace(/\([^()]*\)/g, ''))) {
    script.push({ op: 'attackNow', who: 'self', thisStack: /^이/.test(m[1]) });
  }
  // "자신의 패/트래시에서 <조건> 카드 N장을 자신의 테이머 아래에 놓는다/놓을 수 있다"
  if ((m = t.match(/자신(?:의)?\s*(패\s*\/\s*트래시|패\s*또는\s*트래시|패|트래시)에서,?\s*(.*?)\s*(\d+)\s*장(?:을)?\s*자신(?:의)?\s*테이머\s*아래에\s*(?:원하는\s*순서대로\s*)?놓(?:는다|을\s*수\s*있다)/s))) {
    const zones = /트래시/.test(m[1]) && /패/.test(m[1]) ? ['hand', 'trash'] : /트래시/.test(m[1]) ? ['trash'] : ['hand'];
    script.push({ op: 'placeUnderTamer', who: 'self', zones, filter: parseCardFilter(m[2]) || {}, n: Number(m[3]) });
  }
  if (/자신(?:의)?\s*시큐리티를\s*셔플한다/.test(t)) script.push({ op: 'shuffleSecurity', who: 'self' });
  if (/자신(?:의)?\s*시큐리티를\s*전부\s*확인한다/.test(t)) script.push({ op: 'lookSecurity', who: 'self' });
  // "상대의 턴 종료까지 상대의 디지몬/테이머 N마리(명)는 액티브가 되지 않는다" — chosen targets skip their next unsuspend.
  if ((m = t.match(/상대(?:의)?\s*턴\s*종료까지,?\s*상대(?:의)?\s*디지몬(?:\/테이머)?\s*(\d+)\s*마리(?:\(명\))?(?:는|가)\s*액티브가\s*되지\s*않는다/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'skipUnsuspend', target: 'opponent' });
  } else if ((m = t.match(/상대(?:의)?\s*턴\s*종료까지,?\s*((?:그\s*디지몬(?:\/테이머)?)|(?:[^.。,]*?상대(?:의)?\s*디지몬\s*(?:전부|1\s*마리)))(?:는|은|의)\s*((?:【진화\s*시】\s*효과는\s*발휘하지\s*않고,\s*)?(?:레스트할\s*수\s*없고,\s*)?(?:【진화\s*시】\s*효과는\s*발휘하지\s*않는다|액티브가\s*되지\s*않는다|DP\s*[+-]\s*\d+))/))) {
    // "상대의 턴 종료까지 <그 디지몬 | 상대의 디지몬 전부/1마리>는 [레스트할 수 없고,] [【진화 시】 효과는 발휘하지 않고,] 액티브가 되지 않는다" (EX7-035, BT18-053/054/056, BT19-038/046/093, EX8-023)
    const subj = m[1], pred = m[2], dm = pred.match(/DP\s*([+-])\s*(\d+)/);
    const mods = /상대/.test(subj) ? parseTargetMods(subj.replace(/상대(?:의)?\s*디지몬\s*(?:전부|1\s*마리)\s*$/, '').trim()) : {};
    if (!mods._left) script.push({ op: 'lockOpp', who: /그\s*디지몬/.test(subj) ? 'last' : /전부/.test(subj) ? 'all' : 'pick', ...(Object.keys(mods).length ? { filter: mods } : {}), noActive: /액티브가\s*되지\s*않는다/.test(pred), noEvoTrig: /【진화\s*시】/.test(pred), noRest: /레스트할\s*수\s*없고/.test(pred), ...(dm ? { dp: (dm[1] === '-' ? -1 : 1) * Number(dm[2]) } : {}) });
  }

  // Trash N cards from own hand (player picks which).
  if ((m = t.match(/자신(?:의)?\s*패(?:에서|를)?\s*(\d+)\s*장(?:을)?\s*파기/)) && !/전부/.test(t)) {
    script.push({ op: 'trashHand', who: 'self', n: Number(m[1]) });
  }

  // Reveal top N of own deck, add matching card(s) to hand (or play them for free), rest to bottom.
  if ((m = t.match(/(?:자신의\s*)?덱(?:을)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*(?:오픈|공개)/))) {
    // "그중 <조건> 카드 N장(과 <조건> 카드 N장)을 패에 추가한다 / 코스트를 지불하지 않고 등장시킬 수 있다" — the picker only offers matching cards, up to N per group.
    const pm = t.replace(/(?:을|를)\s*(\d+\s*장씩)\s*(패(?:에|로)\s*추가)/, ' $1을 $2').match(/그\s*중(?:에서|에)?\s*(.*?)\s*(?:을|를)\s*(패(?:에|로)\s*추가(?:한다|하고)|코스트를?\s*지불하지\s*않고\s*(?:레스트\s*상태로\s*)?등장(?:시킬\s*수\s*있다|시킨다|할\s*수\s*있다))/s);
    const action = pm && !/패(?:에|로)/.test(pm[2]) ? 'play' : 'hand';
    let groups = pm ? parsePickGroups(pm[1]) : null;
    if (!groups && pm) { const pf1 = parseCardFilter(pm[1].replace(/\s*\d+\s*장(?:까지)?\s*$/, '')); const nn = pm[1].match(/(\d+)\s*장/); groups = [{ ...(pf1 ? { filter: pf1 } : {}), max: nn ? Number(nn[1]) : 1 }]; }
    // "그 카드가 <조건>라면 패에 추가한다" (top-1 reveal): only a matching card may be taken
    if (!pm) { const cdm = t.match(/그\s*카드가\s*(.*?)\s*(?:이)?(?:라면|다면),?\s*패에\s*추가한다/s); if (cdm) { const pfc = parseCardFilter(cdm[1]); if (pfc) groups = [{ filter: pfc, max: 1 }]; } }
    const max = groups ? groups.reduce((a, g) => a + g.max, 0) : 1;
    script.push({ op: 'revealTop', who: 'self', n: Number(m[1]),
      pick: { min: 0, max, ...(groups && groups.length === 1 && groups[0].filter ? { filter: groups[0].filter } : {}), ...(groups && groups.length > 1 ? { groups } : {}), ...(action === 'play' ? { action: 'play', rested: /레스트\s*상태로/.test(pm[2]), noTriggers: /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t) } : {}) },
      restTo: /남은\s*카드(?:는|를)\s*(?:원하는\s*순서대로\s*)?파기한다|나머지는\s*파기한다/.test(t) ? 'trash' : /덱\s*(?:의)?\s*위(?:로)?\s*(?:되돌|돌려)/.test(t) ? 'top' : 'bottom' });
  }

  // "이 디지몬과 <다른 자신의 디지몬>으로 (코스트를 지불하여) 패의 디지몬 카드/「X」로 조그레스 진화할 수 있다."
  if ((m = t.match(/^이\s*디지몬과\s*(?:명칭에\s*「([^」]+)」을?\s*포함하는\s*)?(?:다른\s*자신의|자신의\s*다른)\s*디지몬(?:\s*\d+\s*마리)?(?:으로|로),?\s*(?:코스트를\s*지불하여\s*)?패의\s*(?:디지몬\s*카드|「([^」]+)」)(?:으로|로)\s*조그레스\s*진화할\s*수\s*있다/))) {
    script.push({ op: 'jogressEffect', who: 'self', partnerName: m[1] || null, cardName: m[2] || null });
  }

  // 【시큐리티】 "이 카드를 코스트를 지불하지 않고 등장시킨다" (331 printed segments): the card being checked, NOT a hand card of the
  // player's choice — it sits in limbo/trash after the check (13-1-6 / 13-1-8-4).
  if (/(?:^|[.。]\s*|그\s*후,?\s*)(?:이\s*카드를\s*코스트를?\s*지불하지\s*않고\s*등장\s*시킨다|코스트를?\s*지불하지\s*않고\s*이\s*카드를\s*등장\s*시킨다)/.test(t) && !/(?:패|트래시)(?:\s*(?:또는|\/)\s*(?:패|트래시))?에서/.test(t)) {
    script.push({ op: 'playThisFree' });
  } else
  // Play a card without paying cost, from hand or trash (or a token / evolution-source card).
  if ((/코스트를?\s*(?:지불하지\s*않고|支払わ)|코스트\s*없이/.test(t) || /\[\[TOK:[^\]]+\]\]\s*토큰[^.]*등장/.test(t)) && /등장/.test(t) && !script.some(o => o.op === 'revealTop' && o.pick?.action === 'play')) {
    const pfOps = compilePlayFree(t);
    if (pfOps) script.push(...pfOps);
    else {
      const zone = /트래시/.test(t) ? (/패/.test(t) ? 'any' : 'trash') : 'hand';
      script.push({ op: 'playFree', who: 'self', zone, filter: null, rested: /레스트\s*상태로/.test(t), noTriggers: /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t) });
    }
  }

  { const gOps = /「효과」\[\[GRANT:/.test(t) ? compileGrants(t) : null; if (gOps) script.push(...gOps); }

  // "이 테이머/디지몬을 레스트시킨다" — rest the effect's own source stack (also the usual
  // COST of "…레스트시키는 것으로," clauses, see compileWithCost).
  if (/이\s*(?:테이머|디지몬)(?:을|를)\s*레스트시킨다/.test(t)) script.push({ op: 'restStack' });

  // Unsuspend ("액티브로 한다"). "이 디지몬" = the source card itself (no
  // choice needed); "자신/상대의 디지몬 N마리" = pick from that player's board.
  if (/이\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다)/.test(t)) {
    script.push({ op: 'unsuspend', target: 'thisStack' });
  } else if (/^\s*그\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다)|[.,]\s*그\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다)/.test(t)) {
    script.push({ op: 'unsuspend', target: 'self', last: true });
  } else {
    const tgU = findTgt(t, '자신', String.raw`디지몬(?:\/테이머)?`, String.raw`(?:를|을)?\s*액티브로\s*(?:한다|할\s*수\s*있다|하고)`) || findTgt(t, '상대', '디지몬', String.raw`(?:를|을)?\s*액티브로\s*(?:한다|할\s*수\s*있다|하고)`);
    if (tgU && !tgU.all) { const sideU = /상대/.test(t.slice(Math.max(0, t.indexOf('액티브로') - 40), t.indexOf('액티브로')).replace(/상대의\s*턴|상대의\s*액티브/g, '')) ? 'opponent' : 'self'; for (let i = 0; i < tgU.n; i++) script.push({ op: 'unsuspend', target: sideU, ...(/테이머/.test(tgU.noun) ? {} : { digimonOnly: true }), ...tgtProps(tgU), ...(tgU.upTo || /수\s*있다/.test(t) ? { optional: true } : {}) }); }
  }

  // "상대는 스스로의/본인의 패를 N장 파기한다." — the opponent discards
  // (and chooses) from their own hand.
  if ((m = t.match(/상대는\s*(?:스스로의|본인의)\s*패(?:를)?\s*(\d+)\s*장(?:을)?\s*파기한다/))) {
    script.push({ op: 'trashHand', who: 'opponent', n: Number(m[1]) });
  }

  // Rest ("레스트시킨다"). "(다음\s*)?상대(?:의)?\s*액티브\s*페이즈에서는[,]?\s*
  // 그\s*디지몬은\s*액티브가\s*되지\s*않는다" tacked on afterward is extremely
  // common (confirmed a dozen+ cards via the audit, e.g. BT7-053/BT10-056/
  // EX2-029 all print almost this exact combo) — a one-time skip of the
  // target's next unsuspend, not a separate standalone effect.
  const tgRest = findTgt(t, '상대', String.raw`디지몬(?:\/테이머)?`, String.raw`(?:를|을)?\s*레스트\s*시(?:킨다|키고|킬\s*수\s*있다)`);
  if (tgRest && !tgRest.all) {
    const skipNextUnsuspend = skipsNextUnsuspend(t);
    for (let i = 0; i < tgRest.n; i++) script.push({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend, ...(/테이머/.test(tgRest.noun) ? {} : { digimonOnly: true }), ...(tgRest.upTo || /수\s*있다/.test(t.slice(tgRest.index)) ? { optional: true } : {}), ...tgtProps(tgRest) });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬(?:\/테이머)?\s*(\d+)\s*마리(?:\(명\))?(?:까지)?를\s*레스트시킨다/))) {
    // Word order varies across prints ("다음 상대의 액티브..." vs "상대의
    // 다음 액티브...", and "그 디지몬은" can lead OR follow "...페이즈에서는") —
    // just require both distinctive phrases to appear together rather than
    // pin down one exact ordering.
    const skipNextUnsuspend = skipsNextUnsuspend(t);
    script.push({ op: 'rest', target: 'opponent', n: Number(m[1]), skipNextUnsuspend });
  } else if ((m = t.match(/(상대(?:의)?\s*|자신(?:의)?\s*)?디지몬\s*(\d+)\s*마리를?\s*레스트시킬\s*수\s*있다/))) {
    // Optional ("...시킬 수 있다") rest — a bare "디지몬 N마리" with NEITHER
    // 상대/자신 prefix is a genuinely either-side choice (common on cards
    // that combo off "이 효과로 자신의 디지몬이 레스트했다면", which only
    // makes sense if resting your own was actually an option).
    const target = m[1] ? (/상대/.test(m[1]) ? 'opponent' : 'self') : 'either';
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'rest', target });
  }

  // "[DP N 이하의] 상대의 디지몬/테이머 전부를 레스트시킨다" — mass rest.
  if ((m = t.match(/상대(?:의)?\s*(디지몬|테이머)\s*전부(?:를)?\s*레스트시킨다/))) {
    const tgA = findTgt(t, '상대', m[1], String.raw`(?:를|을)?\s*레스트시킨다`);
    const filter = { ...(tgA?.filter || {}), category: m[1] === '테이머' ? 'tamer' : 'digimon' };
    script.push({ op: 'restAll', target: 'opponent', filter });
  }

  // DP modification, this turn unless stated otherwise.
  const dpDuration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : 'turn';
  const dpStart = script.length;
  if (/이\s*디지몬(?:의)?\s*DP를\s*[+-]?\d+\s*(?:한다|하고)/.test(t) && (m = t.match(/DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDP', target: 'self', thisStack: true, amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDPAll', target: 'self', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDPAll', target: 'opponent', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:의)?\s*(?:는,?\s*)?DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2]), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2]), duration: dpDuration });
  } else if (/이\s*디지몬을\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/이\s*디지몬을\s*DP\s*([+-]\s*\d+)/))) {
    // The far more common terse phrasing "(대상)을 DP ±N." with no "를 ...
    // 한다" verb at all — confirmed via a full-DB audit as the majority
    // shape (451/3072 uncovered segments at the time this was added).
    // Unanchored like the "한다" forms above: this clause is often preceded
    // by a "턴 종료까지"/"[턴에 N회]" lead-in that's part of the same segment.
    script.push({ op: 'modifyDP', target: 'self', thisStack: true, amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if (/자신(?:의)?\s*디지몬\s*전부(?:를)?\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDPAll', target: 'self', amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if (/상대(?:의)?\s*디지몬\s*전부(?:를)?\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDPAll', target: 'opponent', amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  }

  for (let i = dpStart; i < script.length; i++) { // target modifiers ("레스트 상태인", "그린인", "특징 「X」를 가진", "DP N 이하의" …) in front of the target noun
    const o = script[i];
    if ((o.op !== 'modifyDP' && o.op !== 'modifyDPAll') || o.thisStack) continue;
    const tgD = findTgt(t, o.target === 'opponent' ? '상대' : '자신', '디지몬', String.raw`(?:를|을|의|는|에게)?\s*(?:,\s*)?(?:이\s*턴\s*동안\s*)?DP`);
    if (tgD) Object.assign(o, tgtProps(tgD));
  }
  // 16-20: ≪세이브≫ as a standalone action ("you may place this card under
  // one of your own Tamers") on a card's OWN 【소멸 시】. The negative
  // lookahead excludes the very common "《세이브》가 기술되어 있는 ..." phrasing
  // (a filter describing OTHER cards, not this card performing the action).
  if (/[≪《]\s*세이브\s*[≫》](?!\s*가)/.test(t)) {
    script.push({ op: 'saveUnderTamer' });
  }

  // 16-26: ≪블래스트 진화≫ — by far the most common 【카운터】 body (confirmed
  // ~75 of 85 카운터 segments via the full-DB audit). Any bare keyword lines
  // that happen to trail it in the same segment (e.g. "…《블로커》") are the
  // card's own SEPARATE standing abilities, already picked up independently
  // by parseStaticGrants — ignored here, only the action itself matters.
  if (/[≪《]\s*블(?:래|라)스트\s*진화\s*[≫》]/.test(t)) {
    script.push({ op: 'blastEvolve' });
  }
  // 16-31: ≪블래스트 조그레스《「A」+「B」》≫ — jogress this hand card from the designated own Digimon + designated hand card.
  if (/[≪《]\s*블(?:래|라)스트\s*조그레스\s*[≪《]/.test(t)) script.push({ op: 'blastJogress' });

  // 《시큐리티 어택 ±N》/《S 어택 ±N》 keyword grant — positive is usually self;
  // negative is usually a debuff placed on an opponent's Digimon. "디지몬
  // N마리에게" without a restated "상대(의)" also means the opponent's side
  // here — confirmed against real cards (EX6-023/EX6-024) that print the
  // identical 손오공몬/사고몬 ability both ways, the fuller print restating
  // "상대의 디지몬" and the terser one dropping it (the duration clause
  // "상대의 턴 종료까지" already consumed the one "상대" in the sentence).
  if ((m = t.match(/[≪《]\s*(?:시큐리티\s*어택|S\s*어택)\s*([+-]\d+)\s*[≫》]/))) {
    const value = Number(m[1]);
    const duration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : (/자신의\s*턴\s*(?:동안|중)/.test(t) || !/이\s*턴\s*동안|턴\s*종료\s*시?까지/.test(t) ? 'permanent' : 'turn');
    const gsA = /(?:얻|준다|주고|부여)/.test(t) ? grantSubject(t) : null;
    if (gsA) script.push(...subjectOps(gsA, (sub) => ({ op: 'grantKeyword', ...sub, keyword: '시큐리티어택', value, duration })));
    else {
      const target = value < 0 && /디지몬\s*\d+\s*마리에게/.test(t) ? 'opponent' : 'self';
      const thisStack = target === 'self' && /이\s*디지몬은/.test(t) && !/자신(?:의)?\s*디지몬\s*\d+\s*마리/.test(t);
      const countM = t.match(/디지몬\s*(\d+)\s*마리에게/);
      const count = thisStack ? 1 : (countM ? Number(countM[1]) : 1);
      for (let i = 0; i < count; i++) script.push({ op: 'grantKeyword', target, thisStack, keyword: '시큐리티어택', value, duration });
    }
  }

  // 《리커버리 +1《덱》》.
  // "자신의 시큐리티를 위에서부터 N장 패에 추가한다" (mandatory forms only —
  // the optional "…추가할 수 있다" and cost-style "…하는 것으로, 《리커버리》"
  // shapes are left uncompiled so a follow-up recovery never runs without
  // the step it's conditioned on).
  const secTopOptional = /시큐리티를\s*위에서(?:부터)?\s*\d+\s*장(?:을)?\s*패에\s*추가할\s*수\s*있다/.test(t);
  const recoverAsCost = /것으로,?\s*[≪《]\s*리커버리/.test(t);
  if (!secTopOptional && (m = t.match(/자신(?:의)?\s*시큐리티를\s*위에서(?:부터)?\s*(\d+)\s*장(?:을)?\s*패에\s*추가(?:한다|하고)/))) {
    script.push({ op: 'securityTopToHand', who: 'self', n: Number(m[1]) });
  }
  // 《리커버리 +N》 (bracket nesting varies: "《리커버리 +2《덱》》", "《리커버리 《+1》》"),
  // optionally gated by "자신의 시큐리티가 N장 이하일 때/라면,".
  if (!secTopOptional && !recoverAsCost && (m = t.match(/리커버리\s*[≪《]?\s*\+(\d+)/))) {
    const rec = [];
    for (let i = 0; i < Number(m[1]); i++) rec.push({ op: 'recoverTop', who: 'self' });
    const cm = t.match(/자신(?:의)?\s*시큐리티가\s*(\d+)\s*장\s*(?:이하일\s*때|이하라면|이라면|일\s*때)[,]?\s*[≪《]\s*리커버리/);
    if (cm) script.push({ op: 'condition', if: { securityLE: Number(cm[1]) }, then: rec, else: [] });
    else script.push(...rec);
  }

  // Trash evolution sources: "상대 디지몬 N마리/전부의 진화원을 (아래에서부터|
  // 위에서부터) N장(까지)/전부 파기한다".
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*(?:(\d+)\s*마리|(전부))(?:의)?\s*진화원을?,?\s*(?:선택하여\s*)?(아래에서(?:부터)?|위에서(?:부터)?)?\s*(?:(\d+)\s*장(?:까지)?|(전부))\s*파기/))) {
    script.push({
      op: 'trashEvoSources', target: 'opponent',
      ...(m[2] ? { all: true } : { stacks: Number(m[1]) }),
      count: m[5] ? 'all' : Number(m[4]),
      from: m[3] && m[3].startsWith('위') ? 'top' : 'bottom',
    });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬의?\s*진화원을?\s*선택하여\s*(\d+)\s*장\s*파기한다/))) {
    // "1마리" isn't even stated here — the player picks WHICH opponent
    // Digimon (via trashEvoSources' own pickStack choose) implicitly.
    script.push({ op: 'trashEvoSources', target: 'opponent', count: Number(m[1]) });
  }

  // Direct (non-check) security trash — removeSecurity was a defined op with
  // no compiler pattern ever producing it (confirmed via the audit: every
  // real occurrence of this exact sentence, however commonly printed, fell
  // through uncompiled). "양 측의"(both)/"자신의"/"상대의" all appear.
  if ((m = t.match(/(양\s*측|자신|상대)(?:의)?\s*시큐리티를?\s*(위|아래)에서부터\s*(\d+)\s*장\s*파기한다/))) {
    const position = m[2] === '아래' ? 'bottom' : 'top';
    const n = Number(m[3]);
    const whos = /^양\s*측$/.test(m[1]) ? ['self', 'opponent'] : m[1] === '상대' ? ['opponent'] : ['self'];
    for (const who of whos) for (let i = 0; i < n; i++) script.push({ op: 'removeSecurity', who, position });
  }

  // Borrow memory now, pay it back at end of turn (net-zero temporary boost).
  if ((m = t.match(/메모리(?:를|을)?\s*\+(\d+)\s*한다\.\s*이\s*턴\s*종료\s*시,?\s*메모리(?:를|을)?\s*-\d+\s*한다/))) {
    for (let gi = script.length - 1; gi >= 0; gi--) if (script[gi].op === 'gainMemory' && Math.abs(script[gi].n) === Number(m[1])) script.splice(gi, 1); // the plain +N / -N clauses are the borrow itself
    script.push({ op: 'memoryBorrowAndRepay', n: Number(m[1]) });
  }

  // Tamer "if memory <= X, set it to Y" starter effect.
  if ((m = t.match(/메모리가\s*(\d+)\s*이하(?:일\s*때|라면),?\s*(\d+)(?:으로)?\s*한다/))) {
    // "이하일 때"/"이하라면" ("when"/"if" ≤ N) — same Tamer turn-start
    // boilerplate either way; "이하라면" turned out to be the far more
    // common printed phrasing (58 of the 62 combined occurrences).
    script.push({ op: 'setMemoryIfLE', threshold: Number(m[1]), setTo: Number(m[2]) });
  }

  // Bounce an opponent Digimon (to hand, or to the bottom of their deck) and
  // discard its evolution sources. "가진"/"갖는"/"가지는" are all real
  // conjugations actually printed ("가지는?" alone, the original pattern,
  // only ever matched "가지" or "가지는" — never "가진", by far the most
  // common form). Tried as hand first, then deck-bottom (84 combined
  // occurrences via the full-DB audit — deck-bottom alone is the larger of
  // the two).
  for (const [destWord, dest] of [['패로', 'hand'], ['덱\\s*아래로', 'deckBottom']]) {
    // The "그 디지몬이 가진 진화원은 파기한다" tail is only ever REMINDER text (sources always go to the trash when a Digimon leaves the battle area this way).
    // Modifiers (Lv./DP/코스트, 레스트·액티브 상태, 진화원 유무, 색, 특징, 가장 …) come from parseTargetMods.
    const tgB = findTgt(t, '상대', '디지몬', String.raw`(?:를|을)?\s*(?:대신\s*)?` + destWord + String.raw`\s*되돌(?:린다|리고)`);
    if (tgB) {
      const filter = { ...(tgB.filter || {}) };
      if (tgB.all) script.push({ op: 'returnToHandStripSources', target: 'opponent', all: true, filter, requireSuspended: null, dest, ...(tgB.excludeSelf ? { excludeSelf: true } : {}) });
      else script.push({ op: 'returnToHandStripSources', target: 'opponent', n: tgB.n, filter, requireSuspended: null, dest, ...(tgB.upTo ? { optional: true } : {}), ...(tgB.excludeSelf ? { excludeSelf: true } : {}) });
      break;
    }
  }

  // Option cards that stay on the field after resolving ("그 후 이 카드를
  // 배틀 에어리어에 놓는다") — the card was provisionally trashed by
  // useOptionCard; this relocates it. Also covers the bare form with no
  // "그 후," lead-in, printed as a whole 【시큐리티】 body by itself — by far
  // the single most common 시큐리티 pattern (60 of 178 via the audit).
  if (/이\s*카드를\s*배틀\s*에어리어에\s*놓는다/.test(t)) {
    script.push({ op: 'placeThisInBattle' });
  }
  // "이 카드를 [특징(으로) 「X」를 가진] 자신의 디지몬 (1마리)의 진화원 아래에 놓는다" (EX7-066/070/071, P-180)
  if ((m = t.match(/이\s*카드를\s*((?:특징(?:으로)?\s*(?:「[^」]+」\/?)+\s*(?:을|를)?\s*가진\s*)?)자신(?:의)?\s*디지몬(?:\s*1\s*마리)?의\s*진화원\s*아래에\s*놓는다/))) {
    script.push({ op: 'placeThisUnderSource', filter: { category: 'digimon', ...(m[1].trim() ? parseCardFilter(m[1] + '디지몬 카드') : {}) } });
  }

  // "이 카드를 패에 추가한다." — a card revealed via security check (or an
  // Option card, after resolving) returns to hand instead of trashing.
  // Second most common 시큐리티 pattern (53 of 178).
  if (/이\s*카드를\s*패(?:에\s*추가|로\s*되돌린)한다|이\s*카드를\s*패로\s*되돌린다/.test(t)) {
    if (/^\s*이\s*카드의\s*【메인】\s*효과를\s*발휘한다\.\s*\S/.test(t)) script.push({ op: 'runOwnMain' });
    script.push({ op: 'addSelfToHand' });
  }

  // "상대의 턴 종료까지 자신의 디지몬 N마리는 배틀에서 소멸하지 않는다."
  // (BT16-018/BT19-023/BT20-022, all 등장 시|진화 시, always N=1) —
  // temporary battle-only destruction immunity on a chosen own Digimon,
  // checked in resolveDigimonBattle (S.grantBattleImmunity).
  if ((m = t.match(/상대(?:의)?\s*턴\s*종료까지\s*자신(?:의)?\s*디지몬\s*(\d+)\s*마리는\s*배틀에서\s*소멸하지\s*않는다/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'grantBattleImmunity', target: 'self' });
  }

  // "자신의 시큐리티를 아래에서부터 N장 패에 추가한다. 그 후, 이 카드를
  // 시큐리티 아래에 앞면으로 놓는다." — MUST push in this order: taking the
  // bottom card(s) to hand has to happen before this card relocates itself
  // to the bottom, or it would immediately pop itself back off.
  if ((m = t.match(/자신(?:의)?\s*시큐리티를?\s*아래에서부터\s*(\d+)\s*장(?:을)?\s*패에\s*추가/))) {
    script.push({ op: 'securityBottomToHand', n: Number(m[1]) });
  }
  if (/이\s*카드를\s*시큐리티\s*아래에\s*앞면으로\s*놓는다/.test(t)) {
    script.push({ op: 'placeThisAtSecurityBottom' });
  }

  // Return a named/trait-matching card from own trash to hand.
  if ((m = t.match(/자신(?:의)?\s*트래시에서,?\s*명칭에\s*「([^」]+)」(?:를|을)?\s*포함하는\s*(?:디지몬\s*)?카드\s*(\d+)?\s*장?(?:을)?\s*패로\s*되돌린다/))) {
    for (let i = 0; i < Number(m[2] || 1); i++) script.push({ op: 'returnFromTrash', who: 'self', filter: { nameIncludes: m[1] } });
  }

  // Same, filtered by color/level/category instead of name — "자신의
  // 트래시에서 퍼플인 Lv.5 이하의 디지몬 카드 1장을 패로 되돌린다/되돌릴 수
  // 있다" (the optional form is handled by ctx.choose returning null).
  if ((m = t.match(/자신(?:의)?\s*트래시에서,?\s*(?:(레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)인\s*)?(?:Lv\.(\d+)\s*이하의\s*)?(디지몬|옵션)\s*카드\s*(\d+)\s*장(?:까지)?(?:를|을)?\s*패(?:로|에)\s*되돌(?:린다|릴\s*수\s*있다)/))) {
    const TRASH_COLOR = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
    const filter = { category: m[3] === '옵션' ? 'option' : 'digimon' };
    if (m[1]) filter.colors = [TRASH_COLOR[m[1]]];
    if (m[2]) filter.levelMax = Number(m[2]);
    for (let i = 0; i < Number(m[4]); i++) script.push({ op: 'returnFromTrash', who: 'self', filter });
  }

  // "상대는 본인의 <패 N장 / 디지몬·테이머 1마리(명) / 시큐리티 위 1장>을 파기·소멸시킬 수 있다. 이 효과로 …하지 않았다면, <효과>"
  if ((m = t.trim().match(/^상대는\s*(?:본인의|스스로의)\s*(패(?:의|에서)?\s*(.*?)\s*(\d+)\s*장|디지몬\/테이머\s*1\s*마리\(명\)|시큐리티를\s*위에서부터\s*1\s*장)(?:을|를)?\s*(?:파기|소멸시킬|파기할|소멸시킬)\s*(?:수\s*있다|할\s*수\s*있다)?\s*(?:수\s*있다)?\.\s*이\s*효과로\s*(?:파기|소멸)하지\s*않았다면,\s*(.+)$/s)) || (m = t.trim().match(/^상대는\s*(?:본인의|스스로의)\s*(패(?:의|에서)?\s*(.*?)\s*(\d+)\s*장|디지몬\/테이머\s*1\s*마리\(명\)|시큐리티를\s*위에서부터\s*1\s*장)(?:을|를)?\s*(?:파기할|소멸시킬)\s*수\s*있다\.\s*이\s*효과로\s*(?:파기|소멸)하지\s*않았다면,\s*(.+)$/s))) {
    const els = compileToScript(m[4]);
    const kind = /^패/.test(m[1]) ? 'discard' : /^디지몬/.test(m[1]) ? 'destroy' : 'security';
    const flt = kind === 'discard' && m[2] ? (parseCardFilter(m[2].replace(/(?:의|에서)\s*$/, '')) || null) : null;
    if (els.length && !(kind === 'discard' && m[2] && !flt)) return [{ op: 'oppMayPay', pay: kind, n: Number(m[3] || 1), filter: flt, else: els }];
  }

  // Any other descriptor ("「X」/「Y」", "특징 「X」를 가진 Lv.N의 디지몬 카드", "명칭에 「X」를 포함하는 옵션 카드").
  if (!script.some(o => o.op === 'returnFromTrash') && (m = t.match(/자신(?:의)?\s*트래시에서,?\s*(.*?)\s*(\d+)\s*장(?:까지)?(?:을|를)?\s*패(?:로|에)\s*되돌(?:린다|릴\s*수\s*있다)/s)) && !/이외|서로\s*다른|마다/.test(m[1])) {
    const qn = m[1].trim().match(/^((?:「[^」]+」\s*(?:과|와|\/)?\s*)+)$/);
    let filter = null;
    if (qn) filter = { exactAny: [...qn[1].matchAll(/「([^」]+)」/g)].map(x => x[1]) };
    else { const desc = m[1].trim().replace(/사용\s*코스트[^,]*?(?:의|인)\s*/, ''); filter = parseCardFilter(desc.replace(/Lv\.(\d+)의\s/, 'Lv.$1 ')); }
    if (filter) for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'returnFromTrash', who: 'self', filter });
  }

  // Set a Digimon's base DP to an absolute value (distinct from a +/- delta).
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리(?:의)?\s*원래\s*DP를\s*(\d+)(?:으로|로)\s*변경/))) {
    script.push({ op: 'setDP', target: 'opponent', value: Number(m[1]), duration: dpDuration });
  }

  // Deck-top trash (non-whole-segment form, e.g. "...할 수 있다" tail as its
  // own clause after other text already consumed above).
  if ((m = t.match(/(?:자신의\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)/)) && !script.some(i => i.op === 'trashDeckTop')) {
    script.push({ op: 'trashDeckTop', who: 'self', n: Number(m[1]) });
  }

  // Attack restriction.
  if (/^이\s*디지몬은\s*어택할\s*수\s*없다[.。]?$/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'self', thisStack: true, expiresAfterTurn: 'permanent' });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리는\s*어택(?:과\s*블록)?을?\s*할\s*수\s*없다/)) || findTgt(t, '상대', '디지몬', String.raw`(?:는|은|가)?\s*(?:,\s*)?어택(?:과\s*블록)?을?\s*할\s*수\s*없다`)) {
    // "(다음) 상대의 턴 종료까지" always means the opponent's coming turn when it is printed on your own turn
    const expires = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'opponentTurn' : /이\s*턴\s*동안|턴\s*종료\s*시?까지/.test(t) ? 'turn' : 'permanent';
    const tgX = findTgt(t, '상대', '디지몬', String.raw`(?:는|은|가)?\s*(?:,\s*)?어택(?:과\s*블록)?을?\s*할\s*수\s*없다`);
    if (tgX && tgX.all) script.push({ op: 'restrictAttack', target: 'opponent', allMatching: true, expiresAfterTurn: expires, ...tgtProps(tgX) });
    else for (let i = 0; i < (tgX?.n || 1); i++) script.push({ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: expires, ...(tgX ? tgtProps(tgX) : {}), ...(tgX?.upTo ? { optional: true } : {}) });
  } else if (/진화원을?\s*갖지\s*않은\s*상대(?:의)?\s*디지몬\s*1\s*마리를?\s*선택한다\.?\s*그\s*디지몬은\s*다음\s*상대(?:의)?\s*턴\s*종료\s*시?까지\s*어택과\s*블록을?\s*할\s*수\s*없다/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'opponent', filter: { hasNoSources: true }, expiresAfterTurn: 'opponentTurn', prompt: '(블록 금지 부분은 수동으로 기억해두세요 — 이 엔진의 자동 블록 판정에는 별도 반영 안 됨)' });
  } else if (/상대는\s*진화원을?\s*갖지\s*않은\s*디지몬으로는\s*어택할\s*수\s*없다/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'opponent', allMatching: true, noEvoSources: true, expiresAfterTurn: 'opponentTurn', prompt: '(주의: 현재 필드의 무진화원 디지몬에만 적용, 이후 새로 등장하는 카드는 수동 확인 필요)' });
  }

  // "플레이어에게 어택할 수 없다." — narrower than the above: can still
  // directly attack a Digimon, just not the player. Always a one-shot
  // temporary grant on the OPPONENT's stack(s) when it reaches compileToScript
  // at all (the bare self-restriction form is a continuous 자신/상대/서로의
  // 턴 ability instead, handled by isAttackPlayerRestrictedByAbility).
  if ((m = t.match(/(?:등장\s*코스트\s*(\d+)\s*(이상|이하)(?:인|의)?\s*)?상대(?:의)?\s*디지몬\s*(전부|\d+\s*마리(?:까지)?)는\s*플레이어에게\s*어택할\s*수\s*없다/))) {
    const filter = {};
    if (m[1]) filter[m[2] === '이상' ? 'costMin' : 'costMax'] = Number(m[1]);
    const expiresAfterTurn = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : (/이\s*턴\s*동안/.test(t) ? 'turn' : 'permanent');
    if (m[3] === '전부') {
      script.push({ op: 'restrictAttackPlayer', target: 'opponent', all: true, filter, expiresAfterTurn });
    } else {
      const n = Number(m[3].match(/\d+/)[0]);
      script.push({ op: 'restrictAttackPlayer', target: 'opponent', n, filter, expiresAfterTurn });
    }
  }

  // "레스트할 수 없다" — the simplest unconditioned forms only; several real
  // prints add an extra prerequisite (a specific card discarded down to no
  // attached cards, no evolution sources, etc.) not attempted here.
  if ((m = t.match(/상대(?:의)?\s*디지몬(\/테이머)?\s*(전부|\d+\s*마리(?:\(명\))?)(?:와|과)?\s*(?:테이머\s*\d+\s*명)?(?:은|는)?\s*레스트할\s*수\s*없다/))) {
    const expiresAfterTurn = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : 'permanent';
    const filter = m[1] ? {} : { category: 'digimon' };
    if (m[2] === '전부') {
      script.push({ op: 'preventRest', target: 'opponent', all: true, filter, expiresAfterTurn });
    } else {
      const n = Number(m[2].match(/\d+/)[0]);
      script.push({ op: 'preventRest', target: 'opponent', n, filter, expiresAfterTurn });
    }
  }

  // "이 디지몬의 DP는 마이너스되지 않는다" — permanent DP-reduction immunity.
  if (/이\s*디지몬(?:의)?\s*DP는\s*마이너스되지\s*않는다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: 'DP감소무효', duration: 'permanent' });
  }

  // Extends direct-attack targeting to also cover ACTIVE opposing Digimon
  // with no evolution sources (base rule 11-2-7-1 only allows targeting
  // RESTED opposing Digimon).
  if (/이\s*디지몬은\s*진화원을?\s*갖지\s*않는\s*액티브\s*상태의\s*상대\s*디지몬에게도\s*어택할\s*수\s*있다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '무진화원액티브공격', duration: 'permanent' });
  } else if (/이\s*디지몬은?[,]?\s*액티브\s*상태의?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다/.test(t)) {
    // Same targeting extension with NO "no evolution sources" restriction
    // at all — the unqualified (and, via the audit, more common) variant.
    const duration = /이\s*턴\s*동안/.test(t) ? 'turn' : 'permanent';
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '액티브공격', duration });
  }
  if (/메모리가\s*상대측\s*1\s*이상일\s*때,?\s*이\s*디지몬은\s*어택할\s*수\s*있다/.test(t)) {
    script.push({ op: 'noop', note: '이 엔진은 메모리 위치로 어택을 제한하지 않아서 조건이 항상 충족됨(데이터 원문 표현 확인 필요)' });
  }

  // Color override ("이 디지몬의 색은 그린으로도 취급한다"). Real prints
  // overwhelmingly spell Yellow as "옐로" (227 occurrences in the card DB vs
  // 1 for "옐로우") — matching only "옐로우" here silently failed on every
  // real card (BT3-014/BT4-017 confirmed). "옐로(?:우)?" accepts both while
  // trying the longer spelling first so "옐로우" isn't left with a stray "우".
  const KOR_COLOR = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
  if ((m = t.match(/이\s*디지몬(?:의)?\s*색은\s*(레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:으로|로)도\s*취급/))) {
    script.push({ op: 'grantColor', color: KOR_COLOR[m[1]] });
  }

  // DP modifier applied to (hidden) security Digimon at check-time.
  if ((m = t.match(/(자신|상대)(?:의)?\s*시큐리티\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'securityDPMod', target: m[1] === '상대' ? 'opponent' : 'self', amount: Number(m[2]), duration: dpDuration });
  } else if ((m = t.match(/(자신|상대)(?:의)?\s*시큐리티\s*디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'securityDPMod', target: m[1] === '상대' ? 'opponent' : 'self', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  }

  // Cost reduction for the NEXT matching evolution.
  if ((m = t.match(/(?:다음에\s*)?그린인\s*자신(?:의)?\s*디지몬이\s*Lv\.(\d+)에서\s*Lv\.(\d+)으로\s*진화할\s*때에?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    script.push({ op: 'evoCostMod', delta: Number(m[3]), filter: { colors: ['green'], fromLevel: Number(m[1]), toLevel: Number(m[2]) }, duration: 'turn' });
  } else if ((m = t.match(/이\s*디지몬이\s*명칭에\s*「([^」]+)」(?:를|을)?\s*포함하는\s*패의\s*디지몬(?:\s*카드)?(?:으로|로)\s*진화할\s*때,?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    script.push({ op: 'evoCostMod', delta: Number(m[2]), filter: { nameIncludes: m[1] }, duration: 'permanent' });
  } else if ((m = t.match(/자신(?:의)?\s*패에서\s*진화하는\s*디지몬과\s*같은\s*색의?\s*디지몬\s*카드\s*1\s*장을?\s*파기하는\s*것으로,?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    // "trash a card of the same color as the evolving Digimon" is a COST for
    // the discount, which our simplified evoCostMod can't require — apply
    // the discount unconditionally and log the omitted cost as a reminder.
    script.push({ op: 'evoCostMod', delta: Number(m[1]), filter: {}, duration: 'turn' });
  }

  // This Digimon's checks against Option cards don't trigger their
  // [SECURITY] effect.
  if (/이\s*디지몬이\s*체크한\s*옵션\s*카드의?\s*(?:【시큐리티】|시큐리티)\s*효과는\s*발휘하지\s*않는다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '옵션시큐리티효과무효', duration: 'permanent' });
  }

  // Bare keyword(s) alone as a segment body ("《관통》", "《블로커》《재밍》", "《S 어택 +1》"): the
  // implicit-grant idiom — this Digimon gains them until end of turn (typically after a leading
  // condition: "자신의 패가 3장 이하라면, 《관통》").
  {
    const KW_BARE = /^(?:[≪《]\s*(블로커|재밍|관통|속공|진격|충돌|길동무|회피|아머\s*퍼지|방벽|스케이프고트|돌진|연계|재기동|(?:S|시큐리티)\s*어택\s*\+\d+)\s*[≫》](?:\s*\([^()]*\))?\s*)+[.。]?$/;
    if (KW_BARE.test(t.trim())) {
      for (const km of t.matchAll(/[≪《]\s*([^≫》]+?)\s*[≫》]/g)) {
        const lab = km[1].replace(/\s+/g, ' ').trim();
        let sm;
        if ((sm = lab.match(/^(?:S|시큐리티)\s*어택\s*\+(\d+)$/))) script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '시큐리티어택', value: Number(sm[1]), duration: 'turn', _bare: true });
        else script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: lab.replace(/\s+/g, ''), duration: 'turn', _bare: true });
      }
    }
  }

  // "《진격》" printed bare, alone, as an entire segment body (BT14-017,
  // EX5-014, BT16-015, BT18-016, LM-039, all 【진화 시】) — the implicit-grant
  // idiom (a keyword name with no "얻는다" wording still means "this card
  // gains it"), distinct from the "X는 《키워드》를 얻는다" phrasing the loop
  // below already covers. 진격 itself has no gating logic in this engine to
  // hook into (declareAttack never restricts by memory position), so this
  // is tracked for consistency/display only, same as the other 5 keywords.
  if (/^[≪《]\s*진격\s*[≫》]$/.test(t.trim())) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '진격', duration: 'turn' });
  }
  // 16-28: 【메인】 "<조건>인 자신의 디지몬 1마리에게 《마인드 링크》" — this Tamer goes under that Digimon's sources (it must have no Tamer card among them).
  if ((m = t.match(/^(.*?)자신의\s*디지몬\s*1\s*마리에게\s*[《≪]\s*마인드\s*링크\s*[》≫]/s))) script.push({ op: 'mindLink', desc: m[1].trim() });
  // 16-16: ≪진격≫ is an executed effect — if memory is on the OPPONENT's side (>= 1), this Digimon may attack.
  // Only unconditional shapes are compiled: the whole segment ("《진격》(…)" bare, or "《진격》(…). <rest>") or a trailing "그 후, 《진격》."
  {
    const RAID = '[《≪]\\s*진격\\s*[》≫]\\s*(?:\\([^()]*\\))?';
    if (new RegExp(`^${RAID}(?:\\s*[.。].*)?$`, 's').test(t.trim()) || new RegExp(`[.。]\\s*그\\s*후,?\\s*${RAID}\\s*[.。]?\\s*$`).test(t.trim())) script.push({ op: 'raid' });
    else {
      // Conditional forms (16-16-2: the condition gates the effect itself): "이 디지몬에게 진화원이 N장 있을 때, 《진격》" (BT10-070),
      // "이 디지몬의 진화원에 <색>인 카드가 있을 때, 《진격》" (BT9-068).
      const cm = t.match(new RegExp(`(?:^|[.。]\\s*)(?:이\\s*디지몬(?:에게|의|은)?\\s*진화원(?:이|에)?\\s*)?(?:(\\d+)\\s*장|(레드|블루|옐로우?|그린|블랙|퍼플|화이트)인\\s*카드가)\\s*있을\\s*때,?\\s*${RAID}`));
      if (cm) script.push(cm[1] ? { op: 'raid', srcMin: Number(cm[1]) } : { op: 'raid', srcColor: S_COLOR_EN[cm[2]] });
    }
  }

  // Blocker / Jamming / Piercing / Rush keyword grants.
  for (const [kw, re] of [['블로커', /[≪《]\s*블로커\s*[≫》]/], ['재밍', /[≪《]\s*재밍\s*[≫》]/], ['관통', /[≪《]\s*관통\s*[≫》]/], ['속공', /[≪《]\s*속공\s*[≫》]/], ['진격', /[≪《]\s*진격\s*[≫》]/], ['충돌', /[≪《]\s*충돌\s*[≫》]/], ['길동무', /[≪《]\s*길동무\s*[≫》]/], ['방벽', /[≪《]\s*방벽\s*[≫》]/], ['아머퍼지', /[≪《]\s*아머\s*퍼지\s*[≫》]/], ['회피', /[≪《]\s*회피\s*[≫》]/], ['스케이프고트', /[≪《]\s*스케이프고트\s*[≫》]/], ['불굴', /[≪《]\s*불굴\s*[≫》]/], ['돌진', /[≪《]\s*돌진\s*[≫》]/], ['연계', /[≪《]\s*연계\s*[≫》]/], ['재기동', /[≪《]\s*재기동\s*[≫》]/]]) {
    if (re.test(t) && /(얻는다|[를을]\s*얻|얻고|준다|주고|부여)/.test(t) && new RegExp(re.source + String.raw`(?:[^.。「]|「[^」]*」)*?(?:얻|준다|주고|부여)`).test(t)) {
      const duration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'opponentTurn' : 'turn';
      const gsK = grantSubject(t);
      if (gsK) script.push(...subjectOps(gsK, (sub) => ({ op: 'grantKeyword', ...sub, keyword: kw, duration })));
      else {
        const thisStack = /이\s*디지몬(?:은|이)/.test(t) && !/자신(?:의)?\s*디지몬\s*\d+\s*마리/.test(t);
        script.push({ op: 'grantKeyword', target: 'self', thisStack, keyword: kw, duration });
      }
    }
  }

  // "《K》를 얻고, DP +N" / "《K》를 주고, DP -N": the DP part of a keyword-granting sentence (same subject)
  { const gsD = script.some(o => o.op === 'grantKeyword') ? grantSubject(t) : null;
    const dpa = gsD && gsD.sn.match(/(?:얻는다|얻고|준다|주고)\s*,?\s*(?:및\s*)?DP\s*([+-]\s*\d+)/);
    if (dpa && !script.some(o => o.op === 'modifyDP' && o.amount === Number(dpa[1].replace(/\s+/g, '')))) {
      const dur = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'opponentTurn' : 'turn';
      const amount = Number(dpa[1].replace(/\s+/g, ''));
      script.push(...subjectOps(gsD, (sub) => ({ op: gsD.all ? 'modifyDPAll' : 'modifyDP', ...sub, amount, duration: dur })));
    } }

  { const x13 = compileS13(t); script.push(...x13.ops); if (x13.exclSame) for (const o of script) if (o.op === 'playFree') o.exclSame = x13.exclSame; }
  for (const dm of delayed) {
    const self = /^이\s*디지몬$/.test(dm[2].trim());
    const inner = /소멸/.test(dm[3]) ? { op: 'destroy', target: 'self', mode: self ? 'thisStack' : 'last' } : { op: 'returnToHandStripSources', target: 'self', last: !self, thisStack: self, n: 1, filter: {}, requireSuspended: null, dest: /덱/.test(dm[3]) ? 'deckBottom' : 'hand' };
    script.push({ op: 'atTurnEnd', when: /상대/.test(dm[1]) ? 'opp' : 'this', then: [inner] });
  }
  // "…한 뒤 이 디지몬을 소멸시킨다" runs after everything else that needs the source stack.
  // The same keyword can be reached by several patterns (bare-keyword idiom + "얻는다" loops) — grant once.
  const hasBare = script.some(o => o._bare);
  const seenGrant = new Set();
  const uniq = script.filter(o => {
    if (hasBare && o.op === 'grantKeyword' && !o._bare) return false;
    if (o.op !== 'grantKeyword') return true;
    const key = JSON.stringify([o.keyword, o.value, o.thisStack, o.target, o.duration]);
    if (seenGrant.has(key)) return false;
    seenGrant.add(key); return true;
  });
  return [...uniq.filter(o => !o.deferLast), ...uniq.filter(o => o.deferLast)];
}

// ---- leading conditions ("<조건>라면/다면, <효과>") ----
// ~420 compiled effects print a condition first; the action patterns below match
// the action clause alone, so those effects used to run UNCONDITIONALLY. The
// condition is now parsed into a runtime predicate and wraps the compiled action;
// a leading condition we can't evaluate makes the whole segment manual (safer
// than silently applying it).
const NUM_CMP = (n, cmp) => (v) => cmp === '이하' ? v <= n : v >= n;

function parseConditionText(c) {
  c = c.trim().replace(/[,\s]+$/, '');
  let m;
  const own = (ctx) => ctx.state.players[ctx.self];
  const opp = (ctx) => ctx.state.players[ctx.opp];
  const mem = (ctx) => (ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory);
  const stackOf = (ctx) => own(ctx).battle.find(s => s.uid === ctx.sourceStackUid) || (own(ctx).raising?.uid === ctx.sourceStackUid ? own(ctx).raising : null);
  const cat = (ctx, id) => ctx.S.card(id)?.category;
  const digimonCount = (ctx, pl) => pl.battle.filter(s => cat(ctx, s.cardId) === 'digimon').length;
  // Descriptor predicate resolved at run time (effects.js has no state import); an
  // unparsable descriptor makes the condition false and says so in the log.
  { const cc = c.match(/^(.+?(?:있|없|이|가지|포함하))(거나|고|며),\s*(.+)$/);
    if (cc) {
      const endM = { '있': '있다면', '없': '없다면', '이': '이라면', '가지': '가진다면', '포함하': '포함한다면' };
      const key = Object.keys(endM).find(k => cc[1].endsWith(k));
      const t1 = key ? parseConditionText(cc[1].slice(0, -key.length) + endM[key]) : null, t2 = parseConditionText(cc[3]);
      if (t1 && t2) return cc[2] === '거나' ? async (ctx) => !!(await t1(ctx)) || !!(await t2(ctx)) : async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx));
    } }
  const descPred = (ctx, desc) => { const pr = ctx.S.cardDescPredicate(desc); if (!pr) ctx.S.log(ctx.state, `조건 "${desc}"을(를) 판정할 수 없어 효과를 건너뜀 (수동 확인)`); return pr; };
  if ((m = c.match(/^(?:자신의\s*)?메모리가\s*(-?\d+)\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(mem(ctx)); }
  if ((m = c.match(/^메모리가\s*상대\s*쪽의\s*(\d+)\s*이상(?:이)?라면$/))) return (ctx) => -mem(ctx) >= Number(m[1]);
  if ((m = c.match(/^상대의\s*디지몬이\s*(있다면|없다면)$/))) return (ctx) => (digimonCount(ctx, opp(ctx)) > 0) === (m[1] === '있다면');
  if ((m = c.match(/^자신의\s*테이머가\s*(\d+)\s*명\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(own(ctx).battle.filter(s => cat(ctx, s.cardId) === 'tamer').length); }
  if ((m = c.match(/^자신의\s*테이머가\s*(있다면|없다면)$/))) return (ctx) => (own(ctx).battle.some(s => cat(ctx, s.cardId) === 'tamer')) === (m[1] === '있다면');
  // zone sizes: "자신/상대의 패/트래시/시큐리티가 N장 이하/이상(이라면|있다면)"
  if ((m = c.match(/^(자신|상대)의\s*(패|트래시|시큐리티)(?:가|에)?\s*(\d+)\s*장\s*(이하|이상)(?:이)?(?:라면|\s*있다면)$/))) {
    const f = NUM_CMP(Number(m[3]), m[4]); const who = m[1]; const zone = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security' }[m[2]];
    return (ctx) => f((who === '자신' ? own(ctx) : opp(ctx))[zone].length);
  }
  // board counts: "자신/상대의 디지몬/테이머가 N마리·명·장 이하/이상(이라면|있다면)"
  if ((m = c.match(/^(자신|상대)의\s*(디지몬|테이머)(?:가|이)?\s*(\d+)\s*(?:마리|명|장)\s*(이하|이상)(?:이)?(?:라면|\s*있다면)$/))) {
    const f = NUM_CMP(Number(m[3]), m[4]); const who = m[1], kind = m[2] === '테이머' ? 'tamer' : 'digimon';
    return (ctx) => f((who === '자신' ? own(ctx) : opp(ctx)).battle.filter(s => cat(ctx, s.cardId) === kind).length);
  }
  if ((m = c.match(/^상대의\s*(디지몬|테이머)(?:가|이)?\s*(있다면|없다면)$/))) {
    const kind = m[1] === '테이머' ? 'tamer' : 'digimon';
    return (ctx) => opp(ctx).battle.some(s => cat(ctx, s.cardId) === kind) === (m[2] === '있다면');
  }
  if ((m = c.match(/^자신의\s*디지몬이\s*없다면$/))) return (ctx) => !own(ctx).battle.some(s => cat(ctx, s.cardId) === 'digimon');
  if ((m = c.match(/^(?:자신의\s*)?다른\s*(?:자신의\s*)?디지몬이\s*(있다면|없다면)$/))) return (ctx) => own(ctx).battle.some(s => cat(ctx, s.cardId) === 'digimon' && s.uid !== ctx.sourceStackUid) === (m[1] === '있다면');
  // presence / count of a described Digimon or Tamer on either side ("진화원을 갖지 않은 상대의 디지몬이 있다면", "레스트 상태인 상대의 디지몬이 N마리 이상 있다면", "C인 자신의 테이머가 N명 이상 …")
  if ((m = c.match(/^(.*?)\s*(자신|상대)(?:의)?\s*(다른\s*)?(디지몬\/테이머|디지몬|테이머)(?:가|이)?\s*(?:(\d+)\s*(?:마리|명)\s*(이상|이하)?\s*)?(있다면|없다면)$/)) && m[1].trim()) {
    const mods = parseTargetMods(m[1]);
    if (!mods._left && Object.keys(mods).length && !mods.extreme) {
      const side = m[2] === '상대' ? 'opp' : 'own', has = m[7] === '있다면', nn = m[5] ? Number(m[5]) : 1, cmpU = m[6] === '이하' ? 'le' : 'ge', anyKind = m[4] !== '디지몬', other = !!m[3];
      const fl = m[4] === '테이머' ? { ...mods, category: 'tamer' } : mods; // 「…인 자신의 테이머가 있다면」 counts TAMERS only (anyKind alone also counted Digimon)
      return (ctx) => { const cnt = candidateStacks(ctx, side === 'own' ? ctx.self : ctx.opp, { filter: fl, anyKind, excludeSelf: other }).length; const ok = cmpU === 'le' ? cnt <= nn : cnt >= nn; return has ? ok : !(cnt >= 1); };
    }
  }
  // "이 디지몬의 진화원에 <descriptor> 카드가 있다면 / 이 디지몬에게 진화원이 N장 있다면"
  if ((m = c.match(/^이\s*디지몬(?:의\s*진화원(?:에|\s*중)|에게\s*진화원이)\s*(.+?)(?:가|이)\s*(있다면|없다면)$/)) && !/^(?:「[^」]+」\/?)+$/.test(m[1].trim())) {
    const desc = m[1].trim(); const has = m[2] === '있다면';
    let nm;
    if ((nm = desc.match(/^(\d+)\s*장$/))) return (ctx) => { const st = stackOf(ctx); return !!st && (st.sources.length >= Number(nm[1])) === has; };
    const parts = desc.split(/\s+또는\s+/).map(x => x.trim());
    const fl = parts.map(pt => /^(?:「[^」]+」\s*\/?\s*)+$/.test(pt) ? { nameAny: [...pt.matchAll(/「([^」]+)」/g)].map(x => x[1]) } : strictCardFilter(/카드$/.test(pt) ? pt : pt + ' 카드'));
    if (fl.every(Boolean)) { const flt = fl.length === 1 ? fl[0] : { anyOf: fl }; return (ctx) => { const st = stackOf(ctx); return !!st && st.sources.some(id => matchesFilter(ctx.S, id, flt)) === has; }; }
  }
  // "자신/상대의 트래시에 <descriptor> 카드가 (N장 이상) 있다면"
  if ((m = c.match(/^(자신|상대)의\s*(트래시|패)에\s*(.+?)\s*카드(?:가|이)\s*(?:(\d+)\s*장\s*(이상|이하)?\s*)?(있다면|없다면)$/))) {
    const fz = strictCardFilter(m[3] + ' 카드'); const zone = m[2] === '패' ? 'hand' : 'trash', side = m[1] === '상대' ? 'opp' : 'own', nn = m[4] ? Number(m[4]) : 1, le = m[5] === '이하', has = m[6] === '있다면';
    if (fz) return (ctx) => { const pl = side === 'own' ? own(ctx) : opp(ctx); const cnt = pl[zone].filter(id => matchesFilter(ctx.S, id, fz)).length; const ok = le ? cnt <= nn : cnt >= nn; return has ? ok : cnt === 0; };
  }
  // "이 디지몬의 DP가 N 이상이라면" / "이 디지몬이 DP N 이상이라면" / "N색 이상이라면"
  if ((m = c.match(/^이\s*디지몬(?:의\s*DP가|이\s*DP)\s*(\d+)\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => { const st = stackOf(ctx); return !!st && f(ctx.S.effectiveDP(ctx.state, ctx.self, st)); }; }
  if ((m = c.match(/^(\d+)\s*색\s*이상(?:이)?라면$/))) return (ctx) => { const st = stackOf(ctx); return !!st && (ctx.S.card(st.cardId).colors || []).length >= Number(m[1]); };
  // exact counts: "자신의 시큐리티가 N장이라면", "이 디지몬의 진화원이 N장이라면"
  if ((m = c.match(/^(자신|상대)의\s*(패|트래시|시큐리티)(?:가|에)?\s*(\d+)\s*장(?:이)?라면$/))) { const zone = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security' }[m[2]], who = m[1]; return (ctx) => (who === '자신' ? own(ctx) : opp(ctx))[zone].length === Number(m[3]); }
  if ((m = c.match(/^이\s*디지몬의\s*진화원이\s*(\d+)\s*장(?:이)?라면$/))) return (ctx) => { const st = stackOf(ctx); return !!st && st.sources.length === Number(m[1]); };
  // several named cards: "자신의 「A」와 「B」가 있다면"
  if ((m = c.match(/^자신의\s*「([^」]+)」(?:와|과)\s*「([^」]+)」(?:가|이)\s*(있다면|없다면)$/))) return (ctx) => ([m[1], m[2]].every(n => own(ctx).battle.some(s => ctx.S.effectiveInfo(ctx.state, s).nameIs(n)))) === (m[3] === '있다면');
  // results of the previous instruction of the same effect ("이 효과로 …소멸/파기/등장/추가/레스트/되돌 …했다면 / 하지 않았다면")
  if ((m = c.match(/^이\s*효과로\s*(.*?)(소멸|파기|등장|추가|레스트|되돌)[^,]*?(했|않았|시켰|되었|하지\s*않았)[^,]*?(?:다면|을\s*때)$/))) {
    const field = { 소멸: 'deleted', 파기: 'discarded', 등장: 'played', 추가: 'added', 레스트: 'rested', 되돌: 'bounced' }[m[2]], neg = /않았/.test(c);
    return (ctx) => { const v = (ctx._res?.[field] || 0) > 0; return neg ? !v : v; };
  }
  // presence with a descriptor: "<색/명칭/특징 조건> 자신의 디지몬/테이머가 있다면/없다면", "자신의 「A」/「B」가 있다면"
  if ((m = c.match(/^(.*?)\s*자신의\s*(디지몬|테이머|디지몬\/테이머)(?:가|이)?\s*(있다면|없다면)$/)) && m[1].trim()) {
    const desc = m[1].trim(), kinds = m[2] === '테이머' ? ['tamer'] : m[2] === '디지몬' ? ['digimon'] : ['digimon', 'tamer'], has = m[3] === '있다면';
    return (ctx) => { const pr = descPred(ctx, desc); return !!pr && (own(ctx).battle.some(s => kinds.includes(cat(ctx, s.cardId)) && pr(ctx.S.card(s.cardId)))) === has; };
  }
  if ((m = c.match(/^자신의\s*((?:「[^」]+」\/?)+)(?:가|이)\s*(있다면|없다면)$/))) {
    const l = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    return (ctx) => own(ctx).battle.some(s => l.includes(ctx.S.card(s.cardId).nameKo)) === (m[2] === '있다면');
  }
  if ((m = c.match(/^이\s*디지몬이\s*「([^」]+)」(?:이)?라면$/))) return (ctx) => { const st = stackOf(ctx); return !!st && ctx.S.effectiveInfo(ctx.state, st).nameIs(m[1]); };
  if ((m = c.match(/^이\s*디지몬의\s*진화원이\s*(\d+)\s*장\s*(이하|이상)(?:이)?(?:라면|\s*있다면)$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => { const st = stackOf(ctx); return !!st && f(st.sources.length); }; }
  if (/^이\s*디지몬이\s*다색(?:이)?라면$/.test(c)) return (ctx) => { const st = stackOf(ctx); return !!st && (ctx.S.card(st.cardId).colors || []).length >= 2; };
  if ((m = c.match(/^이\s*디지몬이\s*(\d+)\s*색\s*이상(?:이)?라면$/))) return (ctx) => { const st = stackOf(ctx); return !!st && (ctx.S.card(st.cardId).colors || []).length >= Number(m[1]); };
  if ((m = c.match(/^서로의\s*시큐리티\s*합계가\s*(\d+)\s*장\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(own(ctx).security.length + opp(ctx).security.length); }
  if ((m = c.match(/^이\s*디지몬의\s*진화원에\s*((?:「[^」]+」\/?)+)(?:이|가)\s*있다면$/))) {
    const l = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
    return (ctx) => { const st = stackOf(ctx); return !!st && st.sources.some(id => { const cd = ctx.S.card(id); return l.some(n => ctx.S.cardNameHas(cd, n) || (cd.types || []).includes(n)); }); };
  }
  if (/^조그레스\s*진화\s*하고\s*있었다면$/.test(c)) return (ctx) => !!stackOf(ctx)?.viaFusion;
  // 7-2-2-9/10: "디지크로스하고 있었다면" / "N장 디지크로스하고 있었다면" — stack.xrosCount = cards actually placed under by DigiXros
  if ((m = c.match(/^(?:(\d+)\s*장\s*)?디지크로스\s*하고\s*있었(?:다면|을\s*때)$/))) { const n = Number(m[1] || 1); return (ctx) => (stackOf(ctx)?.xrosCount || 0) >= n; }
  if (/^이\s*효과로\s*소멸하지\s*않았다면$/.test(c)) return (ctx) => ctx._lastDestroyed === false;
  if (/^이\s*효과로\s*소멸했다면$/.test(c)) return (ctx) => ctx._lastDestroyed === true;
  if ((m = c.match(/^이\s*디지몬(?:이|의\s*레벨이)\s*Lv\.(\d+)\s*(이하|이상)?(?:이)?라면$/))) { const lv = Number(m[1]), mode = m[2]; return (ctx) => { const st = stackOf(ctx); const L = st ? (ctx.S.card(st.cardId).level ?? 0) : -1; return mode === '이하' ? L <= lv : mode === '이상' ? L >= lv : L === lv; }; }
  if (/^자신의\s*턴이라면$/.test(c)) return (ctx) => ctx.state.activePlayer === ctx.self;
  if (/^상대의\s*턴이라면$/.test(c)) return (ctx) => ctx.state.activePlayer !== ctx.self;
  if (/^이\s*(?:디지몬|테이머)(?:이|가)\s*레스트\s*상태(?:이)?라면$/.test(c)) return (ctx) => !!stackOf(ctx)?.suspended;
  if (/^이\s*(?:디지몬|테이머)(?:이|가)\s*액티브\s*상태(?:이)?라면$/.test(c)) return (ctx) => { const st = stackOf(ctx); return !!st && !st.suspended; };
  if ((m = c.match(/^이\s*디지몬(?:이|에게|에)\s*(.+?)(?:가진다면|포함한다면|기술되어\s*있다면)$/))) {
    const kind = /가진다면$/.test(c) ? 'trait' : /포함한다면$/.test(c) ? 'name' : 'desc';
    const body = m[1].trim();
    if (/^《/.test(body)) { const kw = body.replace(/[《》≪≫]/g, '').replace(/\s*(?:을|를|이|가)\s*$/, '').trim(); return (ctx) => { const st = stackOf(ctx); if (!st) return false; const cd = ctx.S.card(st.cardId); return `${cd.effectKo || ''}\n${cd.inheritedKo || ''}`.includes(`《${kw}`); }; }
    const descText = kind === 'trait' ? body.replace(/\s*(?:를|을)\s*$/, '') + ' 가진' : kind === 'name' ? body.replace(/\s*(?:를|을)\s*$/, '') + ' 포함하는' : body.replace(/(?:이|가)\s*$/, '') + ' 기술되어 있는';
    return (ctx) => { const st = stackOf(ctx); if (!st) return false; const pr = descPred(ctx, descText); return !!pr && pr(ctx.S.card(st.cardId)); };
  }
  if ((m = c.match(/^(?:(.+?)\s+)?자신의\s*디지몬이\s*있다면$/))) {
    const desc = m[1] ? m[1].replace(/\s*(?:를|을)\s*$/, '').trim() + ' 가진' : null;
    return (ctx) => { const pr = desc ? descPred(ctx, desc) : () => true; return !!pr && own(ctx).battle.some(s => cat(ctx, s.cardId) === 'digimon' && pr(ctx.S.card(s.cardId))); };
  }
  if ((m = c.match(/^자신의\s*「([^」]+)」(?:가|이)\s*(있다면|없다면)$/))) return (ctx) => (own(ctx).battle.some(s => ctx.S.effectiveInfo(ctx.state, s).nameIs(m[1]))) === (m[2] === '있다면');
  return null;
}

// ---- "<비용>하는 것으로, <효과>" ----
// 542 compiled effects begin with a cost clause. The old pattern scan ran the effect
// (often BEFORE the cost, and even when the cost couldn't be paid). The cost is now
// compiled on its own, must be payable, and is executed first.
const COST_OPS = new Set(['trashHand', 'removeSecurity', 'restStack', 'destroy']);

function normalizeCost(c) {
  return c.trim().replace(/파기하는$/, '파기한다').replace(/소멸\s*시키는$/, '소멸시킨다').replace(/레스트\s*시키는$/, '레스트시킨다').replace(/되돌리는$/, '되돌린다').replace(/추가하는$/, '추가한다');
}

// A card descriptor ("특징 「X」를 가진 카드", "명칭에 「X」를 포함하거나 특징 「Y」를 가진 카드") -> matchesFilter filter, or null when
// some part of it isn't understood (so callers never silently widen a restriction).
function strictCardFilter(desc) {
  desc = desc.trim().replace(/,\s*$/, '').replace(/Lv\.\s+(\d)/g, 'Lv.$1').replace(/」\s*(?:또는|이나)\s*「/g, '」/「');
  if (/^(?:「[^」]+」\s*(?:\/|또는|과|와)?\s*)+$/.test(desc)) return { exactAny: [...desc.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
  if (/^(?:디지몬\s*|테이머\s*|옵션\s*)?카드$/.test(desc) && !/디지몬|테이머|옵션/.test(desc)) return {};
  let f = parseCardFilter(desc);
  if (!f && /거나|또는/.test(desc)) {
    const tailM = desc.match(/((?:디지몬|테이머|옵션)?\s*카드)$/); const tail = tailM ? ' ' + tailM[1] : '';
    const parts = desc.replace(/((?:디지몬|테이머|옵션)?\s*카드)$/, '').split(/(?<=포함하|가진|가지|갖|있|하)거나\s*|\s+또는\s+(?=특징|명칭|「)/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) { const fs = parts.map(p => parseCardFilter(p.replace(/(포함하|가지|갖)$/, '$1는') + tail)); if (fs.every(Boolean)) f = { anyOf: fs }; }
  }
  if (!f) return null;
  const rest = desc.replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\/?)+\s*(?:을|를)?\s*(?:가진|가지는|갖는|포함하는)?/g, '').replace(/명칭에\s*(?:「[^」]+」\/?)+\s*(?:을|를)?\s*포함하(?:는|거나)?/g, '')
    .replace(/(?:「[^」]+」\/?)+\s*(?:이|가)\s*기술되어\s*있(?:는|거나)?/g, '').replace(/^\s*(?:「[^」]+」\/?)+\s*(?:을|를)\s*포함하는/, '').replace(/《[^》]+》\s*(?:을|를)\s*(?:가진|갖는)/g, '').replace(/《[^》]+》\s*(?:이|가)\s*기술되어\s*있(?:는|거나)?/g, '')
    .replace(/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*(?:인|의)/g, '').replace(/Lv\.\d+\s*(?:이하|이상)?(?:의|인)?/g, '')
    .replace(/(?:사용|등장)?\s*코스트\s*\d+\s*(?:이하|이상)(?:의|인)?/g, '').replace(/(?:사용|등장)\s*코스트\s*\d+(?:의|인)/g, '').replace(/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:을|를)\s*포함하는\s*\d\s*색(?:의|인)?/g, '').replace(/DP\s*\d+\s*(?:이하|이상)(?:의|인)?/g, '')
    .replace(/디지몬|테이머|옵션|카드|디지타마|또는|거나|[의인을를이가은는,\s]/g, '');
  return /[가-힣]/.test(rest) ? null : f;
}

// One cost clause ("…하는 것으로," part) -> cost ops. Anything not automatable becomes a manualCost the player must confirm.
function compileCostClause(raw) {
  const c = normalizeCost(raw.replace(/^그\s*후,?\s*/, '')).replace(/레스트\s*시킨다$/, '레스트시킨다').replace(/[.。]$/, '');
  let m;
  if (/거나/.test(c.replace(/「[^」]*」/g, '')) && !/(?:가지|갖|포함하|있)거나/.test(c)) return [{ op: 'manualCost', text: raw.trim() }];
  if ((m = c.match(/^이\s*(?:테이머|디지몬)(?:을|를)\s*레스트시킨다$/))) return [{ op: 'restStack' }];
  if (/^이\s*디지몬을\s*소멸시킨다$/.test(c)) return [{ op: 'destroy', target: 'self', mode: 'thisStack' }];
  if (/^이\s*디지몬을\s*액티브로\s*(?:한다|하는)$/.test(c)) return [{ op: 'unsuspend', target: 'thisStack', asCost: true }];
  { const tgD = findTgt(c, '자신', '디지몬', String.raw`(?:를|을)?\s*소멸시킨다$`);
    if (tgD && !tgD.all && tgD.n && !/[가-힣「]/.test(tgD.left)) return Array.from({ length: tgD.n }, () => ({ op: 'destroy', target: 'self', mode: 'choose', ...tgtProps(tgD) }));
    const tgR = findTgt(c, '자신', String.raw`디지몬(?:\/테이머)?`, String.raw`(?:를|을)?\s*레스트시킨다$`);
    if (tgR && !tgR.all && tgR.n && !/[가-힣「]/.test(tgR.left)) return [{ op: 'rest', target: 'self', n: tgR.n, ...(/테이머/.test(tgR.noun) ? {} : { digimonOnly: true }), filter: { ...(tgR.filter || {}), suspended: false }, ...(tgR.excludeSelf ? { excludeSelf: true } : {}) }]; }
  if ((m = c.match(/^메모리(?:를|을)?\s*-\s*(\d+)\s*(?:한다|하는)?$/))) return [{ op: 'gainMemory', who: 'self', n: -Number(m[1]) }];
  if ((m = c.match(/^(\d+)\s*코스트\s*지불(?:한다|하는)?$/))) return [{ op: 'gainMemory', who: 'self', n: -Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*패(?:를)?\s*(\d+)\s*장(?:을|를)?\s*파기한다$/))) return [{ op: 'trashHand', who: 'self', n: Number(m[1]) }];
  if ((m = c.match(/^(.*?)(?:을|를)\s*자신(?:의)?\s*패에서\s*(\d+)\s*장(?:을|를)?\s*파기한다$/)) || (m = c.match(/^자신(?:의)?\s*패에서,?\s*(.*?)\s*(\d+)\s*장(?:을|를)?\s*파기한다$/))) {
    const f = strictCardFilter(m[1]);
    if (f) return [{ op: 'trashHand', who: 'self', n: Number(m[2]), ...(Object.keys(f).length ? { filter: f } : {}) }];
  }
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*위에서부터\s*(\d+)\s*장\s*패에\s*추가한다$/))) return [{ op: 'securityTopToHand', who: 'self', n: Number(m[1]) }];
  if ((m = c.match(/^이\s*디지몬의\s*진화원을\s*(?:선택하여\s*)?(\d+)\s*장\s*파기한다$/))) return [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: Number(m[1]), choose: true }];
  if ((m = c.match(/^자신(?:의)?\s*(패|트래시)(?:의|에서),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)\s*(원하는\s*순서대로\s*)?덱\s*아래로\s*되돌린다$/))) { // "자신의 트래시에서 「A」와 「B」 1장씩을 덱 아래로 되돌리는 것으로": one card per criterion
    const gs = parsePickGroups(`${m[2]} 1장씩`);
    if (gs) return [{ op: 'moveEach', who: 'self', from: [m[1] === '패' ? 'hand' : 'trash'], groups: gs, dest: 'deckBottom', ordered: !!m[3], required: true }];
  }
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*(위|아래)에서부터\s*(\d+)\s*장\s*파기한다$/))) return Array.from({ length: Number(m[2]) }, () => ({ op: 'removeSecurity', who: 'self', position: m[1] === '아래' ? 'bottom' : 'top' }));
  return [{ op: 'manualCost', text: raw.trim() }];
}

function compileWithCost(text) {
  const inner = compileInner(text);
  const t = text.trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  const cmM = t.replace(/Lv\./g, 'Lv'); // masked so the "." of Lv. isn't taken for a sentence end
  const cm = cmM.match(/^([^.。\n《≪]{2,90}?)\s*것으로,?\s*(.+)$/s);
  if (cm) { cm[1] = cm[1].replace(//g, '.'); cm[2] = cm[2].replace(//g, '.'); }
  if (!cm) {
    // the cost may open a LATER sentence ("…한다. 그 후, <비용>하는 것으로, <효과>"): compile the earlier sentences on their own
    const sents = splitSentences(t);
    const k = sents.findIndex(x => /것으로,?\s*\S/.test(x));
    if (k > 0 && !/오픈|공개|〈룰〉/.test(sents.slice(0, k).join(' ')) && !inner.some(x => x.op === 'costGroup' || x.op === 'condition')) {
      const rest = compileWithCost(sents.slice(k).join(' '));
      if (rest.length && rest.some(x => x.op === 'costGroup')) return [...compileToScript(sents.slice(0, k).join(' ')), ...rest];
    }
    return inner;
  }
  if (inner.some(x => x.op === 'costGroup')) return inner;
  // "〈룰〉 …" reminder lines and replacement-style costs ("…하는 것으로, 벗어나지 않는다") aren't costs of a following effect
  if (/^〈룰〉/.test(cm[1].trim()) || /^(?:벗어나지|소멸하지|파기되지)\s*않는다/.test(cm[2].trim())) return inner;
  let eff = /^이하의\s*효과\s*(?:에서|중)|(?:라면|다면|때|경우)\s*,/.test(cm[2].trim()) || splitSentences(cm[2].trim()).length > 1 ? compileToScript(cm[2]) : compileInner(cm[2]); // whole effect text (effectChoice / later conditional sentences)
  if (!eff.length) eff = [{ op: 'noop', note: `효과를 수동으로 처리하세요: ${cm[2].replace(/\([^()]*\)/g, '').slice(0, 120)}` }];
  const costOps = compileCostClause(cm[1]);
  if (!costOps.length) return inner;
  return [{ op: 'costGroup', cost: costOps, then: eff }];
}

// Later sentences that open with a condition ("…한다. 그 후, <조건>라면, <효과>" / "<조건>일 때, 대신 <효과>" / "이 효과로 소멸하지 않았다면, …"):
// everything before it compiles unconditionally; the conditional sentence is wrapped in a condition op ("대신" = replaces the previous sentence).
// "…있을 때 / …이하일 때 / …포함할 때 / …가질 때" (state conditions written with 때) -> the "…라면" forms parseConditionText knows
// a condition we can't evaluate asks the player instead (never runs the gated effect blindly, never silently drops it)
function manualCondition(label) { const f = (ctx) => ctx.choose('confirmEffect', { player: ctx.self, prompt: `조건 확인(수동): ${label} — 충족합니까?` }); f.manualLabel = label; return f; }
function normCondText(cond) {
  return cond.replace(/\s+/g, ' ').trim().replace(/경우$/, '때').replace(/\s*있을\s*때$/, ' 있다면').replace(/\s*없을\s*때$/, ' 없다면').replace(/\s*이하일\s*때$/, ' 이하라면').replace(/\s*이상일\s*때$/, ' 이상이라면')
    .replace(/^(이\s*효과로.*?)\s*(않았|했)을\s*때$/, '$1 $2다면').replace(/\s*(?:가질|가지고\s*있을|갖고\s*있을)\s*때$/, ' 가진다면').replace(/\s*(?:포함할|포함하고\s*있을)\s*때$/, ' 포함한다면').replace(/\s*기술되어\s*있을\s*때$/, ' 기술되어 있다면').replace(/(\S)\s*일\s*때$/, '$1이라면');
}
// (kept below normCondText)
function condTestFor(cond) {
  const cn = normCondText(cond);
  return parseConditionText(cn) || manualCondition(cond);
}
function compileSentenceConds(text, allowFirst = false) {
  if (/\n\s*·/.test(text)) return null;
  const un = (x) => x.replace(/\uE000/g, '.');
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  if (sents.length < 2) return null;
  const CONDRE = /^(?:(?:그\s*후|또한),?\s*)?((?:[^,.。\n]{2,80}?(?:거나|고|며),\s*)?[^,.。\n]{2,80}?(?:라면|다면|(?:있을|없을|이하일|이상일|않았을|일|적을|많을|가질|같을|다를|포함할|가지고\s*있을|갖고\s*있을|기술되어\s*있을)\s*(?:때|경우)))(?:,\s*|\s+)(.+)$/s;
  const REPRE = /^(?:(?:그\s*후|또한),?\s*)?(.+?(?:라면|다면|(?:있을|없을|않았을)\s*때)),?\s*((?:그\s*)?대신에?,?\s*.+)$/s; // long conditions containing commas, always followed by "대신"
  const conds = sents.map((x, i) => ((i > 0 || allowFirst) && !/^그\s*카드가[^.]*(?:라면|다면),?\s*패에\s*추가한다/.test(x) ? (x.replace(/Lv\./g, 'Lv\uE000').match(CONDRE) || x.replace(/Lv\./g, 'Lv\uE000').match(REPRE)) : null));
  if (!conds.some(Boolean) || (allowFirst && conds.filter(Boolean).length < 2)) return null;
  const out = []; let buf = [];
  const flush = () => { if (buf.length) out.push(...compileToScript(buf.join(' '))); buf = []; };
  for (let i = 0; i < sents.length; i++) {
    const cm = conds[i];
    if (!cm) { buf.push(sents[i]); continue; }
    const test = condTestFor(un(cm[1]));
    const body = un(cm[2]);
    if (/^(?:그\s*)?대신에?,?\s*/.test(body)) {
      const last = buf.pop();
      flush();
      out.push({ op: 'condition', if: { test }, then: compileToScript(body.replace(/^(?:그\s*)?대신에?,?\s*/, '')), else: last ? compileToScript(last) : [] });
    } else {
      flush();
      const thenOps = compileToScript(body);
      if (thenOps.length) out.push({ op: 'condition', if: { test }, then: thenOps, else: [] });
    }
  }
  flush();
  return out.length ? out : null;
}

// A flat script whose ops come from several sentences is emitted in code-scan order, not printed order ("레스트시킬 수 있다. 그 후, …소멸시킨다" ran
// destroy first). When compiling each sentence on its own yields exactly the same ops, use the printed order.
function reorderBySentences(text, script) {
  if (script.length < 2 || script.some(x => ['costGroup', 'condition', 'effectChoice', 'afterBattle', 'oppMayPay', 'setMemoryIfLE'].includes(x.op) || x.deferLast)) return script;
  text = text.replace(/\n?〈룰〉.*$/s, ''); // (a trailing 〈룰〉 reminder line is not part of the effect order)
  if (/[\n]\s*·/.test(text)) return script;
  const raw = splitSentences(text.trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '')).map(x => x.trim()).filter(Boolean);
  const sents = [];
  for (const x of raw) { if (sents.length && /^(?:그\s*(?:디지몬|카드|턴)|이\s*효과로|남은|나머지|오픈한|그\s*중|그중|이\s*디지몬의\s*뒷면|또한)/.test(x)) sents[sents.length - 1] += ' ' + x; else sents.push(x); }
  if (sents.length < 2) return script;
  const parts = sents.map(x => compileToScript(x));
  if (parts.some(pt => pt.some(x => ['costGroup', 'condition', 'effectChoice', 'afterBattle', 'oppMayPay', 'setMemoryIfLE'].includes(x.op) || x.deferLast))) return script;
  const flat = parts.flat();
  if (flat.length !== script.length) return script;
  const key = (x) => JSON.stringify(x);
  const a = flat.map(key).sort(), b = script.map(key).sort();
  if (a.every((v, i) => v === b[i])) return flat;
  // only the duration differs: a "상대의 턴 종료까지" of another sentence had leaked into this one in the whole-text scan -> trust the per-sentence result
  const nd = (x) => JSON.stringify({ ...x, duration: undefined, expiresAfterTurn: undefined });
  const a2 = flat.map(nd).sort(), b2 = script.map(nd).sort();
  return a2.every((v, i) => v === b2[i]) ? flat : script;
}

// "A와 B 1장씩" zone moves that aren't a cost (트래시/패 -> 이 디지몬의 진화원, 이 디지몬의 진화원 -> 코스트 없이 등장, 상대의 레스트 디지몬과 테이머 1장씩 -> 덱 아래).
// Other sentences of the text compile as usual; "놓은 1장마다 메모리+N" / "이 효과로 N장 놓았을 때 …" hang off the move.
function compileMoveEachSentences(text) {
  if (!/씩/.test(text) || /것으로,/.test(text.replace(/\([^()]*\)/g, ''))) return null;
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  const out = []; let buf = []; let changed = false; let last = null;
  const flush = () => { if (buf.length) { const t1 = prepText(buf.join(' ')); out.push(...reorderBySentences(t1, compileToScriptCore(t1))); } buf = []; };
  for (const raw of sents) {
    const sn = raw.replace(/^그\s*후,?\s*/, '');
    let m, op = null;
    if ((m = sn.match(/자신(?:의)?\s*(패\s*(?:또는|\/)\s*트래시|트래시|패)(?:에서|의),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)?\s*(원하는\s*순서대로\s*)?이\s*디지몬의\s*진화원(\s*아래)?에\s*(원하는\s*순서대로\s*)?놓(?:는다|을\s*수\s*있다)/s))) {
      const gs = parsePickGroups(`${m[2]} 1장씩`);
      if (gs) op = { op: 'moveEach', who: 'self', from: /패/.test(m[1]) && /트래시/.test(m[1]) ? ['hand', 'trash'] : [/트래시/.test(m[1]) ? 'trash' : 'hand'], groups: gs, dest: 'thisSources', pos: m[4] ? 'bottom' : 'top', ordered: !!(m[3] || m[5]), ...(/수\s*있다/.test(sn) ? {} : { required: true }) };
    } else if ((m = sn.match(/이\s*디지몬의\s*진화원(?:에서|의),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)?\s*코스트를?\s*지불하지\s*않고\s*(레스트\s*상태로\s*)?등장시(킬\s*수\s*있다|킨다)/s))) {
      const gs = parsePickGroups(`${m[1]} 1장씩`);
      if (gs) op = { op: 'moveEach', who: 'self', from: ['sources'], groups: gs, dest: 'play', rested: !!m[2], noTriggers: false, ...(m[3] === '킨다' ? { required: true } : {}) };
    } else if ((m = sn.match(/^(레스트\s*상태인\s*)?상대(?:의)?\s*(디지몬(?:과|와)\s*테이머)\s*(?:각각\s*)?1\s*(?:장|마리|명)씩(?:을|를)?\s*덱\s*아래로\s*되돌린다/))) {
      changed = true; flush();
      out.push(...['digimon', 'tamer'].map(cat => ({ op: 'returnToHandStripSources', target: 'opponent', dest: 'deckBottom', n: 1, optional: false, filter: { category: cat, ...(m[1] ? { suspended: true } : {}) } })));
      continue;
    }
    if (op) { changed = true; flush(); out.push(op); last = op; continue; }
    if (last && (m = sn.match(/놓은\s*1\s*장마다\s*메모리\s*\+\s*(\d+)/))) { out.push({ op: 'gainMemory', who: 'self', n: Number(m[1]), per: { kind: 'moved', size: 1 } }); continue; }
    if (last && (m = sn.match(/^이\s*효과로\s*(\d+)\s*장\s*놓았을\s*때\s*(.+)$/s))) { const body = compileToScript(m[2]); if (body.length) { out.push({ op: 'condition', if: { movedGE: Number(m[1]) }, then: body, else: [] }); continue; } }
    buf.push(sn);
  }
  flush();
  return changed ? out : null;
}
export function compileToScript(text) { const t0 = prepText(text); const mvE = compileMoveEachSentences(t0); if (mvE) return mvE; const per = compilePerSentences(t0); if (per) return per; return reorderBySentences(t0, compileToScriptCore(t0)); }
function compileToScriptCore(text) {
  // Sentences gated on a fact about the stack / the event subject that generic condition parsing can't see. The gated sentence is compiled
  // on its own and wrapped in a condition; the surrounding sentences compile as usual, in printed order.
  //   BT9-068  "이 디지몬의 진화원에 <색>인 카드가 있을 때, <효과>."   (the 《진격》 form is handled by the raid op)
  //   EX11-058 "《디코드》로 등장했었다면, <효과>."   — the Digimon that triggered this watcher entered play through 《디코드》/《파티션》 (stack.playedByKw)
  //   EX11-060 "《오버클럭》으로 소멸했다면, <효과>." — the Digimon that triggered this watcher was deleted as 《오버클럭》's cost (deletedInfo.byOverclock)
  { const COLORS = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
    const GATES = [
      { re: /^이\s*디지몬의\s*진화원에\s*(레드|블루|옐로우?|그린|블랙|퍼플|화이트)인\s*카드가\s*있을\s*때,?\s*(.+)$/s, skip: /진격/, body: 2,
        test: (m) => (ctx) => { const st = ctx.state.players[ctx.self].battle.find(x => x.uid === ctx.sourceStackUid); return !!st && st.sources.some(id => (ctx.S.card(id).colors || []).includes(COLORS[m[1]])); } },
      { re: /^[《≪]\s*(디코드|파티션)\s*[》≫]\s*(?:로|으로)\s*등장했었다면,?\s*(.+)$/s, body: 2,
        test: (m) => (ctx) => { const uid = ctx.trigger?.evtStackUid; const st = uid && [...ctx.state.players.p1.battle, ...ctx.state.players.p2.battle].find(x => x.uid === uid); return !!st && st.playedByKw === m[1]; } },
      { re: /^[《≪]\s*오버클럭\s*[》≫]\s*(?:로|으로)\s*소멸했다면,?\s*(.+)$/s, body: 1,
        test: () => (ctx) => { const uid = ctx.trigger?.evtStackUid; return !!uid && !!ctx.state.deletedInfo?.[uid]?.byOverclock; } },
    ];
    const sents = text.trim().split(/(?<=\.)\s+/);
    const gateOf = (x) => { for (const g of GATES) { const m = x.match(g.re); if (m && !(g.skip && g.skip.test(x))) return { g, m }; } return null; };
    if (sents.length > 1 && sents.some(x => gateOf(x))) {
      const out = []; let chunk = [];
      const flush = () => { if (chunk.length) { out.push(...compileToScript(chunk.join(' '))); chunk = []; } };
      for (const x of sents) {
        const gm = gateOf(x);
        if (gm) {
          flush();
          const inner = compileToScript(gm.m[gm.g.body]);
          if (inner.length) out.push({ op: 'condition', if: { test: gm.g.test(gm.m) }, then: inner, else: [] });
        } else chunk.push(x);
      }
      flush();
      return out;
    } }

  // 15-15-7-2/4: "이하의 효과에서 1개를 발휘한다. <조건>이라면 대신 이하의 효과 전부를 발휘한다." + bullet lines. One of them, or (condition) ALL of them
  // in an order the player picks; when all are run by a forced effect their optional processing conditions are forced too.
  { const om = text.trim().match(/^이하의\s*효과\s*(?:에서|중(?:에서)?)\s*1개를\s*(?:선택하여\s*)?발휘한다\.(.*?)\n((?:\s*·[^\n]*(?:\n|$))+)\s*$/s);
    if (om) {
      const bullets = om[2].split('\n').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^·\s*/, ''));
      const opts = bullets.map(b => ({ label: b.replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').slice(0, 60), then: compileToScript(b) }));
      const tail = om[1].trim();
      let allIf = null, okTail = !tail;
      if (tail) {
        const am = tail.match(/^(.*?(?:라면|다면|(?:있을|없을)\s*때)),?\s*(?:그\s*)?대신,?\s*이하(?:의)?\s*효과(?:를)?\s*(?:전부(?:를)?|모두)\s*발휘한다\.?$/s);
        if (am) { allIf = parseConditionText(am[1].replace(/\s+/g, ' ').trim().replace(/있을\s*때$/, '있다면').replace(/없을\s*때$/, '없다면')); okTail = !!allIf; }
      }
      if (opts.length > 1 && okTail && opts.some(o => o.then.length)) return [{ op: 'effectChoice', options: opts, ...(allIf ? { allIf } : {}) }];
    } }
  // 14-2-5 / 13-1-8: a 【시큐리티】 "배틀 종료 시, <효과>" is held until the battle with this security Digimon has ended (see S.queueAfterBattle).
  { const abm = text.trim().match(/^배틀\s*종료\s*시,?\s*(.+)$/s); if (abm) return [{ op: 'afterBattle', text: abm[1] }]; }
  // 7-2-2-9/10: "…. 그 후, (N장) 디지크로스하고 있었다면/있었을 때, <효과>" — the clause after it only runs when the stack was actually DigiXros'ed (stack.xrosCount).
  { const xm = text.match(/^(.*?)(?:그\s*후,?\s*)?((?:\d+\s*장\s*)?디지크로스\s*하고\s*있었(?:다면|을\s*때)),?\s*(.+)$/s);
    if (xm && !/^\s*디지크로스\s*-/.test(xm[3])) {
      const clean = (t) => t.split('\n').filter(l => !/^\s*(?:디지크로스\s*-|〈룰〉)/.test(l)).join('\n').trim();
      const prefix = clean(xm[1]) ? compileToScript(clean(xm[1])) : [];
      const test = parseConditionText(xm[2].replace(/\s+/g, ' ').trim());
      if (/^다음\s*상대의\s*액티브\s*페이즈에서는?,?\s*그\s*디지몬은\s*액티브가\s*되지\s*않는다\.?$/.test(clean(xm[3]))) { const rp = prefix.find(x => x.op === 'rest'); if (rp) { rp.skipIfXros = Number((xm[2].match(/(\d+)\s*장/) || [0, 1])[1]); return prefix; } }
      const bm = clean(xm[3]).match(/^이\s*효과로\s*등장시키는\s*매수\s*\+(\d+)\.?$/);
      if (bm) { const pf = prefix.find(x => x.op === 'playFree'); if (pf) { pf.xrosBonus = Number(bm[1]); const nm = xm[2].match(/(\d+)\s*장/); pf.xrosMin = nm ? Number(nm[1]) : 1; return prefix; } }
      const suffix = clean(xm[3]) ? compileToScript(clean(xm[3])) : [];
      if (!test) return prefix; // never run the gated clause blindly
      return [...prefix, ...(suffix.length ? [{ op: 'condition', if: { test }, then: suffix, else: [] }] : [])];
    } }
  const inner = compileWithCost(text);
  const trimmed = text.trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  { const rMulti = /(?:라면|다면|때|경우)/.test(trimmed) ? compileSentenceConds(trimmed, true) : null; if (rMulti) return rMulti; } // several conditional sentences in a row
  { // "<조건 A>하고/이고/있고, <조건 B>라면, <효과>": every part must hold
    const cmp = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^((?:[^.。\n]{2,120}?)(?:포함하고|가지고|있고|없고|이고|이며|가지며|포함하며)),\s*([^,.。\n]{2,80}?(?:라면|다면)),\s*(.*)$/s);
    if (cmp) {
      const un2 = (x) => x.replace(/\uE000/g, '.');
      const first = un2(cmp[1]).replace(/포함하(?:고|며)$/, '포함한다면').replace(/가지(?:고|며)$/, '가진다면').replace(/있(?:고)$/, '있다면').replace(/없(?:고)$/, '없다면').replace(/(?:이고|이며)$/, '이라면');
      const t1 = parseConditionText(first), t2 = parseConditionText(un2(cmp[2]));
      if (t1 && t2) {
        const restC = compileWithCost(un2(cmp[3]));
        if (restC.length) return [{ op: 'condition', if: { test: async (ctx) => (await t1(ctx)) && (await t2(ctx)) }, then: restC, else: [] }];
      }
    }
  }
  const cm = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,80}?(?:라면|다면))(?:,\s*|\s+)(.*)$/s);
  if (cm) { cm[1] = cm[1].replace(/\uE000/g, '.'); cm[2] = cm[2].replace(/\uE000/g, '.'); }
  if (!cm) {
    // "<조건>일 때, <효과>" / "…있을 때," leading conditions (157 segments used to run unconditionally). Unparsable ones ask the player.
    const wm = trimmed.replace(/경우,/, '때,').replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,80}?(?:있을|없을|이하일|이상일|장일|일|적을|많을|가질|같을|다를|포함할|가지고\s*있을|갖고\s*있을|기술되어\s*있을)\s*때),\s*(.*)$/s);
    if (wm && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
      const wUn = (x) => x.replace(//g, '.');
      const cn = normCondText(wUn(wm[1]));
      const rest = compileWithCost(wUn(wm[2]));
      if (rest.length) {
        const label = wUn(wm[1]);
        const test = parseConditionText(cn) || manualCondition(label);
        return [{ op: 'condition', if: { test }, then: rest, else: [] }];
      }
    }
    // A condition can also open a LATER sentence: "…한다. 그 후, <조건>라면, <효과>". The
    // whole-text scan used to run that trailing clause unconditionally, so split there:
    // prefix compiled as-is, the clause after the condition wrapped in a condition op.
    if (!inner.length || inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) return inner;
    { const r = compileSentenceConds(trimmed); if (r) return r; }
    const masked = trimmed.replace(/Lv\./g, 'Lv');
    const ms = masked.match(/^(.+?[.。])\s*(?:(?:그\s*후|또한),?\s*)?([^,.。\n]{2,80}?(?:라면|다면)),\s*(.+)$/s);
    if (!ms) return inner;
    const un = (x) => x.replace(//g, '.');
    const prefix = compileToScript(un(ms[1]));
    const test = parseConditionText(un(ms[2]));
    const suffix = compileToScript(un(ms[3]));
    if (!prefix.length && !suffix.length) return inner;
    // Condition we can't evaluate: keep only the unconditional prefix (never run the gated clause blindly).
    if (!test) return prefix;
    return [...prefix, ...(suffix.length ? [{ op: 'condition', if: { test }, then: suffix, else: [] }] : [])];
  }
  // Already condition-aware (dedicated op/condition) — leave it alone.
  if (inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE')) return inner;
  const test = parseConditionText(cm[1]) || manualCondition(cm[1]); // can't evaluate the condition → ask the player, never apply blindly
  const rest = compileWithCost(cm[2]);
  if (!rest.length) return [];
  return [{ op: 'condition', if: { test }, then: rest, else: [] }];
}

// ---- sentences a compiled script silently leaves out ----
// compileToScript understands what it can; sentences with no matching pattern used to
// vanish without a trace. droppedSentences finds sentences whose removal doesn't change
// the compiled script at all (=they contribute nothing) so the UI can hand them to the
// player as a manual follow-up instead of pretending the effect fully resolved.
function splitSentences(text) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '（') depth++;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    cur += ch;
    if (depth === 0 && (ch === '.' || ch === '。') && !/Lv$/.test(cur.slice(0, -1)) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) { out.push(cur); cur = ''; }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const IGNORABLE_SENTENCE = /^(?:나머지는|남은\s*카드는|오픈한\s*카드는|그\s*중|그중|그렇게\s*했을\s*때|이하의\s*효과|·|〈룰〉|〔[^〕]+〕$|그\s*디지몬이\s*(?:가진|갖는)\s*진화원은\s*파기한다)/;

export function droppedSentences(text) {
  const sents = splitSentences(text.replace(/〈룰〉.*$/s, ''));
  if (sents.length < 2) return [];
  const base = JSON.stringify(compileToScript(text));
  if (base === '[]') return [];
  const dropped = [];
  for (let i = 0; i < sents.length; i++) {
    const plain = sents[i].replace(/\([^()]*\)/g, '').replace(/[.。]\s*$/, '').trim();
    if (plain.length < 7 || IGNORABLE_SENTENCE.test(plain)) continue;
    // 디지크로스 -N 조건 줄(S.parseDigiXros가 처리) / 키워드 나열 줄(《돌진》《관통》, 《오버클럭…》)은 효과 문장이 아님
    if (/^디지크로스\s*-\d+\s*[:：]/.test(plain) || /^(?:《[^》]*(?:《[^》]*》)?[^》]*》\s*)+$/.test(plain.replace(/[（(][^）)]*[）)]/g, '').trim())) continue;
    const without = sents.filter((_, j) => j !== i).join(' ');
    if (JSON.stringify(compileToScript(without)) === base) dropped.push(sents[i].trim());
  }
  return dropped;
}

async function evalCondition(cond, ctx) {
  if (!cond) return true;
  if (cond.test) return !!(await cond.test(ctx));
  if (cond.memoryLE != null) {
    const val = ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory;
    return val <= cond.memoryLE;
  }
  if (cond.hasDigimon) {
    return ctx.state.players[ctx.self].battle.some(s => matchesFilter(ctx.S, s, cond.hasDigimon, ctx.state));
  }
  if (cond.movedGE != null) return (ctx._moveEachN || 0) >= cond.movedGE; // "이 효과로 2장 놓았을 때"
  if (cond.securityLE != null) {
    return ctx.state.players[ctx.self].security.length <= cond.securityLE;
  }
  if (cond.handSizeGE != null) {
    return ctx.state.players[ctx.self].hand.length >= cond.handSizeGE;
  }
  if (cond.hasTamer) {
    return ctx.state.players[ctx.self].battle.some(s => ctx.S.card(s.cardId).category === 'tamer');
  }
  return true;
}

// Per-card bespoke scripts for effects too structurally unique to
// generalize into a regex pattern (still fully automated — just addressed
// by card id + tag signature instead of free-text matching).
const CARD_SPECIFIC = {
  '*::__급습': [{ op: 'ambush' }], // 16-44
  '*::__오버클럭': [{ op: 'overclock' }], // 16-34
  'BT1-089::메인': [
    { op: 'condition', if: { hasDigimon: { colors: ['green'], levelMin: 5 } }, then: [
      { op: 'restStack', target: 'self', thisStack: true },
      { op: 'choice', prompt: '빈 육성 에어리어에 부화 또는 Lv.3+ 자신 디지몬 배틀로 이동', options: [
        { label: '부화', then: [{ op: 'hatch', who: 'self' }] },
        { label: '육성→배틀 이동', then: [{ op: 'moveRaising', who: 'self' }] },
      ] },
    ], else: [] },
  ],
  'EX1-021::어택 시': [
    { op: 'condition', if: { handSizeGE: 8, hasTamer: true }, then: [
      { op: 'bounceToDeckBottomStripSources', target: 'opponent', filter: { hasSegmentTag: '소멸 시' } },
    ], else: [] },
  ],
  'EX1-035::어택 시': [{ op: 'noop', note: '공격 중 진화 옵션 — 이 엔진엔 공격 중간 타이밍이 없어서 동일 효과를 원하면 어택 선언 "전에" 일반 진화로 처리하세요 (결과는 동일).' }],
  'EX1-040::어택 시': [{ op: 'noop', note: '공격 중 진화 옵션 — 어택 선언 전에 일반 진화로 대체 처리하세요 (결과 동일).' }],
  'EX1-043::자신의 턴': [{ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '전투후액티브', duration: 'permanent' }],
  'EX1-056::자신의 턴': [{ op: 'grantDynamicRestriction', target: 'self', thisStack: true, restriction: { type: 'noDigimonAttackUnlessOwn', filter: { nameIncludes: '묘티스몬' } } }],
  'EX1-072::메인': [{ op: 'noop', note: '상대 옵션카드 사용 봉인 — 이 엔진은 옵션카드 사용을 별도 액션으로 게이트하지 않아서 강제할 수 없습니다. 수동으로 상대가 옵션 카드를 못 쓰게 안내해주세요.' }],
  'EX1-073::서로의 턴': [{ op: 'noop', note: '대체 배리어(진화원 Lv.5 2장 파기로 생존) — 일반 배리어처럼 소멸 판정 시 수동으로 대가를 지불해서 생존 처리하세요.' }],
};

// Keys of the form 'CARD::tag@needle' disambiguate several same-tag segments on one card: they match only when the
// effect text (`text`, when the caller passes it) contains `needle`.
let AT_INDEX = null; // built lazily (cards/*.js import cycles make top-level access to CARD_SCRIPTS unsafe)
function atIndex() {
  if (AT_INDEX) return AT_INDEX;
  AT_INDEX = {};
  for (const [k, v] of Object.entries(CARD_SCRIPTS)) { const i = k.indexOf('@'); if (i > 0) (AT_INDEX[k.slice(0, i)] ||= []).push([k.slice(i + 1), v]); }
  return AT_INDEX;
}
export function lookupCardSpecific(cardId, tags, text) {
  if (typeof cardId === 'string' && cardId.includes('~')) cardId = cardId.split('~')[0]; // synthetic "<id>~<tag>" cards (effects gained from an evolution source, EX10-059) run the source card's own scripts
  const key = `${cardId}::${tags[0]}`;
  if (text != null && atIndex()[key]) { const hit = atIndex()[key].find(([needle]) => text.includes(needle)); if (hit) return hit[1]; }
  return CARD_SCRIPTS[key] || CARD_SPECIFIC[key] || (String(tags[0]).startsWith('__') ? CARD_SCRIPTS['*::' + tags[0]] || CARD_SPECIFIC['*::' + tags[0]] || null : null);
}

// helpers for per-card shard scripts (src/cards/shard1X.js): compile a printed sentence / evaluate a printed condition at run time
export const FX_HELPERS = { parseConditionText, condTestFor, parseCardFilter, matchesFilter, compileToScript };
