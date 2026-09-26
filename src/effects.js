import { SCRIPTS as CARD_SCRIPTS, OPS as CARD_OPS } from './cards/index.js';
import { CARDS as ALL_CARDS, parseEffectSegments as parseSegs } from './state.js'; // call-time use only (state.js <-> cards/* already form an import cycle)
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
// 2-3-3-3 (Ver.4.3): a "≪X≫를 가진 카드" REFERENCE only matches cards that ALWAYS have the keyword (printed / live
// continuous grant), not one obtained through a one-shot or even permanent-duration effect GRANT — so this checks
// S.hasAlwaysKeyword (not the broader S.hasKeyword, which folds every source together for a card's own play legality).
function stackHasKeywordNow(S, state, target, kw) {
  if (S.hasAlwaysKeyword(target, kw)) return true;
  const p = ['p1', 'p2'].find(x => state.players[x].battle.includes(target) || state.players[x].raising === target);
  if (!p) return false;
  try { if (S.hookGrantedKeywords(state, p, target).includes(kw)) return true; } catch (e) { /* ignore */ }
  try { return !!S.hasContinuousKeyword(state, p, target, kw); } catch (e) { return false; }
}
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
  if (filter.idIn && !filter.idIn.includes(cardId)) return false; // (revealTop: only the revealed cards that can actually be evolved into / used)
  if ((filter.levelAny || filter.level != null || filter.levelMax != null || filter.levelMin != null) && !(c.level > 0)) return false; // official Q&A (2596/2807/2929/3589/3796/4242): a Lv.-less card/digimon (Lv.0 in the DB) or a tamer/option has no Lv. — it can never satisfy a Lv.-based condition
  if (filter.levelAny && !filter.levelAny.includes(c.level)) return false; // "Lv.4 또는 Lv.5의 …"
  if (filter.level != null && c.level !== filter.level) return false;
  if (filter.levelMax != null && (c.level || 0) > filter.levelMax) return false;
  if (filter.levelMin != null && (c.level || 0) < filter.levelMin) return false;
  if (filter.colors && !colors.some(col => filter.colors.includes(col))) return false;
  // Cards store their 특징 in `types` (유형 + 속성 + 형태 folded in by loadData; there is no `traits` field).
  if (filter.trait && !traits.includes(filter.trait)) return false;
  if (filter.traitAny && !filter.traitAny.some(t => traits.includes(t))) return false;
  if (filter.traitIncludes && !filter.traitIncludes.some(t => traits.some(ty => ty.includes(t) && !(t === '수' && BEAST_TRAIT_EXCL.includes(ty))))) return false; // 「수」를 포함(「수장룡형」/「수생형」/「수생포유류형」/「정보수집 타입」은 제외)
  if (filter.nameAny && !filter.nameAny.some(nameHas)) return false;
  if (filter.mentionAny && !filter.mentionAny.some(n => S.cardMentions(cardId, n))) return false;
  if (filter.exactAny && !filter.exactAny.some(n => names.includes(n))) return false;
  if (filter.keywordText && !`${c.effectKo || ''}
${c.inheritedKo || ''}`.includes(`《${filter.keywordText}`)) return false;
  if (filter.keywordHas && !(`${c.effectKo || ''}`.includes(`《${filter.keywordHas}`) /* QA-S3 Q3249: a card "has" a keyword only via its printed main text; a 진화원 효과 (inherited) line does not count */ || (isStack && state && stackHasKeywordNow(S, state, target, filter.keywordHas)))) return false; // pass2-b6
  if (filter.noKeywordText && (isStack && state ? S.hasKeyword(target, filter.noKeywordText) : `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes(`《${filter.noKeywordText}`))) return false; // "《X》를 갖지 않은" (BT1-079/110, BT6-054)
  if (filter.category && !(eff ? eff.isCategory(filter.category) : c.category === filter.category)) return false;
  if (filter.notCategory && c.category === filter.notCategory) return false; // "디지타마 카드 이외의 카드"
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
    if (filter.srcHas && !(target.sources || []).some(id => matchesFilter(S, id, filter.srcHas))) return false; // "진화원에 「X」/2색 이상인 카드를 가진 …" (any evolution-source card matches)
  }
  if (!isStack && c.dual && c.cost == null && (filter.costMax != null || filter.costMin != null || filter.costEq != null)) return false; // 듀얼 카드의 디지몬 쪽에는 등장 코스트가 없다 -> 「등장 코스트 N 이하」 조건을 만족하지 않는다
  const costNow = isStack && state && S.effectiveCost ? S.effectiveCost(state, target) : (c.cost || 0); // battle-area cards: printed cost + 등장 코스트 modifiers
  if (filter.costMax != null && costNow > filter.costMax) return false;
  if (filter.costMin != null && costNow < filter.costMin) return false;
  if (filter.costEq != null && costNow !== filter.costEq) return false;
  if (filter.colorCount != null && colors.length !== filter.colorCount) return false; // "블랙을 포함하는 2색의 카드"
  if (filter.colorCountMin != null && colors.length < filter.colorCountMin) return false; // "그린/블루를 포함하는 2색 이상의 카드"
  if (filter.colorsNot && colors.some(col => filter.colorsNot.includes(col))) return false; // "화이트 이외의 테이머"
  if (filter.hasInherited && !(c.inheritedKo || '').trim()) return false; // "진화원 효과를 가진 카드"
  if (filter.hasXros && !S.parseDigiXros(cardId)) return false; // "디지크로스 조건을 가진 카드"
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
async function pickByGroups(ctx, who, cards, groups, kind, basePrompt, mkEligible, required = false, allOrNone = false) {
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
    const full = cand.filter(i => 1 + maxSlotMatching(S, cards, avail.filter(x => x !== i), rest) >= best);
    // open-e (RB1-005 Q3420): a card that fits several criteria may also be taken AS the criterion of this slot even when that leaves another slot unfillable
    // (the maximal outcome stays listed first so a default/CPU answer takes it)
    const el = [...full, ...cand.filter(i => !full.includes(i) && rest.some(f => matchesFilter(S, cards[i], f)))];
    const lbl = sl.g.label ? `${sl.g.label} ${sl.g.max > 1 ? `${sl.k + 1}/${sl.g.max}` : '1'}장` : '';
    const prompt = `${basePrompt}${lbl ? ` — ${lbl}` : ''}`;
    const rq = mkEligible ? mkEligible(el, prompt) : { player: who, revealed: cards, eligible: el.map(i => ({ id: cards[i], i })), min: 0, max: 1, prompt, ...(required && el.length ? { required: true } : {}) };
    if (allOrNone && chosen.length && el.length) { rq.min = 1; rq.required = true; } // official Q&A (BT6-075 Q1465 / BT7-063 Q1623): an optional "A와 B 1장씩" is done as far as possible or not at all -> once one criterion is taken the others are mandatory
    let sel = await ctx.choose(kind, rq);
    if (allOrNone && chosen.length && el.length && !(sel || []).some(i => el.includes(i))) sel = [el[0]]; // mandatory once the effect was started (a UI/CPU answer cannot skip it)
    if (allOrNone && !chosen.length && !(sel || []).length) break; // declined the first available criterion = declined the whole (optional) effect
    for (const i of (sel || [])) if (el.includes(i) && !chosen.includes(i)) { chosen.push(i); (chosen.gi ||= {})[i] = groups.indexOf(sl.g); break; } // one card per slot
  }
  return chosen;
}

// ---- "덱 위에서부터 N장 오픈 → 그중 <조건> N장을 <패에 추가 / 등장 / 진화원 / 파기> → 나머지는 <덱 아래/위/파기>" (batch reveal-2) ----
// revealPick instr: { op, who:'self', n, optReveal, steps:[{ groups:[{filter,max,all,upTo,distinctColors,label}], costSum, optional, dests:[{k:'hand'|'trash'|'play'|'use'|'srcThis'|'srcOwn', rested, filter}] }],
//   restTo:'bottom'|'top'|'trash'|'hand'|'topOrBottom' }.  Steps run in order on the cards still revealed; every pick is limited to matching cards;
// the deck holds the unpicked cards until the rest is placed (the player orders them). ctx._lastPlacedSource counts 진화원 placements ("이 효과로 놓았다면").
function revealCriterion(dsc) {
  dsc = dsc.trim().replace(/특징으로\s*특징으로/g, '특징으로').replace(/,\s*$/, '');
  let m;
  if ((m = dsc.match(/^(.*?)(?:를|을)?\s*가지거나\s*(\d)\s*색의\s*카드$/))) { const a = strictCardFilter(m[1] + '를 가진 카드'); if (a) return { anyOf: [a, { colorCount: Number(m[2]) }] }; }
  if ((m = dsc.match(/^((?:「[^」]+」\s*\/?\s*)+)\s*(?:또는|이나)\s*([^「].*)$/))) return { anyOf: [{ exactAny: [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]) }, revealCriterion(m[2])] };
  const f = criterionFilter(dsc);
  if (f && f.anyOf && /거나\s/.test(dsc)) { // "명칭에 「A」를 포함하거나 특징으로 「B」를 가진 퍼플인 디지몬 카드": the trailing color/Lv./cost words describe the shared noun -> apply to every alternative
    const last = f.anyOf[f.anyOf.length - 1], shared = {};
    for (const k of ['colors', 'colorCount', 'colorCountMin', 'level', 'levelMax', 'levelMin', 'costMax', 'costMin']) if (last[k] != null) shared[k] = last[k];
    if (Object.keys(shared).length) return { anyOf: f.anyOf.map(sub => ({ ...shared, ...sub })) };
  }
  return f;
}
function revealGroups(desc) {
  desc = desc.trim();
  if (!desc) return null;
  if (/씩$/.test(desc)) return parsePickGroups(desc);
  const groups = [];
  for (let part of desc.split(/(?<=장|전부)\s*(?:과|와)\s*(?=\S)/)) {
    part = part.trim();
    let distinctColors = false;
    if (/색이\s*서로\s*다른/.test(part)) { distinctColors = true; part = part.replace(/,?\s*색이\s*서로\s*다른\s*/, ' ').replace(/(있|가지|갖)고\s+/, '$1는 ').trim(); }
    const one = (p) => {
      let mm;
      if ((mm = p.match(/^(.*?)\s*전부$/))) return { max: 99, all: true, dsc: mm[1].trim() };
      if ((mm = p.match(/^(.*?)\s*(\d+)\s*장(까지)?$/))) return { max: Number(mm[2]), dsc: mm[1].trim(), upTo: !!mm[3] };
      return { max: null, dsc: p.trim() };
    };
    const orParts = part.split(/(?<=장)\s*또는\s*/);
    if (orParts.length > 1) {
      const os = orParts.map(one); if (os.some(o => o.max == null || o.all)) return null;
      groups.push({ filter: { anyOf: os.map(o => (o.dsc ? revealCriterion(o.dsc) : {})) }, max: Math.max(...os.map(o => o.max)), label: part });
      continue;
    }
    const o = one(part);
    const f = o.dsc ? revealCriterion(o.dsc) : null;
    groups.push({ ...(f && Object.keys(f).length ? { filter: f } : {}), max: o.max ?? 1, ...(o.max == null ? { noCount: true } : {}), ...(o.all ? { all: true } : {}), ...(distinctColors ? { distinctColors: true } : {}), ...(o.upTo ? { upTo: true } : {}), label: (o.dsc || '카드') });
  }
  return groups.length ? groups : null;
}
function parseRevealDest(s) {
  s = s.trim().replace(/[.。]\s*$/, '');
  const one = (x) => {
    let m;
    x = x.trim();
    if (/^패(?:에|로)\s*(?:추가|넣)/.test(x)) return { k: 'hand' };
    if (/^파기/.test(x)) return { k: 'trash' };
    if (/^코스트를?\s*지불하지\s*않고/.test(x)) return /사용/.test(x) ? { k: 'use' } : { k: 'play', rested: /레스트\s*상태로/.test(x) };
    if (/^이\s*디지몬의\s*진화원\s*아래에/.test(x)) return { k: 'srcThis' };
    if ((m = x.match(/^(.*?)자신의\s*디지몬(?:\s*1\s*마리)?의\s*진화원\s*아래에/))) { const pre = m[1].trim(); const f = pre ? parseCardFilter(pre + ' 디지몬 카드') : null; return pre && !f ? null : { k: 'srcOwn', filter: f }; }
    return null;
  };
  const dests = s.split(/(?<=거나),?\s*/).map(one);
  if (!dests.length || dests.some(d => !d) || dests.length > 2) return null;
  return { dests, optional: /수\s*있다/.test(s) };
}
function compileRevealPick(t) {
  const m0 = t.match(/자신의\s*덱\s*위에서(?:부터)?\s*(\d+)\s*장(?:을)?\s*오픈(?:한다|할\s*수\s*있다|하고)/);
  if (!m0) return null;
  const sents = splitSentences(t.replace(/[〈<]룰[〉>].*$/s, '')).map(x => x.trim());
  let steps = null, tailRest = "";
  const bi = sents.findIndex(x => /^그\s*중(?:에서|에|의)?(?:\s|(?=[《「]))/.test(x)); // ("그중《흡수진화》를 …" has no space)
  const ci = sents.findIndex(x => /^그\s*카드가\s/.test(x));
  const finish = (desc, destStr, sum) => {
    const groups = revealGroups(desc), pd = parseRevealDest(destStr);
    if (!pd || (desc.trim() && !groups)) return null;
    const g = groups || [{ max: 1, label: '카드', noCount: true }];
    if (sum != null) for (const x of g) if (x.noCount) x.max = 99;
    return { groups: g, ...(sum != null ? { costSum: sum } : {}), optional: pd.optional || g.every(x => x.upTo), dests: pd.dests };
  };
  if (bi >= 0) {
    const body = sents[bi].replace(/^그\s*중(?:에서|에|의)?\s*/, '').replace(/[.。]$/, '').replace(/,?\s*(?:나머지|남은\s*카드)(?:는|를)\s*[^,]*$/, (x) => { tailRest = x; return ''; }); // "…패에 추가하고 나머지는 덱 아래로 되돌린다" in one sentence
    steps = [];
    for (const seg of body.split(/(?<=[하놓]고),\s*/)) {
      let sum = null;
      const sm = seg.match(/등장\s*코스트\s*합계\s*(\d+)\s*까지\s*/);
      let sg = seg; if (sm) { sum = Number(sm[1]); sg = seg.replace(sm[0], ''); }
      const mm = sg.match(/^(.*)(?:을|를)\s*((?:패(?:에|로)\s*(?:추가|넣)|코스트를?\s*지불하지|이\s*디지몬의\s*진화원|(?:[가-힣]+인\s*)?자신의\s*디지몬(?:\s*1\s*마리)?의\s*진화원|파기).*)$/s);
      if (!mm) return null;
      let descX = mm[1];
      // official Q&A (BT9-071): a later step that names only a count ("…1장을 패에 추가하고, 1장을 파기한다") takes the SAME card descriptor as the first step
      if (steps.length && /^\s*\d+\s*장\s*$/.test(descX) && steps.firstDesc && /파기/.test(mm[2])) descX = steps.firstDesc.replace(/\d+\s*장\s*$/, descX.trim());
      if (!steps.length) steps.firstDesc = mm[1];
      const st = finish(descX, mm[2], sum);
      if (!st) return null;
      steps.push(st);
    }
  } else if (ci >= 0) {
    const mm = sents[ci].match(/^그\s*카드가\s*(.*?)(?:(?:이)?(?:라면|다면)|일\s*때|일\s*경우),?\s*(.*)$/s); // ("…디지몬 카드일 때 코스트를 지불하지 않고 등장시킬 수 있다" — P-070)
    if (!mm) return null;
    const st = finish(mm[1], mm[2], null); if (!st) return null;
    st.groups.forEach(x => { x.max = 1; }); st.optional = /수\s*있다/.test(mm[2]); steps = [st];
  } else if (sents.some(x => /^오픈한\s*카드(?:는|를)/.test(x)) && !/오픈한\s*카드가/.test(t)) steps = []; // reveal only: "오픈한 카드는 원하는 순서대로 덱 위 또는 아래로만 되돌린다" (nothing may be picked)
  else return null;
  const rs = sents.find(x => /^(?:나머지|오픈한\s*카드|남은\s*카드)(?:는|를)/.test(x)) || tailRest || '';
  const restTo = /파기/.test(rs) ? 'trash' : /덱(?:\s*의)?\s*위\s*(?:또는|\/|나)\s*(?:덱(?:\s*의)?\s*)?아래/.test(rs) ? 'topOrBottom' : /패에\s*추가/.test(rs) ? 'hand' : /덱(?:\s*의)?\s*위로/.test(rs) ? 'top' : /덱(?:\s*의)?\s*아[래도]/.test(rs) ? 'bottom' : null;
  if (!restTo) return null;
  return { op: 'revealPick', who: 'self', n: Number(m0[1]), ...(/상대\s*디지몬\s*1\s*마리마다,?\s*자신의\s*덱/.test(t) ? { nMulOpp: true } : {}), optReveal: /오픈할\s*수\s*있다/.test(m0[0]), steps, restTo };
}
async function runRevealPick(instr, ctx) {
  const { state, S } = ctx, who = ctx.self, pl = state.players[who];
  if (instr.optReveal) { const ok = await ctx.choose('confirmEffect', { player: who, prompt: `덱 위에서부터 ${instr.n}장을 오픈하시겠습니까?` }); if (!ok) return; }
  let nWant = instr.n;
  if (instr.nMulOpp) { nWant *= state.players[ctx.opp].battle.filter(s => S.isDigimonLike(s)).length; if (!nWant) { S.log(state, '상대의 디지몬이 없어 오픈하지 않음'); return; } } // "상대 디지몬 1마리마다, 덱 위에서부터 N장"
  const n = Math.min(nWant, pl.deck.length);
  const revealed = pl.deck.slice(0, n);
  if (!n) { S.log(state, `${who} 덱에 카드가 없어 오픈할 수 없음`); return; }
  S.log(state, `${who} 덱 위 ${n}장 오픈: ${revealed.map(id => S.card(id).nameKo).join(', ')}`);
  if (!instr.steps.length && instr.restTo !== 'topOrBottom') await ctx.choose('pickFromRevealed', { player: who, revealed, eligible: [], min: 0, max: 0, prompt: `덱 위 ${n}장을 오픈했습니다 (확인만 합니다)`, dest: 'none' }); // reveal-only effects: show the cards
  const gone = new Set();
  const posOf = (i) => { let p = 0; for (let k = 0; k < i; k++) if (!gone.has(k)) p++; return p; };
  const take = (i) => { const p = posOf(i); gone.add(i); return pl.deck.splice(p, 1)[0]; };
  const nm = (i) => S.card(revealed[i]).nameKo;
  ctx._lastPlacedSource = 0;
  ctx._lastUsedOption = false;
  const thisStk = () => [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid) || null;
  const putSource = (i, tgt) => { const id = take(i); tgt.sources.splice(S.fdCount(tgt), 0, id); ctx._lastPlacedSource++; S.recomputeStackGrants(tgt); S.log(state, `${who} ${S.card(id).nameKo}을(를) ${S.card(tgt.cardId).nameKo}의 진화원 아래에 놓음`); };
  const canDo = (d, i) => {
    if (d.k === 'play') return S.card(revealed[i]).category !== 'option';
    if (d.k === 'use') return S.isOptionLike(revealed[i]) && !S.s1HookAny(state, 's1cannotUseOption', { p: who }) && !S.timedLocked(state, who, 'option') && S.optionColorOk(state, who, revealed[i]);
    if (d.k === 'srcThis') return !!thisStk();
    if (d.k === 'srcOwn') return candidateStacks(ctx, who, { filter: d.filter }).length > 0;
    return true;
  };
  const apply = async (d, i) => {
    if (d.k === 'hand') pl.hand.push(take(i));
    else if (d.k === 'trash') { const id = take(i); pl.trash.push(id); S.log(state, `${who} ${S.card(id).nameKo} 파기`); }
    else if (d.k === 'play') { const st = S.playFreeFromZone(state, who, 'deck', posOf(i), { rested: !!d.rested, noTriggers: !!d.noTriggers, ...(await xrosOptsFor(ctx, who, 'deck', posOf(i))) }); if (st) { gone.add(i); ctx._lastPick = { player: who, uid: st.uid }; recordPickInfo(ctx, who, st.uid); } }
    else if (d.k === 'use') {
      const id = take(i); pl.trash.push(id); S.log(state, `${who} ${S.card(id).nameKo} 코스트를 지불하지 않고 사용`); ctx._lastUsedOption = true;
      S.queueTriggersFor(state, who, id, 'use'); S.emitGameEvent(state, 'optionUsed', { owner: who, stack: null, cardId: id, cause: 'effect', useCost: 0 });
    } else if (d.k === 'srcThis') putSource(i, thisStk());
    else if (d.k === 'srcOwn') {
      const cs = candidateStacks(ctx, who, { filter: d.filter });
      const u = cs.length === 1 ? cs[0].uid : await ctx.choose('pickStack', { player: who, uids: cs.map(x => x.uid), prompt: '카드를 진화원 아래에 놓을 디지몬 선택' });
      const tgt = cs.find(x => x.uid === u) || cs[0]; if (tgt) putSource(i, tgt);
    }
  };
  // idx1391/1395 (BT10-096/097): 「…패에 추가하고, …등장시킬 수 있다」 — the trailing 「수 있다」 makes the WHOLE chain optional: either everything that can be done is done, or none of it.
  const chainOpt = instr.steps.length >= 2 && instr.steps[instr.steps.length - 1].optional && instr.steps.slice(0, -1).every(x => !x.optional);
  let chainSkip = false;
  if (chainOpt) {
    const anyCand = instr.steps.some(st => revealed.some((_, k) => st.groups.some(g => matchesFilter(S, revealed[k], g.filter)) && st.dests.some(d => canDo(d, k))));
    if (anyCand && !(await ctx.choose('confirmEffect', { player: who, prompt: '오픈한 카드의 패 추가/등장을 처리하시겠습니까? (일부만 처리할 수 없고, 전부 처리하거나 전혀 처리하지 않습니다)' }))) chainSkip = true;
  }
  for (const step of instr.steps) {
    if (chainSkip) break;
    const stepOpt = chainOpt ? false : step.optional;
    const remaining = revealed.map((_, i) => i).filter(i => !gone.has(i));
    if (!remaining.length) break;
    const rem = remaining.map(i => revealed[i]);
    const groups = step.groups;
    const dl = step.dests.length === 1 && (step.dests[0].k === 'hand' || step.dests[0].k === 'play') ? step.dests[0].k : step.dests.map(d => ({ hand: '패에 추가', trash: '파기', play: '코스트 없이 등장', use: '코스트 없이 사용', srcThis: '이 디지몬의 진화원 아래에 놓기', srcOwn: '자신의 디지몬의 진화원 아래에 놓기' }[d.k])).join(' 또는 ');
    const usable = (i) => groups.some(g => matchesFilter(S, revealed[i], g.filter)) && step.dests.some(d => canDo(d, i));
    const distinctOk = (g, chosen, i) => !g.distinctColors || S.colorsAllDistinct([...chosen, i].map(j => S.card(revealed[j]).colors || [])); // W9r2 (official Q6099): multi-colored cards may count as different colors
    const cands = remaining.filter(usable);
    const elOf = (list) => list.map(i => ({ id: revealed[i], i: remaining.indexOf(i) }));
    let picked = [];
    if (!cands.length) {
      await ctx.choose('pickFromRevealed', { dest: dl, player: who, revealed: rem, eligible: [], min: 0, max: 0, prompt: `공개된 카드 중 조건에 맞는 카드가 없습니다 (${groups.map(g => g.label).join(' / ')})` });
      S.log(state, `${who} 오픈한 카드 중 조건에 맞는 카드가 없음`);
    } else if (step.costSum != null) {
      let budget = step.costSum;
      const done = [];
      for (let k = 0; k < 20; k++) {
        const el = cands.filter(i => !gone.has(i) && !done.includes(i) && (S.card(revealed[i]).cost || 0) <= budget);
        if (!el.length) break;
        const r = await ctx.choose('pickFromRevealed', { dest: dl, player: who, revealed: rem, eligible: elOf(el), min: stepOpt || done.length ? 0 : 1, max: 1, prompt: `등장시킬 카드 선택 (남은 등장 코스트 합계 ${budget})` });
        const gi = (r || []).map(x => remaining[x]).find(x => el.includes(x)); if (gi == null) break;
        done.push(gi); budget -= S.card(revealed[gi]).cost || 0;
        await apply(step.dests.find(d => canDo(d, gi)), gi);
      }
    } else if (groups.some(g => g.all)) {
      picked = cands.filter(i => groups.some(g => g.all && matchesFilter(S, revealed[i], g.filter)));
      await ctx.choose('pickFromRevealed', { dest: dl, player: who, revealed: rem, eligible: elOf(picked), min: picked.length, max: picked.length, prompt: `조건에 맞는 카드 전부(${picked.length}장)를 패에 추가합니다 — 확인` }); // (shows the reveal; "전부" is not optional)
      S.log(state, `${who} 조건에 맞는 카드 전부: ${picked.map(nm).join(', ')}`);
    } else if (groups.length > 1) {
      const idxs = await pickByGroups(ctx, who, rem, groups, 'pickFromRevealed', '공개된 카드 중 선택',
        (el, prompt) => ({ dest: dl, player: who, revealed: rem, eligible: el.filter(li => step.dests.some(d => canDo(d, remaining[li]))).map(li => ({ id: rem[li], i: li })), min: stepOpt ? 0 : 1, max: 1, prompt }));
      picked = idxs.map(li => remaining[li]);
    } else {
      const g = groups[0], chosen = [], mx = Math.min(g.max, 99);
      for (let k = 0; k < (g.distinctColors ? mx : 1); k++) {
        const el = cands.filter(i => !chosen.includes(i) && distinctOk(g, chosen, i));
        if (!el.length) break;
        const want = g.distinctColors ? 1 : mx;
        const r = await ctx.choose('pickFromRevealed', { dest: dl, player: who, revealed: rem, eligible: elOf(el), min: stepOpt || g.upTo || (g.distinctColors && k > 0) ? 0 : Math.min(want, el.length), max: want, prompt: `공개된 카드 중 선택${g.max > 1 ? ` (최대 ${g.max}장)` : ''} — ${g.label || ''}` });
        const got = [...new Set(r || [])].map(x => remaining[x]).filter(i => el.includes(i)).slice(0, want);
        if (!got.length) break;
        chosen.push(...got);
      }
      picked = chosen;
    }
    for (const gi of picked) {
      if (gone.has(gi)) continue;
      const opts = step.dests.filter(d => canDo(d, gi));
      if (!opts.length) continue;
      let d = opts[0];
      if (opts.length > 1) { const lab = { hand: '패에 추가', srcThis: '이 디지몬의 진화원 아래에 놓기', srcOwn: '자신의 디지몬의 진화원 아래에 놓기', trash: '파기', play: '등장', use: '사용' }; const c = await ctx.choose('multipleChoice', { prompt: `${nm(gi)}: 어떻게 하시겠습니까?`, options: opts.map(o => lab[o.k]) }); d = opts[typeof c === 'number' && c >= 0 && c < opts.length ? c : 0]; }
      await apply(d, gi);
    }
  }
  // the rest
  const restIds = revealed.filter((_, i) => !gone.has(i));
  if (!restIds.length) return;
  pl.deck.splice(0, restIds.length);
  const to = instr.restTo;
  if (to === 'trash') { pl.trash.push(...restIds); S.log(state, `${who} 나머지 ${restIds.length}장 파기: ${restIds.map(id => S.card(id).nameKo).join(', ')}`); S.emitGameEvent(state, 'deckDiscard', { owner: who, stack: null, cause: 'effect', ids: restIds.slice(), viaOpen: true }); return; }
  if (to === 'hand') { pl.hand.push(...restIds); S.log(state, `${who} 나머지 ${restIds.length}장을 패에 추가`); return; }
  let top = [], bottom = [];
  if (to === 'top') top = restIds; else if (to === 'bottom') bottom = restIds;
  else {
    const r = await ctx.choose('pickFromRevealed', { player: who, revealed: restIds, eligible: restIds.map((id, i) => ({ id, i })), min: 0, max: restIds.length, prompt: '덱 위에 되돌릴 카드 선택 (선택하지 않은 카드는 덱 아래로)', dest: '덱 위로 (나머지는 덱 아래로)' });
    const set = new Set((r || []).filter(x => Number.isInteger(x) && x >= 0 && x < restIds.length));
    restIds.forEach((id, i) => (set.has(i) ? top : bottom).push(id));
  }
  top = await S.orderPlacement(ctx.choose, who, top, '덱 위에 되돌릴 카드의 순서를 정하세요 (위쪽부터)');
  bottom = await S.orderPlacement(ctx.choose, who, bottom, '덱 아래로 되돌릴 카드의 순서를 정하세요 (위쪽부터)');
  pl.deck.unshift(...top); pl.deck.push(...bottom);
  S.log(state, `${who} 나머지 ${restIds.length}장을 덱 ${top.length ? `위 ${top.length}장` : ''}${top.length && bottom.length ? ' / ' : ''}${bottom.length ? `아래 ${bottom.length}장` : ''}으로 되돌림`);
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
    if (z !== 'sources') { (instr.zoneOwner === 'opp' ? state.players[ctx.opp] : pl)[z].forEach((id, i) => out.push({ z, i, id })); continue; }
    if (instr.srcOwn) { // "자신의 디지몬의 진화원에서 …": the evolution sources of ANY own Digimon (optionally only those matching srcFilter)
      // 3-4-7-5: 육성 에어리어의 디지몬은 육성 에어리어를 지정/참조하지 않는 효과의 대상이 아니다 -> 배틀 에어리어만
      for (const s of pl.battle) if (ctx.S.card(s.cardId).category === 'digimon' && (!instr.srcFilter || matchesFilter(ctx.S, s, instr.srcFilter, state))) s.sources.forEach((id, i) => { if (i >= ctx.S.fdCount(s)) out.push({ z: 'sources', st: s, i, id }); });
      continue;
    }
    if (st) st.sources.forEach((id, i) => out.push({ z: 'sources', i, id }));
    else if (evtIds) { const pool = evtIds.slice(); pl.trash.forEach((id, i) => { const k = pool.indexOf(id); if (k >= 0) { pool.splice(k, 1); out.push({ z: 'trash', i, id, left: true }); } }); }
  }
  return { st, entries: out.filter(e => instr.groups.some(g => matchesFilter(ctx.S, e.id, g.filter))) };
}
const moveEachSlots = (instr) => instr.upTo ? 1 : instr.groups.reduce((a, g) => a + (g.max || 1), 0); // upTo ("N장까지"): at least one card must be moved to count as paid
function moveEachPayable(ctx, instr) {
  const { entries, st } = moveEachEntries(ctx, instr);
  const slots = []; for (const g of instr.groups) for (let k = 0; k < (g.max || 1); k++) slots.push(g.filter);
  if (instr.upTo) slots.length = Math.min(slots.length, 1);
  if (instr.dest === 'thisSources' && !st) return false;
  if (instr.dest === 'otherSources' && !candidateStacks(ctx, ctx.self, { filter: instr.destFilter, anyKind: true, excludeSelf: !!instr.destExcludeSelf }).length) return false;
  return maxSlotMatching(ctx.S, entries.map(e => e.id), entries.map((_, i) => i), slots) >= slots.length;
}

// Battle-area stacks of `who` an effect may target: Digimon only (unless filter.category says otherwise), narrowed by the filter
// (current DP, state, sources…), by `excludeSelf` ("다른 …") and by an extreme ("가장 DP가 낮은 …": filter.extreme = { stat, dir }).
// 7-2-2-13: playing a Digimon card BY AN EFFECT (hand/trash/deck/revealed) may DigiXros too. Offers the legal materials (at least 1 or no DigiXros) and returns the
// playFreeFromZone opts { materials, restTamers } ({} when declined / not applicable). Call it before every effect-driven playFreeFromZone of a possible DigiXros card.
// `paidPlay` (P-205 Q4483/4665): the effect play pays a (reduced) cost, so 《어셈블리》 may be declared as well -> result.assembly (materials) / result.asmDiscount
export async function xrosOptsFor(ctx, who, zone, idx, paidPlay = false) {
  const { S, state } = ctx, pl = state.players[who];
  const playId = pl[zone] && pl[zone][idx];
  let asmRes = {};
  if (paidPlay && playId && S.card(playId).category === 'digimon' && S.planAssemblyFor) {
    const ap = S.planAssemblyFor(state, who, playId, zone, idx);
    if (ap && await ctx.choose('confirmEffect', { player: who, prompt: `${S.card(playId).nameKo}: 《어셈블리 -${ap.per}》 — 트래시의 ${ap.materials.map(m => S.card(m.cardId).nameKo).join(', ')}을(를) 아래에 놓고 등장 코스트 -${ap.discount}?` })) asmRes = { assembly: ap.materials, asmDiscount: ap.discount };
  }
  if (!playId || S.card(playId).category !== 'digimon' || !S.parseDigiXros(playId)) return asmRes;
  const cands = S.digiXrosOptions(state, who, idx, playId, zone);
  if (!cands.length) return asmRes;
  const go = await ctx.choose('multipleChoice', { prompt: `${S.card(playId).nameKo}: 《디지크로스》 — 재료를 아래에 놓고 등장시키시겠습니까?`, options: ['한다', '하지 않는다'] });
  if (go !== 0) return asmRes;
  const keys = new Set();
  for (const o of cands) {
    if (cands.length === 1) { keys.add(o.key); break; }
    const k = await ctx.choose('multipleChoice', { prompt: `${S.card(o.cardId).nameKo} (${o.kind === 'hand' ? '패' : o.kind === 'battle' ? '배틀 에어리어' : o.kind === 'tamer' ? '테이머 아래' : '트래시'})을(를) 아래에 놓겠습니까?`, options: ['놓는다', '놓지 않는다'] });
    if (k === 0) keys.add(o.key);
  }
  const plan = keys.size ? S.planDigiXrosPicked(state, who, idx, keys, playId, zone) : null;
  return plan ? { ...asmRes, materials: plan.materials, restTamers: plan.restTamers || [] } : asmRes;
}

// open-d (2): ONE shared prep for every bespoke effect-driven play (shard3 playPay/playFreeWhere, shard17 reveal-play, …): the paid part (tamer / trait / s1 hand-play discounts,
// hook play-cost options such as EX6-006) and the 7-2-2-13 DigiXros / 《어셈블리》 offers, exactly like s8_playOrUse. `cost` = the play cost the effect already computed (0 = free play).
// Returns { cost, idx, opts }: pay `cost` (S.spendMemory), then S.playFreeFromZone(state, who, zone, idx, {...ownOpts, ...opts}). The card may shift in the hand -> use the returned idx.
export async function effectPlayPlan(ctx, who, zone, idx, cost = 0) {
  const { S, state } = ctx, pl = state.players[who];
  const id = pl[zone] && pl[zone][idx];
  if (!id) return { cost, idx, opts: {} };
  const dig = S.card(id).category === 'digimon';
  const locked = S.isPlayCostLocked(state);
  cost = Math.max(0, cost || 0);
  if (cost > 0 && zone === 'hand' && dig && !locked) cost = Math.max(0, cost + S.tamerPlayCostDiscount(state, who, id) + S.traitPlayCostDiscount(state, who, id) + S.s1PlayDiscount(state, who, id));
  if (cost > 0 && zone === 'hand' && dig && !locked) {
    const hd = await S.effectPlayHookDiscount(state, who, id, (kd, pd) => ctx.choose(kd, pd)); if (hd) cost = Math.max(0, cost + hd);
    if (pl.hand[idx] !== id) { const k = pl.hand.indexOf(id); if (k >= 0) idx = k; } // (a hook cost may have discarded/moved cards)
  }
  const xo = dig ? await xrosOptsFor(ctx, who, zone, idx, cost > 0) : {};
  if (cost > 0 && !locked) cost = Math.max(0, cost - ((xo.materials || []).length ? (S.parseDigiXros(id)?.per || 0) * xo.materials.length : 0) - (xo.asmDiscount || 0));
  return { cost, idx: pl[zone] && pl[zone][idx] === id ? idx : (pl[zone] || []).indexOf(id), opts: xo };
}

let DISTINCT_SEQ = 0;
// several free plays compiled from ONE printed instruction ("A와 B 1장씩" / "N장") are simultaneous: they share a batchKey so a "…등장했을 때" watcher fires once (official Q&A 3664 EX5-062, 15-5-2)
const withPlayBatch = (ops) => { if (ops.length > 1) { const k = 'pb' + (++DISTINCT_SEQ); for (const o of ops) o.batchKey = k; } return ops; };
// 'opponentTurn' = 「상대의 턴 종료까지」, 'nextOpponentTurn' = 「다음 상대의 턴 종료 (시)까지」 (see S.durationEnd)
const oppDur = (t) => (/다음\s*상대/.test(t) ? 'nextOpponentTurn' : 'opponentTurn');
function candidateStacks(ctx, who, instr) {
  const { S, state } = ctx;
  let f = instr.filter;
  if (f?.ref) { // "소멸시킨 디지몬의 Lv. 이하" / "파기한 카드의 등장 코스트 이하" / "그 디지몬의 DP 이하": the value recorded when that Digimon/card was chosen
    let info = f.ref === 'discard' ? ctx._lastDiscardInfo : ctx._lastPickInfo;
    if (!info && f.ref === 'pick' && ctx.trigger?.evtStackUid) { // pass2-b7 (EX3-054): "그 디지몬의 등장 코스트 이하" inside an event trigger = the digimon that triggered it (no earlier pick in this script)
      const eu = ctx.trigger.evtStackUid; const ep = ['p1', 'p2'].find(q => state.players[q].battle.some(x => x.uid === eu)); const es = ep && state.players[ep].battle.find(x => x.uid === eu);
      if (es) { const ec = S.card(es.cardId); info = { level: ec.level ?? 0, dp: S.effectiveDP(state, ep, es), cost: ec.cost || 0 }; }
      else if (ctx.trigger.evtSnap?.cardId && !['play', 'digivolve'].includes(ctx.trigger.evtKind)) { const ec = S.card(ctx.trigger.evtSnap.cardId); info = { level: ec.level ?? 0, dp: ec.dp || 0, cost: ec.cost || 0 }; }
      else if (['play', 'digivolve'].includes(ctx.trigger.evtKind)) return []; // w4 (Q2198 BT17-076): "登場したとき" + "その デジモンのDP以下" — if that digimon has already left the battle area there is nothing to compare with, so nothing can be chosen
    }
    const { ref, refStat, refEq, ...rest } = f;
    const key = refStat === 'dp' ? (refEq ? 'dp' : 'dpMax') : refStat === 'level' ? (refEq ? 'level' : 'levelMax') : (refEq ? 'costEq' : 'costMax');
    f = info && info[refStat] != null ? { ...rest, [key]: info[refStat] } : rest;
  }
  if (f?.lvVsHand) { const { lvVsHand, ...rest } = f; const n = state.players[lvVsHand.side === 'self' ? ctx.self : ctx.opp].hand.length; f = { ...rest, [lvVsHand.dir === '이상' ? 'levelMin' : 'levelMax']: n }; } // Lv. compared with a hand size read at resolution time
  if (f?.srcMaxSelf || f?.srcMinSelf) { const { srcMaxSelf, srcMinSelf, ...rest } = f; const src = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); const n = src ? src.sources.length : 0; f = { ...rest, ...(srcMaxSelf ? { srcMax: n } : { srcMin: n }) }; } // "진화원 매수가 이 디지몬 이하/이상의 …" — sources counted at resolution
  if (f?.dpMaxSelf) { const src = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); f = { ...f, dpMax: src ? S.effectiveDP(state, ctx.self, src) : 0 }; } // "이 디지몬의 DP 이하의 …"
  let arr = state.players[who].battle.filter(s => (f?.category || instr.anyKind ? true : ['digimon', 'digitama'].includes(S.card(s.cardId).category)) && (!instr.excludeSelf || s.uid !== ctx.sourceStackUid) && matchesFilter(S, s, f, state));
  const ex = f?.extreme;
  if (ex && ex.stat === 'level') arr = arr.filter(s => (S.card(s.cardId).level || 0) > 0); // Lv.-less digimon have no Lv. to compare (official Q&A 2596/2807/3589)
  if (ex && arr.length) {
    const val = (s) => ex.stat === 'sources' ? s.sources.length : ex.stat === 'level' ? (S.card(s.cardId).level || 0) : ex.stat === 'cost' ? S.effectiveCost(state, s) : S.effectiveDP(state, who, s);
    const best = ex.dir === 'min' ? Math.min(...arr.map(val)) : Math.max(...arr.map(val));
    arr = arr.filter(s => val(s) === best);
  }
  if (instr.distinct && ctx._distinctPicks && ctx._distinctPicks[instr.distinct]) arr = arr.filter(s => !ctx._distinctPicks[instr.distinct].has(s.uid)); // 'N마리까지' = N distinct targets
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
  let lvAny = null; phrase = phrase.replace(/Lv\.(\d+)\s*(?:또는|\/)\s*Lv\.(\d+)((?:\s*(?:또는|\/)\s*Lv\.\d+)*)/, (a, x, y, z) => { lvAny = [Number(x), Number(y), ...[...z.matchAll(/\d+/g)].map(q => Number(q[0]))]; return ''; }); // "Lv.4 또는 Lv.5의 …"
  const flat = phrase.replace(/「[^」]*」/g, '「」').replace(/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))*(?:인|의|(?:을|를)\s*포함하는)/g, 'C');
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
  if ((m = phrase.match(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술되어\s*있는/))) f.mentionAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); // "「감마몬」이 기술되어 있는 카드" (name or text mentions it)
  if ((m = phrase.match(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함/))) f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
  const rest = phrase.replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\/?)+/g, '').replace(/명칭에\s*(?:「[^」]+」\/?)+/g, '');
  // short forms after "A와 B"-lists: "「오메가몬」을 포함하는 디지몬 카드" (= 명칭에 …), "《진격》을 가진 디지몬 카드"
  if (!f.nameAny && (m = rest.match(/^\s*((?:「[^」]+」\/?)+)\s*(?:을|를)\s*포함하는/))) f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
  if (!f.keywordText && (m = rest.match(/《([^》]+)》\s*(?:을|를)\s*(?:가진|갖는)/))) f.keywordHas = m[1]; // pass2-b6: "《X》를 가진" = currently HAS the keyword (granted too); "《X》가 기술되어 있는" = printed text
  if ((m = rest.match(/((?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))*)(?:인|의)/))) f.colors = m[1].split('/').map(x => FILTER_COLOR[x]);
  if (lvAny) f.levelAny = lvAny;
  if ((m = rest.match(/Lv\.(\d+)\s*이하/))) f.levelMax = Number(m[1]);
  else if ((m = rest.match(/Lv\.(\d+)\s*이상/))) f.levelMin = Number(m[1]);
  else if ((m = rest.match(/Lv\.(\d+)/))) f.level = Number(m[1]);
  if ((m = rest.match(/DP\s*(\d+)\s*(이하|이상)/))) f[m[2] === '이하' ? 'dpMax' : 'dpMin'] = Number(m[1]); // "DP 3000 이하의 디지몬 카드" (ST18-09/10 …): the DP bound was silently dropped for card (non-stack) filters
  if ((m = rest.match(/(?:등장\s*)?코스트\s*(\d+)\s*이하/))) f.costMax = Number(m[1]);
  else if ((m = rest.match(/(?:사용|등장)\s*코스트\s*(\d+)(?:의|인)\s/))) f.costEq = Number(m[1]); // "사용 코스트 7의 옵션 카드"
  if ((m = rest.match(/((?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))*)(?:을|를)\s*포함하는\s*(\d)\s*색\s*(이상)?/))) { f.colors = m[1].split('/').map(x => FILTER_COLOR[x]); if (m[3]) f.colorCountMin = Number(m[2]); else f.colorCount = Number(m[2]); } // "블랙을 포함하는 2색의 카드" / "그린/블루를 포함하는 2색 이상의 카드"
  if ((m = rest.match(/((?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트))\s*이외의/))) f.colorsNot = [FILTER_COLOR[m[1]]]; // "화이트 이외의 테이머 카드"
  if (/진화원\s*효과를\s*가진/.test(rest)) f.hasInherited = true; // "진화원 효과를 가진 테이머 카드"
  if (/디지크로스\s*조건을\s*가진/.test(rest)) f.hasXros = true; // "디지크로스 조건을 가진 카드"
  if ((m = rest.match(/(?:사용|등장)\s*코스트\s*(\d+)\s*이상/))) f.costMin = Number(m[1]); // "사용 코스트 2 이상의 옵션 카드"
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
  let cat = S.card(ctx.sourceCardId)?.category, also = false;
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid);
    if (st) { cat = S.card(st.cardId)?.category; also = cat !== 'digimon' && !!S.isAsDigimon(st); } // 「디지몬으로도 취급」: the effect counts as a Digimon's AND as its printed category's (Q6501/6505)
  }
  if (ctx.trigger?.optSide || ctx._optSide) { cat = 'option'; also = false; } // 4-6-6-3: the option side of a dual card is an OPTION card's effect (official Q&A: not blocked by 「디지몬의 효과를 받지 않는다」)
  return { player: ctx.self, category: cat, cardId: ctx.sourceCardId, stackUid: ctx.sourceStackUid || null, isDigimon: cat === 'digimon' || also, alsoDigimon: also };
}
const IMMUNE_SAFE_OPS = new Set(['destroy', 'destroySum', 'retreat', 'returnToHandStripSources', 'bounceToDeckBottomStripSources', 'rest', 'restAll', 'trashEvoSources', 'modifyDP', 'modifyDPAll', 'setDP', 'grantKeyword', 'restrictAttack', 'restrictAttackPlayer', 's4_forceOppAttack']); // w4 (Q2359 BT18-069): "상대는, 선택한 디지몬을 어택시킨다" acts on the PLAYER — an effect-immune digimon can still be chosen (and must attack)
const PICK_KINDS = new Set(['pickStack', 'pickStackAnySide', 'pickFromHand', 'pickFromZoneIndex', 'pickFromRevealed']);
function wrapChoose(ctx) {
  if (ctx._fxWrapped) return;
  ctx._fxWrapped = true;
  const orig = ctx.choose;
  ctx.choose = async (kind, payload) => {
    // 온라인 대전: "이 선택은 누구 몫인가"를 렌더링 쪽(main.js의 uiChoiceByOpponentOnline)이 payload.player로 판단하는데,
    // 카드 스크립트 중 상당수(특히 정보성 multipleChoice)가 player를 아예 안 채운다 — 그 경우 렌더 쪽 추정(Cpu.deciderFor)이
    // 'p1'으로 잘못 단정해서, 실제로는 상대(예: 게스트) 몫인 선택창이 그 상대 화면에서 "상대가 선택 중…"으로 숨어버리는
    // 사고가 났다. 이 효과를 실행하고 있는 주체(ctx.self)가 사실상 항상 맞는 기본값이므로 여기서 채워 넣는다.
    if (payload && payload.player === undefined) payload = { ...payload, player: ctx.self };
    // 선택 대상이 상대 디지몬이면 payload.player는 "대상의 주인"이라 결정권자와 다르다 — 결정권자(효과를 실행 중인 쪽)를 따로 실어 둔다
    if (payload && payload._self === undefined) payload = { ...payload, _self: ctx.self };
    // 3-1-3-4: the player behind the effect orders cards it moves; and "상대 디지몬의 진화원을 선택해서 파기" is the effect user's pick even though the sources belong to the opponent
    if ((kind === 'orderCards' || kind === 'pickSourcesMulti') && payload && payload.player && payload.player !== ctx.self && payload.decider === undefined) payload = { ...payload, decider: ctx.self };
    if (ctx._deciderOverride && payload && payload.decider === undefined) payload = { ...payload, decider: ctx._deciderOverride }; // (revealTop of the opponent's deck: the effect's user decides - see case 'revealTop')
    // 1-3-6: when a rule/effect makes you choose cards, you must choose at least 1 — unless the effect text is an
    // optional one ("…할 수 있다" / "N장까지"). The UI hides its cancel button for required picks that have candidates.
    if (PICK_KINDS.has(kind) && payload && payload.required === undefined && ctx.trigger && typeof ctx.trigger.text === 'string') {
      const optional = /수\s*있다|까지|없어도|않아도|않을\s*수/.test(ctx.trigger.text.replace(/\([^()]*\)/g, ''));
      payload = { ...payload, required: !optional };
    }
    const { state, S } = ctx;
    const battlePick = /배틀할/.test(String((payload && payload.prompt) || '')); // 공식 Q&A idx6047 등: 「효과를 받지 않는」 디지몬도 「배틀할 수 있다」 효과로 골라 배틀시킬 수 있다 (배틀 자체는 효과가 아니라 DP를 비교하는 룰)
    if (kind === 'pickStack' && payload && Array.isArray(payload.uids) && payload.player && payload.player !== ctx.self) {
      const fk = payload.fxKind || FX_KIND_OF_OP[state._fxOp] || 'other';
      const pl = state.players[payload.player];
      // 15-15-5-3: an immune Digimon CAN be chosen (the effect just has no result on it). Every op in IMMUNE_SAFE_OPS handles immunity in its
      // own outcome (one-shot ops: state.js effectBlocked; grants: S.grantGate records them). Other ops keep the legacy "not offered" filter.
      if (!IMMUNE_SAFE_OPS.has(state._fxOp) && !battlePick) {
        const uids = payload.uids.filter(u => { const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === u); return !st || !S.effectBlocked(state, payload.player, st, fk); });
        if (payload.uids.length && !uids.length) { S.log(state, '대상이 될 수 있는 디지몬이 없음 (상대의 효과를 받지 않음)'); return null; }
        payload = { ...payload, uids };
      }
    }
    if (kind === 'pickStackAnySide' && payload && Array.isArray(payload.entries) && !IMMUNE_SAFE_OPS.has(state._fxOp) && !battlePick) {
      const fk = FX_KIND_OF_OP[state._fxOp] || 'other';
      const entries = payload.entries.filter(e => { if (e.player === ctx.self) return true; const pl = state.players[e.player]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === e.uid); return !st || !S.effectBlocked(state, e.player, st, fk); });
      payload = { ...payload, entries };
    }
    // 룰 15-15-7-4 (Ver.4.3에서 변경): 예전에는 "다른 효과를 발휘시키는 효과가 강제 효과면, 선택된 다른 효과의
    // 임의 처리 조건도 강제로 처리한다"였으나, Ver.4.3부터는 강제 효과라도 그 임의 처리 조건을 처리할지는
    // 플레이어가 선택할 수 있다. 따라서 여기서 confirmEffect를 강제로 true 처리하지 않고, 일반적인 선택 흐름
    // (UI 프롬프트/CPU 판단)에 맡긴다.
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
// card-id multiset of a deck: "덱이 늘어났을 때" also covers draw-then-return (net size 0) — official Q&A slice6 G225; open-and-return keeps the multiset
function deckCount(deck) { const m = new Map(); for (const id of deck) m.set(id, (m.get(id) || 0) + 1); return m; }
function fxSnapshot(state) {
  const snap = {};
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    snap[pp] = { hand: pl.hand.length, deck: pl.deck.length, deckIds: deckCount(pl.deck), stacks: new Map([pl.raising, ...pl.battle].filter(Boolean).map(st => [st.uid, { cardId: st.cardId, sources: st.sources.slice() }])) };
  }
  return snap;
}
function fxEmit(ctx, instr, snap) {
  const { state, S } = ctx;
  S.normalizeDigitamaZones(state); // unres-A (1): a Digi-Egg (EX2-007) "returned to hand/deck/security" is redirected to the digi-egg deck bottom before any 「늘어났을 때」 comparison (Q1198/1265/2402/3558)
  const skipHand = /evolve|jogress|digivolve|fuse/i.test(instr.op);
  const cat = fxSourceOf(ctx).category;
  for (const pp of ['p1', 'p2']) {
    const pl = state.players[pp];
    if (pl.deck.length > snap[pp].deck || (snap[pp].deckIds && [...deckCount(pl.deck)].some(([id, n]) => n > (snap[pp].deckIds.get(id) || 0)))) S.emitGameEvent(state, 'deckIncrease', { owner: pp, stack: null, cause: 'effect', srcPlayer: ctx.self }); // s8: "덱이 (자신의 효과로) 늘어났을 때"
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
    if (c.op === 'destroy' && c.mode === 'choose') return candidateStacks(ctx, c.target === 'opponent' ? ctx.opp : ctx.self, c).length >= instr.cost.filter(x => x.op === 'destroy' && x.mode === 'choose' && (x.target === 'opponent') === (c.target === 'opponent')).length; // sacrifice: enough legal picks
    if (c.op === 'destroy') return !!st;
    if (c.op === 'rest' && c.target === 'self') return candidateStacks(ctx, ctx.self, { ...c, anyKind: !c.digimonOnly }).length >= instr.cost.filter(x => x.op === 'rest' && x.target === 'self').reduce((a, x) => a + (x.n || 1), 0);
    if (c.op === 'rest' && c.target === 'opponent') return candidateStacks(ctx, ctx.opp, { ...c, anyKind: !c.digimonOnly }).length >= (c.n || 1);
    if (c.op === 'unsuspend' && c.thisStack !== false) return !!st && !!st.suspended;
    if (c.op === 'moveEach') return moveEachPayable(ctx, c); // every listed criterion needs its own card (15-7-3: no partial cost)
    if (c.op === 'placeUnderSource') { const pl0 = state.players[ctx.self]; return candidateStacks(ctx, ctx.self, { filter: c.targetFilter }).length > 0 && c.zones.some(z => pl0[z].filter(id => matchesFilter(S, id, c.filter)).length >= (c.n || 1)); }
    if (c.op === 'securityTopToHand') return state.players[ctx.self].security.length >= (c.n || 1);
    if (c.op === 'trashEvoSources' && c.thisStack) return !!st && st.sources.length >= c.count;
    if (c.op === 'returnToHandStripSources' && c.thisStack) return !!st;
    if (c.op === 'returnToHandStripSources' && (c.target === 'self' || c.target === 'opponent') && !c.thisStack) return candidateStacks(ctx, c.target === 'opponent' ? ctx.opp : ctx.self, c).length >= (c.n || 1);
    if (CARD_OPS[c.op + '$payable']) return !!CARD_OPS[c.op + '$payable'](c, ctx, { candidateStacks, matchesFilter }); // shard ops used as costs (shard20 protocol)
    return true;
  });
}
// 15-7-1: the player's yes/no for an optional processing condition ("~하는 것으로"). The payload identifies the effect (cardId / costKinds / effectText) for the CPU (cpu.js) and the UI.
const COST_KIND_OF = { trashHand: 'trashHand', removeSecurity: 'removeSecurity', restStack: 'restTamer', rest: 'restOwn', destroy: 'destroyOwn', unsuspend: 'unsuspend', moveEach: 'moveCards', placeUnderSource: 'placeUnder', securityTopToHand: 'securityToHand', trashEvoSources: 'trashSources', returnToHandStripSources: 'returnOwn', gainMemory: 'memory', manualCost: 'manual' };
const COST_LABEL = { trashHand: '패를 파기', removeSecurity: '시큐리티를 파기', restTamer: '이 카드를 레스트', restOwn: '자신의 디지몬/테이머를 레스트', destroyOwn: '자신의 디지몬을 소멸', unsuspend: '액티브로 함', moveCards: '카드를 덱 아래 등으로 이동', placeUnder: '카드를 진화원 아래에 놓음', securityToHand: '시큐리티를 패에 추가', trashSources: '진화원을 파기', returnOwn: '자신의 디지몬을 되돌림', memory: '메모리/코스트를 지불', manual: '수동 비용' };
export function costKindsOf(cost) { return (cost || []).map(c => (c.op === 'destroy' && c.target === 'opponent') ? 'destroyOpp' : COST_KIND_OF[c.op] || c.op); }
async function askOptionalCost(ctx, instr) {
  if (ctx._optAsked) { ctx._optAsked = false; return true; } // the runner already asked for this whole effect ("할 수 있다" prompt)
  const { S } = ctx;
  const kinds = costKindsOf(instr.cost);
  const name = (S.card(ctx.sourceCardId) || {}).nameKo || ctx.sourceCardId;
  const costText = (instr.costText || kinds.map(k => COST_LABEL[k] || k).join(', ')).replace(/\s+/g, ' ').trim();
  const effText = (instr.thenText || '').replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  const prompt = `${name}: 「${costText.slice(0, 80)}」 하는 것으로 ${effText ? '「' + effText.slice(0, 80) + '」 ' : ''}— 비용을 지불하고 효과를 발휘할까요? (아니오 = 효과 전체를 건너뜀)`;
  return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt, optionalCost: true, cardId: ctx.sourceCardId, costKinds: kinds, costText, effectText: effText }));
}
// A 【메인】 (activated) ability that has an optional processing condition may only be DECLARED while that condition can be executed (15-8-4-4-1).
export function mainAbilityPayable(state, S, p, stackUid, cardId, tags, text) {
  let script;
  try { script = lookupCardSpecific(cardId, tags, text) || compileToScript(text); } catch (e) { return true; }
  let first = (script || [])[0];
  // a leading "if <cond> -> [costGroup]" wrapper (e.g. EX7-065 "패가 4장 이하라면, 이 테이머를 레스트시키는 것으로 …"): the wrapped cost still has to be payable to declare the ability
  if (first && first.op === 'condition' && (first.then || []).length === 1 && first.then[0].op === 'costGroup' && !(first.else || []).length) first = first.then[0];
  if (!first || first.op !== 'costGroup') return true;
  return costGroupPayable({ state, S, self: p, opp: S.opponentOf(p), sourceStackUid: stackUid }, first);
}

// ---- 15-7-1 optional-cost gate for effects the compiler did not turn into a costGroup (bespoke shard scripts, watcher-rested tamers) ----
// "<비용>하는 것으로, <효과>" printed in the FIRST sentence of a triggered effect: ask the player (naming the card, the cost and the benefit) BEFORE the bespoke script pays anything.
export function optionalCostSplit(text) {
  let t = String(text || '').replace(/\([^()]*\)/g, ' ').replace(/〈룰〉[^\n]*/g, ' ').replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '').replace(/Lv\./g, 'Lv');
  if (/\n\s*[·▷]/.test(t)) return null; // multi-bullet / choose-one texts keep their own handling
  t = t.replace(/「[^」]*」/g, s => s.replace(/것으로/g, '것○로')).replace(/\s+/g, ' ').trim();
  const m = /^(.{2,200}?[가-힣》≫]\s*는)\s*것으로(?!\s*도|\s*취급)\s*,?\s*(.*)$/.exec(t);
  if (!m || /[.。]\s*\S/.test(m[1])) return null; // must be inside the first sentence
  const cost = m[1].replace(/^.*(?:때|경우|라면|다면|있다면|있을 때|한 때),\s*/, '').replace(/^그\s*후,?\s*/, '').replace(/[○]/g, '으').trim();
  return { costText: cost, effectText: m[2].replace(/○/g, '으').replace(/[.。]\s*$/, '').trim() };
}
export function inferCostKinds(costText) {
  const c = String(costText || ''), k = [];
  if (/레스트/.test(c) && /이\s*(?:테이머|디지몬|카드)/.test(c)) k.push('restTamer'); else if (/레스트/.test(c)) k.push('restOwn');
  if (/시큐리티/.test(c) && /(파기|패에|트래시)/.test(c)) k.push('removeSecurity');
  if (/소멸/.test(c)) k.push(/상대/.test(c) ? 'destroyOpp' : 'destroyOwn');
  if (/진화원/.test(c) && /(파기|되돌|덱)/.test(c)) k.push('trashSources');
  if (/패(?:에서|를)?[^,]*파기|파기[^,]*패/.test(c) || /자신의 패[^,]*\d\s*장/.test(c) && /파기/.test(c)) k.push('trashHand');
  if (/(패로|덱\s*아래)[^,]*되돌/.test(c) || /되돌리/.test(c)) k.push('returnOwn');
  if (/(놓는)/.test(c) && /아래/.test(c)) k.push('placeUnder');
  if (/코스트\s*지불|메모리/.test(c)) k.push('memory');
  return k.length ? k : ['other'];
}
function scriptOwnConfirms(script) {
  const seen = (ops) => (Array.isArray(ops) ? ops : []).some(o => o && (/confirm|askYN|yesNo|askYes/i.test(String(o.fn || '')) || (CARD_OPS[o.op] && /confirm|askYN|yesNo|askYes/i.test(String(CARD_OPS[o.op]))) || seen(o.then) || seen(o.else) || seen(o.cost)));
  return seen(script);
}
const scriptHasCostGroup = (ops) => Array.isArray(ops) && ops.some(o => o && (o.op === 'costGroup' || scriptHasCostGroup(o.then) || scriptHasCostGroup(o.else)));
async function optionalGate(script, ctx) {
  const tr = ctx.trigger; const { state, S } = ctx;
  ctx._gateDone = true;
  if (!tr || tr.manualOnly || tr.schedFn || ctx._optAsked || !Array.isArray(script) || !script.length) return true;
  const mk = (costText, effectText, kinds) => ctx.choose('confirmEffect', { player: ctx.self, prompt: `${(S.card(ctx.sourceCardId) || {}).nameKo || ctx.sourceCardId}: 「${String(costText).slice(0, 80)}」 하는 것으로 ${effectText ? '「' + String(effectText).slice(0, 80) + '」 ' : ''}— 비용을 지불하고 효과를 발휘할까요? (아니오 = 효과 전체를 건너뜀)`, optionalCost: true, cardId: ctx.sourceCardId, costKinds: kinds, costText, effectText });
  const refund = () => { if (tr.onceKey && tr.stackUid) { const st = [state.players.p1, state.players.p2].flatMap(q => [q.raising, ...q.battle]).find(x => x && x.uid === tr.stackUid); const u = st && st.turnEffectUses; if (u && u[tr.onceKey] > 0) u[tr.onceKey]--; } };
  if (tr.restPending && !tr.restPaid) { // a watcher-queued "이 테이머를 레스트시키는 것으로, …": the tamer is rested only when the player agrees
    const holder = [state.players.p1, state.players.p2].flatMap(q => [q.raising, ...q.battle]).find(x => x && x.uid === tr.stackUid);
    if (!holder || holder.suspended) { S.log(state, `${ctx.self} 이미 레스트 상태라 비용을 지불할 수 없어 효과를 건너뜀`); ctx._declined = true; ctx._costUnpaid = true; refund(); return false; }
    if (!(await mk('이 테이머를 레스트', String(tr.text || '').replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').trim(), ['restTamer']))) { S.log(state, `${ctx.self} 비용을 지불하지 않기로 함 — 효과를 발휘하지 않음`); ctx._declined = true; ctx._costUnpaid = true; refund(); return false; }
    holder.suspended = true; tr.restPaid = true; ctx._optAsked = true;
    return true;
  }
  if (scriptHasCostGroup(script) || scriptOwnConfirms(script) || (ctx.trigger && ctx.trigger.optGateDone)) return true;
  const sp = optionalCostSplit(tr.text);
  if (!sp) return true;
  if (!(await mk(sp.costText, sp.effectText, inferCostKinds(sp.costText)))) { S.log(state, `${ctx.self} 비용을 지불하지 않기로 함 — 효과를 발휘하지 않음`); ctx._declined = true; ctx._costUnpaid = true; refund(); return false; }
  ctx._optAsked = true;
  return true;
}

export async function runScript(script, ctx) {
  const { state, S } = ctx;
  wrapChoose(ctx);
  if (ctx.trigger && !ctx._gateDone && !(await optionalGate(script, ctx))) return;
  const prevSrc = state._fxSrc, prevCaster = state._caster;
  state._caster = ctx.self; // S.durationEnd resolves 「상대의/자신의 턴 종료까지」 relative to the effect's controller
  if (!prevSrc) S.beginCause(state); // 15-8-5-4: a new cause (effect resolution) — immediate effects may be used once again
  state._fxSrc = fxSourceOf(ctx);
  state._rcDepth = (state._rcDepth || 0) + 1; // 17-1-2-2: no rule check while an effect is being processed
  // effect-visibility (presentation only): the outermost resolution gets a record that log()/deleteStack() attribute their lines to
  let fxRec = null;
  if (!state._fxRec) {
    try {
      const tr = ctx.trigger || {};
      fxRec = S.fxNewRec(state, { kind: 'effect', cardId: ctx.sourceCardId, owner: ctx.self, tag: (tr.tags || ctx.tags || []).map(t => String(t).replace(/^__/, '')).join('】【'), inherited: !!tr.inherited, kw: tr.kw || null }, tr.text || ctx.text || '');
      state._fxRec = fxRec;
    } catch (e) { fxRec = null; }
  }
  try {
    for (const instr of script || []) {
      if (instr && instr.op === 'costGroup') { // pass2-b7: 15-7-2 — a cost that was not (fully) paid cancels the WHOLE effect, incl. the later sentences ("또한/그 후, …") compiled after the costGroup
        const was = ctx._costUnpaid; ctx._costUnpaid = false;
        await runOne(instr, ctx);
        if (ctx._costUnpaid) break;
        ctx._costUnpaid = was;
        continue;
      }
      await runOne(instr, ctx);
    }
  } finally {
    if (fxRec) { state._fxRec = null; try { S.fxCommit(state, fxRec); } catch (e) { /* presentation only */ } }
    state._fxSrc = prevSrc; state._caster = prevCaster;
    if (--state._rcDepth <= 0) { state._rcDepth = 0; S.flushLeaves(state); S.flushRuleChecks(state); }
  }
}

const RES_SKIP = new Set(['condition', 'costGroup', 'effectChoice', 'oppMayPay', 'noop', 'afterBattle']);
function resSnap(state, self) {
  const o = self === 'p1' ? 'p2' : 'p1', P = state.players;
  return { sb: P[self].battle.length, ob: P[o].battle.length, sh: P[self].hand.length, oh: P[o].hand.length, st: P[self].trash.length, ot: P[o].trash.length, susp: [...P.p1.battle, ...P.p2.battle].filter(x => x.suspended).length, ss: P[self].security.length, os: P[o].security.length, sd: P[self].deck.length, od: P[o].deck.length };
}
function resDiff(a, b, op) {
  return { deleted: Math.max(0, a.sb - b.sb) + Math.max(0, a.ob - b.ob), played: Math.max(0, b.sb - a.sb) + Math.max(0, b.ob - a.ob), discarded: op === 's13_trimTo' ? Math.max(0, a.sh - b.sh) + Math.max(0, a.oh - b.oh) + Math.max(0, a.ss - b.ss) + Math.max(0, a.os - b.os) : op === 'trashHand' || op === 'oppMayPay' ? Math.max(0, a.sh - b.sh) + Math.max(0, a.oh - b.oh) : op === 'removeSecurity' ? Math.max(0, a.ss - b.ss) + Math.max(0, a.os - b.os) : 0,
    added: Math.max(0, b.sh - a.sh), rested: Math.max(0, b.susp - a.susp), bounced: Math.max(0, b.oh - a.oh) + Math.max(0, b.sh - a.sh) + Math.max(0, b.od - a.od) + Math.max(0, b.sd - a.sd) }; // b14: 덱 위/아래로 되돌린 것도 「되돌렸다」 (LM-039 「이 효과로 되돌아가지 않았다면」)
}
// ---- revealTop helpers: per-group destinations (hand / trash / play / evolve / useOption / sourcesThis / tamerUnder / sourcesOf / security) ----
// evolve target stacks: 'this' = the effect's own Digimon, 'attacker' = the Digimon that attacked (watcher event), otherwise any own Digimon
function revealEvoTargets(ctx, who, g) {
  const { state, S } = ctx;
  const bt = state.players[who].battle.filter(s => S.card(s.cardId).category === 'digimon');
  if (g.evoTarget === 'this') return bt.filter(s => s.uid === ctx.sourceStackUid);
  if (g.evoTarget === 'attacker') { const a = bt.filter(s => s.uid === ctx.trigger?.evtStackUid); if (a.length) return a; }
  return bt;
}
function revealCanEvo(ctx, who, st, id) {
  const { state, S } = ctx;
  if (!ctx.E || !ctx.E.canEvolveAny) return true;
  return ctx.E.canEvolveAny(st.cardId, id, S.evoExtraArg(state, who, st), S.evolveTargetRestriction(state, who, st)).ok;
}
// narrow the pick criteria to revealed cards that can really be used that way (an Option can't be played; a card that can't evolve onto the target isn't offered)
function adaptRevealPick(ctx, who, pick, revealed) {
  if (!pick) return pick;
  const { state, S } = ctx;
  const narrow = (g) => {
    const dest = g.dest || pick.action || 'hand';
    let ids = null;
    if (dest === 'play') ids = revealed.filter(id => S.card(id).category !== 'option');
    else if (dest === 'evolve') { const sts = revealEvoTargets(ctx, who, { ...pick, ...g }); ids = revealed.filter(id => S.card(id).category === 'digimon' && sts.some(st => revealCanEvo(ctx, who, st, id))); }
    else if (dest === 'useOption') ids = revealed.filter(id => S.isOptionLike(id) && S.optionColorOk(state, who, id));
    return ids ? { ...g, filter: { ...(g.filter || {}), idIn: ids } } : g;
  };
  if (pick.groups) return { ...pick, groups: pick.groups.map(narrow) };
  const one = narrow({ filter: pick.filter });
  return one.filter === pick.filter ? pick : { ...pick, filter: one.filter };
}
async function routeRevealed(ctx, who, instr, ids, dests, gps) {
  const { state, S } = ctx;
  const pl = state.players[who];
  const base = pl.hand.length - ids.length;
  for (let k = ids.length - 1; k >= 0; k--) { // the cards were appended to the hand in order; walking backwards keeps the earlier indices valid
    const id = ids[k], dest = dests[k], g = { ...(instr.pick || {}), ...(gps[k] || {}) }, ix = base + k;
    if (dest === 'hand' || pl.hand[ix] !== id) continue;
    const nm = S.card(id).nameKo;
    if (dest === 'trash') { pl.hand.splice(ix, 1); pl.trash.push(id); S.log(state, `${who} ${nm} 파기 (오픈한 카드)`); }
    else if (dest === 'security') { pl.hand.splice(ix, 1); S.addToSecurity(state, who, id, g.secPos || 'top'); }
    else if (dest === 'play') {
      if (S.isOptionLike(id)) continue; // (a dual card has no 등장 코스트 either)
      const st = S.playFreeFromZone(state, who, 'hand', ix, { rested: !!g.rested, noTriggers: !!g.noTriggers, ...(await xrosOptsFor(ctx, who, 'hand', ix)) });
      if (st) { ctx._lastPick = { player: who, uid: st.uid }; ctx._revealPlayed = (ctx._revealPlayed || 0) + 1; }
    } else if (dest === 'evolve') {
      const cands = revealEvoTargets(ctx, who, g).filter(st => revealCanEvo(ctx, who, st, id));
      if (!cands.length) { S.log(state, `${who} ${nm}: 진화시킬 수 있는 디지몬이 없음`); continue; }
      const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: who, uids: cands.map(s => s.uid), prompt: `${nm}(으)로 진화시킬 디지몬 선택` });
      if (uid && S.digivolve(state, who, uid, id, 0, 'hand')) ctx._revealEvolved = true;
    } else if (dest === 'useOption') {
      if (!S.isOptionLike(id) || !S.optionColorOk(state, who, id) || S.s1HookAny(state, 's1cannotUseOption', { p: who }) || S.timedLocked(state, who, 'option')) continue;
      pl.hand.splice(ix, 1); pl.trash.push(id);
      S.log(state, `${who} ${nm} 코스트를 지불하지 않고 사용`);
      ctx._lastUsedOption = true;
      S.queueTriggersFor(state, who, id, 'use');
      S.emitGameEvent(state, 'optionUsed', { owner: who, stack: null, cardId: id, cause: 'effect', useCost: 0 });
    } else if (dest === 'sourcesThis' || dest === 'tamerUnder' || dest === 'sourcesOf') {
      let st = null;
      if (dest === 'sourcesOf') { const cs = candidateStacks(ctx, who, { filter: g.targetFilter, anyKind: true }); const u = cs.length <= 1 ? cs[0]?.uid : await ctx.choose('pickStack', { player: who, uids: cs.map(s => s.uid), prompt: `${nm}을(를) 진화원 아래에 놓을 대상 선택` }); st = cs.find(s => s.uid === u) || null; }
      else st = [pl.raising, ...pl.battle].filter(Boolean).find(s => s.uid === ctx.sourceStackUid) || null;
      if (!st) { S.log(state, `${who} ${nm}을(를) 놓을 대상이 없음`); continue; }
      pl.hand.splice(pl.hand[ix] === id ? ix : pl.hand.lastIndexOf(id), 1);
      if (dest === 'tamerUnder') st.sources.unshift(id); else st.sources.splice(S.fdCount(st), 0, id); // bottom of the (face-up) sources
      S.recomputeStackGrants(st);
      S.log(state, `${who} ${nm}을(를) ${S.card(st.cardId).nameKo} 아래에 놓음`);
    }
  }
}

async function runOne(instr, ctx) {
  const { state } = ctx;
  if (instr.filter && (instr.filter.srcMaxSelf || instr.filter.srcMinSelf)) { // "진화원 매수가 이 디지몬 이하/이상의 …": resolve against the source stack's sources at run time (all ops, incl. restAll/preventRest)
    const { srcMaxSelf, srcMinSelf, ...rest } = instr.filter;
    const src = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid);
    const n = src ? src.sources.length : 0;
    return runOne({ ...instr, filter: { ...rest, ...(srcMaxSelf ? { srcMax: n } : { srcMin: n }) } }, ctx);
  }
  if (instr.exclSame) { // "이 효과로는 자신의 테이머/디지몬과 같은 명칭의 카드는 등장시킬 수 없다": the names on the board now become an excluded-name filter
    const cat = instr.exclSame === 'tamer' ? 'tamer' : 'digimon';
    const names = state.players[ctx.self].battle.filter(s => ctx.S.card(s.cardId).category === cat).flatMap(s => ctx.S.effectiveInfo(state, s).names);
    return runOne({ ...instr, exclSame: null, filter: { ...(instr.filter || {}), exclNames: names } }, ctx);
  }
  if (instr.capIf) { // "<조건>이라면 이 효과의 상한 ±M": ceiling shift only when the printed condition holds
    const { test, delta, stat } = instr.capIf, d = (await test(ctx)) ? delta : 0, key = { dp: 'dpMax', level: 'levelMax', cost: 'costMax' }[stat];
    const adj = instr.op === 'destroySum' ? { ...instr, limit: instr.limit + d } : { ...instr, filter: { ...instr.filter, [key]: (instr.filter?.[key] ?? 0) + d } };
    return runOne({ ...adj, capIf: null }, ctx);
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
    if (base.op === 'retreat' && !base.all) return runOne({ ...base, n: (base.n || 1) * k, exact: true }, ctx); // b12: "상대의 디지몬 1마리를 <N>마다 《퇴화 1》" = ONE digimon peeled N stages (EX9-043)
    if (base.op === 'modifyDP') return runOne({ ...base, amount: base.amount * k }, ctx); // "상대의 디지몬 1마리를 자신의 디지몬 1마리마다 DP -N": ONE target gets N×k (BT22-042, BT23-033), not k separate picks
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
  if (top) state._delBatch = new Set(); // 15-5-2 (Q&A 909): digimon deleted together by one instruction fire a "소멸했을 때" watcher once
  if (top) state._discardBatch = new Set(); // 15-5-2: several hand cards discarded inside one instruction trigger a hand-discard watcher once
  if (top) state._playBatch = instr.batchKey ? ((ctx._pbSets ||= {})[instr.batchKey] ||= new Set()) : new Set(); // 15-5-2 (Q3664 EX5-062): digimon played simultaneously by ONE instruction (batchKey groups the ops of one printed sentence) fire a "…등장했을 때" watcher once
  const resBefore = RES_SKIP.has(instr.op) ? null : resSnap(state, ctx.self);
  try { await runOneCore(instr, ctx); }
  finally { fxDepth--; state._fxOp = prevOp; if (top) { state._secDecBatch = null; state._discardBatch = null; state._delBatch = null; state._playBatch = null; } }
  if (resBefore) ctx._res = resDiff(resBefore, resSnap(state, ctx.self), instr.op); // what THIS instruction did, for a later "이 효과로 …했다면"
  // official Q&A (EX2-012 Q3302, BT9-017 Q1814): resDiff's battle-area-length-based "deleted" count is fooled by a
  // ≪디코이≫/≪수호≫ replacement — the specifically targeted stack survives, but a DIFFERENT stack in the same battle
  // area is removed instead, so the raw length delta still reads "something died". The 'destroy' op already tracks
  // whether ITS OWN intended target(s) were actually removed (ctx._lastDestroyed) — trust that instead here.
  if (instr.op === 'destroy' && ctx._lastDestroyed != null && ctx._res) ctx._res = { ...ctx._res, deleted: ctx._lastDestroyed ? 1 : 0 };

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
      if (instr.optional && !(await ctx.choose('confirmEffect', { player: who, prompt: `덱 위에서부터 ${instr.n}장을 파기할까요?` }))) break; // b10
      S.trashTopOfDeck(state, who, instr.n);
      break;
    case 'unblockableSelf': { const st = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); if (st) (st.s1 ||= {}).unblockable = S.durationEnd(state, instr.duration || 'turn'); break; }
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
      let posR = instr.position;
      if (posR === 'either' && state.players[who].security.length > 1) { const kE = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '시큐리티를 어느 쪽에서부터 파기할까요?', options: ['위에서부터', '아래에서부터'] }); posR = kE === 1 ? 'bottom' : 'top'; }
      const id = posR === 'bottom' ? S.trashBottomSecurityByEffect(state, who) : S.trashTopSecurityByEffect(state, who);
      instr._result = id;
      break;
    }
    case 'revealPick': await runRevealPick(instr, ctx); break;
    case 'revealTop': {
      let dWho = who;
      if (instr.nMulOpp || instr.pick?.maxMulOpp) { // "상대 디지몬 1마리마다": N per opposing Digimon (0 Digimon -> nothing happens)
        const oc = state.players[ctx.opp].battle.filter(s => S.isDigimonLike(s)).length;
        if (!oc && instr.nMulOpp) { S.log(state, '상대의 디지몬이 없어 효과를 처리하지 않음'); break; } // (maxMulOpp only scales the pick count: with 0 opp digimon the cards are still opened and the rest discarded — BT8-068 Q1660)
        instr = { ...instr, ...(instr.nMulOpp ? { n: instr.n * oc } : {}), ...(instr.pick?.maxMulOpp ? { pick: { ...instr.pick, max: (instr.pick.max || 1) * oc } } : {}) };
      }
      if (instr.optionalReveal && !(await ctx.choose('confirmEffect', { player: who, prompt: `덱 위 ${instr.n}장을 오픈할까요?` }))) break; // "오픈할 수 있다"
      if (instr.whoChoice) { // "자신/상대의 덱 위에서부터 N장 오픈" — '/' = OR: the player chooses whose deck
        const wi = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '어느 쪽 덱을 오픈할까요?', options: ['자신의 덱', '상대의 덱'] });
        if (wi === 1) dWho = ctx.opp;
      }
      // 3-1-3-4 / the effect's user decides every pick and ordering even when the OPPONENT's deck is revealed (the cards belong to `dWho`, the decisions to ctx.self) - wrapChoose stamps `decider` on each prompt below
      if (dWho !== ctx.self) ctx._deciderOverride = ctx.self;
      try {
      const revealed = S.revealTop(state, dWho, instr.n);
      if (revealed.length) S.log(state, `${dWho} 덱 위 ${revealed.length}장 오픈: ${revealed.map(id => S.card(id).nameKo).join(', ')}`);
      instr = { ...instr, n: revealed.length, pick: adaptRevealPick(ctx, dWho, instr.pick, revealed) }; // (a deck with fewer cards than N reveals what is left)
      // "등장 코스트 N 이하" / "코스트를 지불하지 않고 등장" — Options have no appearance cost and can never be played, so they are not offered
      const eligible = revealed.map((id, i) => ({ id, i })).filter(x => matchesFilter(S, x.id, instr.pick?.filter) && !(instr.pick?.action === 'play' && S.isOptionLike(x.id)));
      let chosenIdxs;
      if (instr.pick?.noPick) chosenIdxs = []; // reveal only (BT18-068 / BT24-005): every card goes back
      else if (instr.pick?.all && !instr.pick?.groups) { // "…카드 전부를 패에 추가한다 / 파기한다": every matching card, no choice (the reveal is still shown)
        chosenIdxs = eligible.map(x => x.i);
        await ctx.choose('pickFromRevealed', { player: dWho, revealed, eligible, min: eligible.length, max: eligible.length, prompt: eligible.length ? `조건에 맞는 카드 전부(${eligible.length}장)를 처리합니다 — 확인` : '공개된 카드 중 조건에 맞는 카드가 없습니다', dest: instr.pick?.action || 'hand' });
      }
      else if (instr.pick?.groups) { // several "<조건> N장과 <조건> N장" groups: pick up to N per group, a card counts for one group only
        if (!instr.pick.groups.some(g => revealed.some(id => matchesFilter(S, id, g.filter)))) await ctx.choose('pickFromRevealed', { player: dWho, revealed, eligible: [], min: 0, max: 0, prompt: '공개된 카드 중 해당하는 카드가 없습니다', dest: 'none' }); // show the reveal even when nothing matches
        chosenIdxs = await pickByGroups(ctx, dWho, revealed, instr.pick.groups, 'pickFromRevealed', instr.prompt || '공개된 카드 중 가져갈 카드 선택', undefined, !instr.pick.optional);
      } else {
        const maxP = instr.pick?.max ?? eligible.length;
        chosenIdxs = await ctx.choose('pickFromRevealed', {
          player: dWho, revealed, eligible, min: instr.pick?.min ?? 0, max: maxP, required: !instr.pick?.optional && !!eligible.length,
          prompt: instr.prompt || (instr.pick?.action === 'play' ? '공개된 카드 중 코스트 없이 등장시킬 카드 선택' : '공개된 카드 중 가져갈 카드 선택'), dest: instr.pick?.action === 'play' ? 'play' : 'hand',
        });
        chosenIdxs = [...new Set(chosenIdxs || [])].filter(i => eligible.some(x => x.i === i)).slice(0, maxP); // only revealed cards that really match can be taken
      }
      chosenIdxs = chosenIdxs || [];
      const destOf = (i) => (instr.pick?.groups ? instr.pick.groups[chosenIdxs.gi?.[i]]?.dest : null) || instr.pick?.action || 'hand';
      ctx._revealAdded = chosenIdxs.filter(i => destOf(i) === 'hand').length; // "이 효과로 추가했다면" (only cards that really went to the hand)
      ctx._revealPlayed = 0; ctx._revealEvolved = false;
      const keepIdxs = instr.restTo === 'hand' ? revealed.map((_, i) => i) : chosenIdxs; // "남은 카드는 패에 추가한다": everything not picked is added too
      const rvRes = await S.resolveRevealOrdered(state, ctx.choose, dWho, instr.n, chosenIdxs, keepIdxs, instr.restTo || 'bottom');
      if (rvRes?.toHand?.length) { // the chosen cards were moved to the hand above — route exactly those to their real destination (play / evolve / trash / under …)
        const ordered = revealed.map((_, i) => i).filter(i => keepIdxs.includes(i));
        await routeRevealed(ctx, dWho, instr, rvRes.toHand, ordered.map(i => (chosenIdxs.includes(i) ? destOf(i) : 'hand')), ordered.map(i => instr.pick?.groups?.[chosenIdxs.gi?.[i]] || null));
      }
      } finally { delete ctx._deciderOverride; }
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
      let uids = pl.battle.filter(s => S.isDigimonLike(s)).map(s => s.uid); // "디지몬을 소멸" never targets Tamers/Options in the battle area
      // "자신이 발휘하는 DP 소멸 효과의 상한+N." raises the ceiling on the
      // ACTIVATING player's own dpMax-filtered destroy effects.
      let filter = instr.filter;
      if (filter?.dpMax != null) {
        const boost = S.dpDestroyCapBoost(state, ctx.self, ctx.sourceStackUid);
        if (boost) filter = { ...filter, dpMax: filter.dpMax + boost };
      }
      if (filter || instr.excludeSelf || instr.anyKind) uids = candidateStacks(ctx, targetPlayer, { filter, excludeSelf: instr.excludeSelf, anyKind: !!instr.anyKind }).map(s => s.uid);
      const dcause = targetPlayer === ctx.self ? 'ownEffect' : 'effect';
      // official Q&A (EX2-012 Q3302, BT9-017 Q1814): "이 효과로 소멸하지 않았을 때" is judged by whether the
      // SPECIFICALLY TARGETED stack(s) actually died, not by whether the player's battle area shrank overall —
      // a ≪디코이≫/≪수호≫ replacement removes a DIFFERENT stack instead, which must still count as "not destroyed".
      let anyActuallyDestroyed = false;
      try {
      if (instr.mode === 'last') {
        const lp = resolveLast(ctx); if (lp && S.deleteStack(state, lp.player, lp.uid, 'trash', lp.player === ctx.self ? 'ownEffect' : 'effect')) anyActuallyDestroyed = true;
      } else if (instr.mode === 'thisStack') {
        recordPickInfo(ctx, targetPlayer, ctx.sourceStackUid); // "이 디지몬을 소멸시키는 것으로, 소멸한 디지몬의 DP/Lv. 이하…" (pass2-b8: ref was dropped -> no cap)
        if (S.deleteStack(state, targetPlayer, ctx.sourceStackUid, 'trash', dcause)) anyActuallyDestroyed = true;
      } else if (instr.mode === 'all') {
        S.orderSimulDelete(state, targetPlayer, uids).forEach(uid => { if (S.deleteStack(state, targetPlayer, uid, 'trash', dcause)) anyActuallyDestroyed = true; }); // idx1341: simultaneous group, granter (로터스몬) last
      } else if (instr.mode === 'lowestDP') {
        const withDp = pl.battle.filter(s => uids.includes(s.uid)).map(s => ({ uid: s.uid, dp: S.card(s.cardId).dp || 0 }));
        if (withDp.length) {
          const min = Math.min(...withDp.map(x => x.dp));
          const minUids = S.orderSimulDelete(state, targetPlayer, withDp.filter(x => x.dp === min).map(x => x.uid));
          minUids.map(u => ({ uid: u })).forEach(x => { if (S.deleteStack(state, targetPlayer, x.uid, 'trash', dcause)) anyActuallyDestroyed = true; });
        }
      } else {
        // Q3976/Q4936 (EX8-073/BT22-074): a plain "…소멸시킨다" (not "…소멸시킬 수 있다/까지") is
        // mandatory — a legal target can't be waved off just to satisfy a later "이 효과로 소멸하지
        // 않았다면" branch. Only an explicitly optional/"upTo" destroy may skip target selection.
        const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, required: !instr.optional, prompt: instr.prompt || '소멸시킬 디지몬 선택' });
        if (pick && targetPlayer === ctx.self) { const ds = pl.battle.find(s => s.uid === pick); if (ds) (ctx._ownDestroyedIds ||= []).push(ds.cardId); } // for "이 효과로 명칭에 「X」를 포함하는 자신의 디지몬이 소멸하고 있었다면"
        if (pick && S.deleteStack(state, targetPlayer, pick, 'trash', dcause)) anyActuallyDestroyed = true;
      }
      } finally { ctx._lastDestroyed = anyActuallyDestroyed; } // for "이 효과로 소멸하지 않았다면"
      break;
    }
    case 'retreat': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const pl = state.players[targetPlayer];
      // 16-12-1: ≪퇴화 N≫ — the effect's controller declares any number from 1 to N of cards to discard.
      const declareN = async (n) => {
        if (instr.exact || !(n > 1)) return n;
        const i = await ctx.choose('multipleChoice', { prompt: `《퇴화 ${n}》 — 몇 장 파기할까요? (1~${n})`, options: Array.from({ length: n }, (_, k) => `${k + 1}장`) });
        return (typeof i === 'number' && i >= 0 && i < n) ? i + 1 : n;
      };
      if (instr.all) {
        const nAll = await declareN(instr.n);
        for (const st of (instr.filter || instr.excludeSelf ? candidateStacks(ctx, targetPlayer, instr) : [...pl.battle])) S.retreat(state, targetPlayer, st.uid, nAll, true);
        break;
      }
      const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid); // 3-4-7-5: an effect that doesn't name the breeding area can't select its card
      const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '퇴화시킬 디지몬 선택' });
      if (pick && instr.distinct) ((ctx._distinctPicks ||= {})[instr.distinct] ||= new Set()).add(pick);
      if (pick) S.retreat(state, targetPlayer, pick, await declareN(instr.n), true);
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
      if (j) { const cs = S.jogressCostStack(src, partner); jcost = Math.max(0, jcost + S.consumeEvoCostMod(state, who, cardId) + S.continuousEvoCostDiscount(state, who, cs, cardId) + S.hookEvoCostDiscount(state, who, cs, cardId)); }
      if (!S.fuseStacks(state, who, src.uid, partner.uid, cardId, jcost, 'hand')) S.restoreEvoCostMods(evoSnap);
      break;
    }
    case 'playThisFree': { // this card (revealed by a security check / sitting in the trash) enters the battle area for free
      if (instr.optional && !(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 카드를 코스트를 지불하지 않고 등장시킬까요?' }))) break;
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
      // idx1473 (BT11-086): with the raised count and at least that many eligible cards, it is all-or-nothing — never just one of two
      let forceAll = false;
      if (times > 1) {
        const pl0 = state.players[who], z0 = instr.zone === 'hand' ? 'hand' : 'trash';
        const n0 = pl0[z0].filter(id => matchesFilter(S, id, instr.filter) && S.card(id).category !== 'option').length;
        if (n0 >= times) { if (!(await ctx.choose('confirmEffect', { player: who, prompt: `대상 카드 ${times}장을 전부 등장시키겠습니까? (일부만 등장시킬 수 없습니다)` }))) break; forceAll = true; }
      }
      for (let rep = 0; rep < times; rep++) {
      const pl = state.players[who];
      if (instr.toRaising && pl.raising) break; // "비어 있는 자신의 육성 에어리어에": nothing to do while the breeding area is occupied
      const okIdx = (z) => pl[z].map((id, i) => i).filter(i => matchesFilter(S, pl[z][i], instr.filter) && S.card(pl[z][i]).category !== 'option'
        && (!instr.noSameName || !(pl.battle.some(s => S.card(s.cardId).nameKo === S.card(pl[z][i]).nameKo) || pl.trash.some(t => S.card(t).nameKo === S.card(pl[z][i]).nameKo)))); // b11: "배틀 에어리어와 트래시에 같은 명칭의 자신의 카드가 없는"
      let zone = instr.zone === 'trash' ? 'trash' : instr.zone === 'any' ? (okIdx('hand').length ? 'hand' : 'trash') : 'hand';
      // "자신의 패/트래시에서 …" = OR: the player picks the zone when both hold a legal card (used to be forced to the hand)
      if (instr.zone === 'any' && okIdx('hand').length && okIdx('trash').length) { const zk = await ctx.choose('multipleChoice', { player: who, prompt: '어느 영역에서 등장시킬까요?', options: ['패', '트래시', '취소'] }); if (zk === 1) zone = 'trash'; else if (zk === 2) break; }
      const eligibleIdxs = okIdx(zone);
      if (!eligibleIdxs.length && zone === 'trash') break; // nothing legal in the (public) trash: no empty "선택 안 함"-only prompt
      let chosenIdx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt: instr.prompt || `${zone === 'trash' ? '트래시' : '핸드'}에서 무료로 등장시킬 카드 선택` });
      if (chosenIdx == null && forceAll && eligibleIdxs.length) chosenIdx = eligibleIdxs[0];
      if (chosenIdx == null) break; // (declining stops the whole optional sequence)
      // 7-2-2-13: an effect-driven play may DigiXros too — offer the candidate materials one by one (at least 1, otherwise no DigiXros).
      const xrosOpts = instr.toRaising ? {} : await xrosOptsFor(ctx, who, zone, chosenIdx);
      const playedSt = instr.toRaising ? S.playFreeToRaising(state, who, zone, chosenIdx, { rested: !!instr.rested }) : S.playFreeFromZone(state, who, zone, chosenIdx, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, ...xrosOpts });
      if (playedSt) { ctx._lastPick = { player: who, uid: playedSt.uid }; recordPickInfo(ctx, who, playedSt.uid); } // (그 디지몬 / 이 효과로 등장한 디지몬)
      }
      break;
    }
    case 'grantText': { // 「【태그】 효과」의 효과를 준다/얻는다: the text fires as a pending effect at the matching engine event (queueGranted)
      const until = (instr.until === 'opponentTurn' || instr.until === 'nextOpponentTurn') ? S.durationEnd(state, instr.until, ctx.self) : state.turnNumber; // QA-S3 Q3255: "다음 상대의 턴 종료 시까지" compiled to 'nextOpponentTurn' but was treated as this-turn-only
      const give = (st, owner) => { (st.s2Granted = st.s2Granted || []).push({ trigger: instr.trigger, label: instr.label, until, ...(instr.turnTag ? { turnTag: instr.turnTag, once: !!instr.once } : {}), ...(/이\s*카드/.test(instr.label) ? { cardId: st.cardId } : {}) }); S.log(state, `${owner} ${S.card(st.cardId).nameKo}에게 효과 부여: ${instr.label.slice(0, 40)}`); }; // "이 카드" = the granted Digimon's top card
      if (instr.thisStack) { const st = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); if (st) give(st, ctx.self); break; }
      const sides = instr.side === 'both' ? [ctx.self, ctx.opp] : [instr.side === 'opponent' ? ctx.opp : ctx.self];
      for (const sd of sides) {
        const cands = candidateStacks(ctx, sd, { ...instr, anyKind: false });
        if (instr.all) { for (const st of cands) give(st, sd); if (!instr.filter && !instr.excludeSelf) (state.s3LateGrants ||= []).push({ owner: sd, trigger: instr.trigger, label: instr.label, until, given: cands.map(x => x.uid) }); continue; } // QA-S3 Q3256: "디지몬 전부에게 효과를 준다" also reaches Digimon that enter later (until expiry)
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
      const turnNumber = instr.when === 'opp' ? (state.activePlayer === ctx.self ? state.turnNumber + 1 : (state.turnEnding ? state.turnNumber + 2 : state.turnNumber)) : state.turnNumber; // QA-W6 Q3618 (P-165): scheduled during the opponent's turn-end step -> the NEXT opponent turn end, not the one already in progress
      const c2 = { ...ctx, _lastPick: ref || undefined, _fxWrapped: true };
      (state.endOfTurnEffects ||= []).push({ turnNumber, player: ctx.self, cardId: ctx.sourceCardId, label: instr.when === 'opp' ? '다음 상대의 턴 종료 시 예약 효과' : '이 턴 종료 시 예약 효과', desc: { kind: 'script', then: instr.then, player: ctx.self, cardId: ctx.sourceCardId, stackUid: ctx.sourceStackUid }, fn: () => { runScript(instr.then, c2).catch(() => {}); } });
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
      const targetUid = instr.target === 'thisStack' ? ctx.sourceStackUid : await ctx.choose('pickStack', { player: upl, uids: candidateStacks(ctx, upl, { ...instr, anyKind: !instr.digimonOnly }).map(s => s.uid), prompt: instr.prompt || '액티브로 만들 디지몬 선택' });
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
          ...state.players[ctx.self].battle.map(s => ({ player: ctx.self, uid: s.uid, s })),
          ...state.players[ctx.opp].battle.map(s => ({ player: ctx.opp, uid: s.uid, s })),
        ].filter(e => S.isDigimonLike(e.s) && (!instr.filter || matchesFilter(S, e.s, instr.filter, state))) // "디지몬" 대상: 테이머/옵션은 제외
          .map(({ player, uid }) => ({ player, uid }));
        if (!entries.length) break;
        const picked = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '레스트시킬 디지몬 선택 (자신/상대 무관)' });
        if (picked) S.restStack(state, picked.player, picked.uid);
        break;
      }
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const restPicked = new Set();
      for (let i = 0; i < (instr.n || 1); i++) {
        // only a Digimon that is still active can be rested ("N마리 레스트" = N different ones) — EXCEPT a 「레스트시킨다. …액티브가 되지 않는다」 combo (Q&A BT3-057: an already-rested digimon may be chosen so the no-unsuspend rider still applies)
        const uids = candidateStacks(ctx, targetPlayer, { ...instr, filter: { ...(instr.filter || {}), ...(instr.skipNextUnsuspend ? {} : { suspended: false }) }, anyKind: !instr.digimonOnly }).map(s => s.uid).filter(u => !restPicked.has(u));
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '레스트시킬 디지몬 선택' });
        if (!targetUid) break;
        restPicked.add(targetUid);
        S.restStack(state, targetPlayer, targetUid); // (an immune target simply isn't rested — 15-15-5-1; its skip-unsuspend rider below is a recorded grant, 15-15-5-2)
        // "다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다." — extremely
        // common tacked onto a rest effect (confirmed via the audit: a
        // dozen+ cards all print this exact "레스트시킨다. ... 액티브가 되지
        // 않는다." combo).
        const xrosSrc = state.players[ctx.self].battle.find(s => s.uid === ctx.sourceStackUid); // BT15-012: 「N장 디지크로스하고 있었다면 …액티브가 되지 않는다」
        if (instr.skipNextUnsuspend || (instr.skipIfFusion && xrosSrc && xrosSrc.viaFusion) || (instr.skipIfXros != null && xrosSrc && (xrosSrc.xrosCount || 0) >= instr.skipIfXros)) S.setSkipNextUnsuspend(state, targetPlayer, targetUid);
      }
      break;
    }
    case 'restAll': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      let raFilter = instr.filter; // P-113 "이 디지몬의 DP 이하의 상대의 디지몬 전부": resolve the self-DP bound (was ignored → every digimon rested)
      if (raFilter?.dpMaxSelf) { const srcRA = [state.players[ctx.self].raising, ...state.players[ctx.self].battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); raFilter = { ...raFilter, dpMax: srcRA ? S.effectiveDP(state, ctx.self, srcRA) : 0 }; }
      for (const s of [...state.players[targetPlayer].battle]) {
        if (matchesFilter(S, s, raFilter, state)) S.restStack(state, targetPlayer, s.uid);
      }
      break;
    }
    case 'modifyDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid); // tamers/options in the battle area are not "디지몬" targets
      if (instr.last) { const lp = resolveLast(ctx); if (lp) S.modifyDP(state, lp.player, lp.uid, instr.amount, instr.duration || 'turn'); break; }
      const targetUid = instr.target !== 'opponent' && instr.thisStack ? ctx.sourceStackUid
        : !uids.length ? null : await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || `DP ${instr.amount >= 0 ? '+' : ''}${instr.amount} 받을 디지몬 선택` });
      if (targetUid && instr.distinct) ((ctx._distinctPicks ||= {})[instr.distinct] ||= new Set()).add(targetUid);
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
      const eligible = pl.battle.filter(s => S.card(s.cardId).category === 'digimon' && ctx.E.canEvolveAny(s.cardId, ctx.sourceCardId, S.evoExtraArg(state, ctx.self, s), S.evolveTargetRestriction(state, ctx.self, s)).ok);
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
      if (instr.all) {
        const cs = candidateStacks(ctx, targetPlayer, instr);
        if (!instr.filter && !instr.excludeSelf && S.addKwAllLate) S.addKwAllLate(state, targetPlayer, instr.keyword, instr.value, instr.duration || 'turn'); // Q&A 607/1243: digimon that arrive later are covered too
        for (const st of cs) S.grantKeyword(state, targetPlayer, st.uid, instr.keyword, instr.value, instr.duration || 'turn'); break;
      }
      if (instr.target === 'either' && !instr.thisStack) { // slice3 r2 (Q3722/3728/3734/3740): a bare 「디지몬 1마리에게」 may be an own OR an opponent's digimon
        const entries = [ctx.self, ctx.opp].flatMap(pp => candidateStacks(ctx, pp, instr).map(s => ({ player: pp, uid: s.uid })));
        if (!entries.length) break;
        const picked = await ctx.choose('pickStackAnySide', { entries, prompt: `《${instr.keyword === '시큐리티어택' ? 'S 어택' : instr.keyword} ${instr.value > 0 ? '+' : ''}${instr.value}》 대상 선택 (자신/상대 무관)${instr.value < 0 ? ' — 약화 DP -' : ''}` });
        if (picked) S.grantKeyword(state, picked.player, picked.uid, instr.keyword, instr.value, instr.duration || 'turn');
        break;
      }
      let targetUid = instr.thisStack ? ctx.sourceStackUid : null;
      if (!targetUid) {
        const uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid);
        // Q4565 (BT21-061): a plain "…1마리는 《X》를 얻는다" grant (not "…얻을 수 있다") is mandatory —
        // the player can't wave off target selection to duck the whole triggered ability.
        targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, required: !instr.optional, prompt: instr.prompt || `${instr.keyword} 부여할 디지몬 선택` });
      }
      if (targetUid && instr.distinct) ((ctx._distinctPicks ||= {})[instr.distinct] ||= new Set()).add(targetUid);
      if (targetUid) S.grantKeyword(state, targetPlayer, targetUid, instr.keyword, instr.value, instr.duration || 'turn');
      break;
    }
    case 'grantBattleImmunity': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.filter(s => S.isDigimonLike(s)).map(s => s.uid);
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
      S.emitGameEvent(state, 'trashToHand', { owner: who, stack: null, cardId, cause: 'effect' }); // "자신의 트래시에서 …카드가 패로 되돌아갔을 때" watchers (BT15-082)
      break;
    }
    case 'setDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.filter(s => S.isDigimonLike(s)).map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || 'DP를 변경할 디지몬 선택' });
      if (targetUid) {
        const pl = state.players[targetPlayer];
        const stack = pl.battle.find(s => s.uid === targetUid);
        // official Q&A (BT1-105, Q972-976): "원래 DP를 N으로 변경" replaces the printed DP itself (timestamped base override, later ±N effects still add on top, and it persists when the digimon evolves) — not a one-off delta against the current top card
        S.setBaseInfo(state, targetPlayer, stack, { dp: instr.value, until: S.durationEnd(state, instr.duration || 'turn') });
        S._s4.ruleCheckDP(state, targetPlayer, stack);
      }
      break;
    }
    case 'restrictAttack': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : S.durationEnd(state, dur);
      if (instr.thisStack) { S.restrictAttack(state, targetPlayer, ctx.sourceStackUid, expiresAfterTurn); break; }
      if (instr.allMatching && ((instr.noEvoSources && !instr.filter) || (instr.filter && instr.filter.noSources === true && Object.keys(instr.filter).length === 1 && !instr.noBlock))) { // QA-W6 Q3339 (LM-006): "진화원을 갖지 않은 상대의 디지몬 전부" is state-based too // official Q&A (BT1-100, Q965): "진화원을 갖지 않은 디지몬으로는 어택할 수 없다" restricts the STATE, not a snapshot: a digimon that later gains sources may attack, a source-less one that enters later may not
        const ban = (state.s71NoSrcAtkBan ||= {}); ban[targetPlayer] = Math.max(ban[targetPlayer] || 0, expiresAfterTurn === 'permanent' ? 1e9 : expiresAfterTurn);
        S.log(state, `${targetPlayer}는 ${expiresAfterTurn === 'permanent' ? '' : '턴 ' + expiresAfterTurn + '까지 '}진화원을 갖지 않은 디지몬으로 어택할 수 없음`);
        break;
      }
      if (instr.allMatching) {
        for (const s of state.players[targetPlayer].battle) {
          if (matchesFilter(S, s, instr.filter, state) && (!instr.noEvoSources || s.sources.length === 0)) {
            S.restrictAttack(state, targetPlayer, s.uid, expiresAfterTurn);
            if (instr.noBlock) S.setS3FlagFx(state, targetPlayer, s, 'noBlock', expiresAfterTurn === 'permanent' ? 1e9 : expiresAfterTurn);
          }
        }
        if (instr.prompt) S.log(state, instr.prompt);
        break;
      }
      let uids = candidateStacks(ctx, targetPlayer, instr).map(s => s.uid);
      if (instr.filter?.hasNoSources) uids = state.players[targetPlayer].battle.filter(s => s.sources.length === 0 && S.isDigimonLike(s)).map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '어택 불가로 만들 디지몬 선택' });
      if (targetUid && instr.distinct) ((ctx._distinctPicks ||= {})[instr.distinct] ||= new Set()).add(targetUid);
      if (targetUid) { S.restrictAttack(state, targetPlayer, targetUid, expiresAfterTurn); if (instr.noBlock) { const tst = state.players[targetPlayer].battle.find(s => s.uid === targetUid); if (tst) S.setS3FlagFx(state, targetPlayer, tst, 'noBlock', expiresAfterTurn === 'permanent' ? 1e9 : expiresAfterTurn); } }
      break;
    }
    case 'restrictAttackPlayer': {
      // Narrower than restrictAttack — can still attack a Digimon directly.
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : S.durationEnd(state, dur);
      const matching = () => state.players[targetPlayer].battle.filter(s => S.isDigimonLike(s) && (!instr.filter || matchesFilter(S, s, instr.filter, state)));
      if (instr.all) {
        if (S.addAttackPlayerLate && !instr.filter?.ref) { S.setLateFilterMatcher((stk, f, stt) => matchesFilter(S, stk, f, stt)); S.addAttackPlayerLate(state, targetPlayer, expiresAfterTurn, instr.filter); } // Q&A BT3-105: digimon arriving later are covered too
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
      if (instr.zone === 'handTrash') { // 패/트래시 both allowed: pick the zone first (when both hold a matching card)
        const plz = state.players[who]; const zs = ['hand', 'trash'].filter(z => plz[z].some(id => matchesFilter(S, id, instr.cardFilter)));
        if (!zs.length) break;
        let z = zs[0];
        if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { player: who, prompt: '진화할 카드가 있는 곳 선택', options: ['패', '트래시'] }); z = k === 1 ? 'trash' : 'hand'; }
        return runOne({ ...instr, zone: z }, ctx);
      }
      if (!ctx.E || !ctx.E.canEvolveAny) break;
      const pl = state.players[who];
      const xArg = (a) => { if (instr.ignoreLevel) a.ignoreLevel = true; return a; }; // b5 (BT13-098/BT24-025): "Lv.을 무시하고 진화" only drops the printed Lv. requirement (colors/names still apply)
      const evoOk = (stack, id) => (instr.ignoreCond && !S.s1HookAny(state, 's1evoIgnoreLocked', {}) && ctx.E.evoRestrictionCheck(id, S.evolveTargetRestriction(state, who, stack)).ok) || ctx.E.canEvolveAny(stack.cardId, id, xArg(S.evoExtraArg(state, who, stack)), S.evolveTargetRestriction(state, who, stack)).ok;
      const cardsFor = (stack) => (instr.zone === 'trash' ? pl.trash : pl.hand).map((id, i) => i).filter(i => {
        const id = (instr.zone === 'trash' ? pl.trash : pl.hand)[i];
        if (!matchesFilter(S, id, instr.cardFilter) || !evoOk(stack, id)) return false;
        if (instr.cardFilter.evoCostMax != null) { const ck = ctx.E.canEvolveAny(stack.cardId, id, xArg(S.evoExtraArg(state, who, stack)), S.evolveTargetRestriction(state, who, stack)); if (!ck.ok || ck.cost > instr.cardFilter.evoCostMax) return false; } // EX2-070 (Q3359/3360): printed evolution cost (modifiers not applied yet); the cheapest applicable condition counts
        return true;
      });
      // candidate source stacks
      let stacks;
      if (instr.subject.thisStack) stacks = pl.battle.filter(x => x.uid === ctx.sourceStackUid);
      else {
        const pr = instr.subject.desc ? S.cardDescPredicate(instr.subject.desc + ' 가진') : null;
        stacks = pl.battle.filter(x => S.isDigimonLike(x)
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
      const chk = ctx.E.canEvolveAny(src.cardId, cardId, xArg(ctx.S.evoExtraArg(ctx.state, null, src)), null);
      let printed = chk.ok ? chk.cost : (S.card(cardId).evoNormal?.cost ?? 0);
      // 8-1-2-1: "evolve for the printed cost (-N)" — when several printed conditions apply the player chooses which one's cost is used.
      // (A fixed cost / "no cost" replaces the printed cost entirely, so there is nothing to choose.)
      if (instr.cost.mode !== 'free' && instr.cost.mode !== 'fixed' && chk.ok && ctx.E.evolutionMethods) {
        const ms = ctx.E.evolutionMethods(src.cardId, cardId, xArg(S.evoExtraArg(state, null, src)), null);
        if (ms.length > 1) {
          const pick = await ctx.choose('multipleChoice', { player: who, prompt: `${S.card(src.cardId).nameKo} → ${S.card(cardId).nameKo} — 진화 조건을 선택하세요 (룰 8-1-2-1)`, options: ms.map((m, i) => `${i + 1}. ${m.label}${m.conditionText ? ` (${m.conditionText})` : ''} — 기본 코스트 ${m.baseCost}`) });
          printed = (ms[pick] || ms[0]).baseCost;
        }
      }
      const cost = instr.cost.mode === 'free' ? 0 : instr.cost.mode === 'fixed' ? instr.cost.n : instr.cost.mode === 'discount' ? Math.max(0, printed - instr.cost.n) : printed;
      // 8-x-2-5: continuous evolve-cost effects also apply to effect-driven evolution (not when "no cost is paid").
      const costAdj = instr.cost.mode === 'free' ? 0 : S.continuousEvoCostDiscount(state, who, src, cardId) + S.hookEvoCostDiscount(state, who, src, cardId);
      if (instr.zone === 'trash') zoneArr.splice(idx, 1);
      if (S.digivolve(state, who, src.uid, cardId, Math.max(0, cost + costAdj), instr.zone === 'trash' ? 'trash' : 'hand')) ctx._evolvedByEffect = true; // "이 효과로 진화했다면" (EX13-004)
      break;
    }
    case 'destroySum': {
      // Pick opponent Digimon one at a time while the running DP/cost total stays within the limit.
      let left = instr.limit + (instr.stat === 'dp' ? S.dpDestroyCapBoost(state, ctx.self, ctx.sourceStackUid) : 0); const chosen = []; // official Q&A (BT9-094): "DP消滅効果の上限+X" also raises a "total DP N or less" cap
      const statOf = (st) => instr.stat === 'dp' ? S.effectiveDP(state, ctx.opp, st) : (S.card(st.cardId).cost || 0);
      for (;;) {
        const opts = state.players[ctx.opp].battle.filter(st => S.isDigimonLike(st) && !chosen.includes(st.uid) && statOf(st) <= left);
        if (!opts.length) break;
        const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: opts.map(x => x.uid), required: chosen.length === 0, prompt: `소멸시킬 디지몬 선택 (남은 ${instr.stat === 'dp' ? 'DP' : '등장 코스트'} 합계 ${left})` }); // official Q&A (ST7-12/Q693): only the FIRST pick is mandatory — the player may stop short of the cap afterward, unlike a fixed-count "N마리를 소멸시킨다" destroy
        if (!uid) break;
        const st = opts.find(x => x.uid === uid);
        if (!st) break;
        chosen.push(uid); left -= statOf(st);
      }
      S.deleteSimul(state, ctx.opp, chosen, 'effect');
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
      if (!stO || !S.canAttackPlayer(state, me, stO.uid)) { S.log(state, `${me} 《오버클럭》 — 어택할 수 없음`); break; }
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
      if (!uid && instr.last) { const lp = resolveLast(ctx); uid = lp && lp.player === who ? lp.uid : null; if (!uid) break; if (instr.optional && !(await ctx.choose('confirmEffect', { player: who, prompt: '그 디지몬으로 어택할까요?' }))) break; } // "그 디지몬으로 어택할 수 있다" (b12)
      if (!uid) uid = await ctx.choose('pickStack', { player: who, uids: pl.battle.filter(x => !x.suspended && S.card(x.cardId).category === 'digimon').map(x => x.uid), prompt: '어택할 디지몬 선택' });
      const st = uid && pl.battle.find(x => x.uid === uid);
      if (!st || st.suspended) { S.log(state, `${who} 어택할 수 있는 디지몬이 없음`); break; }
      if (ctx.startAttack) ctx.startAttack(who, uid, undefined, instr.digimonOnly ? { digimonOnly: true } : undefined);
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
      const uids = state.players[targetPlayer].battle.filter(s => S.isDigimonLike(s)).map(s => s.uid); // 디지몬만 (테이머/옵션 제외)
      if (!uids.length) break;
      const uid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '액티브가 되지 않을 디지몬 선택' });
      if (uid) S.setSkipNextUnsuspend(state, targetPlayer, uid);
      break;
    }
    case 'moveEach': {
      const pl = state.players[who];
      const { st, entries } = moveEachEntries(ctx, instr);
      instr._moved = 0; ctx._moveEachN = 0;
      let destSt = null; // dest 'otherSources': the chosen stack (Digimon or Tamer) whose sources the cards go under ("자신의 테이머 아래에 놓는")
      if (instr.dest === 'otherSources') {
        const cDs = candidateStacks(ctx, who, { filter: instr.destFilter, anyKind: true, excludeSelf: !!instr.destExcludeSelf });
        if (!cDs.length) { S.log(state, `${who} 카드를 놓을 대상이 없음`); break; }
        const uDs = cDs.length === 1 ? cDs[0].uid : await ctx.choose('pickStack', { player: who, uids: cDs.map(x => x.uid), prompt: instr.destPrompt || '카드를 아래에 놓을 대상 선택' });
        destSt = cDs.find(x => x.uid === uDs) || null;
        if (!destSt) break;
      }
      const ids = entries.map(e => e.id);
      const pickedIdx = await pickByGroups(ctx, who, ids, instr.groups, 'pickFromRevealed', instr.prompt || '카드 선택', (el, prompt) => ({ player: who, revealed: ids, eligible: el.map(i => ({ id: ids[i], i })), min: 0, max: 1, prompt, dest: instr.dest, ...(instr.required != null ? { required: instr.required } : {}) }), false, !instr.required && instr.groups.length >= 2 && !instr.upTo);
      let chosen = pickedIdx.map(i => entries[i]);
      if (!chosen.length) break;
      if ((instr.ordered || instr.dest === 'securityBottom') && chosen.length > 1 && instr.dest !== 'play') { // "원하는 순서대로": the player orders the group (first = top); several cards placed under the security are always ordered by the player (official Q&A 2405/2408, BT18-102)
        const ord = await ctx.choose('orderCards', { player: who, ids: chosen.map(e => e.id), prompt: instr.dest === 'deckBottom' ? '덱 아래로 되돌릴 순서 선택 (먼저 고른 카드가 위)' : instr.dest === 'securityBottom' ? '시큐리티 아래에 놓을 순서 선택 (먼저 고른 카드가 위)' : '진화원에 놓을 순서 선택 (먼저 고른 카드가 위)' });
        if (Array.isArray(ord) && ord.length === chosen.length) chosen = ord.map(i => chosen[i]);
      }
      const taken = [];
      for (const e of chosen) { // remove by id from the zone it came from (indices shift as cards leave)
        const arr = e.z === 'sources' ? (e.st || st).sources : (instr.zoneOwner === 'opp' ? state.players[ctx.opp] : pl)[e.z];
        let k = arr.lastIndexOf(e.id); if (k < 0) continue;
        arr.splice(k, 1); taken.push(e);
      }
      for (const s2 of new Set(taken.filter(e => e.z === 'sources').map(e => e.st || st))) if (s2) S.recomputeStackGrants(s2);
      instr._moved = taken.length; ctx._moveEachN = taken.length;
      const sname = (e) => S.card(e.id).nameKo;
      if (instr.dest === 'hand') {
        for (const e of taken) { pl.hand.push(e.id); S.log(state, `${who} ${sname(e)}을(를) 패로 되돌림`); }
      } else if (instr.dest === 'deckBottom') {
        for (const e of taken) { (instr.zoneOwner === 'opp' ? state.players[ctx.opp] : pl).deck.push(e.id); S.log(state, `${who} ${sname(e)}을(를) 덱 아래로 되돌림`); }
      } else if (instr.dest === 'otherSources') {
        if (instr.faceDown) { for (const e of taken) { destSt.sources.unshift(e.id); destSt.s5fd = S.fdCount(destSt) + 1; destSt.s5fdFlag = true; } }
        else for (const e of taken) destSt.sources.splice(S.fdCount(destSt), 0, e.id);
        S.recomputeStackGrants(destSt);
        S.log(state, `${who} ${taken.map(sname).join(', ')}을(를) ${S.card(destSt.cardId).nameKo}의 아래에 놓음`);
      } else if (instr.dest === 'securityBottom') {
        for (const e of taken) { if (instr.faceUp) S.secAddFaceUp(state, who, e.id, 'bottom'); else S.addToSecurity(state, who, e.id, 'bottom'); S.log(state, `${who} ${sname(e)}을(를) 시큐리티 아래에 놓음`); }
      } else if (instr.dest === 'eggBottom') {
        for (const e of taken) { state.players[who].digitamaDeck.push(e.id); S.log(state, `${who} ${sname(e)}을(를) 디지타마 덱 아래로 되돌림`); }
      } else if (instr.dest === 'deckTop') {
        for (const e of taken.slice().reverse()) (instr.zoneOwner === 'opp' ? state.players[ctx.opp] : pl).deck.unshift(e.id); // first picked = topmost
        S.log(state, `${who} ${taken.map(sname).join(', ')}을(를) 덱 위로 되돌림`);
      } else if (instr.dest === 'trash') {
        for (const e of taken) { pl.trash.push(e.id); S.log(state, `${who} ${sname(e)}을(를) 파기`); }
        { // pass2-b6: cards discarded from an evolution source area by an effect fire the 'sourcesTrashed' watchers ("이 카드가 …디지몬의 진화원에서 효과로 파기되었을 때" EX10-028/039/044/045, EX8-005 …)
          const bySt = new Map(); for (const e of taken) if (e.z === 'sources') { const s2 = e.st || st; if (s2) (bySt.get(s2) || bySt.set(s2, []).get(s2)).push(e.id); }
          for (const [s2, ids2] of bySt) { const own = ['p1', 'p2'].find(pp => state.players[pp].battle.includes(s2) || state.players[pp].raising === s2) || who; S.emitGameEvent(state, 'sourcesTrashed', { owner: own, stack: s2, cause: 'effect', from: 'pick', ids: ids2, fdGone: 0, srcPlayer: ctx.self }); }
        }
      } else if (instr.dest === 'thisSources') {
        if (!st) { for (const e of taken) pl.trash.push(e.id); break; }
        if (instr.faceDown) { for (const e of taken) { st.sources.unshift(e.id); st.s5fd = S.fdCount(st) + 1; st.s5fdFlag = true; } }
        else for (const e of instr.pos === 'top' ? taken.slice().reverse() : taken) { if (instr.pos === 'top') st.sources.push(e.id); else st.sources.splice(S.fdCount(st), 0, e.id); }
        S.recomputeStackGrants(st);
        S.log(state, `${who} ${taken.map(sname).join(', ')}을(를) 진화원에 놓음`);
      } else if (instr.dest === 'play') {
        for (const e of taken) {
          if (S.card(e.id).category === 'option') { pl.trash.push(e.id); continue; }
          pl.trash.push(e.id); // sources / hand cards are played through the trash slot (same trick as the other "진화원에서 등장" effects)
          S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, fromSources: e.z === 'sources' || !!e.left, ...(await xrosOptsFor(ctx, who, 'trash', pl.trash.length - 1)) });
        }
      }
      break;
    }
    case 'costGroup': {
      // b10: a generic watcher already rested the tamer as the printed cost ("이 테이머를 레스트시키는 것으로," is stripped from the queued text; pending.restPaid) —
      // a bespoke script that still carries the restStack cost must not try to pay it a second time
      if (ctx.trigger && ctx.trigger.restPaid && !ctx._restPaidUsed && instr.cost.some(c => c.op === 'restStack')) {
        ctx._restPaidUsed = true;
        const restCost = instr.cost.filter(c => c.op !== 'restStack');
        if (!restCost.length) { await runScript(instr.then, ctx); break; }
        instr = { ...instr, cost: restCost };
      }
      const st = state.players[ctx.self].battle.find(x => x.uid === ctx.sourceStackUid) || (state.players[ctx.self].raising?.uid === ctx.sourceStackUid ? state.players[ctx.self].raising : null);
      const canPay = costGroupPayable(ctx, instr);
      if (instr.else && (!canPay || !(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '비용을 지불하고 대신 다른 효과를 처리하시겠습니까? (아니오 = 원래 효과)' })))) { await runScript(instr.else, ctx); break; } // pass2-b2: replacement-style cost ("…것으로, 대신 …")
      if (!canPay) { S.log(state, `${ctx.self} 비용을 지불할 수 없어 효과를 건너뜀`); ctx._costUnpaid = true; break; }
      // 15-7-1: 「~하는 것으로」 is an optional processing condition — the PLAYER chooses whether to perform it, BEFORE anything is paid or moved (a 'no' skips the whole effect: no once-per-turn use is consumed, 15-14-1)
      if (!instr.else && !(await askOptionalCost(ctx, instr))) { S.log(state, `${ctx.self} 비용을 지불하지 않기로 함 — 효과를 발휘하지 않음`); ctx._costUnpaid = true; ctx._declined = true; break; }
      // 15-7-2/15-7-3: an optional-processing-condition ("~ことで") cost must be performed IN FULL; if the player
      // picked fewer cards than required (or a step was blocked), nothing after the cost may run.
      const needHand = { p1: 0, p2: 0 }, needSec = { p1: 0, p2: 0 };
      const bat0 = state.players[ctx.self].battle.length, needSac = instr.cost.filter(x => x.op === 'destroy' && x.mode === 'choose' && x.target !== 'opponent').length + instr.cost.filter(x => x.op === 'returnToHandStripSources' && !x.thisStack && x.target === 'self').reduce((a, x) => a + (x.n || 1), 0);
      const oppBat0 = state.players[ctx.opp].battle.length, needOpp = instr.cost.filter(x => x.op === 'destroy' && x.mode === 'choose' && x.target === 'opponent').length + instr.cost.filter(x => x.op === 'returnToHandStripSources' && !x.thisStack && x.target === 'opponent').reduce((a, x) => a + (x.n || 1), 0);
      const h0 = { p1: state.players.p1.hand.length, p2: state.players.p2.hand.length }, s0 = { p1: state.players.p1.security.length, p2: state.players.p2.security.length };
      const whoKey = (c) => (c.who === 'opponent' ? ctx.opp : ctx.self);
      for (const c of instr.cost) { if (c.op === 'trashHand') needHand[whoKey(c)] += c.n || 1; if (c.op === 'removeSecurity') needSec[whoKey(c)] += c.n || 1; }
      // costs the compiler could not automate: the player confirms having paid them by hand (never run the effect for free)
      for (const c of instr.cost.filter(x => x.op === 'manualCost')) {
        if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `비용(수동 처리): ${c.text} — 지불했습니까/지불하시겠습니까?` }))) { S.log(state, `${ctx.self} 비용을 지불하지 않아 효과를 처리하지 않음`); return; }
      }
      for (const c of instr.cost) delete c._paid;
      await runScript(instr.cost.filter(x => x.op !== 'manualCost'), ctx);
      const paid = bat0 - state.players[ctx.self].battle.length >= needSac && ['p1', 'p2'].every(pp => (!needHand[pp] || h0[pp] - state.players[pp].hand.length >= needHand[pp]) && (!needSec[pp] || s0[pp] - state.players[pp].security.length >= needSec[pp]))
        && instr.cost.every(c => c.op !== 'restStack' || !st || st.suspended)
        && instr.cost.every(c => c.op !== 'moveEach' || c._moved >= moveEachSlots(c)) // (upTo: at least 1)
        && instr.cost.every(c => c.op !== 'placeUnderSource' || (ctx._lastPlacedSource || 0) >= (c.n || 1))
        && (!needOpp || oppBat0 - state.players[ctx.opp].battle.length >= needOpp) // costs that remove OPPONENT stacks
        && instr.cost.every(c => c._paid !== false) // shard ops used as costs report via instr._paid
        && instr.cost.every(c => !(c.op === 'returnToHandStripSources' && c.thisStack) || !st || !state.players[ctx.self].battle.includes(st));
      if (!paid) { S.log(state, `${ctx.self} 비용을 전부 지불하지 못해 이후 효과를 처리하지 않음 (15-7-2)`); ctx._costUnpaid = true; break; }
      await runScript(instr.then, ctx);
      break;
    }
    case 'preventRest': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : S.durationEnd(state, dur);
      // only Digimon/Tamers can be rested — never offer an option card sitting in the battle area (playtest fix)
      const matching = () => state.players[targetPlayer].battle.filter(s => ['digimon', 'tamer'].includes(S.card(s.cardId).category) && (!instr.filter || matchesFilter(S, s, instr.filter, state)));
      if (instr.all) {
        if (instr.filter && instr.filter.noSources && instr.filter.category === 'digimon' && Object.keys(instr.filter).length === 2) { (state.s3RestLocks ||= []).push({ owner: targetPlayer, until: expiresAfterTurn === 'permanent' ? 1e9 : expiresAfterTurn, kind: 'noSources' }); break; } // QA-S3 Q2952: "진화원을 갖지 않은 …전부는 레스트할 수 없다" is live (newcomers covered, a Digimon that gains a source is released)
        for (const s of matching()) S.preventRest(state, targetPlayer, s.uid, expiresAfterTurn);
        break;
      }
      const pickedNR = []; // "N마리(명)": N DIFFERENT targets (EX13-016 "디지몬/테이머 2마리(명)는 레스트할 수 없다")
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = matching().map(s => s.uid).filter(u => !pickedNR.includes(u));
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '레스트 불가로 만들 디지몬 선택' });
        if (!targetUid) break;
        pickedNR.push(targetUid);
        S.preventRest(state, targetPlayer, targetUid, expiresAfterTurn);
      }
      break;
    }
    case 'hatch': // "육성 에어리어에 부화시킨다" as an EFFECT: not the once-per-breeding-phase hatch action, so it doesn't consume/need state.breedingActionTaken
      S.s7HatchByEffect(state, who);
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
        stack._leftTo = dest; // unres-c: BT14-030 "다른 디지몬이 패로 되돌아갔을 때" reads where the stack went
        S.hookLeaveTriggers(state, targetPlayer, stack, targetPlayer === ctx.self ? 'ownEffect' : 'effect'); // "패/덱으로 되돌아갈 때" leave abilities (EX4-021/060)
      };
      const matching = () => candidateStacks(ctx, targetPlayer, { filter: instr.filter && Object.keys(instr.filter).length ? instr.filter : undefined, excludeSelf: instr.excludeSelf, anyKind: !!instr.anyKind }).filter(s =>
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
      if (targetUid && S.effectBlocked(state, targetPlayer, state.players[targetPlayer].battle.find(s => s.uid === targetUid), 'bounce')) S.log(state, '대상이 효과를 받지 않아 덱 아래로 되돌아가지 않음 (15-15-5-1)');
      else if (targetUid) {
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
    case 'placeUnderSource': { // 패/트래시의 카드 N장(까지)을 (이 디지몬 | 자신의 디지몬 | 육성 에어리어의 「X」)의 진화원 아래에 놓는다 (EX6-062/065/069, BT18-024 …)
      const plU2 = state.players[who];
      ctx._lastPlacedSource = 0;
      let tgtU = null;
      if (instr.thisStack) tgtU = [plU2.raising, ...plU2.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid) || null;
      else if (instr.raising) tgtU = plU2.raising && matchesFilter(S, plU2.raising, instr.targetFilter, state) ? plU2.raising : null;
      else { const cU = candidateStacks(ctx, who, { filter: instr.targetFilter }); if (cU.length) { const uU = cU.length === 1 ? cU[0].uid : await ctx.choose('pickStack', { player: who, uids: cU.map(x => x.uid), prompt: '카드를 진화원 아래에 놓을 디지몬 선택' }); tgtU = cU.find(x => x.uid === uU) || null; } }
      if (!tgtU) { S.log(state, `${who} 카드를 진화원 아래에 놓을 디지몬이 없음`); break; }
      for (let iU = 0; iU < (instr.n || 1); iU++) {
        const okU = (z) => plU2[z].map((id, i) => i).filter(i => matchesFilter(S, plU2[z][i], instr.filter));
        const zU = instr.zones.filter(z => okU(z).length);
        if (!zU.length) break;
        let zPick = zU[0];
        if (zU.length > 1) { const kU = await ctx.choose('multipleChoice', { prompt: '카드를 가져올 위치', options: zU.map(z => (z === 'hand' ? '패' : '트래시')) }); if (kU == null) break; zPick = zU[kU] || zU[0]; }
        const ixU2 = await ctx.choose('pickFromZoneIndex', { player: who, zone: zPick, eligibleIdxs: okU(zPick), prompt: instr.prompt || `${zPick === 'hand' ? '패' : '트래시'}에서 진화원 아래에 놓을 카드 선택` });
        if (ixU2 == null) break;
        const [idU2] = plU2[zPick].splice(ixU2, 1);
        tgtU.sources.splice(S.fdCount(tgtU), 0, idU2); // bottom of the face-up sources
        ctx._lastPlacedSource++;
        S.log(state, `${who} ${S.card(idU2).nameKo}을(를) ${S.card(tgtU.cardId).nameKo}의 진화원 아래에 놓음`);
      }
      S.recomputeStackGrants(tgtU);
      break;
    }
    case 'playFreeTamerUnder': { // 자신의 (패/트래시 또는) 테이머 아래에서 카드 N장을 코스트 없이 등장 (BT19-013/014/025/026 …)
      const plT = state.players[who];
      const okT = (id) => S.card(id).category !== 'option' && matchesFilter(S, id, instr.filter);
      for (let rep = 0; rep < (instr.n || 1); rep++) {
        const tams = plT.battle.filter(s => S.card(s.cardId).category === 'tamer' && s.sources.some(okT));
        const zonesT = (instr.zones || []).filter(z => plT[z].some(okT));
        if (!tams.length && !zonesT.length) { S.log(state, `${who} 테이머 아래에 등장시킬 수 있는 카드가 없음`); break; }
        if (instr.optional && !(await ctx.choose('confirmEffect', { player: who, prompt: '코스트를 지불하지 않고 등장시키겠습니까?' }))) break;
        let useZone = null;
        if (zonesT.length && tams.length) { const k = await ctx.choose('multipleChoice', { prompt: '어느 영역에서 등장시킬까요?', options: [...zonesT.map(z => (z === 'hand' ? '패' : '트래시')), '테이머 아래'] }); if (k == null) break; useZone = k < zonesT.length ? zonesT[k] : null; }
        else if (zonesT.length) useZone = zonesT[0];
        if (useZone) {
          const el = plT[useZone].map((id, i) => i).filter(i => okT(plT[useZone][i]));
          const ix = await ctx.choose('pickFromZoneIndex', { player: who, zone: useZone, eligibleIdxs: el, prompt: '무료로 등장시킬 카드 선택' });
          if (ix == null) break;
          S.playFreeFromZone(state, who, useZone, ix, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, ...(await xrosOptsFor(ctx, who, useZone, ix)) });
          continue;
        }
        const uT = tams.length === 1 ? tams[0].uid : await ctx.choose('pickStack', { player: who, uids: tams.map(x => x.uid), prompt: '카드를 등장시킬 테이머 선택' });
        const stT = tams.find(x => x.uid === uT); if (!stT) break;
        const [iT] = await S.chooseSourceIdxs(state, who, stT, 1, ctx.choose, okT, `${S.card(stT.cardId).nameKo} 아래에서 코스트 없이 등장시킬 카드 선택`);
        if (iT == null) break;
        const [idT] = stT.sources.splice(iT, 1);
        S.recomputeStackGrants(stT);
        plT.trash.push(idT);
        const playedT = S.playFreeFromZone(state, who, 'trash', plT.trash.length - 1, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, ...(await xrosOptsFor(ctx, who, 'trash', plT.trash.length - 1)) });
        if (playedT) { ctx._lastPick = { player: who, uid: playedT.uid }; recordPickInfo(ctx, who, playedT.uid); }
      }
      break;
    }
    case 'playFromSources': { // 자신의 디지몬 1마리의 진화원에서 카드 N장(까지)을 코스트 없이 등장 (ST2-15, BT7-096/097, BT11-098)
      const plS = state.players[who];
      const okS = (id) => S.card(id).category !== 'option' && matchesFilter(S, id, instr.filter);
      const csS = candidateStacks(ctx, who, { filter: instr.targetFilter }).filter(x => x.sources.some(okS));
      if (!csS.length) { S.log(state, `${who} 진화원에서 등장시킬 수 있는 카드가 없음`); break; }
      if (instr.optional && !(await ctx.choose('confirmEffect', { player: who, prompt: '진화원의 카드를 코스트를 지불하지 않고 등장시키겠습니까?' }))) break;
      const uS = csS.length === 1 ? csS[0].uid : await ctx.choose('pickStack', { player: who, uids: csS.map(x => x.uid), prompt: '진화원에서 카드를 등장시킬 디지몬 선택' });
      const stS = csS.find(x => x.uid === uS); if (!stS) break;
      const nS = Math.min(instr.n || 1, stS.sources.filter(okS).length);
      const idxS = await S.chooseSourceIdxs(state, who, stS, nS, ctx.choose, okS, `${S.card(stS.cardId).nameKo}의 진화원에서 코스트 없이 등장시킬 카드 ${nS}장 선택`);
      const takenS = idxS.map(i => stS.sources[i]);
      for (const i of [...idxS].sort((a, b) => b - a)) stS.sources.splice(i, 1);
      S.recomputeStackGrants(stS);
      for (const id of takenS) { plS.trash.push(id); S.playFreeFromZone(state, who, 'trash', plS.trash.length - 1, { rested: !!instr.rested, noTriggers: !!instr.noTriggers, fromSources: true, ...(await xrosOptsFor(ctx, who, 'trash', plS.trash.length - 1)) }); }
      break;
    }
    case 'placeSecurity': { // 패/트래시의 카드 1장을 시큐리티 위/아래에 (앞면으로) 놓는다
      const plP = state.players[who];
      ctx._lastPlacedSecurity = false;
      if (S.s1SecIncreaseBlocked(state, who)) { S.log(state, `${who} 시큐리티를 늘릴 수 없음 (효과 제한)`); break; }
      const okZ = (z) => plP[z].map((id, i) => i).filter(i => matchesFilter(S, plP[z][i], instr.filter));
      const zs = instr.zones.filter(z => okZ(z).length);
      if (!zs.length) { S.log(state, `${who} 시큐리티 아래에 놓을 수 있는 카드가 없음`); break; }
      let zP = zs[0];
      if (zs.length > 1) { const kZ = await ctx.choose('multipleChoice', { prompt: '카드를 가져올 위치', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) }); if (kZ == null) break; zP = zs[kZ] || zs[0]; }
      const ixP = await ctx.choose('pickFromZoneIndex', { player: who, zone: zP, eligibleIdxs: okZ(zP), prompt: instr.prompt || `${zP === 'hand' ? '패' : '트래시'}에서 시큐리티 ${instr.position === 'top' ? '위' : '아래'}에 놓을 카드 선택` });
      if (ixP == null) break;
      const [idP] = plP[zP].splice(ixP, 1);
      if (instr.faceUp) S.secAddFaceUp(state, who, idP, instr.position || 'top'); else S.addToSecurity(state, who, idP, instr.position || 'top');
      ctx._lastPlacedSecurity = true;
      break;
    }
    case 'useOptionFree': { // 패의 옵션 카드 1장을 코스트를 지불하지 않고 사용 (shard1/2/3/4 keep their own bespoke variants for special cards)
      const plO = state.players[who];
      if (S.s1HookAny(state, 's1cannotUseOption', { p: who }) || S.timedLocked(state, who, 'option')) { S.log(state, `${who} 옵션 카드를 사용할 수 없음 (효과)`); break; }
      ctx._lastUsedOption = false;
      const okO = plO.hand.map((id, i) => i).filter(i => S.isOptionLike(plO.hand[i]) && matchesFilter(S, plO.hand[i], instr.filter) && S.optionColorOk(state, who, plO.hand[i]));
      if (!okO.length) { S.log(state, `${who} 코스트 없이 사용할 수 있는 옵션 카드가 패에 없음`); break; }
      const ixO = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'hand', eligibleIdxs: okO, prompt: instr.prompt || '코스트를 지불하지 않고 사용할 옵션 카드 선택' });
      if (ixO == null) break;
      const [idO] = plO.hand.splice(ixO, 1);
      plO.trash.push(idO); // provisional (like useOptionCard); the option's own effect may relocate it
      S.log(state, `${who} ${S.card(idO).nameKo} 코스트를 지불하지 않고 사용`);
      ctx._lastUsedOption = true;
      S.queueTriggersFor(state, who, idO, 'use');
      S.emitGameEvent(state, 'optionUsed', { owner: who, stack: null, cardId: idO, cause: 'effect', useCost: 0 });
      break;
    }
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
    case 'selectStack': { // a bare "…1마리를 선택한다": pick now, later "그 디지몬" sentences use it (ctx._lastPick / _lastPickInfo)
      const tp = instr.target === 'opponent' ? ctx.opp : ctx.self;
      ctx._lastPick = undefined; ctx._lastPickInfo = undefined;
      const uids = candidateStacks(ctx, tp, { filter: instr.filter, excludeSelf: instr.excludeSelf, anyKind: instr.anyKind }).map(x => x.uid);
      if (uids.length) await ctx.choose('pickStack', { player: tp, uids, prompt: instr.prompt || '선택할 대상 고르기' });
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
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : S.durationEnd(state, dur);
      S.addSecurityDPMod(state, targetPlayer, instr.amount, expiresAfterTurn);
      break;
    }
    case 'evoCostMod': {
      const dur = instr.duration;
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : S.durationEnd(state, dur);
      S.addEvoCostMod(state, ctx.self, instr.delta, instr.filter, expiresAfterTurn);
      break;
    }
    case 'securityTopToHand': {
      const pl = state.players[who];
      for (let i = 0; i < (instr.n || 1); i++) {
        if (instr.end === 'either' && pl.security.length > 1) { // "시큐리티를 위 또는 아래에서부터 N장 패에 추가": the player picks the end (EX6-003/021, BT14-084)
          const kE = await ctx.choose('multipleChoice', { prompt: '시큐리티를 어느 쪽에서부터 패에 추가할까요?', options: ['위에서부터', '아래에서부터'] });
          if (kE === 1) { S.securityBottomToHand(state, who, 1); continue; }
        }
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
        if (instr.digiburst && removed.length) S.emitGameEvent(state, 'digiburst', { owner: targetPlayer, stack: st, cause: 'effect' }); // "자신의 디지몬이 《디지버스트》를 발휘했을 때" watchers (BT5-056)
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
        let pickIdx = null, trgUid = targetUid;
        if (instr.choose && Number.isInteger(instr.count)) {
          let tst = state.players[targetPlayer].battle.find(x => x.uid === targetUid);
          if (tst && instr.count < tst.sources.length) {
            const alt = S.redirectSourceTrash(state, targetPlayer, tst); if (alt) { tst = alt; trgUid = alt.uid; } // idx1367/1368 (BT10-084): the replaced discard is "선택하여" from the replacer's own sources, chosen by the effect's owner
            if (instr.count < tst.sources.length) pickIdx = await S.chooseSourceIdxs(state, ctx.self, tst, instr.count, ctx.choose, null, `${S.card(tst.cardId).nameKo}의 진화원 ${instr.count}장을 선택하여 파기`);
          }
        }
        S.trashEvoSources(state, targetPlayer, trgUid, instr.count ?? 'all', instr.from, pickIdx);
      }
      break;
    }
    case 'memoryBorrowAndRepay':
      S.grantMemory(state, ctx.self, instr.n, ctx.sourceCardId);
      S.scheduleEndOfTurn(state, () => S.grantMemory(state, ctx.self, -instr.n), { player: ctx.self, cardId: ctx.sourceCardId, label: `이 턴 종료 시 메모리 -${instr.n}`, desc: { kind: 'memory', player: ctx.self, n: instr.n } });
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
    case 'effectChoice': { // 15-15-7-2 (순차 선택-발휘 반복); 15-15-7-4(Ver.4.3): "모두 발휘"가 강제라도 각 효과의 임의
      // 처리 조건은 여전히 플레이어의 선택 — wrapChoose가 confirmEffect를 더 이상 자동으로 강제 처리하지 않는다.
      const all = instr.allIf ? await evalCondition({ test: instr.allIf }, ctx) : false;
      if (!all) {
        const idx = await ctx.choose('multipleChoice', { options: instr.options.map(o => o.label), prompt: '발휘할 효과를 1개 선택하세요' });
        if (idx != null && instr.options[idx]) { if (instr.options[idx].then.length) await runScript(instr.options[idx].then, ctx); else S.log(state, '선택한 효과는 자동 처리할 수 없음 (수동 처리): ' + instr.options[idx].label); }
        break;
      }
      const rest = instr.options.slice();
      while (rest.length) {
        let i = 0;
        if (rest.length > 1) { const k = await ctx.choose('multipleChoice', { options: rest.map(o => o.label), prompt: `모든 효과를 발휘합니다 — 먼저 발휘할 효과를 선택하세요 (룰 15-15-7-2, 남은 ${rest.length}개)` }); i = k == null || k < 0 || k >= rest.length ? 0 : k; }
        const [o] = rest.splice(i, 1);
        if (o.then.length) await runScript(o.then, ctx); else S.log(state, '자동 처리할 수 없는 효과 (수동 처리): ' + o.label);
      }
      break;
    }
    case 'choice': {
      const idx = await ctx.choose('multipleChoice', { options: instr.options.map(o => o.label), prompt: instr.prompt });
      if (idx != null && instr.options[idx]) await runScript(instr.options[idx].then, ctx);
      break;
    }
    default:
      if (CARD_OPS[instr.op]) await CARD_OPS[instr.op](instr, ctx, { runScript, runOne, matchesFilter, candidateStacks, compileToScript, lookupCardSpecific, runRevealPick, pickByGroups });
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
  else if ((m = sent.match(/지불하는\s*(?:진화\s*)?코스트\s*-(\d+)/) || sent.match(/(?:진화\s*)?코스트\s*-(\d+)\s*(?:으로|로)\s*진화/))) cost = { mode: 'discount', n: Number(m[1]) }; // b9: "…진화 코스트 -2로 진화할 수 있다" (BT25-003/067)
  else if ((m = sent.match(/(?:진화\s*)?코스트\s*(\d+)\s*(?:을\s*지불하여|으로|를\s*지불하여)|(\d+)\s*코스트\s*지불하여/))) cost = { mode: 'fixed', n: Number(m[1] ?? m[2]) };
  const ignoreCond = /진화\s*조건을\s*무시/.test(sent), ignoreLevel = /Lv\.\s*을\s*무시/.test(sent);
  // zone + card descriptor: "<zone>의 <desc>(으)로"
  const zm = sent.match(/(패\/트래시|패|트래시)의\s*(.+?)\s*(?:으로|로)\s*(?:(?:진화\s*조건을\s*무시하고|Lv\.을\s*무시하고|코스트를\s*지불하지\s*않고|지불하는\s*(?:진화\s*)?코스트\s*-\d+\s*하여|진화\s*코스트\s*\d+\s*(?:을\s*지불하여|으로)|\d+\s*코스트\s*지불하여|코스트를\s*지불하여|진화\s*코스트를\s*지불하여)\s*)*(?:진화시킬|진화할|진화시킨다)/);
  if (!zm) return null;
  const zone = zm[1] === '패' ? 'hand' : zm[1] === '트래시' ? 'trash' : 'handTrash'; // "패/트래시의 X로 진화" (BT16-071): zone chosen at run time
  const subjText = sent.slice(0, zm.index).replace(/[,\s]+$/, '').replace(/(?:을|를|은|는)$/, '').replace(/\s*자신의$/, '').replace(/(?:을|를|은|는)$/, '').trim();
  let cardFilter;
  const desc = zm[2].trim().replace(/\s*\d+\s*장$/, '');
  const qn = desc.match(/^((?:「[^」]+」\/?)+)$/);
  const evoCap = desc.match(/^진화\s*코스트\s*(\d+)\s*이하$/); // EX2-070 (Q3354-3360): 「진화 코스트 N 이하로 진화할 수 있는 디지몬 카드」 = 진화 조건의 코스트 상한 (등장 코스트가 아니다)
  if (evoCap) cardFilter = { category: 'digimon', evoCostMax: Number(evoCap[1]) };
  else if (qn) cardFilter = { exactAny: [...qn[1].matchAll(/「([^」]+)」/g)].map(x => x[1]), category: 'digimon' };
  else { cardFilter = parseCardFilter(desc); if (!cardFilter) return null; cardFilter = { ...cardFilter, category: 'digimon' }; }
  // subject
  let subject;
  if (/^이\s*디지몬/.test(subjText) && !/자신/.test(subjText)) subject = { thisStack: true };
  else {
    const sm2 = subjText.match(/^(다른\s*)?(.*?)\s*자신(?:의)?\s*(?:(디지몬)|「([^」]+)」)\s*(?:\d+\s*마리)?$/);
    if (!sm2) return null;
    const trailOther = /(?:^|\s)다른$/.test(sm2[2].trim()); // "특징 「CS」를 가진 다른 자신의 디지몬" (BT22-065): 「다른」 after the descriptor
    subject = { thisStack: false, other: !!sm2[1] || trailOther, desc: sm2[2].trim().replace(/\s*다른$/, '') || null, name: sm2[4] || null };
  }
  return { subject, zone, cardFilter, cost, ignoreCond, ignoreLevel };
}

// ---- text preparation ----
// Reminder text "(…)" and quoted granted-ability text "「【…】…」" describe OTHER things (keyword reminders, token stats, the effect a Digimon gains),
// yet every pattern scan below used to read them as if they were part of the effect ("…DP 3000·【소멸 시】 …DP -3000" inside a token definition compiled to a
// DP debuff). They are removed here; a token definition "「X」 (디지몬·…) 토큰" is kept as a marker for the spawnToken pattern.
// Printed-text idioms rewritten into forms the pattern scans already understand.
function prepRewrites(text) {
  // P-195/196/197/198/204: "진화 시킬 수 있다" (spaced) is the same verb as "진화시킬 수 있다" — the effect-evolution / 등장-시-effect matchers only knew the unspaced form.
  // ("【진화 시】" is bracketed and untouched: only a following 킬/킨/켜 form is joined.)
  text = text.replace(/진화\s+시(킬|킨다|켜|킨)/g, '진화시$1');
  // census (BT25-080): "상대의 디지몬을 1마리 소멸시킨다" (object particle BEFORE the count) = "상대의 디지몬 1마리를 소멸시킨다"; every "N마리 <verb>" matcher expects the count first
  text = text.replace(/(디지몬|테이머)을\s*(\d+)\s*(마리|명)\s*(소멸시킨다|소멸시킬|패로\s*되돌린다|덱\s*아래로\s*되돌린다|레스트시킨다)/g, '$1 $2$3를 $4');
  // "조그레스 진화하고 있었을 때, …" (ST9-05/11, ST10-06, BT8-015/042 …) is the same condition as "…있었다면," (condTestFor -> stack.viaFusion)
  text = text.replace(/조그레스\s*진화하고\s*있었을\s*때,/g, '조그레스 진화하고 있었다면,');
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
      if (/^디지몬·/.test(inner) && (/^\s*토큰/.test(text.slice(j)) || /^\s*(?:과|와)\s*「[^」]+」\s*[(（]디지몬·/.test(text.slice(j))) && /「[^」]+」\s*$/.test(out)) out = out.replace(/\s*$/, '') + `[[TOK:${enc(inner)}]]`;
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
  const dur = /(?:다음\s*)?상대의\s*턴\s*종료\s*시?\s*까지/.test(sn) ? oppDur(sn) : 'turn';
  const ops = [];
  for (const g of grants) {
    const gm = g.match(/^【([^】]+)】\s*([\s\S]*)$/);
    let kind = gm ? GRANT_KIND[gm[1].trim()] : null;
    let label = gm ? gm[2].trim() : g;
    let watch = null; // granted WATCHER ("【서로의 턴】 이 디지몬이 레스트했을 때, 메모리 -1."): fires from the 'rest' game event (state.queueGrantedWatch)
    if (gm && !kind && ['자신의 턴', '상대의 턴', '서로의 턴'].includes(gm[1].trim())) { const wm = gm[2].trim().match(/^([\[〔]턴\s*에?\s*1\s*회[\]〕]\s*)?이\s*디지몬이\s*레스트했을\s*때,?\s*(.+)$/s); if (wm) { kind = 'g:rest'; label = wm[2].trim(); watch = { turnTag: gm[1].trim(), once: !!wm[1] }; } }
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
    if (/이\s*디지몬과\s/.test(sn.split('「효과」')[0]) && !tgt.thisStack) ops.push({ op: 'grantText', trigger: kind, label, until: dur, ...(watch || {}), thisStack: true });
    ops.push({ op: 'grantText', trigger: kind, label, until: dur, ...(watch || {}), ...tgt });
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
      groups.push({ ...(Object.keys(f).length ? { filter: f } : {}), max, label: dsc.replace(/\s*카드$/, '') || '카드' });
    }
  }
  return groups.length ? groups : null;
}
// "<zone>에서 <descriptor> N장을 코스트를 지불하지 않고 등장" (hand/trash) -> playFree ops; tokens -> spawnToken; evolution-source plays stay manual
const SRC_PLAY_RE = /(?:^|,\s*|그\s*후,?\s*)(?:자신의\s*)?((?:패|트래시|이\s*디지몬의\s*진화원)(?:\s*(?:또는|\/|나)\s*(?:패|트래시|이\s*디지몬의\s*진화원))*)(?:에서|의|인)\s*,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(?:레스트\s*상태로\s*)?코스트를?\s*지불하지\s*않고\s*(?:레스트\s*상태로\s*)?등장시(킬\s*수\s*있다|킨다)/s;
function compilePlayFree(t) {
  const sn = (splitSentences(t).find(x => /\[\[TOK:/.test(x)) || splitSentences(t).find(x => /코스트를?\s*지불하지\s*않고/.test(x) && /등장/.test(x)) || t).replace(/^\s*[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  const srcZoneTxt = sn.split(/코스트를?\s*지불하지/)[0].replace(/진화원\s*효과를\s*(?:가진|갖는)/g, ''); // ("진화원 효과를 가진 테이머 카드" names a card property, not the evolution-source zone)
  const noTriggers = /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t);
  const rested = /레스트\s*상태로/.test(sn);
  let m;
  // "자신의 (패/트래시 또는) 테이머 아래에서 <카드> N장(까지)을 코스트를 지불하지 않고 등장시킬 수 있다" -> playFreeTamerUnder (used to compile to a plain hand playFree with no filter)
  if ((m = sn.match(/^(?:그\s*후,?\s*)?(?:자신의\s*(패|트래시)\s*(?:또는|\/)\s*)?(?:자신의\s*)?테이머\s*아래에서,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(?:레스트\s*상태로\s*)?코스트를?\s*지불하지/s))) {
    const dsc = m[2].trim();
    const f = !dsc || /^카드$/.test(dsc) ? {} : (strictCardFilter(dsc) || { desc: dsc });
    return [{ op: 'playFreeTamerUnder', who: 'self', zones: m[1] ? [m[1] === '패' ? 'hand' : 'trash'] : [], filter: f, n: Number(m[3]), rested, noTriggers, optional: true }];
  }
  if ((m = sn.match(/((?:상대는\s*)?(?:「[^」]+」\[\[TOK:[^\]]+\]\]\s*(?:와|과)\s*)+「[^」]+」\[\[TOK:[^\]]+\]\])\s*토큰\s*(\d+)\s*마리(?:씩)?(?:을|를)?/))) { // "「A」와 「B」(와 「C」) 토큰 1마리씩": one token per listed name (was: only the last one)
    return [...m[1].matchAll(/「([^」]+)」\[\[TOK:([^\]]+)\]\]/g)].map(tm => ({ op: 'spawnToken', who: /^상대는/.test(m[1]) ? 'opponent' : 'self', def: parseTokenDef(tm[1], decodeURIComponent(tm[2])), n: Number(m[2]), rested, optional: /수\s*있다/.test(sn) }));
  }
  if ((m = sn.match(/(상대는\s*)?「([^」]+)」\[\[TOK:([^\]]+)\]\]\s*토큰\s*(\d+)\s*(?:마리|장)(?:을|를)?/))) { // (ST22-05 prints "토큰 1장을")
    return [{ op: 'spawnToken', who: m[1] ? 'opponent' : 'self', def: parseTokenDef(m[2], decodeURIComponent(m[3])), n: Number(m[4]), rested, optional: /수\s*있다/.test(sn) }];
  }
  if (/진화원/.test(srcZoneTxt) && (m = sn.match(/^(.*?)자신의\s*디지몬(?:\s*(\d+)\s*마리)?의\s*진화원(?:인|에서|의)\s*,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(?:선택하고,?\s*그\s*카드(?:를|을)\s*)?코스트를?\s*지불하지\s*않고\s*(?:(?:테이머\s*또는\s*)?(?:다른|별개의)\s*디지몬으로서\s*)?등장시(킨다|킬\s*수\s*있다)/))) {
    // "자신의 디지몬 1마리의 진화원(에서/인) <카드> N장(까지)을 코스트를 지불하지 않고 (다른 디지몬으로서) 등장" — the sources of ONE of the player's stacks (ST2-15, BT7-096/097, BT11-098)
    const tm = parseTargetMods(m[1] || ''); const tOk = !tm._left;
    if (tOk) return [{ op: 'playFromSources', who: 'self', filter: criterionFilter(m[3].replace(/\s+/g, ' ')), n: Number(m[4]), upTo: !!m[5], ...(Object.keys(tm).length ? { targetFilter: tm } : {}), optional: /수/.test(m[6]), noTriggers, rested }];
  }
  if (/진화원/.test(srcZoneTxt) && (m = sn.match(SRC_PLAY_RE))) { // "<패/트래시/이 디지몬의 진화원>에서 <카드> N장(까지)을 코스트를 지불하지 않고 등장" -> moveEach (this stack's sources -> play)
    const from = []; let okZ = true;
    for (let z of m[1].split(/\s*(?:또는|\/|나)\s*/)) { z = z.trim(); if (z === '패') from.push('hand'); else if (z === '트래시') from.push('trash'); else if (/^이\s*디지몬의\s*진화원$/.test(z)) from.push('sources'); else okZ = false; }
    const alts = m[2].trim().replace(/,\s*$/, '').split(/(?<=\d\s*장)\s*(?:또는)\s*/).map(x => x.replace(/\s*\d+\s*장$/, '').trim());
    const fl = alts.map(a => (!a || /^카드$/.test(a) ? {} : /^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(a) ? { exactAny: [...a.matchAll(/「([^」]+)」/g)].map(x => x[1]) } : strictCardFilter(a)));
    if (okZ && from.includes('sources') && fl.every(Boolean) && !/서로\s*다른|씩|이외/.test(m[2])) {
      const f = fl.length === 1 ? fl[0] : { anyOf: fl };
      const upTo = !!m[4], optional = /수\s*있다/.test(m[5]);
      return [{ op: 'moveEach', who: 'self', from, groups: [{ ...(Object.keys(f).length ? { filter: f } : {}), max: Number(m[3]) * (fl.length > 1 ? 1 : 1), label: m[2].trim() || '카드' }], dest: 'play', rested: rested || /레스트\s*상태로/.test(m[0]), noTriggers, ...(optional || upTo ? {} : { required: true }) }];
    }
  }
  if (/진화원/.test(srcZoneTxt)) return [{ op: 'noop', note: `진화원의 카드를 코스트 없이 등장시키는 효과 — 수동으로 처리하세요: ${sn.replace(/\s+/g, ' ').slice(0, 100)}` }];
  const re = /(?:자신의\s*)?(패|트래시)(?:\s*(?:또는|\/)\s*(패|트래시))?(?:에서|의)?,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:씩)?(?:을|를|은)?\s*,?\s*(?:색\s*조건을\s*무시하고\s*)?(?:레스트\s*상태로\s*)?,?\s*((?:비어\s*있는\s*)?(?:자신의\s*)?육성\s*에어리어(?:에|의)?\s*)?,?\s*코스트를?\s*지불하지\s*않고/s;
  if ((m = sn.match(re))) {
    const b11Raising = !!m[6]; // b11: "…카드 1장을 (비어 있는 자신의) 육성 에어리어에 코스트를 지불하지 않고 등장시킨다" -> play into the breeding area (was: filter dropped + battle area)
    const zones = new Set([m[1], m[2]].filter(Boolean));
    const zone = zones.size === 2 ? 'any' : zones.has('트래시') ? 'trash' : 'hand';
    let dsc = m[3].trim();
    let b11NoSame = false; // "배틀 에어리어와 트래시에 같은 명칭의 자신의 카드가 없는, …"
    { const nm = dsc.match(/^(?:자신의\s*)?배틀\s*에어리어와\s*트래시에\s*같은\s*명칭의\s*자신의\s*카드가\s*없는,?\s*/); if (nm) { b11NoSame = true; dsc = dsc.slice(nm[0].length).trim(); } }
    if (dsc && /\d\s*장\s*(?:과|와)\s*\S/.test(dsc)) { // "A 1장과 B 1장을 …": one group per listed criterion, each with its own count (ST6-16)
      const tk = dsc.split(/\s*(\d+)\s*장\s*(?:과|와)\s*/); // [descA, nA, descB, (nB, descC …)]
      const grp = []; for (let i = 0; i < tk.length; i += 2) grp.push({ d: tk[i].trim(), n: i + 1 < tk.length ? Number(tk[i + 1]) : Number(m[4]) });
      const fls = grp.map(g => strictCardFilter(g.d));
      if (grp.every(g => g.d) && fls.every(Boolean)) return withPlayBatch(grp.flatMap((g, gi) => Array.from({ length: g.n }, () => ({ op: 'playFree', who: 'self', zone, filter: fls[gi], rested, noTriggers, optional: true, prompt: `${zone === 'trash' ? '트래시' : zone === 'any' ? '패/트래시' : '핸드'}에서 무료로 등장시킬 ${g.d} 선택` }))));
    }
    if (/씩|각각/.test(m[0]) && dsc) { // "A와 B 1장씩": one card per criterion (was: one card matching A-or-B)
      const gs = parsePickGroups(`${dsc} ${m[4]}장씩`);
      if (gs && gs.length > 1) return withPlayBatch(gs.flatMap(g => Array.from({ length: g.max }, () => ({ op: 'playFree', who: 'self', zone, filter: g.filter || null, rested, noTriggers, optional: true, prompt: `${zone === 'trash' ? '트래시' : zone === 'any' ? '패/트래시' : '핸드'}에서 무료로 등장시킬 ${g.label} 선택` }))));
    }
    let filter = null;
    if (dsc) {
      if (/^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(dsc)) filter = { exactAny: [...dsc.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
      else { filter = strictCardFilter(dsc); if (!filter) filter = { desc: dsc }; if (filter && !Object.keys(filter).length) filter = null; }
    }
    const ops = [];
    const whoP = /^\s*상대는\s*본인의/.test(sn) ? 'opponent' : 'self'; // "상대는 본인의 패에서 …를 코스트를 지불하지 않고 등장시킬 수 있다": the OPPONENT picks and plays (BT17-074/075)
    for (let i = 0; i < Number(m[4]); i++) ops.push({ op: 'playFree', who: whoP, zone, filter, rested, noTriggers, ...(m[5] || /수\s*있다/.test(sn) ? { optional: true } : {}), ...(b11Raising ? { toRaising: true } : {}), ...(b11NoSame ? { noSameName: true } : {}) });
    return withPlayBatch(ops);
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
  if (/^서로의\s*트래시(?:\s*합계)?$/.test(ph)) return { kind: 'zone', side: 'both', zone: 'trash' }; // pass2-b2: "서로의 트래시 합계 10장마다" (BT17-018)
  if ((m = ph.match(/^(자신|상대)의\s*(앞면의\s*시큐리티|시큐리티|패|트래시)$/))) return { kind: 'zone', side: m[1] === '상대' ? 'opp' : 'own', zone: /시큐리티/.test(m[2]) ? 'security' : m[2] === '패' ? 'hand' : 'trash', ...(/앞면/.test(m[2]) ? { faceUp: true } : {}) };
  if (/^(?:돌려놓은|되돌린|파기한|놓은|옮긴)(?:\s*(?:카드|시큐리티))?$/.test(ph)) return { kind: 'moved' }; // "되돌린 1장마다" / "돌려놓은 카드 1장당": the cards a preceding moveEach (cost or effect) moved
  if (/^그\s*디지몬이\s*(?:갖는|가진|가지는)\s*진화원$/.test(ph)) return { kind: 'lastSources' }; // "그 디지몬이 갖는 진화원 1장마다" (BT7-104)
  if ((m = ph.match(/^(자신|상대)의\s*디지몬과\s*테이머의\s*색$/))) return { kind: 'stackColors', side: m[1] === '상대' ? 'opp' : 'own' }; // "상대의 디지몬과 테이머의 색 2색마다" (EX10-068, BT18-079): distinct colors over that side's Digimon + Tamers
  if (/^이\s*디지몬의\s*진화원의\s*색$/.test(ph)) return { kind: 'sourceColors' }; // "이 디지몬의 진화원의 색 1색마다" (BT18-102)
  if (/^이\s*효과로\s*소멸(?:한|시킨)(?:\s*(?:디지몬|테이머|디지몬\/테이머))?$/.test(ph)) return { kind: 'lastRes', key: 'deleted' }; // "이 효과로 소멸한 1마리(명)마다" (BT19-011): the previous instruction's result
  if ((m = ph.match(/^(자신|상대)의\s*(패|트래시)(?:의|에서)?\s*(.+?)\s*카드$/))) { const f = strictCardFilter(m[3] + ' 카드'); if (f) return { kind: 'zone', side: m[1] === '상대' ? 'opp' : 'own', zone: m[2] === '패' ? 'hand' : 'trash', filter: f }; return null; }
  if ((m = ph.match(/^이\s*디지몬의\s*(?:뒷면(?:의|인)\s*)?진화원(?:의\s*(.+?)\s*카드)?$/))) { if (/뒷면/.test(ph)) return m[1] ? null : { kind: 'fdSources' }; if (!m[1]) return { kind: 'sources' }; const f = strictCardFilter(m[1] + ' 카드'); return f ? { kind: 'sources', filter: f } : null; }
  let exOther = false, distinctNames = false, ph2 = ph;
  ph2 = ph2.replace(/명칭이\s*서로\s*다른\s*/, () => { distinctNames = true; return ''; }); // "명칭이 서로 다른 특징으로 「…」를 가진 자신의 디지몬"
  ph2 = ph2.replace(/(^|\s)다른\s+/, (a, b) => { exOther = true; return b; }); // "다른 자신의 디지몬" / "레스트 상태인 다른 디지몬"
  if ((m = ph2.match(/^(.*?)\s*(?:(자신|상대)(?:의)?\s*)?(다른\s*)?(디지몬\/테이머|디지몬|테이머)$/)) && (m[2] || !/(?:자신|상대)/.test(m[1]))) {
    const mods = m[1] ? parseTargetMods(m[1]) : {};
    if (mods._left || mods.extreme) return null;
    const kindF = m[4] === '테이머' ? { category: 'tamer' } : m[4] === '디지몬/테이머' ? { anyOf: [{ category: 'digimon' }, { category: 'tamer' }] } : {}; // ("테이머 N명마다" counts Tamers only, not every stack)
    const fAll = { ...mods, ...kindF };
    return { kind: 'stacks', side: !m[2] ? 'both' : m[2] === '상대' ? 'opp' : 'own', filter: Object.keys(fAll).length ? fAll : undefined, excludeSelf: exOther || !!m[3], anyKind: m[4] !== '디지몬', ...(distinctNames ? { distinctNames: true } : {}) };
  }
  return null;
}
// "이 효과로 고를/선택할 수 있는 Lv.|등장 코스트|DP를 +N 한다" / "이 (DP|Lv.) 소멸 효과의 상한 +N" -> the canonical "이 효과의 <stat> 상한 +N"; "N장당," -> "N장마다,"
function capNorm(sn) {
  return sn.replace(/이\s*효과로\s*(?:고를|선택할)\s*수\s*있는\s*(Lv\.?|(?:등장\s*)?코스트|DP)(?:을|를|의)?\s*(?:상한\s*)?([+-])\s*(\d+)\s*(?:한다)?/, '이 효과의 $1 상한 $2$3')
    .replace(/이\s*(DP|Lv\.?)\s*소멸\s*효과의\s*상한/, '이 효과의 $1 상한')
    .replace(/(\d+\s*(?:장|마리|명|색))\s*당,\s*/, '$1마다, ').replace(/(\d+\s*(?:장|마리|명|색))\s*당\s+(?=\S)/, '$1마다, ');
}
// "<조건>라면/일 때, 이 효과로 선택할 수 있는 Lv.을 +N 한다" (BT10-108, EX3-064): the ceiling of the effect compiled just before rises only when the condition holds (op.capIf, applied by runOne)
function compileCapIf(text) {
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  if (sents.length < 2) return null;
  const last = capNorm(sents[sents.length - 1].replace(/^그\s*후,?\s*/, '').replace(/Lv\./g, 'Lv'));
  const m = last.match(/^(.*?(?:라면|다면|(?:있을|없을|이상일|이하일)\s*때)),?\s*이\s*효과의\s*(Lv|DP|(?:등장\s*)?코스트)\s*상한\s*([+-])\s*(\d+)\s*[.。]?$/s);
  if (!m || /마다/.test(m[1])) return null;
  const stat = m[2].startsWith('Lv') ? 'level' : m[2] === 'DP' ? 'dp' : 'cost';
  const key = { dp: 'dpMax', level: 'levelMax', cost: 'costMax' }[stat];
  const ops = compileToScript(sents.slice(0, -1).join(' '));
  const tgt = [...ops].reverse().find(o => (o.op === 'destroySum' ? o.stat === stat : (o.filter && o.filter[key] != null)));
  if (!tgt) return null;
  tgt.capIf = { test: condTestFor(m[1].replace(/Lv(?!\.)/g, 'Lv.')), delta: (m[3] === '-' ? -1 : 1) * Number(m[4]), stat };
  return ops;
}
// "<기간,> <대상>을/를 <수량원> N장/마리(명)마다/당, <효과>": the counted source comes AFTER the target (BT24-041/065, AD1-016, BT25-018, BT26-081) — reorder into the "<수량원> N마리마다, <대상>을 <효과>" form
function perTrailingSource(sn) {
  const mm = sn.replace(/Lv\./g, 'Lv').match(/^((?:(?:이\s*턴\s*동안|턴\s*종료까지|다음\s*상대의\s*턴\s*종료\s*시?까지|상대의\s*턴\s*종료까지),?\s*)?)(.*?)\s*(\d+)\s*(?:장|마리|명)\s*(?:\(명\))?\s*(?:마다|당),?\s*(.+)$/s);
  if (!mm || !/^(?:상대|자신)/.test(mm[2].trim())) return null;
  const head = mm[2].replace(//g, '.'), re = /[을를]\s+/g; let k;
  while ((k = re.exec(head))) {
    const tgt = head.slice(0, k.index + 1), srcTxt = head.slice(k.index + k[0].length).replace(/디지몬\s*(?:과|와)\s*테이머/, '디지몬/테이머').trim();
    const src = /^(?:다른\s*)?(?:상대|자신)/.test(srcTxt) || /(?:가진|포함하는)\s*(?:상대|자신)/.test(srcTxt) || /^(?:다른\s*)?(?:테이머|디지몬)$/.test(srcTxt) || /^이\s*디지몬의\s*(?:뒷면(?:의|인)?\s*)?진화원$/.test(srcTxt) ? parsePerSource(srcTxt) : null; // (b12: "상대의 디지몬 1마리를 이 디지몬의 뒷면의 진화원 1장마다 《퇴화 1》" — EX9-018/043)
    if (src) return { src, pm: [null, mm[1], srcTxt, mm[3], tgt + ' ' + mm[4].replace(//g, '.')] };
  }
  return null;
}
function compilePerSentences(text) {
  if (!/마다|(?:마리|장|명)\s*(?:\(명\))?\s*당[,\s]/.test(text) || /\n\s*·/.test(text)) return null;
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  if (sents.length) sents[0] = sents[0].replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, ''); // batch4: a leading 〔턴에 1회〕 made "자신의 트래시 10장마다" unparsable (BT10-082 (진화원) mem +1 ran once)
  const out = []; let buf = []; let changed = false;
  const flush = () => { if (buf.length) { const t1 = prepText(buf.join(' ')); out.push(...reorderBySentences(t1, compileToScriptCore(t1))); } buf = []; }; // (no per pass again: that would recurse)
  for (let si = 0; si < sents.length; si++) {
    const sn = capNorm(sents[si].replace(/^그\s*후,?\s*/, ''));
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
  else if (per.kind === 'stackColors') cnt = new Set(state.players[who].battle.filter(s => ['digimon', 'tamer'].includes(S.card(s.cardId).category)).flatMap(s => S.stackColors(s))).size;
  else if (per.kind === 'zone' && per.side === 'both') cnt = ['p1', 'p2'].reduce((n, pp) => n + state.players[pp][per.zone].filter(id => matchesFilter(S, id, per.filter)).length, 0);
  else if (per.kind === 'zone') {
    cnt = per.faceUp ? S.secFaceUpCount(state.players[who]) : state.players[who][per.zone].filter(id => matchesFilter(S, id, per.filter)).length;
    // Q&A BT4-111 (idx 664): an option card only goes to the trash AFTER its effect resolves, so it is not part of its own 「자신의 트래시 N장마다」 count (the engine trashes it on use, before resolving)
    if (per.zone === 'trash' && !per.faceUp && who === ctx.self && !ctx.sourceStackUid && ctx.sourceCardId && (ctx.trigger?.tags || []).includes('메인') && S.card(ctx.sourceCardId)?.category === 'option' && state.players[who].trash.includes(ctx.sourceCardId) && matchesFilter(S, ctx.sourceCardId, per.filter)) cnt = Math.max(0, cnt - 1);
  }
  else if (per.kind === 'sourceColors') { const pl = state.players[ctx.self]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); cnt = st ? new Set(st.sources.flatMap(id => S.card(id).colors || [])).size : 0; }
  else if (per.kind === 'lastRes') cnt = (ctx._res && ctx._res[per.key]) || 0; // "이 효과로 소멸한 1마리마다": what the previous instruction did
  else if (per.kind === 'lastSources') { const lp = resolveLast(ctx); const st0 = lp && [ctx.state.players[lp.player].raising, ...ctx.state.players[lp.player].battle].filter(Boolean).find(x => x.uid === lp.uid); cnt = st0 ? st0.sources.length : 0; } // "그 디지몬이 갖는 진화원 N장마다"
  else if (per.kind === 'fdSources') { const pl = state.players[ctx.self]; const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid); cnt = st ? S.fdCount(st) : 0; } // "이 디지몬의 뒷면의 진화원 1장마다"
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
    if (take(/(자신|상대)의\s*패\s*매수\s*(이상|이하)의\s*Lv\.?(?:의|인)?$/, m => { f.lvVsHand = { side: m[1] === '자신' ? 'self' : 'opp', dir: m[2] }; })) continue; // EX6-071/BT23-097: "자신/상대의 패 매수 이상의 Lv.의 …"
    if (take(/Lv\.\s*(\d+)\s*(이하|이상)?(?:인|의)?$/, m => { f[m[2] === '이하' ? 'levelMax' : m[2] === '이상' ? 'levelMin' : 'level'] = Number(m[1]); })) continue;
    if (take(/(?:등장\s*)?코스트\s*(\d+)\s*(이하|이상)(?:인|의)?$/, m => { f[m[2] === '이하' ? 'costMax' : 'costMin'] = Number(m[1]); })) continue;
    if (take(/(레스트|액티브)\s*상태(?:인|의)$/, m => { f.suspended = m[1] === '레스트'; })) continue;
    if (take(/진화원(?:을|이)?\s*(?:갖지\s*않은|갖지\s*않는|가지지\s*않은|가지지\s*않는)$/, () => { f.noSources = true; })) continue;
    if (take(/진화원\s*매수가\s*이\s*디지몬\s*(이하|이상)(?:의|인)?$/, m => { f[m[1] === '이하' ? 'srcMaxSelf' : 'srcMinSelf'] = true; })) continue; // "진화원 매수가 이 디지몬 이하의" (BT16-025/027 …)
    if (take(/진화원(?:\s*매수)?(?:가|이)\s*(\d+)\s*장\s*(이하|이상)(?:의|인)?$/, m => { f[m[2] === '이하' ? 'srcMax' : 'srcMin'] = Number(m[1]); })) continue;
    if (take(/진화원(?:을)?\s*(?:가진|갖는)$/, () => { f.hasSources = true; })) continue;
    // stack filters on the evolution sources: "진화원에 「X」를 가진" / "진화원에 2색 이상인 카드를 가진" / "진화원을 N장 이상 가진"; "명칭에 「A」를 포함하거나 진화원에 「B」를 가진" = OR
    if (take(/명칭에\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*포함하거나\s*진화원에\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*(?:가진|갖는|가지는)$/, m => { const nl = (x) => [...x.matchAll(/「([^」]+)」/g)].map(y => y[1]); const l2 = nl(m[2]); (f.anyOf ||= []).push({ nameAny: nl(m[1]) }, { srcHas: { exactAny: l2 } }); })) continue;
    if (take(/진화원(?:에|에서)\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*(?:가진|갖는|가지는)$/, m => { const l = [...m[1].matchAll(/「([^」]+)」/g)].map(y => y[1]); f.srcHas = { exactAny: l }; })) continue;
    if (take(/진화원에\s*(\d)\s*색\s*이상인\s*카드를\s*(?:가진|갖는|가지는)$/, m => { f.srcHas = { colorCountMin: Number(m[1]) }; })) continue;
    if (take(/진화원\s*을\s*(\d+)\s*장\s*이상\s*(?:가진|갖는|가지는)$/, m => { f.srcMin = Number(m[1]); })) continue;
    if (take(/(\d)\s*색\s*이상(?:인|의)$/, m => { f.colorCountMin = Number(m[1]); })) continue;
    if (take(/《([^》]+)》\s*(?:를|을|이|가)\s*(?:가진|갖는)$/, m => { f.keywordHas = m[1].trim(); })) continue;
    if (take(/《([^》]+)》\s*(?:를|을|이|가)\s*(?:갖지\s*않은|갖지\s*않는|가지지\s*않은|가지지\s*않는)$/, m => { f.noKeywordText = m[1].trim(); })) continue;
    // "명칭에 「A」를 포함하거나 특징으로 「B」를 가진 …" = OR of the two criteria (BT6-084, ST12-13, BT14-086 …)
    if (take(/명칭에\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*포함하거나\s*특징(?:으로|에|은)?\s*((?:「[^」]+」\s*\/?\s*)+)\s*(?:을|를)?\s*(가진|갖는|가지는|포함하는)$/, m => { const nl = (x) => [...x.matchAll(/「([^」]+)」/g)].map(y => y[1]); (f.anyOf ||= []).push({ nameAny: nl(m[1]) }, m[3] === '포함하는' ? { traitIncludes: nl(m[2]) } : { traitAny: nl(m[2]) }); })) continue;
    if (take(/특징(?:으로|에|은)?\s*((?:「[^」]+」\s*(?:\/|또는)?\s*)+)\s*(?:을|를)?\s*(가진|갖는|가지는|포함하는)$/, m => { const l = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); if (m[2] === '포함하는') f.traitIncludes = l; else f.traitAny = l; })) continue;
    if (take(/((?:「[^」]+」\/?)+)\s*(?:이|가)\s*기술되어\s*있는$/, m => { f.mentionAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); })) continue; // pass2-b3: "「X」가 기술되어 있는" = name OR text mentions X (cardMentions), not name-only
    if (take(/명칭에\s*((?:「[^」]+」\/?)+)\s*(?:을|를)?\s*포함하는$/, m => { f.nameAny = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); })) continue;
    if (take(new RegExp(String.raw`((?:${C})(?:\/(?:${C}))*)(?:인|의)$`), m => { f.colors = m[1].split('/').map(x => FILTER_COLOR[x]); })) continue;
    break;
  }
  Object.defineProperty(f, '_left', { value: s, enumerable: false });
  return f;
}
// Finds "<pre> <side>(의) [다른] <noun> (N마리|전부)<tail>" and returns { n, all, upTo, excludeSelf, filter? } (filter only when modifiers were found).
function findTgt(t, side, noun, tail) {
  const re = new RegExp(String.raw`((?:[^,.。\n]|Lv\.)*?)(다른\s*)?(?:${side})(?:의)?\s*(다른\s*)?(${noun})\s*(?:(\d+)\s*(?:마리|명|장)(?:\(명\))?(까지)?(?:씩)?|(전부))${tail}`);
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
  if (/(?:그|이\s*효과로\s*(?:등장|진화)(?:한|시킨))\s*디지몬(?:\s*1\s*마리)?(?:은|는|에게|이)\s*,?$/.test(pre)) return { last: true, sn };
  const tail = String.raw`(?:은|는|에게|에|를|을|가)?\s*,?\s*$`;
  const tgS = findTgt(pre, '자신', '디지몬', tail), tgO = findTgt(pre, '상대', '디지몬', tail);
  const tg = tgS && tgO ? (pre.lastIndexOf('상대') > pre.lastIndexOf('자신') ? tgO : tgS) : (tgS || tgO);
  if (!tg) return null;
  return { target: tg === tgO ? 'opponent' : 'self', n: tg.n, all: tg.all, upTo: tg.upTo, ...tgtProps(tg), sn };
}
// ops for one granted effect on the subject (grantKeyword / modifyDP …)
function subjectOps(gs, mk, linked = false) {
  if (linked && !gs.thisStack && !gs.last && !gs.all && (gs.n || 1) === 1) return [mk({ target: gs.target, last: true })]; // "자신의 디지몬 1마리는 《A》를 얻고, DP +N": the 2nd effect hits the Digimon the 1st one picked
  if (gs.thisStack) return [mk({ target: 'self', thisStack: true })];
  if (gs.last) return [mk({ target: 'self', last: true })];
  if (gs.all) return [mk({ target: gs.target, all: true, ...(gs.filter ? { filter: gs.filter } : {}), ...(gs.excludeSelf ? { excludeSelf: true } : {}) })];
  const sdk = (gs.n || 1) > 1 ? 'so' + (++DISTINCT_SEQ) : null; // "N마리(까지)" = N distinct targets
  return Array.from({ length: gs.n || 1 }, () => mk({ target: gs.target, thisStack: false, ...(sdk ? { distinct: sdk } : {}), ...(gs.filter ? { filter: gs.filter } : {}), ...(gs.excludeSelf ? { excludeSelf: true } : {}), ...(gs.upTo ? { optional: true } : {}) }));
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
      return [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: Number(db[1]), digiburst: true }], then: bullet, costText: `진화원 ${Number(db[1])}장을 파기 (디지버스트 ${Number(db[1])})`, thenText: '' }];
    }
  }

  // Simple unconditional actions (also handled as instant auto-apply in
  // state.js for whole-segment matches, but included here too so they still
  // fire correctly when part of a larger multi-clause sentence).
  let m;
  if ((m = t.match(/[≪《]\s*(\d+)\s*드로우\s*[≫》]/))) { script.push({ op: 'draw', who: 'self', n: Number(m[1]) }); if (/서로는\s*(?:각각\s*)?[≪《]\s*\d+\s*드로우/.test(t)) script.push({ op: 'draw', who: 'opponent', n: Number(m[1]) }); } // "서로는 《1 드로우》": both players draw
  if (!/드로우/.test(t) && (m = t.match(/(서로는|상대는|자신은)?\s*(?:각각\s*)?(?:자신의\s*)?덱(?:\s*위)?(?:에서|에서부터)\s*(?:부터\s*)?카드를\s*(\d+)\s*장\s*뽑는다/))) { // spelled-out draw without 《N 드로우》 (BT16-020 "서로는 덱에서 카드를 1장 뽑는다")
    const n = Number(m[2]);
    if (m[1] !== '상대는') script.push({ op: 'draw', who: 'self', n });
    if (m[1] === '서로는' || m[1] === '상대는') script.push({ op: 'draw', who: 'opponent', n });
  }
  if (/(?:턴\s*종료\s*시?까지|이\s*턴\s*동안)/.test(t) && /(?:^|[\s,])이\s*디지몬(?:은|이)[^.]*?블록당하지\s*않는다/.test(t) && !/에게는\s*블록당하지/.test(t)) script.push({ op: 'unblockableSelf', duration: /상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : 'turn' }); // "턴 종료까지 이 디지몬은 블록당하지 않는다" (BT16-054, BT14-020 …)
  if ((m = t.match(/(?<=(?:까지|[.,。])\s*|^)(이\s*디지몬|자신의\s*디지몬\s*1\s*마리)(?:은|는)\s*상대의\s*효과로\s*DP가\s*마이너스되지\s*않고,?\s*[《≪]\s*퇴화\s*[》≫](?:의)?\s*효과를\s*받지\s*않는다/))) { // "…까지 이 디지몬/자신의 디지몬 1마리는 상대의 효과로 DP가 마이너스되지 않고, 《퇴화》의 효과를 받지 않는다" (BT16-055, BT11-069 …): shard4 s4_shield
    script.push({ op: 's4_shield', kinds: ['dpDown', 'retreat'], dur: /상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opp' : 'turn', ...(/^이/.test(m[1]) ? { thisStack: true } : {}) });
  }
  if (/(?:^|[.,。]|까지,?)\s*자신의\s*디지몬\s*전부에\s*겹쳐진\s*카드는\s*상대의\s*효과로\s*파기되지\s*않는다/.test(t)) script.push({ op: 's8_shield', target: 'ownAllMatching', kinds: ['srcTrash'] }); // EX12-059 "상대의 턴 종료까지, 자신의 디지몬 전부에 겹쳐진 카드는 상대의 효과로 파기되지 않는다" (공식 Q&A idx6062: 《퇴화》·진화원 파기 처리가 되지 않는다 / 디지몬 자체는 소멸 가능)
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
  // Q3976/Q4936 (EX8-073/BT22-074): a plain "…소멸시킨다" is mandatory (a legal target must be picked), but many
  // OTHER printed cards (EX8-074, BT21-045, BT16-079 …) use "…소멸시킬 수 있다" with no "까지" at all — findTgt()'s
  // upTo only fires on a numeric "까지", so it misses that verb-level optionality. Scope the "수 있다" check to the
  // ONE sentence that actually contains this destroy clause (not the whole multi-sentence segment), so a later
  // unrelated "그 후, …할 수 있다" tail can't leak "optional" onto an earlier, separate mandatory destroy.
  const destroyClauseOptional = (side) => {
    const sent = splitSentences(t).find(s => s.includes('소멸') && s.includes(side));
    return /소멸시킬\s*수\s*있다/.test(sent || t);
  };
  { const tgO = findTgt(t, '상대', '(?:디지몬\/테이머|디지몬|테이머)', String.raw`(?:를|을)?\s*소멸`), tgS = findTgt(t, '자신', '디지몬', String.raw`(?:를|을)?\s*소멸`);
    if (/^이\s*(?:디지몬|테이머)(?:을|를)\s*소멸시킨다[.。]?$/.test(t)) {
      script.push({ op: 'destroy', target: 'self', mode: 'thisStack' });
    } else if (tgO) {
      if (tgO.all) script.push({ op: 'destroy', target: 'opponent', mode: 'all', ...tgtProps(tgO) });
      else for (let i = 0; i < tgO.n; i++) script.push({ op: 'destroy', target: 'opponent', mode: 'choose', ...(tgO.upTo || destroyClauseOptional('상대') ? { optional: true } : {}), ...(tgO.noun === '디지몬/테이머' ? { anyKind: true } : {}), ...tgtProps(tgO), ...(tgO.noun === '테이머' ? { filter: { ...(tgO.filter || {}), category: 'tamer' } } : {}) });
    } else if (/가장\s*(?:DP가\s*)?낮은[^。\n]*상대[^。\n]*디지몬[^。\n]*소멸|상대[^。\n]*가장\s*(?:DP가\s*)?낮은[^。\n]*디지몬[^。\n]*소멸/.test(t)) {
      // official ruling (slice6 G40/G41 area): "가장 DP가 낮은 상대의 디지몬 1마리를 소멸시킨다" destroys ONE (the player picks among ties); only "전부/모두" destroys every tied one.
      const dsent = t.split(/[.。]/).find((x) => /소멸/.test(x) && /가장\s*(?:DP가\s*)?낮은/.test(x)) || t;
      if (/전부|모두|모든/.test(dsent)) script.push({ op: 'destroy', target: 'opponent', mode: 'lowestDP' });
      else script.push({ op: 'destroy', target: 'opponent', mode: 'choose', ...(destroyClauseOptional('상대') ? { optional: true } : {}), filter: { extreme: { stat: 'dp', dir: 'min' } } });
    }
    if (tgS && !/^이\s*디지몬을/.test(t) && !tgS.all) {
      for (let i = 0; i < tgS.n; i++) script.push({ op: 'destroy', target: 'self', mode: 'choose', ...(tgS.upTo || destroyClauseOptional('자신') ? { optional: true } : {}), ...tgtProps(tgS) });
    } else if (tgS && tgS.all && !/^이\s*디지몬을/.test(t)) {
      script.push({ op: 'destroy', target: 'self', mode: 'all', ...tgtProps(tgS) });
    } }

  // Retreat / de-digivolve.
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:를)?\s*[≪《]\s*퇴화\s*(\d+)\s*[≫》]/))) {
    script.push({ op: 'retreat', target: 'opponent', n: Number(m[1]), all: true });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*(?:마리|장)(?:까지)?(?:를|을)?\s*[≪《]\s*퇴화\s*(\d+)\s*[≫》]/))) {
    { const rdk = 'rt' + (++DISTINCT_SEQ); for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'retreat', target: 'opponent', n: Number(m[2]), ...(Number(m[1]) > 1 ? { distinct: rdk } : {}) }); } // "N마리까지" = N distinct targets
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*1\s*마리를?\s*[≪《]?\s*퇴화\s*(\d+)\s*[≫》]?/))) {
    script.push({ op: 'retreat', target: 'self', n: Number(m[1]) });
  }

  // "(그 후,) 이 디지몬을 소멸시킨다" as a trailing clause (the anchored form above only matched a lone sentence).
  if (/이\s*디지몬을\s*소멸시킨다/.test(t) && !/것으로\s*,?\s*이\s*디지몬을\s*소멸시킨다/.test(t) && !script.some(o => o.op === 'destroy' && o.mode === 'thisStack')) {
    script.push({ op: 'destroy', target: 'self', mode: 'thisStack', deferLast: true });
  }
  // "이 디지몬/자신의 디지몬 N마리로 (상대의 디지몬에게) 어택할 수 있다" — an effect-granted immediate attack.
  if ((m = t.match(/(이\s*디지몬|자신(?:의)?\s*디지몬\s*\d+\s*(?:마리|장))(?:으로|로)\s*(?:상대(?:의)?\s*디지몬(?:에게|에)\s*)?어택할\s*수\s*있다/)) && !/(?:동안|때)[^.]*어택할\s*수\s*있다/.test(t.replace(/\([^()]*\)/g, ''))) {
    script.push({ op: 'attackNow', who: 'self', thisStack: /^이/.test(m[1]), ...(/디지몬(?:에게|에)\s*어택할\s*수\s*있다/.test(t) ? { digimonOnly: true } : {}) }); // pass2-b2: 「상대의 디지몬에 어택」(BT12-056) also matches; digimon-only target
  } else if (/^\s*(?:[【\[][^】\]]*[】\]]\s*)?이\s*디지몬으로\s*어택한다\.?\s*$/.test(t)) {
    script.push({ op: 'attackNow', who: 'self', thisStack: true }); // census: the MANDATORY form (granted "【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다." / S2-GRANT 부여 label) compiled to [] = a manual prompt on every trigger
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
  if ((m = t.match(/자신(?:의)?\s*패(?:에서|를)?\s*(\d+)\s*장(?:을)?\s*파기/) || t.match(/(?:하고|한다\.)\s*,?\s*패(?:를|에서)?\s*(\d+)\s*장(?:을)?\s*파기한다/)) && !/전부/.test(t)) { // ("《1 드로우》하고, 패 1장을 파기한다" — 자신의 omitted: BT21-067)
    script.push({ op: 'trashHand', who: 'self', n: Number(m[1]) });
  }

  // Reveal top N of own deck, add matching card(s) to hand (or play them for free), rest to bottom.
  const rvPick = compileRevealPick(t);
  if (rvPick) script.push(rvPick);
  else if ((m = t.match(/(?:자신의\s*)?덱(?:을)?\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*(?:오픈|공개)/))) {
    // "그중 <조건> 카드 N장(과 <조건> 카드 N장)을 패에 추가한다 / 코스트를 지불하지 않고 등장시킬 수 있다" — the picker only offers matching cards, up to N per group.
    const pm = t.replace(/(?:을|를)\s*(\d+\s*장씩)\s*(패(?:에|로)\s*추가)/, ' $1을 $2').match(/그\s*중(?:에서|에)?\s*(.*?)\s*(?:을|를)\s*(패(?:에|로)\s*(?:추가(?:한다|하고)|넣는다)|코스트를?\s*지불하지\s*않고\s*(?:레스트\s*상태로\s*)?등장(?:시킬\s*수\s*있다|시킨다|할\s*수\s*있다))/s);
    const action = pm && !/패(?:에|로)/.test(pm[2]) ? 'play' : 'hand';
    let groups = pm ? parsePickGroups(pm[1]) : null;
    if (!groups && pm) { const pf1 = parseCardFilter(pm[1].replace(/\s*\d+\s*장(?:까지)?\s*$/, '')); const nn = pm[1].match(/(\d+)\s*장/); groups = [{ ...(pf1 ? { filter: pf1 } : {}), max: nn ? Number(nn[1]) : 1 }]; }
    // "그 카드가 <조건>라면 패에 추가한다" (top-1 reveal): only a matching card may be taken
    if (!pm) { const cdm = t.match(/그\s*카드가\s*(.*?)\s*(?:이)?(?:라면|다면),?\s*패에\s*추가한다/s); if (cdm) { const pfc = parseCardFilter(cdm[1]); if (pfc) groups = [{ filter: pfc, max: 1 }]; } }
    const max = groups ? groups.reduce((a, g) => a + g.max, 0) : 1;
    // verify-reveal-3: no "그중" clause = the cards are only looked at ("오픈한 카드는 덱 위 또는 아래로만 되돌린다"): nothing may be picked; "…수 있다"/"N장까지" = optional pick, otherwise the player must take a matching card
    const noPick = !pm && !groups && !/그\s*중/.test(t);
    const pickOpt = !!pm && /(?:장까지|수\s*있다)/.test(pm[0]);
    script.push({ op: 'revealTop', who: 'self', n: Number(m[1]),
      ...(/오픈(?:하?여)?\s*할\s*수\s*있다/.test(t) ? { optionalReveal: true } : {}), ...(/자신\s*\/\s*상대의\s*덱/.test(t) ? { whoChoice: true } : {}),
      pick: { min: 0, max: noPick ? 0 : max, ...(noPick ? { noPick: true } : {}), ...(pickOpt ? { optional: true } : {}),...(groups && groups.length === 1 && groups[0].filter ? { filter: groups[0].filter } : {}), ...(groups && groups.length > 1 ? { groups } : {}), ...(action === 'play' ? { action: 'play', rested: /레스트\s*상태로/.test(pm[2]), noTriggers: /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t) } : {}) },
      restTo: /남은\s*카드(?:는|를)\s*(?:원하는\s*순서대로\s*)?파기한다|나머지는\s*파기한다/.test(t) ? 'trash' : /덱(?:\s*의)?\s*위(?:\s*또는|나)\s*(?:덱(?:\s*의)?\s*)?아래(?:로|에)?만?\s*(?:되돌|돌려)/.test(t) ? 'either' : /덱\s*(?:의)?\s*위(?:로)?\s*(?:되돌|돌려)/.test(t) ? 'top' : 'bottom' });
    refineRevealTop(t, script[script.length - 1]);
  }

  // "이 디지몬과 <다른 자신의 디지몬>으로 (코스트를 지불하여) 패의 디지몬 카드/「X」로 조그레스 진화할 수 있다."
  if ((m = t.match(/^이\s*디지몬과\s*(?:명칭에\s*「([^」]+)」을?\s*포함하는\s*)?(?:다른\s*자신의|자신의\s*다른)\s*디지몬(?:\s*\d+\s*마리)?(?:으로|로),?\s*(?:코스트를\s*지불하여\s*)?패의\s*(?:디지몬\s*카드|「([^」]+)」)(?:으로|로)\s*조그레스\s*진화할\s*수\s*있다/))) {
    script.push({ op: 'jogressEffect', who: 'self', partnerName: m[1] || null, cardName: m[2] || null });
  }

  // 【시큐리티】 "이 카드를 코스트를 지불하지 않고 등장시킨다" (331 printed segments): the card being checked, NOT a hand card of the
  // player's choice — it sits in limbo/trash after the check (13-1-6 / 13-1-8-4).
  if (/(?:^|[.。]\s*|그\s*후,?\s*|배틀을\s*진행하지\s*않고,?\s*)(?:이\s*카드를\s*코스트를?\s*지불하지\s*않고\s*등장\s*시(?:킨다|킬\s*수\s*있다)|코스트를?\s*지불하지\s*않고\s*이\s*카드를\s*등장\s*시(?:킨다|킬\s*수\s*있다))/.test(t) && !/(?:패|트래시)(?:\s*(?:또는|\/)\s*(?:패|트래시))?에서/.test(t)) {
    script.push({ op: 'playThisFree', ...(/등장\s*시킬\s*수\s*있다/.test(t) ? { optional: true } : {}) }); // b10: "…등장시킬 수 있다" (【소멸 시】 EX4-011/059, BT7-072 …) is optional
  } else
  // Play a card without paying cost, from hand or trash (or a token / evolution-source card).
  if ((/코스트를?\s*(?:지불하지\s*않고|支払わ)|코스트\s*없이/.test(t) || /\[\[TOK:[^\]]+\]\]\s*토큰[^.]*등장/.test(t)) && /등장/.test(t) && !script.some(o => (o.op === 'revealTop' && o.pick?.action === 'play') || (o.op === 'revealPick' && o.steps.some(s => s.dests.some(d => d.k === 'play'))))) {
    const pfOps = compilePlayFree(t);
    if (pfOps) script.push(...pfOps);
    else {
      const zone = /트래시/.test(t) ? (/패/.test(t) ? 'any' : 'trash') : 'hand';
      script.push({ op: 'playFree', who: 'self', zone, filter: null, rested: /레스트\s*상태로/.test(t), noTriggers: /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(t) });
    }
  }

  // "자신의 패에서 <조건> 옵션 카드 N장을 코스트를 지불하지 않고 사용할 수 있다" (BT17-038, EX7-059, BT19-037/040, EX8-037 …): the option is used for free (its 【메인】 effect queues as a normal use)
  if ((m = t.match(/(?:자신(?:의)?\s*)?패에서,?\s*((?:[^.。]|Lv\.)*?옵션\s*카드)\s*(\d+)\s*장(?:을|를)?\s*코스트를?\s*지불하지\s*않고\s*사용/))) {
    let cc = null; const dsc = m[1].replace(/(^|\s)1\s*색의\s*/, (a, b) => { cc = 1; return b; });
    const f0 = strictCardFilter(dsc);
    const filter = { ...(f0 || { desc: dsc }), ...(cc ? { colorCount: 1 } : {}) };
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'useOptionFree', who: 'self', filter, optional: /수\s*있다/.test(t) });
  }

  // "자신의 패(/트래시)에서 <조건> 카드 N장(까지)을 (이 디지몬|자신의 디지몬|육성 에어리어의 자신의 「X」)의 진화원 아래에 놓을 수 있다/놓는다"
  if ((m = t.match(/자신(?:의)?\s*(패\s*\/\s*트래시|패|트래시)에서,?\s*((?:[^.。]|Lv\.)*?카드|(?:「[^」]+」\/?)+)\s*(\d+)\s*장(까지)?(?:를|을)?\s*,?\s*(이\s*디지몬의|육성\s*에어리어의\s*자신의\s*「[^」]+」의|[^.。,]*?자신의\s*디지몬(?:\s*1\s*마리)?의)\s*진화원(?:의\s*가장)?\s*아래(?:쪽)?에\s*놓(을\s*수\s*있다|는다)/))) {
    const dscU = m[2], fU = strictCardFilter(dscU), tn = m[5].match(/「([^」]+)」/);
    script.push({ op: 'placeUnderSource', who: 'self', zones: m[1].includes('/') ? ['hand', 'trash'] : [m[1] === '패' ? 'hand' : 'trash'], filter: fU || { desc: dscU }, n: Number(m[3]), ...(/^이/.test(m[5]) ? { thisStack: true } : /^육성/.test(m[5]) ? { raising: true, targetFilter: { exactAny: [tn[1]] } } : (() => { const tmU = parseTargetMods(m[5].replace(/자신의s*디지몬(?:s*1s*마리)?의s*$/, '')); return !tmU._left && Object.keys(tmU).length ? { targetFilter: tmU } : {}; })()), optional: m[4] === '까지' || /수\s*있다/.test(m[6]) });
  }

  // "자신의 패(/트래시)에서 <조건> 카드 N장을 시큐리티 위|아래에 [앞면으로] 놓을 수 있다/놓는다" (EX6-021/068, BT19-036/096, BT18-038 …)
  if ((m = t.match(/자신(?:의)?\s*(패\s*\/\s*트래시|패|트래시)에서,?\s*((?:[^.。]|Lv\.)*?카드)\s*(\d+)\s*장(?:을|를)?\s*(?:자신의\s*)?시큐리티\s*(위|아래)에\s*(앞면으로\s*)?놓(을\s*수\s*있다|는다)/))) {
    const dscS = m[2].replace(/(^|\s)1\s*색의\s*/, (a, b) => b), fS = strictCardFilter(dscS);
    for (let i = 0; i < Number(m[3]); i++) script.push({ op: 'placeSecurity', who: 'self', zones: m[1].includes('/') ? ['hand', 'trash'] : [m[1] === '패' ? 'hand' : 'trash'], filter: { ...(fS || { desc: dscS }), ...(/(^|\s)1\s*색의\s*/.test(m[2]) ? { colorCount: 1 } : {}) }, position: m[4] === '위' ? 'top' : 'bottom', faceUp: !!m[5], optional: /수\s*있다/.test(m[6]) });
  }

  { const gOps = /「효과」\[\[GRANT:/.test(t) ? compileGrants(t) : null; if (gOps) script.push(...gOps); }

  // "이 테이머/디지몬을 레스트시킨다" — rest the effect's own source stack (also the usual
  // COST of "…레스트시키는 것으로," clauses, see compileWithCost).
  if (/이\s*(?:테이머|디지몬)(?:을|를)\s*레스트시킨다/.test(t)) script.push({ op: 'restStack' });

  // Unsuspend ("액티브로 한다"). "이 디지몬" = the source card itself (no
  // choice needed); "자신/상대의 디지몬 N마리" = pick from that player's board.
  if (/이\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다|하고)/.test(t)) { // (batch4: "…액티브로 하고, <효과>" — the 하고 spelling used to drop the unsuspend: BT11-065, BT10-009/057, BT11-017 …)
    script.push({ op: 'unsuspend', target: 'thisStack' });
  } else if (/^\s*그\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다|하고)|[.,]\s*그\s*디지몬을\s*액티브로\s*(?:한다|할\s*수\s*있다|하고)/.test(t)) {
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
  const tgRest = findTgt(t, '상대', String.raw`(?:디지몬(?:\/테이머)?|테이머)`,String.raw`(?:를|을)?\s*레스트\s*시(?:킨다|키고|킬\s*수\s*있다)`);
  if (tgRest && !tgRest.all) {
    const skipNextUnsuspend = skipsNextUnsuspend(t);
    for (let i = 0; i < tgRest.n; i++) script.push({ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend, ...(/테이머/.test(tgRest.noun) ? {} : { digimonOnly: true }), ...(tgRest.upTo || /수\s*있다/.test(t.slice(tgRest.index)) ? { optional: true } : {}), ...tgtProps(tgRest), ...(tgRest.noun === '테이머' ? { filter: { ...(tgRest.filter || {}), category: 'tamer' } } : {}) });
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
    const lvPre = t.slice(0, m.index).match(/Lv\.\s*(\d+)\s*이하의\s*$/); // "Lv.6 이하의 디지몬 1마리를 레스트시킬 수 있다"
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'rest', target, ...(lvPre ? { filter: { levelMax: Number(lvPre[1]) } } : {}) });
  }

  // "[DP N 이하의] 상대의 디지몬/테이머 전부를 레스트시킨다" — mass rest.
  if ((m = t.match(/상대(?:의)?\s*(디지몬|테이머)\s*전부(?:를)?\s*레스트시키(?:다|ㄴ다|고)/) || t.match(/상대(?:의)?\s*(디지몬|테이머)\s*전부(?:를)?\s*레스트시킨다|상대(?:의)?\s*(디지몬|테이머)\s*전부(?:를)?\s*레스트시키고/))) { // (also the compound "…전부를 레스트시키고, …": BT20-043)
    const tgA = findTgt(t, '상대', m[1], String.raw`(?:를|을)?\s*레스트시키(?:고|ㄴ다)`) || findTgt(t, '상대', m[1], String.raw`(?:를|을)?\s*레스트시킨다`);
    const filter = { ...(tgA?.filter || {}), category: m[1] === '테이머' ? 'tamer' : 'digimon' };
    script.push({ op: 'restAll', target: 'opponent', filter });
  }

  // DP modification, this turn unless stated otherwise.
  const dpDuration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : /자신(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'ownTurn' : 'turn';
  const dpStart = script.length;
  if (/이\s*디지몬(?:의)?\s*DP를\s*[+-]?\d+\s*(?:한다|하고)/.test(t) && (m = t.match(/DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDP', target: 'self', thisStack: true, amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDPAll', target: 'self', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    script.push({ op: 'modifyDPAll', target: 'opponent', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:의)?\s*(?:는,?\s*)?DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    { const dk = 'dp' + (++DISTINCT_SEQ); for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2]), duration: dpDuration, ...(Number(m[1]) > 1 ? { distinct: dk } : {}) }); } // "N마리(까지)" = N distinct targets
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:의)?\s*DP를\s*([+-]?\d+)\s*(?:한다|하고)/))) {
    { const dk = 'dp' + (++DISTINCT_SEQ); for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2]), duration: dpDuration, ...(Number(m[1]) > 1 ? { distinct: dk } : {}) }); } // "N마리(까지)" = N distinct targets
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
    { const dk = 'dp' + (++DISTINCT_SEQ); for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration, ...(Number(m[1]) > 1 ? { distinct: dk } : {}) }); } // "N마리(까지)" = N distinct targets
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:까지)?(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    { const dk = 'dp' + (++DISTINCT_SEQ); for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration, ...(Number(m[1]) > 1 ? { distinct: dk } : {}) }); } // "N마리(까지)" = N distinct targets
  } else if (!/(?:선택|고른|골라)/.test(t) && (m = t.match(/(?:^|[\s,.])그\s*디지몬(?:의\s*DP를|을\s*DP|의\s*DP)\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDP', target: 'self', last: true, amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration }); // census: "…어택했을 때, 이 테이머를 레스트시키는 것으로, 그 디지몬을 DP+1000" (EX2-062/BT2-086 tamers): "그 디지몬" = the event subject (resolveLast -> trigger.evtStackUid); was an empty script = manual on every trigger
  }

  // "이 디지몬을 DP +N 하고, 상대의 디지몬 M마리를 DP -K" (EX8-073): the else-if chain above emits only the FIRST DP change of a compound sentence — add the second one.
  if (script.length === dpStart + 1 && script[dpStart].op === 'modifyDP' && script[dpStart].thisStack && (m = t.match(/이\s*디지몬을\s*DP\s*[+-]\s*\d+\s*(?:하고|,)\s*,?\s*상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  }
  for (let i = dpStart; i < script.length; i++) { // target modifiers ("레스트 상태인", "그린인", "특징 「X」를 가진", "DP N 이하의" …) in front of the target noun
    const o = script[i];
    if ((o.op !== 'modifyDP' && o.op !== 'modifyDPAll') || o.thisStack || o.last) continue;
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
    const duration = /다음\s*자신(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'nextOwnTurn' : /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : /자신(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'ownTurn' : (/자신의\s*턴\s*(?:동안|중)/.test(t) || !/이\s*턴\s*동안|턴\s*종료\s*시?까지/.test(t) ? 'permanent' : 'turn');
    const gsA = /(?:얻|준다|주고|부여)/.test(t) ? grantSubject(t) : null;
    if (gsA) script.push(...subjectOps(gsA, (sub) => ({ op: 'grantKeyword', ...sub, keyword: '시큐리티어택', value, duration })));
    else if (/(?:^|[\s,.])디지몬\s*전부에게/.test(t) && !/(?:자신|상대)(?:의)?\s*디지몬\s*전부에게/.test(t)) { // "디지몬 전부에게 《S 어택 -1》을 준다" (EX6-031): BOTH sides' digimon (it used to grant a single digimon)
      for (const target of ['self', 'opponent']) script.push({ op: 'grantKeyword', target, all: true, keyword: '시큐리티어택', value, duration });
    } else {
      const target = value < 0 && /디지몬\s*\d+\s*마리에게/.test(t) ? (/상대(?:의)?\s*디지몬\s*\d+\s*마리에게/.test(t) ? 'opponent' : 'either') : 'self'; // (official Q3722: a bare 「디지몬 1마리에게」 also allows an own digimon)
      const thisStack = target === 'self' && /이\s*디지몬은|이\s*디지몬을\s*DP\s*[+-]/.test(t) &&!/자신(?:의)?\s*디지몬\s*\d+\s*마리/.test(t);
      const countM = t.match(/디지몬\s*(\d+)\s*마리에게/);
      const count = thisStack ? 1 : (countM ? Number(countM[1]) : 1);
      const dk = 'sa' + (++DISTINCT_SEQ); for (let i = 0; i < count; i++) script.push({ op: 'grantKeyword', target, thisStack, keyword: '시큐리티어택', value, duration, ...(count > 1 ? { distinct: dk } : {}) });
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
      ...(/진화원을?,?\s*선택하여/.test(t) && !m[3] ? { choose: true } : {}),
    });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬의?\s*진화원을?\s*선택하여\s*(\d+)\s*장\s*파기한다/))) {
    // "1마리" isn't even stated here — the player picks WHICH opponent
    // Digimon (via trashEvoSources' own pickStack choose) implicitly.
    script.push({ op: 'trashEvoSources', target: 'opponent', count: Number(m[1]), choose: true }); // 「선택하여」: the player chooses which sources (EX7-023, EX8-023)
  }

  // Direct (non-check) security trash — removeSecurity was a defined op with
  // no compiler pattern ever producing it (confirmed via the audit: every
  // real occurrence of this exact sentence, however commonly printed, fell
  // through uncompiled). "양 측의"(both)/"자신의"/"상대의" all appear.
  if ((m = t.match(/(양\s*측|서로|자신|상대)(?:의)?\s*시큐리티를?\s*(위\s*또는\s*아래|위|아래)에서(?:부터)?\s*(\d+)\s*장\s*파기(?:한다|하고)/))) {
    const position = /또는/.test(m[2]) ? 'either' : m[2] === '아래' ? 'bottom' : 'top';
    const n = Number(m[3]);
    const whos = /^(?:양\s*측|서로)$/.test(m[1]) ? ['self', 'opponent'] : m[1] === '상대' ? ['opponent'] : ['self']; // g3: "서로의" (mutual) is the same as "양 측의" (both sides) — BT16-036/BT19-043/BT25-038 all print "서로의 시큐리티를 …"
    // slice6 G321 (BT26-103 "…시큐리티를 위에서부터 1장 파기하고, 《리커버리 +2》"): textual order wins — trash first, THEN recover (with 0 security the recover must not be undone by the trash)
    const rmOps = []; for (const who of whos) for (let i = 0; i < n; i++) rmOps.push({ op: 'removeSecurity', who, position });
    const recIdx = script.findIndex((o) => o.op === 'recoverTop' || (o.op === 'condition' && (o.then || []).some((x) => x.op === 'recoverTop')));
    const recTxt = t.search(/리커버리/);
    if (recIdx >= 0 && recTxt > m.index) script.splice(recIdx, 0, ...rmOps); else script.push(...rmOps);
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
    const tgB = findTgt(t, '상대', '(?:디지몬\/테이머|디지몬|테이머)', String.raw`(?:를|을)?\s*(?:대신\s*)?` + destWord + String.raw`\s*되돌(?:린다|리고)`);
    if (tgB) {
      const filter = { ...(tgB.filter || {}), ...(tgB.noun === '테이머' ? { category: 'tamer' } : {}) };
      if (tgB.all) script.push({ op: 'returnToHandStripSources', target: 'opponent', all: true, filter, requireSuspended: null, dest, ...(tgB.excludeSelf ? { excludeSelf: true } : {}) });
      else script.push({ op: 'returnToHandStripSources', target: 'opponent', n: tgB.n, filter, requireSuspended: null, dest, ...(tgB.noun === '디지몬/테이머' ? { anyKind: true } : {}), ...(tgB.upTo ? { optional: true } : {}), ...(tgB.excludeSelf ? { excludeSelf: true } : {}) });
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
    if (/^\s*이\s*카드의\s*【메인】\s*효과를\s*(?:발휘|발동)한다\.\s*\S/.test(t)) script.push({ op: 'runOwnMain' });
    script.push({ op: 'addSelfToHand' });
  } else if (/^\s*이\s*카드의\s*【메인】\s*효과를\s*(?:발휘|발동)한다\.?\s*$/.test(t)) script.push({ op: 'runOwnMain' }); // 【시큐리티】 이 카드의 【메인】 효과를 발동한다. (BT24-092/097, BT25-093/100/101 …): the MAIN effect resolves from the security check

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
  if ((m = t.match(/자신(?:의)?\s*시큐리티를?\s*아래에서(?:부터)?\s*(\d+)\s*장(?:을)?\s*패에\s*추가/))) {
    script.push({ op: 'securityBottomToHand', n: Number(m[1]) });
  }
  if (/이\s*카드를\s*(?:(?:앞면|표면)으로\s*)?시큐리티(?:의)?\s*아래에\s*(?:(?:앞면|표면)으로\s*)?놓는다/.test(t)) {
    script.push({ op: 'placeThisAtSecurityBottom' });
  }

  // Return a named/trait-matching card from own trash to hand.
  if ((m = t.match(/자신(?:의)?\s*트래시에서,?\s*명칭에\s*「([^」]+)」(?:를|을)?\s*포함하는\s*(?:디지몬\s*)?카드\s*(\d+)?\s*장?(?:을)?\s*패로\s*되돌린다/))) {
    for (let i = 0; i < Number(m[2] || 1); i++) script.push({ op: 'returnFromTrash', who: 'self', filter: { nameIncludes: m[1] } });
  }

  // Same, filtered by color/level/category instead of name — "자신의
  // 트래시에서 퍼플인 Lv.5 이하의 디지몬 카드 1장을 패로 되돌린다/되돌릴 수
  // 있다" (the optional form is handled by ctx.choose returning null).
  if ((m = t.match(/자신(?:의)?\s*트래시에서,?\s*(?:(레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)인\s*)?(?:Lv\.(\d+)\s*이하의\s*)?(디지몬|옵션)\s*카드\s*(\d+)\s*장(?:까지)?(?:를|을)?\s*패(?:로|에)\s*되돌(?:린다|릴\s*수\s*있다|리고)/))) { // (EX4-072 【시큐리티】 "…패로 되돌리고, 이 카드를 패에 추가한다": the compound spelling used to drop the return)
    const TRASH_COLOR = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
    const filter = { category: m[3] === '옵션' ? 'option' : 'digimon' };
    if (m[1]) filter.colors = [TRASH_COLOR[m[1]]];
    if (m[2]) filter.levelMax = Number(m[2]);
    for (let i = 0; i < Number(m[4]); i++) script.push({ op: 'returnFromTrash', who: 'self', filter });
  }

  // "상대는 본인의 <패 N장 / 디지몬·테이머 1마리(명) / 시큐리티 위 1장>을 파기·소멸시킬 수 있다. 이 효과로 …하지 않았다면, <효과>"
  if ((m = t.trim().match(/^상대는,?\s*(?:본인의|스스로의|상대의)\s*(패(?:의|에서)?\s*(.*?)\s*(\d+)\s*장|디지몬\/테이머\s*1\s*마리(?:\(명\))?|시큐리티를\s*위에서부터\s*1\s*장)(?:을|를)?\s*(?:파기|소멸시킬|파기할|소멸시킬)\s*(?:수\s*있다|할\s*수\s*있다)?\s*(?:수\s*있다)?\.\s*(?:이\s*효과로\s*)?(?:파기|소멸)하지\s*않았(?:다면|을\s*경우|을\s*때),?\s*(.+)$/s)) || (m = t.trim().match(/^상대는,?\s*(?:본인의|스스로의|상대의)\s*(패(?:의|에서)?\s*(.*?)\s*(\d+)\s*장|디지몬\/테이머\s*1\s*마리(?:\(명\))?|시큐리티를\s*위에서부터\s*1\s*장)(?:을|를)?\s*(?:파기할|소멸시킬)\s*수\s*있다\.\s*(?:이\s*효과로\s*)?(?:파기|소멸)하지\s*않았(?:다면|을\s*경우|을\s*때),?\s*(.+)$/s))) {
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
  if ((m = t.match(/(?:(자신의|상대의|서로의)\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:까지)?(?:을)?\s*파기(?:한다|할\s*수\s*있다|하고,)/)) && !script.some(i => i.op === 'trashDeckTop')) { // (slice3 r2 Q3333: EX2-039 "3장까지 파기할 수 있다" compiled to nothing) // (b12: "…2장 파기하고, 턴 종료까지 …" — EX10-041; 「상대의/서로의 덱」 used to discard only OWN cards)
    const opt = /할\s*수\s*있다/.test(m[0]) ? { optional: true } : {};
    if (m[1] === '상대의' || m[1] === '서로의') script.push({ op: 'trashDeckTop', who: 'opponent', n: Number(m[2]), ...opt });
    if (m[1] !== '상대의') script.push({ op: 'trashDeckTop', who: 'self', n: Number(m[2]), ...opt }); // b10: "파기할 수 있다" is optional (EX1-060, EX2-040/044, BT10-082)
  }

  // Attack restriction.
  if (/^이\s*디지몬은\s*어택할\s*수\s*없다[.。]?$/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'self', thisStack: true, expiresAfterTurn: 'permanent' });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리는\s*어택(?:과\s*블록)?을?\s*할\s*수\s*없다/)) || findTgt(t, '상대', '디지몬', String.raw`(?:는|은|가)?\s*(?:,\s*)?어택(?:과\s*블록)?을?\s*할\s*수\s*없다`)) {
    // "(다음) 상대의 턴 종료까지" always means the opponent's coming turn when it is printed on your own turn
    const expires = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? oppDur(t) : /이\s*턴\s*동안|턴\s*종료\s*시?까지/.test(t) ? 'turn' : 'permanent';
    const tgX = findTgt(t, '상대', '디지몬', String.raw`(?:는|은|가)?\s*(?:,\s*)?어택(?:과\s*블록)?을?\s*할\s*수\s*없다`);
    const nbk = /어택과\s*블록/.test(t) ? { noBlock: true } : {}; // "어택과 블록을 할 수 없다": also lock blocking (s3 'noBlock' flag)
    if (tgX && tgX.all) script.push({ op: 'restrictAttack', target: 'opponent', allMatching: true, expiresAfterTurn: expires, ...nbk, ...tgtProps(tgX) });
    else { const rak = 'ra' + (++DISTINCT_SEQ); for (let i = 0; i < (tgX?.n || 1); i++) script.push({ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: expires, ...nbk, ...(tgX ? tgtProps(tgX) : {}), ...(tgX?.upTo ? { optional: true } : {}), ...((tgX?.n || 1) > 1 ? { distinct: rak } : {}) }); } // (batch4: "2마리" = 2 distinct digimon — BT12-028)
  } else if (/진화원을?\s*갖지\s*않은\s*상대(?:의)?\s*디지몬\s*1\s*마리를?\s*선택한다\.?\s*그\s*디지몬은\s*다음\s*상대(?:의)?\s*턴\s*종료\s*시?까지\s*어택과\s*블록을?\s*할\s*수\s*없다/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'opponent', filter: { hasNoSources: true }, expiresAfterTurn: 'opponentTurn', noBlock: true });
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
    const expiresAfterTurn = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : (/이\s*턴\s*동안/.test(t) ? 'turn' : 'permanent');
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
  if ((m = t.match(/상대(?:의)?\s*테이머\s*(전부|\d+\s*명)(?:은|는)\s*레스트할\s*수\s*없다/))) { // "상대의 테이머 1명은 레스트할 수 없다" (BT20-024)
    const expiresAfterTurn = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : /자신의\s*턴\s*종료\s*시?까지/.test(t) ? 'ownTurn' : /(?:이\s*턴\s*동안|(?:^|[\s,])턴\s*종료\s*시?까지)/.test(t) ? 'turn' : 'permanent';
    if (m[1] === '전부') script.push({ op: 'preventRest', target: 'opponent', all: true, filter: { category: 'tamer' }, expiresAfterTurn });
    else script.push({ op: 'preventRest', target: 'opponent', n: Number(m[1].match(/\d+/)[0]), filter: { category: 'tamer' }, expiresAfterTurn });
  } else
  if ((m = t.match(/상대(?:의)?\s*디지몬(\/테이머)?\s*(전부|\d+\s*(?:마리|장)(?:\(명\))?)(?:와|과)?\s*(?:테이머\s*\d+\s*명)?(?:은|는)?\s*레스트\s*할\s*수\s*없다/))) {
    const expiresAfterTurn = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? oppDur(t) : /자신의\s*턴\s*종료\s*시?까지/.test(t) ? 'ownTurn' : /(?:이\s*턴\s*동안|(?:^|[\s,])턴\s*종료\s*시?까지)/.test(t) ? 'turn' : 'permanent'; // (ST22-09: "자신의 턴 종료까지" / plain "턴 종료까지" used to compile to a permanent lock)
    const filter = m[1] ? {} : { category: 'digimon' };
    { const pre = t.slice(0, m.index).split(/까지s*|[,.]s*/).pop().trim(); if (pre) { const { _left, ...pf } = parseTargetMods(pre); Object.assign(filter, pf); } } // descriptors before "상대의 디지몬" ("진화원 매수가 1장 이하의 …" BT16-026) were dropped
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
  // "<상대의 디지몬 1마리>와 <상대의 시큐리티 디지몬 전부>를 DP -N" (ST17-06, EX4-009, BT7-098, EX1-030, P-053): the board Digimon half was dropped
  { const pm = t.match(/(자신|상대)(?:의)?\s*디지몬\s*(\d+)\s*마리(?:와|과)\s*(?:(?:자신|상대)(?:의)?\s*)?시큐리티\s*디지몬\s*전부(?:의|를)?\s*(?:DP를?\s*)?([+-]\s*\d+)\s*(?:한다|하고)?/);
    if (pm && !/마다/.test(t)) for (let i = 0; i < Number(pm[2]); i++) script.push({ op: 'modifyDP', target: pm[1] === '상대' ? 'opponent' : 'self', amount: Number(pm[3].replace(/\s+/g, '')), duration: dpDuration }); }
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
  } else if ((m = t.trim().match(/^(?:이\s*턴\s*동안|턴\s*종료까지),?\s*다음에\s*자신(?:의)?\s*디지몬이\s*진화할\s*때,?\s*지불하는\s*진화\s*코스트\s*(?:를\s*)?(-?\d+)\s*(?:한다)?\.?$/))) {
    script.push({ op: 'evoCostMod', delta: Number(m[1]), filter: {}, duration: 'turn' }); // ST12-15 《딜레이》 bullet: the NEXT own evolution this turn is cheaper (one-time mod)
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
  let kwLinked = script.some(o => o.op === 'grantKeyword' && !o.thisStack && !o.all && !o.last && o.keyword === '시큐리티어택'); // (an S-attack grant of the same sentence already picked the subject)
  for (const [kw, re] of [['블로커', /[≪《]\s*블로커\s*[≫》]/], ['재밍', /[≪《]\s*재밍\s*[≫》]/], ['관통', /[≪《]\s*관통\s*[≫》]/], ['속공', /[≪《]\s*속공\s*[≫》]/], ['진격', /[≪《]\s*진격\s*[≫》]/], ['충돌', /[≪《]\s*충돌\s*[≫》]/], ['길동무', /[≪《]\s*길동무\s*[≫》]/], ['방벽', /[≪《]\s*방벽\s*[≫》]/], ['아머퍼지', /[≪《]\s*아머\s*퍼지\s*[≫》]/], ['회피', /[≪《]\s*회피\s*[≫》]/], ['스케이프고트', /[≪《]\s*스케이프고트\s*[≫》]/], ['불굴', /[≪《]\s*불굴\s*[≫》]/], ['돌진', /[≪《]\s*돌진\s*[≫》]/], ['연계', /[≪《]\s*연계\s*[≫》]/], ['재기동', /[≪《]\s*재기동\s*[≫》]/]]) {
    if (re.test(t) && /(얻는다|[를을]\s*얻|얻고|준다|주고|부여)/.test(t) && new RegExp(re.source + String.raw`(?:[^.。「]|「[^」]*」)*?(?:얻|준다|주고|부여)`).test(t)) {
      const duration = /다음\s*자신(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'nextOwnTurn' : /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? oppDur(t) : /자신(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? 'ownTurn' : 'turn';
      const gsK = grantSubject(t);
      if (gsK) { script.push(...subjectOps(gsK, (sub) => ({ op: 'grantKeyword', ...sub, keyword: kw, duration }), kwLinked)); if (!gsK.thisStack && !gsK.last && !gsK.all && (gsK.n || 1) === 1) kwLinked = true; }
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
      const dur = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?\s*까지/.test(t) ? oppDur(t) : 'turn';
      const amount = Number(dpa[1].replace(/\s+/g, ''));
      script.push(...subjectOps(gsD, (sub) => ({ op: gsD.all ? 'modifyDPAll' : 'modifyDP', ...sub, amount, duration: dur }), true));
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
    if (o.op !== 'grantKeyword' || o.distinct) return true; // distinct = one op per chosen target (N마리), never a duplicate
    const key = JSON.stringify([o.keyword, o.value, o.thisStack, o.target, o.duration]);
    if (seenGrant.has(key)) return false;
    seenGrant.add(key); return true;
  });
  return [...uniq.filter(o => !o.deferLast), ...uniq.filter(o => o.deferLast)];
}

// ---- batch-4 additions (dropped-sentence audit): sentences that no earlier pattern compiled ----
//   s13_trimTo   "자신의 패가 N장이 되도록 파기한다" / "상대는 자신의 패가 N장이 되도록 파기한다" / "서로는 각각 (패|시큐리티)가 N장이 되도록 (위에서부터) 파기한다"
//   s13_jogress  "자신의 디지몬 2마리로 패의 <카드>로 조그레스 진화할 수 있다" (optional, the player picks the pair + the hand card)
//   exclSame     "이 효과로는 자신의 테이머/디지몬과 같은 명칭의 카드는 등장시킬 수 없다" -> attached to the playFree ops of the same text (runOne -> filter.exclNames)
// The ops themselves run in cards/shard13.js (OPS).
function s13DescFilter(desc) {
  const parts = desc.trim().split(/\s*(?:또는|거나)\s*/).filter(Boolean), fs = [];
  for (const p of parts) {
    let f = null;
    if (/이외|같은|겹쳐|앞면|뒷면|합계|없는/.test(p)) return null; // a modifier parseCardFilter can't express: keep the old (uncompiled) behaviour rather than widening the pick
    if (/^(?:「[^」]+」\s*\/?\s*)+$/.test(p)) f = { exactAny: [...p.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
    else f = parseCardFilter(/카드$/.test(p) ? p : p + ' 디지몬 카드');
    if (!f) return null;
    fs.push(f);
  }
  return !fs.length ? null : fs.length === 1 ? fs[0] : { anyOf: fs };
}
function compileS13(t) {
  const ops = []; let exclSame = null;
  for (const raw of splitSentences(t)) {
    const sn = raw.replace(/\s+/g, ' ').trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '').replace(/^(?:그\s*후|또한),?\s*/, '');
    let m;
    if ((m = sn.match(/^이 카드를 시큐리티 위에( 앞면으로)? 놓는다[.。]?$/))) ops.push({ op: 's13_placeThis', dest: 'security', faceUp: !!m[1] });
    else if ((m = sn.match(/^이 카드를 (.+?) 자신의 디지몬 1마리의 진화원 아래에 놓는다[.。]?$/))) { const f = parseTargetMods(m[1]); if (!f._left) ops.push({ op: 's13_placeThis', dest: 'sources', ...(Object.keys(f).length ? { filter: f } : {}) }); }
    else if ((m = sn.match(/^이 (?:테이머|디지몬)(?:을|를) (시큐리티 위에 놓는다|덱 아래로 되돌린다)[.。]?$/))) ops.push({ op: 's13_selfTo', dest: /시큐리티/.test(m[1]) ? 'security' : 'deckBottom' });
    else if ((m = sn.match(/^(자신의|상대는 (?:자신|본인|스스로)의|상대의|서로는 (?:각각|각자)(?:의)?) (패|시큐리티)(?:가)? ?(\d+)장이 되도록 (?:위에서부터 )?(?:패를 )?파기한다[.。]?$/))) {
      ops.push({ op: 's13_trimTo', zone: m[2] === '패' ? 'hand' : 'security', who: /^상대/.test(m[1]) ? 'opponent' : /^서로/.test(m[1]) ? 'both' : 'self', n: Number(m[3]) });
    } else if ((m = sn.match(/^자신의 디지몬 2마리로 패의 (.+?) ?(?:으로|로|에) 조그레스 진화할 수 있다[.。]?$/))) {
      const f = s13DescFilter(m[1]); if (f) ops.push({ op: 's13_jogress', filter: f });
    } else if ((m = sn.match(/^이 효과(?:로는|론),? 자신의 (테이머|디지몬)와 같은 (?:명칭|이름)의 카드는 등장시킬 수 없다[.。]?$/))) exclSame = m[1] === '테이머' ? 'tamer' : 'digimon';
  }
  return { ops, exclSame };
}

// ---- leading conditions ("<조건>라면/다면, <효과>") ----
// ~420 compiled effects print a condition first; the action patterns below match
// the action clause alone, so those effects used to run UNCONDITIONALLY. The
// condition is now parsed into a runtime predicate and wraps the compiled action;
// a leading condition we can't evaluate makes the whole segment manual (safer
// than silently applying it).
const NUM_CMP = (n, cmp) => (v) => cmp === '이하' ? v <= n : v >= n;

// Extra state / entry-history conditions (docs/manual-effects.md 「조건수동」). Returns a test (ctx) => bool, or null when not understood.
function parseConditionExtra(c) {
  let m;
  const own = (ctx) => ctx.state.players[ctx.self];
  const stackOf = (ctx) => own(ctx).battle.find(s => s.uid === ctx.sourceStackUid) || (own(ctx).raising?.uid === ctx.sourceStackUid ? own(ctx).raising : null);
  const delStackOf = (ctx) => ctx.trigger?.delStack || null; // the stack a 【소멸 시】 effect belongs to (already off the board)
  const nameIn = (list, id, S) => list.some(n => S.cardNames(id).some(x => x.includes(n)) || S.cardNameInfo(id).incl.some(x => x.includes(n)));
  const names = (s) => [...s.matchAll(/「([^」]+)」/g)].map(x => x[1]);
  const NUMCMP = (n, dir) => (v) => (dir === '이하' ? v <= n : v >= n);
  // how this Digimon entered play / evolved
  if (/^(?:이\s*디지몬이\s*)?진화원에서\s*등장하고\s*있었다면$/.test(c)) return (ctx) => !!stackOf(ctx)?.playedFromSources;
  if (/^(?:이\s*디지몬이\s*)?효과로\s*(?:등장하고\s*있었|등장했)다면$/.test(c)) return (ctx) => !!stackOf(ctx)?.playedByEffect;
  if (/^(?:이\s*디지몬이\s*)?트래시에서\s*진화하고\s*있었다면$/.test(c)) return (ctx) => { const s = stackOf(ctx); return !!s && s.byEffect?.kind === 'digivolve' && s.byEffect.from === 'trash'; };
  // how this Digimon was deleted (a 【소멸 시】 effect)
  if ((m = c.match(/^(?:이\s*디지몬이\s*)?(배틀\s*이외로|배틀로|효과로)\s*소멸하고\s*있었다면$/))) {
    const k = m[1].replace(/\s+/g, '');
    return (ctx) => { const cause = delStackOf(ctx)?.s7DelCause ?? ctx.state.deletedInfo?.[ctx.sourceStackUid]?.cause; if (!cause) return false; return k === '배틀이외로' ? cause !== 'battle' : k === '배틀로' ? cause === 'battle' : (cause === 'effect' || cause === 'ownEffect'); };
  }
  // the name of this Digimon (also after it has been deleted: last-known top card)
  if ((m = c.match(/^이\s*디지몬이\s*명칭에\s*((?:「[^」]+」\s*(?:\/|또는)?\s*)+)(?:을|를)\s*포함(?:하고\s*있(?:었)?다면|한다면)$/))) {
    const ns = names(m[1]);
    if (ns.length) return (ctx) => { const s = stackOf(ctx); const id = s ? s.cardId : (delStackOf(ctx)?.cardId || ctx.state.deletedInfo?.[ctx.sourceStackUid]?.cardId); return !!id && nameIn(ns, id, ctx.S); };
  }
  if ((m = c.match(/^이\s*디지몬이\s*특징으로\s*((?:「[^」]+」\s*(?:\/|또는)?\s*)+)(?:을|를)\s*(?:가지고\s*있다면|가진다면)$/)))
    return (ctx) => { const s = stackOf(ctx); return !!s && ctx.S.effectiveInfo(ctx.state, s).traits.some(t => names(m[1]).includes(t)); };
  if ((m = c.match(/^이\s*디지몬이\s*[《≪]([^》≫]+)[》≫](?:을|를)\s*(?:가지고\s*있다면|가진다면)$/)))
    return (ctx) => { const s = stackOf(ctx); return !!s && ctx.S.hasKeyword(s, m[1].trim()); };
  // this Digimon's evolution sources
  if ((m = c.match(/^(레드|블루|옐로우?|그린|블랙|퍼플|화이트)인\s*카드가\s*있다면$/))) { const col = FILTER_COLOR[m[1]]; return (ctx) => { const s = stackOf(ctx); return !!s && s.sources.some(id => (ctx.S.card(id).colors || []).includes(col)); }; } // bare "<색>인 카드가 있을 때" (BT8-032 …): follows "이 디지몬의 진화원에 <색>인 카드가 있을 때, …" in the same effect
  if ((m = c.match(/^이\s*디지몬에게\s*진화원이\s*(\d+)\s*장\s*(이상\s*)?있다면$/))) return (ctx) => { const s = stackOf(ctx); return !!s && (m[2] ? s.sources.length >= Number(m[1]) : s.sources.length === Number(m[1])); };
  if ((m = c.match(/^이\s*디지몬의\s*진화원에\s*((?:「[^」]+」\s*(?:\/|또는)?\s*)+)(?:이|가)\s*(?:(\d+)\s*장\s*(이상)\s*)?있다면$/))) {
    const ns = names(m[1]), k = m[2] ? Number(m[2]) : 1;
    return (ctx) => { const s = stackOf(ctx); return !!s && s.sources.filter(id => ctx.S.cardNames(id).some(x => ns.includes(x))).length >= k; };
  }
  if ((m = c.match(/^이\s*디지몬에\s*Lv\.?이\s*같은\s*카드가\s*(\d+)\s*장\s*이상\s*겹쳐져\s*있다면$/))) return (ctx) => {
    const s = stackOf(ctx); if (!s) return false; const cnt = {};
    // Q4879 family: the WHOLE stack is looked at — the top card counts too (Lv.5 digimon + one Lv.5 source = 2 same-Lv cards)
    [s.cardId, ...s.sources.slice(ctx.S.fdCount(s))].forEach(id => { const lv = ctx.S.card(id).level; if (lv != null) cnt[lv] = (cnt[lv] || 0) + 1; });
    return Object.values(cnt).some(v => v >= Number(m[1]));
  };
  if ((m = c.match(/^이\s*디지몬의\s*진화원에\s*있는\s*Lv\.?(\d+)인\s*카드의\s*색의\s*합계가\s*(\d+)\s*색\s*이상이라면$/))) return (ctx) => {
    const s = stackOf(ctx); if (!s) return false;
    return new Set(s.sources.filter(id => ctx.S.card(id).level === Number(m[1])).flatMap(id => ctx.S.card(id).colors || [])).size >= Number(m[2]);
  };
  // board / zone comparisons
  if ((m = c.match(/^자신의\s*시큐리티(?:의)?\s*매수가\s*상대의\s*시큐리티(?:의)?\s*매수보다\s*(적|많)(?:다면|을\s*때)$|^자신의\s*시큐리티의\s*매수가\s*상대의\s*시큐리티보다\s*(적|많)(?:다면|을\s*때)$/)))
    return (ctx) => { const a = own(ctx).security.length, b = ctx.state.players[ctx.opp].security.length; return (m[1] || m[2]) === '적' ? a < b : a > b; };
  if ((m = c.match(/^자신의\s*시큐리티\s*매수가\s*이\s*디지몬의\s*뒷면의\s*진화원\s*매수\s*이하라면$/))) return (ctx) => { const s = stackOf(ctx); return !!s && own(ctx).security.length <= ctx.S.fdCount(s); };
  if ((m = c.match(/^자신의\s*테이머의\s*색\s*합계가\s*(\d+)\s*색\s*이상이라면$/))) return (ctx) => new Set(own(ctx).battle.filter(s => ctx.S.card(s.cardId).category === 'tamer').flatMap(s => ctx.S.stackColors(s))).size >= Number(m[1]);
  if ((m = c.match(/^자신\s*(?:\/|또는)\s*상대의\s*(패|트래시|시큐리티)(?:가|에)?\s*(\d+)\s*장\s*(이하|이상)(?:이)?(?:라면|\s*있다면)$/))) { const zone = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security' }[m[1]], f = NUMCMP(Number(m[2]), m[3]); return (ctx) => ['p1', 'p2'].some(p => f(ctx.state.players[p][zone].length)); }
  if ((m = c.match(/^서로의\s*(패|트래시|시큐리티)\s*합계가\s*(\d+)\s*장\s*(이하|이상)(?:이)?라면$/))) { const zone = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security' }[m[1]], f = NUMCMP(Number(m[2]), m[3]); return (ctx) => f(ctx.state.players.p1[zone].length + ctx.state.players.p2[zone].length); }
  // the Digimon a previous sentence picked ("그 디지몬이 DP 16000 이상이라면" / "…특징으로 「X」를 가진다면")
  if ((m = c.match(/^그\s*디지몬이\s*DP\s*(\d+)\s*(이상|이하)(?:이라면|일\s*때)$/))) return (ctx) => { const r = resolveLast(ctx); if (!r) return false; const st = [ctx.state.players[r.player].raising, ...ctx.state.players[r.player].battle].filter(Boolean).find(x => x.uid === r.uid); return !!st && NUMCMP(Number(m[1]), m[2])(ctx.S.effectiveDP(ctx.state, r.player, st)); };
  if ((m = c.match(/^그\s*디지몬이\s*특징으로\s*((?:「[^」]+」\s*(?:\/|또는)?\s*)+)(?:을|를)\s*가진다면$/))) return (ctx) => { const r = resolveLast(ctx); if (!r) return false; const st = [ctx.state.players[r.player].raising, ...ctx.state.players[r.player].battle].filter(Boolean).find(x => x.uid === r.uid); return !!st && ctx.S.effectiveInfo(ctx.state, st).traits.some(t => names(m[1]).includes(t)); };
  return null;
}

function parseConditionText(c) {
  c = c.trim().replace(/[,\s]+$/, '');
  c = c.replace(/다른\s+(자신|상대)(의)\s*/g, '$1$2 다른 '); // b10: "레스트 상태인 다른 자신의 디지몬" (EX4-025/029/054/057) = "레스트 상태인 자신의 다른 디지몬"
  { const cx = parseConditionExtra(c); if (cx) return cx; }
  let m;
  const own = (ctx) => ctx.state.players[ctx.self];
  const opp = (ctx) => ctx.state.players[ctx.opp];
  const mem = (ctx) => (ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory);
  const stackOf = (ctx) => own(ctx).battle.find(s => s.uid === ctx.sourceStackUid) || (own(ctx).raising?.uid === ctx.sourceStackUid ? own(ctx).raising : null) || (ctx.trigger?.delStack && ctx.trigger.delStack.uid === ctx.sourceStackUid ? ctx.trigger.delStack : null); // last-known info for 【소멸 시】 conditions on the sources (BT7-075 Q1641)
  const cat = (ctx, id) => { const c = ctx.S.card(id)?.category; return c === 'digitama' ? 'digimon' : c; }; // w4 (Q2430 BT19-026): a Digi-Egg card in the battle area is treated as a Digimon
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
  // b10: "이 디지몬이 【등장 시】 효과를 가진다면" (EX3-005/011 …): the top card's own printed text has a segment with that tag
  if ((m = c.match(/^이\s*디지몬이\s*【([^】]+)】\s*효과를\s*가진다면$/))) { const tg = m[1]; return (ctx) => { const st = stackOf(ctx); if (!st) return false; return ctx.S.parseEffectSegments(ctx.S.card(st.cardId).effectKo || '').segments.some(sg => sg.tags.some(t => t.includes(tg))); }; }
  const descPred = (ctx, desc) => { const pr = ctx.S.cardDescPredicate(desc); if (!pr) ctx.S.log(ctx.state, `조건 "${desc}"을(를) 판정할 수 없어 효과를 건너뜀 (수동 확인)`); return pr; };
  if ((m = c.match(/^(?:자신의\s*)?메모리가\s*(-?\d+)\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(mem(ctx)); }
  if ((m = c.match(/^메모리가\s*상대\s*(?:쪽|측)의\s*(\d+)\s*이상(?:이)?라면$/))) return (ctx) => -mem(ctx) >= Number(m[1]);
  // g7 audit (EX13-060/BT26-078; also BT25-019, whose own bespoke script already handled it): "상대의 메모리가 N 이상/이하(이)라면"
  // — the OPPONENT's own signed memory count, not "메모리가 상대 쪽의 N" (word order differs: 상대의 precedes 메모리가 here).
  // Before this branch existed, condTestFor fell through to `undefined`, which evalCondition({test: undefined}, ctx) treats as
  // always-true — silently granting the effect unconditionally regardless of memory.
  if ((m = c.match(/^상대의\s*메모리가\s*(-?\d+)\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(-mem(ctx)); }
  if ((m = c.match(/^상대의\s*디지몬이\s*(있다면|없다면)$/))) return (ctx) => (digimonCount(ctx, opp(ctx)) > 0) === (m[1] === '있다면');
  if ((m = c.match(/^자신의\s*테이머가\s*(\d+)\s*명\s*(이하|이상)(?:이)?라면$/))) { const f = NUM_CMP(Number(m[1]), m[2]); return (ctx) => f(own(ctx).battle.filter(s => cat(ctx, s.cardId) === 'tamer').length); }
  if ((m = c.match(/^자신의\s*「([^」]+)」의\s*진화원이\s*(\d+)\s*장\s*이상\s*있다면$/))) return (ctx) => [...own(ctx).battle].filter(Boolean).some(s => ctx.S.effectiveInfo(ctx.state, s).names.includes(m[1]) && s.sources.length >= Number(m[2])); // EX2-053 "자신의 「마더 디·리퍼」의 진화원이 5장 이상 있을 때"
  if ((m = c.match(/^자신의\s*테이머가\s*(있다면|없다면)$/))) return (ctx) => (own(ctx).battle.some(s => cat(ctx, s.cardId) === 'tamer')) === (m[1] === '있다면');
  // zone sizes: "자신/상대의 패/트래시/시큐리티가 N장 이하/이상(이라면|있다면)"
  if ((m = c.match(/^(자신|상대)의\s*(패|트래시|시큐리티)(?:가|에)?\s*(\d+)\s*장\s*(이하|이상)(?:이)?(?:라면|\s*있다면)$/))) {
    const f = NUM_CMP(Number(m[3]), m[4]); const who = m[1]; const zone = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security' }[m[2]];
    return (ctx) => f((who === '자신' ? own(ctx) : opp(ctx))[zone].length);
  }
  // zone size vs the other side: "자신의 시큐리티(의 매수)가 상대의 시큐리티(의) 매수 이하/이상(이라면)" (ST7-11 …)
  if ((m = c.match(/^(자신|상대)의\s*(패|트래시|시큐리티|덱)(?:의\s*매수)?(?:가|이)\s*(자신|상대)의\s*(패|트래시|시큐리티|덱)(?:의)?\s*매수\s*(이하|이상)(?:이)?라면$/)) && m[1] !== m[3]) {
    const zn = { 패: 'hand', 트래시: 'trash', 시큐리티: 'security', 덱: 'deck' }, side = (w, ctx) => (w === '자신' ? own(ctx) : opp(ctx));
    const [w1, z1, w2, z2, dir] = [m[1], zn[m[2]], m[3], zn[m[4]], m[5]];
    return (ctx) => { const a = side(w1, ctx)[z1].length, b = side(w2, ctx)[z2].length; return dir === '이하' ? a <= b : a >= b; };
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
  // several named cards: "자신의 「A」와 「B」(와 「C」)가 있다면" — AND: every listed name must be on the board
  if ((m = c.match(/^자신의\s*((?:「[^」]+」\s*(?:와|과)\s*)+「[^」]+」)(?:가|이)\s*(있다면|없다면)$/))) { const names = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); return (ctx) => (names.every(n => own(ctx).battle.some(s => ctx.S.effectiveInfo(ctx.state, s).nameIs(n)))) === (m[2] === '있다면'); }
  // "이 디지몬의 진화원에 「A」와 「B」가 있다면" — AND (each name needs its own card among the sources)
  if ((m = c.match(/^이\s*디지몬의\s*진화원에\s*((?:「[^」]+」\s*(?:와|과)\s*)+「[^」]+」)(?:가|이)\s*(있다면|없다면)$/))) { const names = [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]); return (ctx) => { const st = stackOf(ctx); const all = !!st && names.every(n => st.sources.some(id => ctx.S.cardNameHas(ctx.S.card(id), n) || ctx.S.card(id).nameKo === n)); return all === (m[2] === '있다면'); }; }
  // "<A> 자신의 테이머 또는 <B> 자신의 디지몬이 있다면" / "자신의 「A」 또는 <B> 자신의 테이머가 있다면" — OR of two complete presence conditions
  if ((m = c.match(/^(.*자신의\s*(?:디지몬\/테이머|디지몬|테이머|「[^」]+」))\s+또는\s+(.*자신의\s*(?:디지몬\/테이머|디지몬|테이머|「[^」]+」)(?:가|이)?\s*(?:있다면|없다면))$/)) && !/^\s*$/.test(m[1])) {
    const has = /있다면$/.test(m[2]);
    const t1 = parseConditionText(m[1] + '가 있다면') || parseConditionText(m[1] + '이 있다면'), t2 = parseConditionText(m[2].replace(/없다면$/, '있다면'));
    if (t1 && t2) return async (ctx) => (!!(await t1(ctx)) || !!(await t2(ctx))) === has;
  }
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
    return (ctx) => own(ctx).battle.some(s => l.includes(ctx.S.card(s.cardId).nameKo) || l.some(n => ctx.S.effectiveInfo(ctx.state, s).nameIs(n))) === (m[2] === '있다면'); // QA-S3 Q3491: 〈룰〉 alias names (EX4-062 also counts as 「노유라」) satisfy "자신의 「X」가 있다/없다"
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
  if (/^조그레스\s*진화\s*하고\s*있었다면$/.test(c)) return (ctx) => (ctx.trigger && ctx.trigger.evtSnap ? !!ctx.trigger.evtSnap.viaFusion : !!stackOf(ctx)?.viaFusion); // watcher effects (tamer: "자신의 디지몬이 …로 진화했을 때, … 조그레스 진화하고 있었다면") read the EVENT subject, not the holder
  // 7-2-2-9/10: "디지크로스하고 있었다면" / "N장 디지크로스하고 있었다면" — stack.xrosCount = cards actually placed under by DigiXros
  if ((m = c.match(/^(?:(\d+)\s*장\s*)?디지크로스\s*하고\s*있었(?:다면|을\s*때)$/))) { const n = Number(m[1] || 1); return (ctx) => (stackOf(ctx)?.xrosCount || 0) >= n && !(ctx.trigger && ctx.trigger.evt && ctx.trigger.evt.kind === 'attack'); } // slice3 r2 (Q3721/3727/3733/3739, EX6-023..026): the DigiXros clause of a 【등장 시】【어택 시】 line is judged only when the DigiXros happens, never at attack time
  if (/^이\s*효과로\s*소멸하지\s*않았다면$/.test(c)) return (ctx) => ctx._lastDestroyed === false;
  if (/^이\s*효과로\s*소멸했다면$/.test(c)) return (ctx) => ctx._lastDestroyed === true;
  if (/^이\s*효과로\s*(?:옵션\s*카드를\s*)?사용(?:했|하였)다면$/.test(c)) return (ctx) => ctx._lastUsedOption === true; // useOptionFree
  if (/^이\s*효과로\s*(?:옵션\s*카드를\s*)?사용하지\s*않았다면$/.test(c)) return (ctx) => ctx._lastUsedOption !== true; // BT6-065 "이 효과로 옵션 카드를 사용하지 않았을 때"
  if (/^이\s*효과로\s*놓았다면$/.test(c)) return (ctx) => (ctx._lastPlacedSource || 0) > 0 || ctx._lastPlacedSecurity === true; // placeUnderSource / placeSecurity
  if ((m = c.match(/^이\s*디지몬(?:이|의\s*레벨이)\s*Lv\.(\d+)\s*(이하|이상)?(?:이)?라면$/))) { const lv = Number(m[1]), mode = m[2]; return (ctx) => { const st = stackOf(ctx); const L = st ? (ctx.S.card(st.cardId).level ?? 0) : -1; return mode === '이하' ? L <= lv : mode === '이상' ? L >= lv : L === lv; }; }
  if (/^자신의\s*턴이라면$/.test(c)) return (ctx) => ctx.state.activePlayer === ctx.self;
  if (/^상대의\s*턴이라면$/.test(c)) return (ctx) => ctx.state.activePlayer !== ctx.self;
  if (/^이\s*(?:디지몬|테이머)(?:이|가)\s*레스트\s*상태(?:이)?라면$/.test(c)) return (ctx) => !!stackOf(ctx)?.suspended;
  if (/^이\s*(?:디지몬|테이머)(?:이|가)\s*액티브\s*상태(?:이)?라면$/.test(c)) return (ctx) => { const st = stackOf(ctx); return !!st && !st.suspended; };
  if ((m = c.match(/^이\s*디지몬(?:이|에게|에)\s*(.+?)(?:가진다면|포함한다면|기술되어\s*있다면)$/))) {
    const kind = /가진다면$/.test(c) ? 'trait' : /포함한다면$/.test(c) ? 'name' : 'desc';
    const body = m[1].trim();
    if (/^《/.test(body)) { const kw = body.replace(/[《》≪≫]/g, '').replace(/\s*(?:을|를|이|가)\s*$/, '').trim(); return (ctx) => { const st = stackOf(ctx) || ctx.trigger?.delStack; if (!st) return false; const cd = ctx.S.card(st.cardId); return `${cd.effectKo || ''}\n${cd.inheritedKo || ''}`.includes(`《${kw}`); }; } // (batch4: a 【소멸 시】 effect's stack is already off the board — BT12-006 …)
    const descText = kind === 'trait' ? body.replace(/\s*(?:를|을)\s*$/, '') + ' 가진' : kind === 'name' ? body.replace(/\s*(?:를|을)\s*$/, '') + ' 포함하는' : body.replace(/(?:이|가)\s*$/, '') + '가 기술되어 있는'; // b9: keep the 이/가 the mention pattern needs (RB1-031 「감마몬」이 기술되어 있다면)
    return (ctx) => { const st = stackOf(ctx) || ctx.trigger?.delStack; if (!st) return false; const pr = descPred(ctx, descText); return !!pr && pr(ctx.S.card(st.cardId)); };
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
  { const pm = desc.trim().match(/^((?:Lv\.\s*\d+\s*(?:이하|이상)?|(?:사용|등장)?\s*코스트\s*\d+\s*(?:이하|이상)?|DP\s*\d+\s*(?:이하|이상)?|(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*)\s*(?:의|인))\s*,\s*(.+(?:거나|또는).+)$/); // pass2-b4: also "등장 코스트 N 이하의," / "DP N 이하의," prefixes and "A 또는 B" (BT23-030, BT22-089 ...) // "Lv.6 이하의, A를 포함하거나 B를 가진 카드": the leading condition applies to BOTH alternatives
    if (pm) { const a = strictCardFilter(pm[1] + ' 카드'), b = strictCardFilter(pm[2]); if (a && b && b.anyOf) return { ...a, ...b }; } }
  desc = desc.replace(/」\s+(?=[을를이가의은는])/g, '」').replace(/」의\s*기술이\s*있(는|거나)/g, '」이 기술되어 있$1').replace(/특징에\s*(?=「)/g, '특징으로 ').replace(/([가-힣.\d])\s*,\s*(?=[가-힣「DL])/g, '$1 '); // spacing/wording variants ("「X」 의 기술이 있거나", "특징에 「X」를", "Lv.6 이하의, 특징…")
  desc = desc.replace(/(레드|블루|옐로우?|그린|블랙|퍼플|화이트)\s*(?:또는|이나)\s*(?=(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))/g, '$1/').trim().replace(/,\s*$/, '').replace(/Lv\.\s+(\d)/g, 'Lv.$1').replace(/」\s*(?:또는|이나)\s*「/g, '」/「');
  if (/^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(desc)) return { exactAny: [...desc.matchAll(/「([^」]+)」/g)].map(x => x[1]) }; // ("「A」와 「B」" is an AND-list — never one card's OR: parsePickGroups / the condition parsers own that)
  if (/^(?:디지몬\s*|테이머\s*|옵션\s*)?카드$/.test(desc) && !/디지몬|테이머|옵션/.test(desc)) return {};
  { const pn = desc.match(/^((?:(?:Lv\.\s*\d+\s*(?:이하|이상)?|(?:사용|등장)?\s*코스트\s*\d+\s*(?:이하|이상)?|DP\s*\d+\s*(?:이하|이상)?|(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*)\s*(?:의|인)\s*)+)((?:「[^」]+」\s*\/?\s*)+)$/); // pass2-b6: "등장 코스트 3 이하의 「매튜」" = numeric/color prefix + bare exact name(s) (was left as a free-form desc that ignored the cost)
    if (pn) { const pre = strictCardFilter(pn[1].trim() + ' 카드'); if (pre) return { ...pre, exactAny: [...pn[2].matchAll(/「([^」]+)」/g)].map(x => x[1]) }; } }
  { const nm = desc.match(/^((?:「[^」]+」\s*(?:\/|또는)?\s*)+?)\s*또는\s*(?!「)(.+)$/); // "「A」 또는 블루인 Lv.3의 디지몬 카드" = OR of a name list and a descriptor
    if (nm) { const rhs = strictCardFilter(nm[2]); if (rhs) return { anyOf: [{ exactAny: [...nm[1].matchAll(/「([^」]+)」/g)].map(x => x[1]) }, rhs] }; } }
  let f = parseCardFilter(desc);
  if (!f && /거나|또는/.test(desc)) {
    const tailM = desc.match(/((?:디지몬|테이머|옵션)?\s*카드)$/); const tail = tailM ? ' ' + tailM[1] : '';
    const parts = desc.replace(/((?:디지몬|테이머|옵션)?\s*카드)$/, '').split(/(?<=포함하|가진|가지|갖|있|하)거나\s*|\s+또는\s+(?=특징|명칭|「)/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) { const fs = parts.map(p => parseCardFilter(p.replace(/(포함하|가지|갖|있)$/, '$1는') + tail)); if (fs.every(Boolean)) f = { anyOf: fs }; }
  }
  if (!f) return null;
  const rest = desc.replace(/특징(?:으로|에|은)?\s*(?:「[^」]+」\/?)+\s*(?:을|를)?\s*(?:가진|가지는|갖는|포함하는|가지거나|갖거나|포함하거나)?/g, '').replace(/명칭에\s*(?:「[^」]+」\/?)+\s*(?:을|를)?\s*포함하(?:는|거나)?/g, '')
    .replace(/(?:「[^」]+」\/?)+\s*(?:이|가)\s*기술되어\s*있(?:는|거나)?/g, '').replace(/^\s*(?:「[^」]+」\/?)+\s*(?:을|를)\s*포함하는/, '').replace(/《[^》]+》\s*(?:을|를)\s*(?:가진|갖는)/g, '').replace(/《[^》]+》\s*(?:이|가)\s*기술되어\s*있(?:는|거나)?/g, '')
    .replace(/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*(?:인|의)/g, '').replace(/Lv\.\d+\s*(?:이하|이상)?(?:의|인)?/g, '')
    .replace(/(?:사용|등장)?\s*코스트\s*\d+\s*(?:이하|이상)(?:의|인)?/g, '').replace(/(?:사용|등장)\s*코스트\s*\d+(?:의|인)/g, '').replace(/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)(?:\/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트))*(?:을|를)\s*포함하는\s*\d\s*색\s*(?:이상)?(?:의|인)?/g, '').replace(/(?:레드|블루|옐로우?|그린|블랙|퍼플|화이트)\s*이외의/g, '').replace(/진화원\s*효과를\s*가진|디지크로스\s*조건을\s*가진/g, '').replace(/DP\s*\d+\s*(?:이하|이상)(?:의|인)?/g, '')
    .replace(/디지몬|테이머|옵션|카드|디지타마|또는|거나|[의인을를이가은는,\s]/g, '');
  return /[가-힣]/.test(rest) ? null : f;
}

// One criterion of an "A와 B 1장씩" list -> filter. Never null: what strictCardFilter can't express degrades to { category?, desc } (cardDescPredicate at run time).
function criterionFilter(dsc) {
  dsc = dsc.trim().replace(/,\s*$/, '');
  let f = strictCardFilter(dsc); if (f) return f;
  let m;
  if ((m = dsc.match(/^(.*?)(디지몬|테이머|옵션)\s*카드\s*\/\s*(디지몬|테이머|옵션)\s*카드$/))) { // "특징으로 「X」를 가진 테이머 카드/옵션 카드" = OR of categories
    const a = strictCardFilter(m[1] + m[2] + ' 카드'), b = strictCardFilter(m[1] + m[3] + ' 카드');
    if (a && b) return { anyOf: [a, b] };
  }
  if ((m = dsc.match(/^((?:「[^」]+」)(?:\s*\/\s*「[^」]+」)*)\s*(?:또는|\/)\s*((?:특징|명칭|사용|등장|Lv\.).*)$/))) { // "「한지호」 또는 특징 「세이버즈」를 가진 카드" = OR of two criteria
    const rhs = criterionFilter(m[2]);
    return { anyOf: [{ exactAny: [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]) }, rhs] };
  }
  { const ps = dsc.split(/(?<=카드)\s*또는\s*(?=「|특징|명칭|Lv\.)/); // "<A 카드> 또는 「X」 또는 「Y」" = OR of the criteria
    if (ps.length >= 2) { const fs = ps.map(p => /^(?:「[^」]+」\s*(?:\/|또는)?\s*)+$/.test(p.trim()) ? { exactAny: [...p.matchAll(/「([^」]+)」/g)].map(x => x[1]) } : strictCardFilter(p.trim())); if (fs.every(Boolean)) return { anyOf: fs }; } }
  const cat = /테이머\s*카드/.test(dsc) && !/옵션\s*카드|디지몬\s*카드/.test(dsc) ? 'tamer' : /옵션\s*카드/.test(dsc) && !/테이머\s*카드/.test(dsc) ? 'option' : /디지몬\s*카드/.test(dsc) && !/테이머|옵션/.test(dsc) ? 'digimon' : null;
  return { ...(cat ? { category: cat } : {}), desc: dsc };
}

// Generic "<zones>에서 <desc> N장(까지)을 (원하는 순서대로) <목적지>하는" card-movement cost -> moveEach (hand / trash / this Digimon's sources -> deck top|bottom, hand, trash, this stack's sources,
// another own Tamer's/Digimon's sources, security bottom). Returns null when any part isn't understood (the caller then falls back to a manualCost).
const MOVE_RE1 = /^(.*?)에서,?\s*(.*?)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(원하는\s*순서대로\s*)?(.+)$/s;
const MOVE_RE2 = /^(?:(?:자신|상대)(?:의)?\s*)?(패|트래시)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(원하는\s*순서대로\s*)?(.+)$/s;
function moveDestOf(tail) {
  let m;
  const fd = /뒷면으로|앞면이\s*아닌\s*상태로/.test(tail) ? { faceDown: true } : {};
  const t = tail.replace(/뒷면으로\s*|앞면이\s*아닌\s*상태로\s*/g, '').replace(/^오픈하고\s*/, '').trim();
  if (/^디지타마\s*덱\s*아래(?:쪽)?(?:로|에)\s*되돌린다$/.test(t)) return { dest: 'eggBottom' };
  if ((m = t.match(/^코스트를?\s*지불하지\s*않고\s*(레스트\s*상태로\s*)?등장시(?:키는다|킨다|키는)$/))) return { dest: 'play', rested: !!m[1], noTriggers: false };
  if (/^덱\s*위(?:쪽)?(?:으로|로|에)\s*되돌린다$/.test(t)) return { dest: 'deckTop' };
  if (/^덱\s*아래(?:쪽)?(?:으로|로|에)\s*되돌린다$/.test(t)) return { dest: 'deckBottom' };
  if (/^패(?:로|에)\s*되돌린다$/.test(t)) return { dest: 'hand' };
  if (/^파기한다$/.test(t)) return { dest: 'trash' };
  if ((m = t.match(/^이\s*디지몬의\s*진화원(?:의\s*가장)?\s*(위|아래)(?:쪽)?(?:에|의)\s*(?:놓|두)(?:는다|는)$/))) return { dest: 'thisSources', pos: m[1] === '위' ? 'top' : 'bottom', ...fd };
  if (/^이\s*테이머(?:의)?\s*아래(?:쪽)?에\s*(?:놓|두)(?:는다|는)$/.test(t)) return { dest: 'thisSources', pos: 'bottom', ...fd };
  if ((m = t.match(/^시큐리티(?:의)?\s*아래에\s*(앞면으로\s*)?(?:놓|두)(?:는다|는)$/)) || (m = tail.match(/^시큐리티\s*아래에\s*(앞면으로)\s*(?:놓|두)(?:는다|는)$/))) return { dest: 'securityBottom', ...(/앞면으로/.test(tail) ? { faceUp: true } : {}) };
  if ((m = t.match(/^(.*?)자신의\s*(테이머|「[^」]+」)(?:\s*중)?(?:\s*1\s*(?:명|마리))?(?:의)?\s*아래(?:쪽)?에\s*(?:놓|두)(?:는다|는)$/))) {
    let f;
    if (m[2] === '테이머') { const pre = m[1].trim(); f = pre ? strictCardFilter(pre.replace(/\s*자신의$/, '') + ' 테이머 카드') : { category: 'tamer' }; if (f && !f.category) f = { ...f, category: 'tamer' }; }
    else f = { exactAny: [m[2].slice(1, -1)] };
    if (!f) return null;
    return { dest: 'otherSources', destFilter: f, ...fd };
  }
  return null;
}
function compileMoveCost(c) {
  let m, zoneS, desc, n, upTo, ord, tail, srcOwn = false, srcFilter = null, ordAny = false;
  if ((m = c.match(/^(.*?)(이|자신의)\s*디지몬의\s*진화원(?:을|를)\s*선택하여\s*(\d+)\s*장\s*파기(?:한다|하는)$/))) { // "<조건> 자신의 디지몬의 진화원을 선택하여 N장 파기" / "이 디지몬의 진화원을 선택하여 N장 파기"
    let sf = null; if (m[2] === '자신의' && m[1].trim()) { sf = strictCardFilter(m[1].trim() + ' 디지몬 카드'); if (!sf) return null; }
    if (m[2] === '이' && m[1].trim()) return null;
    return [{ op: 'moveEach', who: 'self', from: ['sources'], ...(m[2] === '자신의' ? { srcOwn: true, ...(sf && Object.keys(sf).length ? { srcFilter: sf } : {}) } : {}), groups: [{ max: Number(m[3]), label: '진화원 카드' }], dest: 'trash', ordered: false, required: true }];
  }
  c = c.replace(/\s*원하는\s*순서대로/, () => { ordAny = true; return ''; }).replace(/^이\s*테이머\s*아래에\s*있는\s*/, '이 디지몬의 진화원의 '); // ("이 테이머 아래에 있는 X" = this stack's sources)
  c = c.replace(/\s*최대\s*(?=\d+\s*장)/, ' ').replace(/\s*\d+\s*장\s*또는\s+/, ''); // "최대 2장까지"; "A 1장 또는 B 1장" -> OR marker
  if ((m = c.match(/^이\s*디지몬의\s*진화원(?:에\s*있는|인|의)\s*(.*?)\s*(\d+)\s*장(까지)?(?:을|를)?\s*,?\s*(원하는\s*순서대로\s*)?(.+)$/s))) { zoneS = '이 디지몬의 진화원'; desc = m[1]; n = +m[2]; upTo = !!m[3]; ord = !!m[4]; tail = m[5]; } // "이 디지몬의 진화원에 있는 Lv.6인 디지몬 카드 1장을 패로 되돌리는"
  else if ((m = c.match(MOVE_RE1))) { zoneS = m[1]; desc = m[2]; n = +m[3]; upTo = !!m[4]; ord = !!m[5]; tail = m[6]; }
  else if ((m = c.match(MOVE_RE2))) { zoneS = (/^상대/.test(c) ? '상대의 ' : '자신의 ') + m[1]; desc = ''; n = +m[2]; upTo = !!m[3]; ord = !!m[4]; tail = m[5]; }
  else return null;
  const from = [];
  const oppZ = /^상대(?:의)?\s*/.test(zoneS); // "상대의 트래시에서 …을 덱 아래로 되돌리는 것으로,": the cards leave the OPPONENT's zone
  if (oppZ) zoneS = zoneS.replace(/^상대(?:의)?\s*/, '');
  for (let z of zoneS.split(/\s*(?:\/|또는|나)\s*/)) {
    z = z.trim().replace(/^자신(?:의)?\s*/, '');
    if (z === '패') from.push('hand'); else if (z === '트래시') from.push('trash'); else if (/^이\s*디지몬의\s*진화원$/.test(z)) from.push('sources'); else if (/^디지몬의\s*진화원$/.test(z)) { from.push('sources'); srcOwn = true; } else return null;
  }
  if (!from.length) return null;
  ord = ord || ordAny;
  const dop = moveDestOf(tail.trim());
  if (!dop) return null;
  let d = desc.trim().replace(/,\s*$/, '').replace(/(?:을|를)$/, '').trim(); const extra = {};
  if (/디지타마\s*카드\s*이외의/.test(d)) { d = d.replace(/디지타마\s*카드\s*이외의\s*/, '').trim() || '카드'; extra.notCategory = 'digitama'; }
  if (/^디지타마\s*카드$/.test(d)) { d = '카드'; extra.category = 'digitama'; }
  if (/씩|각각|서로\s*다른/.test(d)) return null;
  let f = {};
  if (d && !/^카드$/.test(d)) {
    const alts = d.split(//).map(x => x.replace(/\s*\d+\s*장$/, '').trim()); // "「A」를 포함하는 디지몬 카드 1장 또는 Lv.3의 디지몬 카드" = OR
    const fl = alts.map(a => (/^카드$/.test(a) ? {} : strictCardFilter(a)));
    if (!fl.every(Boolean)) return null;
    f = fl.length === 1 ? fl[0] : { anyOf: fl };
  }
  f = { ...f, ...extra };
  const g = { ...(Object.keys(f).length ? { filter: f } : {}), max: n, label: d || '카드' };
  if (dop.dest === 'thisSources' && from.includes('sources')) return null; // moving within the same stack
  if (dop.dest === 'hand' && (from.length !== 1 || from[0] !== 'sources')) return null; // only sources -> hand is a "되돌린다" cost
  if (dop.dest === 'trash' && from.includes('trash')) return null;
  if (oppZ && (from.includes('sources') || !['deckTop', 'deckBottom', 'trash'].includes(dop.dest))) return null; // opponent-zone costs: only trash/hand -> their deck top/bottom (or trash)
  if (srcOwn && dop.dest !== 'trash') return null; // ("자신의 디지몬의 진화원에서 …" is only supported as a discard)
  return [{ op: 'moveEach', who: 'self', from, groups: [g], ...dop, ...(srcOwn ? { srcOwn: true } : {}), ...(oppZ ? { zoneOwner: 'opp' } : {}), ordered: ord, ...(upTo ? { upTo: true } : { required: true }) }];
}


// Stack-moving / face-down / link / self-return costs (ops live in cards/shard20.js and follow its instr._paid protocol).
function compileStackCost(c) {
  let m;
  const filt = (pre, noun) => { const p = pre.replace(/(?:^|\s)다른\s*$/, ' ').replace(/(?:^|\s)다른\s+/g, ' ').trim(); if (!p) return {}; return strictCardFilter(p + ' ' + noun + ' 카드'); };
  if ((m = c.match(/^(.*?)자신의\s*(?:다른\s*)?디지몬\s*1\s*마리(?:를|을)\s*이\s*디지몬의\s*진화원(?:의)?\s*아래에\s*(?:놓|두)(?:는다|는)$/))) {
    const f = filt(m[1], '디지몬'); if (f) return [{ op: 'stackMove', mode: 'otherUnderThis', ...(Object.keys(f).length ? { filter: f } : {}) }];
  }
  if ((m = c.match(/^이\s*(디지몬|테이머)(?:을|를)\s*(.*?)자신의\s*(?:다른\s*)?(디지몬|테이머)\s*(?:1\s*(?:마리|명))?(?:의)?\s*진화원(?:의)?\s*아래에\s*(?:놓|두)(?:는다|는)$/)) && !/이\s*카드/.test(m[2])) {
    const f = filt(m[2], m[3]); if (f) return [{ op: 'stackMove', mode: 'thisUnderOther', anyKind: m[3] === '테이머', ...(Object.keys(f).length ? { filter: m[3] === '테이머' ? { ...f, category: 'tamer' } : f } : {}) }];
  }
  if (/^이\s*디지몬의\s*진화원\s*전부(?:를|을)\s*자신의\s*테이머\s*1\s*명(?:의)?\s*아래에\s*놓(?:는다|는)$/.test(c)) return [{ op: 'stackMove', mode: 'sourcesUnderTamer' }];
  if ((m = c.match(/^이\s*디지몬의\s*뒷면의\s*진화원(?:을|를)\s*아래에서부터\s*(\d+)\s*장\s*파기(?:한다|하는)$/))) return [{ op: 'trashFaceDown', target: 'this', n: Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*테이머\s*아래의\s*뒷면\s*카드(?:를|을)\s*아래에서부터\s*(\d+)\s*장\s*파기(?:한다|하는)$/))) return [{ op: 'trashFaceDown', target: 'ownTamer', n: Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*디지몬의\s*뒷면인\s*진화원(?:을|를)\s*아래에서부터\s*(\d+)\s*장\s*파기(?:한다|하는)$/))) return [{ op: 'trashFaceDown', target: 'ownDigimon', n: Number(m[1]) }];
  if ((m = c.match(/^이\s*디지몬의\s*링크\s*카드(?:를|을)?\s*(\d+)\s*장(?:을|를)?\s*파기(?:한다|하는)$/))) return [{ op: 'trashLink', n: Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*디지몬의\s*링크\s*카드(?:를|을)?\s*(\d+)\s*장(?:을|를)?\s*파기(?:한다|하는)$/))) return [{ op: 'trashLink', n: Number(m[1]), target: 'own' }];
  if ((m = c.match(/^(\d+)\s*코스트\s*지불하고,?\s*이\s*카드를\s*(.*?)자신의\s*디지몬의\s*진화원\s*아래에\s*놓(?:는다|는)$/))) { // option cards: pay memory, then put THIS card under a Digimon (EX6-009/010/037/044)
    const pre = m[2].trim(), f = pre ? strictCardFilter(pre + ' 디지몬 카드') : {};
    if (f) return [{ op: 'gainMemory', who: 'self', n: -Number(m[1]) }, { op: 'placeThisUnderSource', ...(Object.keys(f).length ? { filter: f } : {}) }];
  }
  if ((m = c.match(/^자신(?:의)?\s*덱\s*위에서부터\s*(\d+)\s*장(?:을|를)?\s*이\s*디지몬의\s*진화원\s*아래에\s*뒷면으로\s*놓(?:는다|는)$/))) return [{ op: 'deckTopToSources', n: Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*(\d+)\s*장이\s*될\s*때까지\s*위에서부터\s*파기(?:한다|하는)$/))) return [{ op: 'trashSecurityTo', n: Number(m[1]) }];
  if ((m = c.match(/^(.*?)이\s*디지몬에\s*겹쳐져\s*있는\s*카드를\s*위에서부터\s*(\d+)\s*장\s*이\s*디지몬의\s*진화원\s*아래에\s*놓(?:는다|는)$/))) { // "<특징 …를 가진> 이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 이 디지몬의 진화원 아래에 놓는": the top-most source goes to the bottom
    const pre = m[1].trim(), f = pre ? strictCardFilter(pre + ' 디지몬 카드') : {};
    if (f) return [{ op: 'rotateSource', n: Number(m[2]), ...(Object.keys(f).length ? { condFilter: f } : {}) }];
  }
  if ((m = c.match(/^배틀\s*에어리어의\s*(.*?)자신의\s*옵션\s*카드\s*(\d+)\s*장(?:을|를)\s*파기(?:한다|하는)$/))) { // options placed in the battle area (delay options …)
    const pre = m[1].trim(), f = pre ? strictCardFilter(pre + ' 옵션 카드') : {};
    if (f) return Array.from({ length: Number(m[2]) }, () => ({ op: 'destroy', target: 'self', mode: 'choose', filter: { ...f, category: 'option' } }));
  }
  if ((m = c.match(/^이\s*(디지몬|테이머)(?:을|를)\s*덱\s*아래(?:로|에)\s*되돌린다$/))) return [{ op: 'returnToHandStripSources', thisStack: true, dest: 'deckBottom' }];
  if ((m = c.match(/^이\s*(디지몬|테이머)(?:을|를)\s*패(?:로|에)\s*되돌린다$/))) return [{ op: 'returnToHandStripSources', thisStack: true }];
  return null;
}

// Chosen-target costs: "<조건> 자신의|상대의 (다른) 「X」/디지몬/테이머/디지몬/테이머 N마리(명)를 소멸시키는 / 레스트시키는 / 패로·덱 아래로 되돌리는"
// (own side: sacrifice-style; opponent side: the cost acts on the opponent's stack — verified by the opponent's battle-area count)
function compileTargetCost(c) {
  const m = c.match(/^(.*?)(자신|상대)(?:의)?\s*(다른\s*)?(「[^」]+」(?:\s*(?:\/|또는)\s*「[^」]+」)*|디지몬\/테이머|테이머|디지몬)\s*(\d+)\s*(?:마리|명)(까지)?(?:를|을)?\s*(소멸시킨다|레스트시킨다|패(?:로|에)\s*되돌린다|덱\s*아래(?:로|에)\s*되돌린다)$/);
  if (!m || m[6]) return null;
  const opp = m[2] === '상대';
  let pre = m[1].trim(), excl = !!m[3];
  if (/(?:^|\s)다른$/.test(pre)) { excl = true; pre = pre.replace(/\s*다른$/, '').trim(); }
  const mods = pre ? parseTargetMods(pre) : {};
  if (mods._left || mods.extreme) return null;
  const { _left, ...f0 } = mods;
  let f = { ...f0 };
  const noun = m[4], isName = noun.startsWith('「');
  if (isName) f = { ...f, exactAny: [...noun.matchAll(/「([^」]+)」/g)].map(x => x[1]) };
  if (noun === '테이머') f = { ...f, category: 'tamer' };
  const n = Number(m[5]), verb = m[7], target = opp ? 'opponent' : 'self', anyKind = noun === '디지몬/테이머' || (isName && /\d+\s*명/.test(c)); // b5 (BT13-010): 「최민지」 1명 = a Tamer (the candidate list was Digimon-only)
  const base = { ...(Object.keys(f).length ? { filter: f } : {}), ...(excl ? { excludeSelf: true } : {}), ...(anyKind ? { anyKind: true } : {}) };
  if (verb === '소멸시킨다') return Array.from({ length: n }, () => ({ op: 'destroy', target, mode: 'choose', ...base }));
  if (verb === '레스트시킨다') return [{ op: 'rest', target, n, ...(noun === '디지몬' ? { digimonOnly: true } : {}), filter: { ...f, suspended: false }, ...(excl ? { excludeSelf: true } : {}) }];
  return [{ op: 'returnToHandStripSources', target, n, ...base, ...(/덱/.test(verb) ? { dest: 'deckBottom' } : {}) }];
}

// One cost clause ("…하는 것으로," part) -> cost ops. Anything not automatable becomes a manualCost the player must confirm.
function compileCostClause(raw) {
  const c = normalizeCost(raw.replace(/^그\s*후,?\s*/, '')).replace(/레스트\s*시킨다$/, '레스트시킨다').replace(/[.。]$/, '');
  let m;
  if (/거나/.test(c.replace(/「[^」]*」/g, '')) && !/(?:가지|갖|포함하|있)거나/.test(c)) return [{ op: 'manualCost', text: raw.trim() }];
  if ((m = c.match(/^이\s*(?:테이머|디지몬)(?:을|를)\s*레스트시킨다$/))) return [{ op: 'restStack' }];
  if (/^이\s*(?:디지몬|테이머)(?:을|를)\s*소멸시킨다$/.test(c)) return [{ op: 'destroy', target: 'self', mode: 'thisStack' }];
  if (/^이\s*디지몬을\s*액티브로\s*(?:한다|하는)$/.test(c)) return [{ op: 'unsuspend', target: 'thisStack', asCost: true }];
  { const tgD = findTgt(c, '자신', '디지몬', String.raw`(?:를|을)?\s*소멸시킨다$`);
    if (tgD && !tgD.all && tgD.n && !/[가-힣「]/.test(tgD.left)) return Array.from({ length: tgD.n }, () => ({ op: 'destroy', target: 'self', mode: 'choose', ...tgtProps(tgD) }));
    const tgR = findTgt(c, '자신', String.raw`디지몬(?:\/테이머)?`, String.raw`(?:를|을)?\s*레스트시킨다$`);
    if (tgR && !tgR.all && tgR.n && !/[가-힣「]/.test(tgR.left)) return [{ op: 'rest', target: 'self', n: tgR.n, ...(/테이머/.test(tgR.noun) ? {} : { digimonOnly: true }), filter: { ...(tgR.filter || {}), suspended: false }, ...(tgR.excludeSelf ? { excludeSelf: true } : {}) }]; }
  // "자신의 패(/트래시)에서 <카드> N장을, <조건> 자신의 디지몬 1마리의 진화원(의 가장) 아래에 놓는 것으로" — hand/trash card -> under one of the player's Digimon (BT8-104, BT10-094, EX3-066)
  if ((m = c.match(/^자신(?:의)?\s*(패\s*\/\s*트래시|패|트래시)에서,?\s*(.*?카드)\s*(\d+)\s*장(?:을|를)?\s*,?\s*(.*?)자신의\s*디지몬(?:\s*1\s*마리)?의\s*진화원(?:의\s*가장)?\s*아래(?:쪽)?에\s*놓(?:는다|는)$/))) {
    const tm = parseTargetMods(m[4] || '');
    if (!tm._left) return [{ op: 'placeUnderSource', who: 'self', zones: m[1].includes('/') ? ['hand', 'trash'] : [m[1] === '패' ? 'hand' : 'trash'], filter: criterionFilter(m[2]), n: Number(m[3]), ...(Object.keys(tm).length ? { targetFilter: tm } : {}), asCost: true }];
  }
  if ((m = c.match(/^메모리(?:를|을)?\s*-\s*(\d+)\s*(?:한다|하는)?$/))) return [{ op: 'gainMemory', who: 'self', n: -Number(m[1]) }];
  if ((m = c.match(/^(\d+)\s*코스트(?:를)?\s*지불(?:한다|하는)?$/))) return [{ op: 'gainMemory', who: 'self', n: -Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*패(?:를)?\s*(\d+)\s*장(?:을|를)?\s*파기한다$/))) return [{ op: 'trashHand', who: 'self', n: Number(m[1]) }];
  if ((m = c.match(/^(.*?)(?:을|를)\s*자신(?:의)?\s*패에서\s*(\d+)\s*장(?:을|를)?\s*파기한다$/)) || (m = c.match(/^자신(?:의)?\s*패에서,?\s*(.*?)\s*(\d+)\s*장(?:을|를)?\s*파기한다$/))) {
    const f = strictCardFilter(m[1]);
    if (f) return [{ op: 'trashHand', who: 'self', n: Number(m[2]), ...(Object.keys(f).length ? { filter: f } : {}) }];
  }
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*위에서부터\s*(\d+)\s*장\s*패에\s*추가한다$/))) return [{ op: 'securityTopToHand', who: 'self', n: Number(m[1]) }];
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*위\s*또는\s*아래에서부터\s*(\d+)\s*장\s*패에\s*추가한다$/))) return [{ op: 'securityTopToHand', who: 'self', n: Number(m[1]), end: 'either' }];
  if ((m = c.match(/^이\s*디지몬의\s*진화원을\s*(?:선택하여\s*)?(\d+)\s*장\s*파기한다$/))) return [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: Number(m[1]), choose: true }];
  if ((m = c.match(/^자신(?:의)?\s*(패|트래시)(?:의|에서),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)\s*(원하는\s*순서대로\s*)?덱\s*아래로\s*되돌린다$/))) { // "자신의 트래시에서 「A」와 「B」 1장씩을 덱 아래로 되돌리는 것으로": one card per criterion
    const gs = parsePickGroups(`${m[2]} 1장씩`);
    if (gs) return [{ op: 'moveEach', who: 'self', from: [m[1] === '패' ? 'hand' : 'trash'], groups: gs, dest: 'deckBottom', ordered: !!m[3], required: true }];
  }
  if ((m = c.match(/^자신(?:의)?\s*시큐리티를\s*(위|아래)에서부터\s*(\d+)\s*장\s*파기한다$/))) return Array.from({ length: Number(m[2]) }, () => ({ op: 'removeSecurity', who: 'self', position: m[1] === '아래' ? 'bottom' : 'top' }));
  if ((m = c.match(/^자신(?:의)?\s*시큐리티(?:를)?\s*(?:위\s*또는\s*아래|위|아래)(?:에서(?:부터)?)?\s*(?:(위|아래)에서(?:부터)?\s*)?(\d+)\s*장(?:을|를)?\s*파기한다$/))) return Array.from({ length: Number(m[2]) }, () => ({ op: 'removeSecurity', who: 'self', position: /위\s*또는\s*아래/.test(c) ? 'either' : /아래/.test(c) ? 'bottom' : 'top' }));
  { const sc = compileStackCost(c); if (sc) return sc; }
  { const tc = compileTargetCost(c); if (tc) return tc; }
  { const mc = compileMoveCost(c); if (mc) return mc; }
  { // "<A>하고, <B>하는" chained costs (이 테이머를 레스트시키고, …를 파기하는): every part must compile, else the whole clause stays manual
    const parts = c.split(/(?<=레스트시키|파기하|되돌리|소멸시키|놓)고,\s*/);
    if (parts.length > 1) {
      const outs = parts.map((p, i) => compileCostClause(i < parts.length - 1 ? normalizeCost(p + (/놓$/.test(p) ? '는' : '는')) : p));
      if (outs.every(o => o.length && o.every(x => x.op !== 'manualCost'))) return outs.flat();
    }
  }
  return [{ op: 'manualCost', text: raw.trim() }];
}

// batch4: a body that follows a leading condition may itself be a "…N장마다, <효과>" sentence — compileWithCost (compileInner) has no per-count pass, so the count was dropped (BT12-085)
function compileWithCostPer(text) {
  const r = compileWithCost(text);
  if (/\d+\s*(?:장|마리|명|색)\s*마다/.test(text) && !r.some(o => o.per)) { const rp = compilePerSentences(text); if (rp && rp.length) return rp; }
  return r;
}
function compileWithCost(text) {
  const inner = compileInner(text);
  const t = text.trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  const cmM = t.replace(/Lv\./g, 'Lv'); // masked so the "." of Lv. isn't taken for a sentence end
  const cm = cmM.match(/^((?:[^.。\n《≪]|《[^》]{1,12}》(?=\s*(?:이|가)\s*기술되어)){2,90}?)\s*것으로,?\s*(.+)$/s); // (a "《세이브》가 기술되어 있는 카드" filter inside the cost is part of the cost — EX10-015)
  if (cm) { cm[1] = cm[1].replace(//g, '.'); cm[2] = cm[2].replace(//g, '.'); }
  if (!cm) {
    // the cost may open a LATER sentence ("…한다. 그 후, <비용>하는 것으로, <효과>"): compile the earlier sentences on their own
    const sents = splitSentences(t);
    const k = sents.findIndex(x => /것으로,?\s*\S/.test(x));
    if (k > 0 && !/오픈|공개|〈룰〉/.test(sents.slice(0, k).join(' ')) && !inner.some(x => x.op === 'costGroup' || x.op === 'condition')) {
      { // pass2-b2: "<효과 A>. <비용>하는 것으로, 대신 <효과 B>" (BT12-031, EX3-072): paying the cost REPLACES the previous sentence (A) with B — costGroup{then:B, else:A}
        const rm = /^(.*?)\s*것으로,?\s*대신에?,?\s*(.+)$/s.exec(sents[k]);
        if (rm && k >= 1 && sents.slice(k + 1).length === 0) {
          const costOps2 = compileCostClause(rm[1].trim().replace(/^(?:그\s*후,?\s*)/, ''));
          const thenOps2 = compileToScript(rm[2]), elseOps2 = compileToScript(sents[k - 1].replace(/^(?:그\s*후,?\s*)/, ''));
          if (costOps2.length && costOps2.every(x => x.op !== 'manualCost') && thenOps2.length && elseOps2.length) return [...(k > 1 ? compileToScript(sents.slice(0, k - 1).join(' ')) : []), { op: 'costGroup', cost: costOps2, then: thenOps2, else: elseOps2 }];
        }
      }
      const rest = compileWithCost(sents.slice(k).join(' '));
      if (rest.length && rest.some(x => x.op === 'costGroup')) return [...compileToScript(sents.slice(0, k).join(' ')), ...rest];
    }
    return inner;
  }
  if (inner.some(x => x.op === 'costGroup')) return inner;
  // "〈룰〉 …" reminder lines and replacement-style costs ("…하는 것으로, 벗어나지 않는다") aren't costs of a following effect
  if (/^〈룰〉/.test(cm[1].trim()) || /^(?:벗어나지|소멸하지|파기되지)\s*않는다/.test(cm[2].trim())) return inner;
  let eff = /^이하의\s*효과\s*(?:에서|중)|(?:라면|다면|때|경우)\s*,|(?:^|[\s,])\d+\s*(?:장|마리|명|색)\s*(?:마다|당)[\s,]/.test(cm[2].trim()) || splitSentences(cm[2].trim()).length > 1 ? compileToScript(cm[2]) : compileInner(cm[2]); // whole effect text (effectChoice / later conditional sentences)
  if (!eff.length) eff = [{ op: 'noop', note: `효과를 수동으로 처리하세요: ${cm[2].replace(/\([^()]*\)/g, '').slice(0, 120)}` }];
  const costOps = compileCostClause(cm[1].replace(/^.*?(?:했을|었을|있을|한)\s*때,?\s*(?=이\s*(?:테이머|디지몬)(?:을|를)\s*레스트\s*시키는$)/, '')); // "<트리거 조건>했을 때, 이 테이머를 레스트시키는 것으로": the trigger part is the watcher's job, only the rest is the cost
  if (!costOps.length) return inner;
  return [{ op: 'costGroup', cost: costOps, then: eff, costText: cm[1].trim(), thenText: cm[2].trim() }];
}

// Later sentences that open with a condition ("…한다. 그 후, <조건>라면, <효과>" / "<조건>일 때, 대신 <효과>" / "이 효과로 소멸하지 않았다면, …"):
// everything before it compiles unconditionally; the conditional sentence is wrapped in a condition op ("대신" = replaces the previous sentence).
// "…있을 때 / …이하일 때 / …포함할 때 / …가질 때" (state conditions written with 때) -> the "…라면" forms parseConditionText knows
// a condition we can't evaluate asks the player instead (never runs the gated effect blindly, never silently drops it)
function manualCondition(label) { const f = (ctx) => ctx.choose('confirmEffect', { player: ctx.self, prompt: `조건 확인(수동): ${label} — 충족합니까?` }); f.manualLabel = label; return f; }
function normCondText(cond) {
  return cond.replace(/\s+/g, ' ').trim().replace(/(진화원\s*을\s*\d+\s*장\s*이상)\s*가지며,\s*/, '$1 가진 ').replace(/(포함하거나),\s*(진화원에)/, '$1 $2').replace(/경우$/, '때').replace(/\s*있을\s*때$/, ' 있다면').replace(/\s*없을\s*때$/, ' 없다면').replace(/\s*이하일\s*때$/, ' 이하라면').replace(/\s*이상일\s*때$/, ' 이상이라면')
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
  const sents = [];
  for (const x of splitSentences(text).map(y => y.trim()).filter(Boolean)) { // "…오픈한다. 그 중 …패에 추가한다. 나머지는 …": one effect, gated as a whole
    if (sents.length && /^(?:그\s*중(?:에서|에)?|그중|남은\s*카드|나머지는?)\s/.test(x) && /(?:오픈|공개)한다\.?$/.test(sents[sents.length - 1].replace(/\s*(?:그\s*중|그중|남은|나머지).*$/s, ''))) sents[sents.length - 1] += ' ' + x; else sents.push(x);
  }
  if (sents.length < 2) return null;
  const CONDRE =/^(?:(?:그\s*후|또한),?\s*)?((?:[^,.。\n]{2,80}?(?:거나|고|며),\s*)?[^,.。\n]{2,80}?(?:라면|다면|(?:있을|없을|이하일|이상일|않았을|일|적을|많을|가질|같을|다를|포함할|가지고\s*있을|갖고\s*있을|기술되어\s*있을)\s*(?:때|경우)))(?:,\s*|\s+)(.+)$/s;
  const REPRE = /^(?:(?:그\s*후|또한),?\s*)?(.+?(?:라면|다면|(?:있을|없을|않았을)\s*때)),?\s*((?:그\s*)?대신에?,?\s*.+)$/s; // long conditions containing commas, always followed by "대신"
  const conds = sents.map((x, i) => ((i > 0 || allowFirst) && !/^그\s*카드가[^.]*(?:라면|다면|일\s*때|일\s*경우),?\s*(?:패에\s*추가한다|코스트를?\s*지불하지\s*않고\s*(?:레스트\s*상태로\s*)?등장)/.test(x) ? (x.replace(/Lv\./g, 'Lv\uE000').match(CONDRE) || x.replace(/Lv\./g, 'Lv\uE000').match(REPRE)) : null));
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
  const nd = (x) => JSON.stringify({ ...x, duration: undefined, expiresAfterTurn: undefined, optional: undefined }); // idx1539/1540 (BT12-056): "…레스트시킨다. 그 후, …어택할 수 있다" — a later sentence's 「수 있다」 leaked `optional` onto the earlier mandatory rest
  const a2 = flat.map(nd).sort(), b2 = script.map(nd).sort();
  return a2.every((v, i) => v === b2[i]) ? flat : script;
}

// "A와 B 1장씩" zone moves that aren't a cost (트래시/패 -> 이 디지몬의 진화원, 이 디지몬의 진화원 -> 코스트 없이 등장, 상대의 레스트 디지몬과 테이머 1장씩 -> 덱 아래).
// Other sentences of the text compile as usual; "놓은 1장마다 메모리+N" / "이 효과로 N장 놓았을 때 …" hang off the move.
// "상대의 디지몬과 테이머 1마리(명)씩을 <V>" / "Lv.4와 Lv.5인 (액티브 상태의) 상대 디지몬 각각 1마리씩을 <V>": rewritten into one plain sentence per listed criterion
// (any "<조건>, " prefix is repeated on each) so the normal single-target compilers handle them; AND-joined criteria each get their own target.
function distributeEach(text) {
  if (!/씩/.test(text)) return text;
  const sents = splitSentences(text);
  let changed = false;
  const out = sents.map(raw => {
    const lead = raw.match(/^\s*/)[0], s = raw.trim();
    let m;
    if ((m = s.match(/^(.*?,\s*)?(레스트\s*상태인\s*)?상대(?:의)?\s*(레스트\s*상태인\s*)?디지몬(?:과|와)\s*테이머\s*(?:각각\s*)?1\s*(?:장|마리|명)(?:\(명\))?씩(?:을|를)\s*(.+)$/s)) && !/[은는]$/.test(m[4].split(/\s/)[0])) {
      const pre = m[1] || '', adj = m[2] || m[3] ? '레스트 상태인 ' : '', verb = m[4].trim();
      changed = true; return `${lead}${pre}${adj}상대의 디지몬 1마리를 ${verb}${pre}${adj}상대의 테이머 1명을 ${verb}`;
    }
    if ((m = s.match(/^(.*?,\s*)?((?:Lv\.\s*\d+\s*(?:와|과)\s*)+Lv\.\s*\d+)(?:인|의)?\s*(.*?)상대(?:의)?\s*디지몬\s*(?:각각\s*)?1\s*마리씩(?:을|를)\s*(.+)$/s))) {
      const pre = m[1] || '', mid = m[3].replace(/의\s*$/, '의 ').trim(), verb = m[4].trim();
      changed = true; return lead + [...m[2].matchAll(/Lv\.\s*(\d+)/g)].map(lm => `${pre}Lv.${lm[1]}인 ${mid ? mid + ' ' : ''}상대의 디지몬 1마리를 ${verb}`).join('');
    }
    return raw;
  });
  return changed ? out.join('') : text;
}
function compileMoveEachSentences(text) {
  if (!/씩|\d\s*장(?:과|와)/.test(text) || /것으로,/.test(text.replace(/\([^()]*\)/g, ''))) return null;
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  const out = []; let buf = []; let changed = false; let last = null;
  const flush = () => { if (buf.length) { const t1 = prepText(buf.join(' ')); out.push(...reorderBySentences(t1, compileToScriptCore(t1))); } buf = []; };
  for (const raw of sents) {
    let sn = raw.replace(/^그\s*후,?\s*/, '');
    let m, op = null, lead = null;
    { const lc = sn.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,80}?(?:있을|없을|이하일|이상일|일|가질|포함할)\s*때|[^,.。\n]{2,80}?(?:라면|다면)),\s*(.+)$/s); // batch4 (BT10-027 …): a leading condition in front of the moved-card sentence used to be ignored
      if (lc) { lead = lc[1].replace(/\uE000/g, '.'); sn = lc[2].replace(/\uE000/g, '.'); } }
    if ((m = sn.match(/자신(?:의)?\s*(패\s*(?:또는|\/)\s*트래시|트래시|패)(?:에서|의),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)?\s*(원하는\s*순서대로\s*)?이\s*디지몬의\s*진화원(\s*아래)?에\s*(원하는\s*순서대로\s*)?놓(?:는다|을\s*수\s*있다)/s))) {
      const gs = parsePickGroups(`${m[2]} 1장씩`);
      if (gs) op = { op: 'moveEach', who: 'self', from: /패/.test(m[1]) && /트래시/.test(m[1]) ? ['hand', 'trash'] : [/트래시/.test(m[1]) ? 'trash' : 'hand'], groups: gs, dest: 'thisSources', pos: m[4] ? 'bottom' : 'top', ordered: !!(m[3] || m[5]), ...(/수\s*있다/.test(sn) ? {} : { required: true }) };
    } else if ((m = sn.match(/이\s*디지몬의\s*진화원(?:에서|의),?\s*(.*?)\s*(?:각각\s*)?\d+\s*장씩(?:을|를)?\s*코스트를?\s*지불하지\s*않고\s*(레스트\s*상태로\s*)?등장시(킬\s*수\s*있다|킨다)/s))) {
      const gs = parsePickGroups(`${m[1]} 1장씩`);
      if (gs) op = { op: 'moveEach', who: 'self', from: ['sources'], groups: gs, dest: 'play', rested: !!m[2], noTriggers: false, ...(m[3] === '킨다' ? { required: true } : {}) };
    } else if ((m = sn.match(/^자신(?:의)?\s*트래시에서,?\s*(.*?)\s*(?:을|를)\s*패로\s*되돌(?:린다|릴\s*수\s*있다)/s))) { // "트래시에서 테이머 카드 1장과 특징으로 「X」를 가진 디지몬 카드 1장을 패로 되돌린다": one card per criterion
      const gs = parsePickGroups(m[1]);
      if (gs && gs.length > 1) op = { op: 'moveEach', who: 'self', from: ['trash'], groups: gs, dest: 'hand', ...(/수\s*있다/.test(sn) ? {} : { required: true }) };
    } else if ((m = sn.match(/^자신(?:의)?\s*(패|트래시)에서,?\s*(.*?)\s*(\d+)\s*장(?:과|와)\s*자신(?:의)?\s*(패|트래시)에서,?\s*(.*?)\s*(\d+)\s*장(?:을|를)\s*코스트를?\s*지불하지\s*않고\s*(레스트\s*상태로\s*)?등장시킬\s*수\s*있다/s))) { // "패에서 A 1장과 트래시에서 B 1장을 코스트 없이 등장" (BT16-083)
      const pf = (zn, d) => ({ op: 'playFree', who: 'self', zone: zn === '트래시' ? 'trash' : 'hand', filter: criterionFilter(d), rested: !!m[7], noTriggers: false, optional: true, prompt: `${zn}에서 무료로 등장시킬 ${d} 선택` });
      changed = true; flush(); out.push(pf(m[1], m[2]), pf(m[4], m[5])); continue;
    }
    if (op) { changed = true; flush(); if (lead) { const lt = parseConditionText(normCondText(lead)) || manualCondition(lead); out.push({ op: 'condition', if: { test: lt }, then: [op], else: [] }); } else out.push(op); last = op; continue; }
    if (lead) sn = raw.replace(/^그\s*후,?\s*/, '');
    if (last && (m = sn.match(/놓은\s*1\s*장마다\s*메모리\s*\+\s*(\d+)/))) { out.push({ op: 'gainMemory', who: 'self', n: Number(m[1]), per: { kind: 'moved', size: 1 } }); continue; }
    if (last && (m = sn.match(/^이\s*효과로\s*(\d+)\s*장\s*놓았을\s*때\s*(.+)$/s))) { const body = compileToScript(m[2]); if (body.length) { out.push({ op: 'condition', if: { movedGE: Number(m[1]) }, then: body, else: [] }); continue; } }
    buf.push(sn);
  }
  flush();
  return changed ? out : null;
}
// ---- sentence-level tails the whole-text scan can't express (batch 5 of the dropped-sentence audit) ----
// A sentence that (a) links a card onto a Digimon, (b) jogresses two own Digimon into a hand card, (c) plays a card while paying the printed cost -N,
// (d) plays cards up to a total cost, (e) battles, or (f) evolves (as a LATER sentence) becomes its own op — in printed order, keeping a leading
// "자신의 턴이라면," condition. Everything around it is compiled as before. The ops (n5_link / n5_jogressPair / n5_playPaid / n5_playSum / n5_battle) live in cards/shard14.js.
function tailZones(txt) { const z = []; if (/패/.test(txt)) z.push('hand'); if (/트래시/.test(txt)) z.push('trash'); if (/진화원/.test(txt)) z.push('sources'); return z; }
function tailFilter(desc) { const d = (desc || '').trim(); if (!d) return { ok: true, filter: null }; const f = parseCardFilter(d + ' 카드'); return f ? { ok: true, filter: f } : { ok: false }; }
function tailLink(s0) {
  const free = /코스트를\s*지불하지\s*않고/.test(s0);
  const s = s0.replace(/코스트를\s*지불하지\s*않고\s*/, '').trim();
  let m;
  if (!/또는/.test(s) && /이\s*카드를/.test(s) && /^(?:이\s*카드를\s*)?(?:(?:배틀\s*)?에어리어(?:의|에\s*있는)\s*)?자신(?:의)?\s*디지몬\s*1\s*마리(?:에게|에)\s*(?:이\s*카드를\s*)?링크|^이\s*카드를\s*(?:(?:배틀\s*)?에어리어(?:의|에\s*있는)\s*)?자신(?:의)?\s*디지몬\s*1\s*마리(?:에게|에)\s*링크/.test(s)) return [{ op: 'n5_link', thisCard: true, zones: ['trash'], filter: null, free, host: 'pick', max: 1 }];
  if ((m = s.match(/^이\s*카드\s*또는\s*자신의\s*트래시에\s*있는\s*(.*?)\s*카드\s*1\s*장을\s*(?:.*?)디지몬\s*1\s*마리에\s*링크/))) { const f = tailFilter(m[1]); return f.ok ? [{ op: 'n5_link', zones: ['trash'], filter: f.filter, free, host: 'pick', max: 1 }] : null; }
  if ((m = s.match(/자신의\s*((?:패|트래시|이\s*디지몬의\s*진화원)(?:\s*(?:또는|나|\/)\s*(?:패|트래시|이\s*디지몬의\s*진화원))?)에서,?\s*(.*?)\s*카드(?:를|을)?\s*(?:(?:최대\s*)?(\d+)\s*장(?:까지)?(?:을|를)?\s*)?(이\s*디지몬|자신(?:의)?\s*디지몬(?:\s*1\s*마리)?)(?:에게|에)\s*링크\s*(?:시킬|할)\s*수\s*있다$/))) {
    const f = tailFilter(m[2]); if (!f.ok) return null;
    return [{ op: 'n5_link', zones: tailZones(m[1]), filter: f.filter, free, host: /^이/.test(m[4]) ? 'this' : 'pick', max: Number(m[3] || 1) }];
  }
  return null;
}
function tailSentenceOps(raw, next, idx) {
  let s = raw.replace(/\([^()]*\)/g, '').replace(/[.。]\s*$/, '').trim().replace(/^[\[〔]턴\s*\d+\s*회[\]〕]\s*/, '').replace(/^그\s*후,?\s*/, '');
  let cond = null, m;
  if ((m = s.match(/^((?:자신|상대)의\s*턴)\s*이라면,?\s*(.+)$/s))) { cond = m[1]; s = m[2]; }
  let ops = null, used = 1;
  if (/링크\s*(?:시킬|할)\s*수\s*있다$/.test(s) && !/마인드|것으로/.test(s)) ops = tailLink(s);
  else if ((m = s.match(/^자신의\s*디지몬\s*2\s*마리로\s*패의\s*「([^」]+)」(?:으로|로|에)\s*조그레스\s*진화할\s*수\s*있다$/))) ops = [{ op: 'n5_jogressPair', cardName: m[1] }];
  else if (/^이\s*디지몬(?:과\s*상대의\s*디지몬\s*1\s*마리로|으로\s*상대의\s*디지몬\s*1\s*마리와)\s*배틀할\s*수\s*있다$/.test(s)) ops = [{ op: 'n5_battle' }];
  else if ((m = s.match(/^자신의\s*(패|트래시)에서,?\s*(.*?)\s*카드\s*1\s*장을\s*(?:지불하는\s*)?(?:등장\s*)?코스트\s*-\s*(\d+)\s*(?:으로|로|하여)\s*(등장\s*\/\s*사용|등장시키거나\s*사용|등장)(?:시킬|할)?\s*수\s*있다$/s))) {
    const f = tailFilter(m[2]);
    if (f.ok) ops = [{ op: 'n5_playPaid', zone: m[1] === '패' ? 'hand' : 'trash', filter: f.filter, delta: -Number(m[3]), kinds: /사용/.test(m[4]) ? ['digimon', 'tamer', 'option'] : ['digimon', 'tamer'], optional: true }];
  } else if ((m = s.match(/^자신의\s*(패\s*\/\s*트래시|패\s*또는\s*트래시|패|트래시)에서,?\s*(.*?)\s*카드를\s*등장\s*코스트\s*합계\s*(\d+)\s*까지\s*코스트를\s*지불하지\s*않고\s*등장시킬\s*수\s*있다$/s))) {
    const f = tailFilter(m[2]);
    if (f.ok) {
      ops = [{ op: 'n5_playSum', zones: tailZones(m[1]), filter: f.filter, limit: Number(m[3]) }];
      const nx = next && next.replace(/\([^()]*\)/g, '').replace(/[.。]\s*$/, '').trim().match(/^(.*?)\s*(\d+)\s*장\s*마다,?\s*이\s*효과의\s*등장\s*코스트\s*상한\s*\+\s*(\d+)$/s);
      const src = nx ? parsePerSource(nx[1]) : null;
      if (src) { ops[0].bonus = { per: { ...src, size: Number(nx[2]) }, plus: Number(nx[3]) }; used = 2; }
    }
  } else if (idx > 0 && parseEvolveEffect(s)) ops = [{ op: 'evolveEffect', who: 'self', ...parseEvolveEffect(s) }];
  if (!ops) return null;
  if (cond) ops = [{ op: 'condition', if: { test: condTestFor(cond + '이라면') }, then: ops, else: [] }];
  return { ops, used };
}
function compileTailSentences(text) {
  if (/\n\s*·/.test(text) || !/링크|조그레스|배틀할|지불하는|합계|진화(?:시킬|할)/.test(text)) return null;
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  const out = []; let buf = []; let changed = false;
  const flush = () => { if (buf.length) out.push(...compileToScript(buf.join(' '))); buf = []; };
  for (let i = 0; i < sents.length; i++) {
    const tl = tailSentenceOps(sents[i], sents[i + 1], i);
    if (!tl) { buf.push(sents[i]); continue; }
    changed = true; flush(); out.push(...tl.ops); i += tl.used - 1;
  }
  if (!changed) return null;
  flush();
  return out;
}
// "<N마리/명/장마다>, 이하의 효과를 발휘한다." + ONE bullet line (BT5-099, BT8-043 ...): the bullet with that per-clause in front
function compileBulletPer(text) {
  const m = text.trim().match(/^([^.\n·]*?(?:마리|명|장|개)\s*(?:마다|당)),?\s*이하의\s*효과를\s*발휘한다\.\s*\n\s*·\s*([^\n]+)$/);
  return m ? compileToScript(`${m[1]}, ${m[2].trim()}`) : null;
}
// "<조건> 자신의/상대의 디지몬 1마리를 선택한다. 그 디지몬…": the bare selection sentence becomes a real pick (op selectStack -> ctx._lastPick), so the following "그 디지몬…" sentences act on it
function compileSelectFirst(text) {
  const sents = splitSentences(text).map(x => x.trim()).filter(Boolean);
  if (sents.length < 2) return null;
  const m = sents[0].replace(/Lv\./g, 'Lv\uE000').match(/^(.*?)(자신|상대)(?:의)?\s*(다른\s*)?(디지몬|테이머)\s*1\s*(?:마리|명)(?:을|를)\s*(?:선택|고른)한다\.?$/);
  if (!m || !/^그\s*(?:디지몬|테이머)/.test(sents[1].replace(/^그\s*후,?\s*/, ''))) return null;
  const f = parseTargetMods(m[1].replace(/\uE000/g, '.'));
  if (f._left) return null;
  const rest = compileToScript(sents.slice(1).join(' '));
  if (!rest.length) return null;
  return [{ op: 'selectStack', target: m[2] === '상대' ? 'opponent' : 'self', ...(Object.keys(f).length ? { filter: f } : {}), ...(m[3] ? { excludeSelf: true } : {}), anyKind: m[4] === '테이머' }, ...rest];
}
// b9: "자신의 디지몬 1마리는 《A》를 얻고, DP +N" — a grantKeyword immediately followed by a modifyDP over the SAME filtered subject is ONE pick: the 2nd op reuses the Digimon the 1st chose (BT26-008/051 …)
function linkSameSubject(script) {
  if (!Array.isArray(script)) return script;
  for (let i = 1; i < script.length; i++) {
    const a = script[i - 1], b = script[i];
    if (a && b && a.op === 'grantKeyword' && b.op === 'modifyDP' && a.target === b.target && !a.all && !b.all && !a.last && !b.last && !a.thisStack && !b.thisStack && !a.excludeSelf && !b.excludeSelf && !a.distinct && !b.distinct && JSON.stringify(a.filter || null) === JSON.stringify(b.filter || null) && !b.per) {
      const { filter, thisStack, ...rest } = b; script[i] = { ...rest, last: true };
    }
  }
  return script;
}
// pass2-b8: "…다음 상대의 턴 종료 시에, 자신의 트래시에서 …을 등장시킨다" (EX4-071 / BT13-089) is a held effect: the free play runs at the end of the opponent's next turn, not now.
export function compileToScript(text) {
  if (typeof text !== 'string' || !/다음\s*상대의\s*턴\s*종료\s*시에,\s*자신의\s*트래시에서[^.]*등장시(?:킨다|킬)/.test(text)) return compileToScript0(text);
  const wrap = (ops) => (ops || []).map(o => o.op === 'playFree' ? { op: 'atTurnEnd', when: 'opp', then: [o] } : o.op === 'condition' ? { ...o, then: wrap(o.then), else: wrap(o.else) } : o.op === 'costGroup' && o.then ? { ...o, then: wrap(o.then) } : o);
  return wrap(compileToScript0(text.replace(/다음\s*상대의\s*턴\s*종료\s*시에,\s*/, '')));
}
function compileToScript0(text) { const t0 = distributeEach(prepText(text)); if (t0.includes('')) return t0.split('').flatMap(seg => compileToScript(seg));{ const slk = compileSecurityLook(t0); if (slk) return slk; } const mvE = compileMoveEachSentences(t0); if (mvE) return mvE; const tlS = compileTailSentences(t0); if (tlS) return tlS; const selF = compileSelectFirst(t0); if (selF) return selF; const cIf = compileCapIf(t0); if (cIf) return cIf; const bPer = compileBulletPer(t0); if (bPer) return bPer; const per = compilePerSentences(t0); if (per) return per; return attackLastPass(t0, linkSameSubject(reorderBySentences(t0, compileToScriptCore(t0)))); }
// b12: "…《연계》를 얻고, 그 디지몬으로 어택할 수 있다" (EX12-015/029) — the sentence's optional immediate attack with the digimon the keyword was just granted to
function attackLastPass(text, script) {
  if (!Array.isArray(script) || !script.some(o => o.op === 'grantKeyword' && !o.all) || script.some(o => o.op === 'attackNow')) return script;
  if (!/그\s*디지몬(?:으로|로)\s*어택할\s*수\s*있다/.test(text.replace(/\([^()]*\)/g, '')) || /(?:동안|때)[^.]*그\s*디지몬(?:으로|로)\s*어택할\s*수\s*있다/.test(text)) return script;
  return [...script, { op: 'attackNow', who: 'self', last: true }]; // slice6 G138 (official Q6737): after 《연계》 is granted the digimon must attack as far as possible (no decline)
}
// "자신의 시큐리티를 전부 확인한다. 그중 <카드> 1장을 (오픈하고) 패에 추가할 수 있다 / 코스트를 지불하지 않고 등장시킬 수 있다. [이 효과로 추가했다면 / 그 카드가 <조건>일 때 / 등장했다면], <효과>. 그 후, 자신의 시큐리티를 셔플한다. …"
// -> op secLook (cards/shard20.js) followed by the compiled remaining sentences. null when the shape isn't understood.
function compileSecurityLook(text) {
  const t = text.trim();
  const m = t.match(/^자신의\s*시큐리티(?:의\s*내용)?(?:을|를)\s*전부\s*확인(?:한다\.|하고,)\s*그\s*중\s*(.*?)\s*1\s*장(?:을|를)\s*(오픈하고\s*)?(패에\s*추가할\s*수\s*있다|패에\s*추가한다|코스트를\s*지불하지\s*않고\s*등장시킬\s*수\s*있다)\.\s*(.*)$/s);
  if (!m) return null;
  let desc = m[1].trim().replace(/(레드|블루|옐로우?|그린|블랙|퍼플|화이트)\s+(?=카드)/, '$1인 ');
  const f = !desc || /^카드$/.test(desc) ? {} : strictCardFilter(desc);
  if (!f) return null;
  const play = /등장/.test(m[3]), optional = /수\s*있다/.test(m[3]);
  const op = { op: 'secLook', who: 'self', action: play ? 'play' : 'hand', optional, ...(Object.keys(f).length ? { filter: f } : {}), ifTaken: [], ifCard: [] };
  const out = [op];
  for (let sn of splitSentences(m[4]).map(x => x.trim()).filter(Boolean)) {
    sn = sn.replace(/^그\s*후,?\s*/, '');
    let mm;
    if ((mm = sn.match(/^(?:이\s*효과로\s*)?(?:추가|등장)했다면,?\s*(.+)$/s))) { const ops = compileToScript(mm[1]); if (!ops.length) return null; op.ifTaken.push(...ops); continue; }
    if ((mm = sn.match(/^그\s*카드가\s*(.+?)\s*(?:일\s*때|이라면|라면|일\s*경우),?\s*(.+)$/s))) {
      const cd = strictCardFilter(mm[1].trim().replace(/(레드|블루|옐로우?|그린|블랙|퍼플|화이트)\s+(?=카드)/, '$1인 ')); const ops = compileToScript(mm[2]);
      if (!cd || !ops.length) return null;
      op.ifCard.push({ filter: cd, ops }); continue;
    }
    const ops = compileToScript(sn);
    if (!ops.length) return null;
    out.push(...ops);
  }
  return out;
}


function compileToScriptCore(text) {
  { const sl = compileSecurityLook(text); if (sl) return sl; }
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
        // official Q&A (EX11-058 Q5911/5912): a combined "등장/진화했을 때" watcher re-fired by a LATER evolution of the same digimon must NOT
        // satisfy this condition even though the digimon did enter via 《디코드》/《파티션》 earlier — playedByKw is a persistent per-stack flag
        // that survives evolution, so it alone can't tell "this trigger instance" apart from a later evolve-triggered one; evtKind can.
        test: (m) => (ctx) => { if (ctx.trigger && ctx.trigger.evtKind === 'digivolve') return false; const uid = ctx.trigger?.evtStackUid; const st = uid && [...ctx.state.players.p1.battle, ...ctx.state.players.p2.battle].find(x => x.uid === uid); return !!st && st.playedByKw === m[1]; } },
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

  // 15-15-7-2/4: "이하의 효과에서 1개를 발휘한다. <조건>이라면 대신 이하의 효과 전부를 발휘한다." + bullet lines. One of them, or (condition) ALL of them,
  // resolved one at a time in an order the player picks each step (15-15-7-2); Ver.4.3부터 15-15-7-4는 "전부 발휘"가 강제라도
  // 각 효과의 임의 처리 조건은 여전히 플레이어가 선택한다 (더 이상 자동으로 강제 처리하지 않음 — wrapChoose 참고).
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
  // ST9-11: "…레스트시킨다. 조그레스 진화하고 있었다면, 다음 상대의 액티브 페이즈에서는 그 디지몬은 액티브가 되지 않는다." — the no-unsuspend tail only applies when this stack was fused (stack.viaFusion)
  { const jm = text.match(/^(.*?)(?:그\s*후,?\s*)?조그레스\s*진화하고\s*있었다면,?\s*다음\s*상대의\s*액티브\s*페이즈에서는?,?\s*그\s*디지몬은\s*액티브가\s*되지\s*않는다\.?\s*$/s);
    if (jm && jm[1].trim()) { const prefix = compileToScript(jm[1].trim()); const rp = prefix.find(x => x.op === 'rest'); if (rp) { rp.skipIfFusion = true; return prefix; } } }
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
    { // "<조건 A>있거나/가지거나/…거나, <조건 B>일 때, <효과>" — OR of two conditions (the effect must NOT run when neither holds; it used to run always)
      const om = trimmed.replace(/Lv\./g, 'Lv').match(/^([^,.。\n]{2,90}?(?:있|없|가지|갖|포함하|이|하)거나),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (om && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const oUn = (x) => x.replace(//g, '.');
        const c1 = oUn(om[1]).replace(/있거나$/, ' 있다면').replace(/없거나$/, ' 없다면').replace(/(?:가지|갖)거나$/, ' 가진다면').replace(/포함하거나$/, ' 포함한다면').replace(/이거나$/, '이라면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')) || manualCondition(oUn(om[1])), t2 = parseConditionText(normCondText(oUn(om[2]))) || manualCondition(oUn(om[2]));
        const restO = compileWithCost(oUn(om[3]));
        if (restO.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) || !!(await t2(ctx)) }, then: restO, else: [] }];
      }
    }
    { // batch4 (BT10-021 …): "<조건 A>가지고/있고/이고, <조건 B>일 때, <효과>" — AND of two leading conditions (the effect must run only when BOTH hold; it used to run always)
      const am = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,90}?(?:가지|갖|포함하|있|없|이)(?:고|며)),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (am && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const aUn = (x) => x.replace(/\uE000/g, '.');
        const c1 = aUn(am[1]).replace(/있고$/, ' 있다면').replace(/없고$/, ' 없다면').replace(/(?:가지|갖)고$/, ' 가진다면').replace(/포함하고$/, ' 포함한다면').replace(/이고$/, '이라면').replace(/며$/, ' 있다면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')), t2 = parseConditionText(normCondText(aUn(am[2])));
        const restA = compileWithCost(aUn(am[3]));
        if (t1 && t2 && restA.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx)) }, then: restA, else: [] }];
      }
    }
    { // batch4 (BT10-021 …): "<조건 A>가지고/있고/이고, <조건 B>일 때, <효과>" — AND of two leading conditions (the effect must run only when BOTH hold; it used to run always)
      const am = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,90}?(?:가지|갖|포함하|있|없|이)(?:고|며)),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (am && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const aUn = (x) => x.replace(/\uE000/g, '.');
        const c1 = aUn(am[1]).replace(/있고$/, ' 있다면').replace(/없고$/, ' 없다면').replace(/(?:가지|갖)고$/, ' 가진다면').replace(/포함하고$/, ' 포함한다면').replace(/이고$/, '이라면').replace(/며$/, ' 있다면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')), t2 = parseConditionText(normCondText(aUn(am[2])));
        const restA = compileWithCost(aUn(am[3]));
        if (t1 && t2 && restA.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx)) }, then: restA, else: [] }];
      }
    }
    { // batch4 (BT10-021 …): "<조건 A>가지고/있고/이고, <조건 B>일 때, <효과>" — AND of two leading conditions (the effect must run only when BOTH hold; it used to run always)
      const am = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,90}?(?:가지|갖|포함하|있|없|이)(?:고|며)),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (am && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const aUn = (x) => x.replace(/\uE000/g, '.');
        const c1 = aUn(am[1]).replace(/있고$/, ' 있다면').replace(/없고$/, ' 없다면').replace(/(?:가지|갖)고$/, ' 가진다면').replace(/포함하고$/, ' 포함한다면').replace(/이고$/, '이라면').replace(/며$/, ' 있다면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')), t2 = parseConditionText(normCondText(aUn(am[2])));
        const restA = compileWithCost(aUn(am[3]));
        if (t1 && t2 && restA.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx)) }, then: restA, else: [] }];
      }
    }
    { // batch4 (BT10-021 …): "<조건 A>가지고/있고/이고, <조건 B>일 때, <효과>" — AND of two leading conditions (the effect must run only when BOTH hold; it used to run always)
      const am = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,90}?(?:가지|갖|포함하|있|없|이)(?:고|며)),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (am && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const aUn = (x) => x.replace(/\uE000/g, '.');
        const c1 = aUn(am[1]).replace(/있고$/, ' 있다면').replace(/없고$/, ' 없다면').replace(/(?:가지|갖)고$/, ' 가진다면').replace(/포함하고$/, ' 포함한다면').replace(/이고$/, '이라면').replace(/며$/, ' 있다면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')), t2 = parseConditionText(normCondText(aUn(am[2])));
        const restA = compileWithCost(aUn(am[3]));
        if (t1 && t2 && restA.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx)) }, then: restA, else: [] }];
      }
    }
    { // batch4 (BT10-021 …): "<조건 A>가지고/있고/이고, <조건 B>일 때, <효과>" — AND of two leading conditions (the effect must run only when BOTH hold; it used to run always)
      const am = trimmed.replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,90}?(?:가지|갖|포함하|있|없|이)(?:고|며)),\s*([^,.。\n]{2,90}?(?:있을|없을|이하일|이상일|일|가질|포함할|있었을|했을|기술되어\s*있을)\s*때),\s*(.*)$/s);
      if (am && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
        const aUn = (x) => x.replace(/\uE000/g, '.');
        const c1 = aUn(am[1]).replace(/있고$/, ' 있다면').replace(/없고$/, ' 없다면').replace(/(?:가지|갖)고$/, ' 가진다면').replace(/포함하고$/, ' 포함한다면').replace(/이고$/, '이라면').replace(/며$/, ' 있다면');
        const t1 = parseConditionText(normCondText(c1).replace(/\s+/g, ' ')), t2 = parseConditionText(normCondText(aUn(am[2])));
        const restA = compileWithCost(aUn(am[3]));
        if (t1 && t2 && restA.length) return [{ op: 'condition', if: { test: async (ctx) => !!(await t1(ctx)) && !!(await t2(ctx)) }, then: restA, else: [] }];
      }
    }
    const wm = trimmed.replace(/경우,/, '때,').replace(/Lv\./g, 'Lv\uE000').match(/^([^,.。\n]{2,80}?(?:있을|없을|이하일|이상일|장일|일|적을|많을|가질|같을|다를|포함할|가지고\s*있을|갖고\s*있을|기술되어\s*있을)\s*때),\s*(.*)$/s);
    if (wm && inner.length && !inner.some(x => x.op === 'condition' || x.op === 'setMemoryIfLE' || x.op === 'oppMayPay')) {
      const wUn = (x) => x.replace(//g, '.');
      const cn = normCondText(wUn(wm[1]));
      const rest = compileWithCostPer(wUn(wm[2]));
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
  // "<조건>라면, <효과>. 그 후, 《세이브》." — the condition belongs to the first sentence only; the trailing 《세이브》 sentence is unconditional (BT19-020)
  // (slice-4 r2, Q4706/4707/4713/4725/4736/4764/4942 …: EVERY "그 후, …" sentence after the condition is processed even when the condition is not met, unless it refers back to the first sentence's result)
  const svm = cm[2].match(/^(.*?[.。])\s*(?:(?:그\s*후|또한),?\s*)([≪《]\s*세이브\s*[≫》])\s*[.。]?\s*$/s) || ((m) => (m && !thenTailRefsPrev(m[2]) ? m : null))(cm[2].match(/^(.*?[.。])\s*그\s*후,?\s*([^]+)$/));
  const rest = compileWithCostPer(svm ? svm[1] : cm[2]);
  if (!rest.length) return [];
  return [{ op: 'condition', if: { test }, then: rest, else: [] }, ...(svm ? compileToScript(svm[2]) : [])];
}

// w4 (Q2015/2053/2202): a "그 후, …" tail after an unmet condition still runs unless it refers back to the FIRST sentence's result. "그 디지몬/그 카드/그 중/그 수" only
// count as a back-reference when they appear before the tail introduces its own noun ("자신의 디지몬 1마리는 《속공》을 얻고, 그 디지몬으로 …" is intra-sentence); "이 효과로"/"선택한" always do.
function thenTailRefsPrev(tail) {
  if (/이\s*효과로|선택한/.test(tail)) return true;
  const m = tail.match(/그\s*디지몬|그\s*카드|그\s*중|그\s*수/); if (!m) return false;
  return !/(?:\d+|한)\s*(?:마리|장|명|체)|전부|모두/.test(tail.slice(0, m.index));
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

const IGNORABLE_SENTENCE = /^(?:(?:어셈블리|디지크로스)\s*-\s*\d+\s*[:：]|.*[《≪]딜레이[》≫]\s*\.?$|[《≪]머티리얼\s*세이브|나머지는|남은\s*카드(?:는|를)|오픈한\s*카드는|그\s*중|그중|그렇게\s*했을\s*때|이하의\s*효과|·|〈룰〉|〔[^〕]+〕$|그\s*디지몬이\s*(?:가진|가지는|갖는)\s*진화원은\s*파기한다)/; // (the sources of a Digimon that leaves the battle area are trashed by the leave itself)

export function droppedSentences(text) {
  const sents = splitSentences(text.replace(/[〈<]룰[〉>].*$/s, ''));
  if (sents.length < 2) return [];
  const sig = (x) => JSON.stringify(x, (k, v) => (typeof v === 'function' ? '<fn>' : v)); // conditions are closures: count their presence (a condition sentence that vanished changes the signature)
  const base = sig(compileToScript(text));
  if (base === '[]') return [];
  const dropped = [];
  for (let i = 0; i < sents.length; i++) {
    const plain = sents[i].replace(/\([^()]*\)/g, '').replace(/[.。]\s*$/, '').trim();
    if (plain.length < 7 || IGNORABLE_SENTENCE.test(plain)) continue;
    // 디지크로스 -N 조건 줄(S.parseDigiXros가 처리) / 키워드 나열 줄(《돌진》《관통》, 《오버클럭…》)은 효과 문장이 아님
    if (/^디지크로스\s*-\d+\s*[:：]/.test(plain) || /^(?:《[^》]*(?:《[^》]*》)?[^》]*》\s*)+$/.test(plain.replace(/[（(][^）)]*[）)]/g, '').trim())) continue;
    const without = sents.filter((_, j) => j !== i).join(' ');
    if (sig(compileToScript(without)) === base) dropped.push(sents[i].trim());
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
    return ctx.state.players[ctx.self].hand.length >= cond.handSizeGE && (!cond.hasTamer || ctx.state.players[ctx.self].battle.some(s => ctx.S.card(s.cardId).category === 'tamer')); // b10: EX1-021 {handSizeGE, hasTamer} — the tamer half was ignored
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
// 16-17 ≪딜레이≫ on an event-triggered placed Option that has no bespoke script: the watcher/turn-start path queues only the trigger sentence
// ("《딜레이》."), so the bullet effect ("·…") — printed on the following line(s) — is fetched from the card text here.
// Returns { script, gate } (gate = the leading 있다면/없다면 condition, evaluated BEFORE the card is discarded) or null when the text is no delay effect.
export function delayBulletPlan(S, cardId, tags, text) {
  const DL = /[≪《]\s*딜레이\s*[≫》](?:\s*\([^()]*\))?\.?/;
  const t = String(text || '').trim();
  if (!DL.test(t)) return null;
  let norm;
  if (/^[≪《]\s*딜레이\s*[≫》](?:\s*\([^()]*\))?\.?$/.test(t)) {
    const c = S.card(cardId);
    const seg = c && S.parseEffectSegments(c.effectKo).segments.find(sg => sg.tags.join('/') === tags.join('/') && DL.test(sg.body));
    if (!seg) return null;
    const lines = seg.body.split(/\r?\n/).slice(1).map(x => x.trim()).filter(Boolean);
    if (!lines.length) return null;
    norm = lines.join(' ').replace(/^·\s*/, '');
  } else {
    norm = t.replace(DL, '').replace(/\r?\n\s*·?\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const own = CARD_SCRIPTS[`${cardId}::딜레이`]; // per-card bullet script (shard19 …): runs AFTER the option was discarded, never re-discards
  const script = own || compileToScript(norm);
  const gate = !own && script[0] && script[0].op === 'condition' ? script[0].if : null;
  return { script: gate ? [...(script[0].then || []), ...script.slice(1)] : script, gate, text: norm }; // (the gate was already checked before discarding: run only what is behind it)
}
export async function delayGateOk(plan, ctx) { return !plan.gate || !!(await evalCondition(plan.gate, ctx)); }
// rule-oracle (LM-003 / EX5-029 / BT15-064 …): a card printing an OWN 【tag】 effect and a DIFFERENT INHERITED (진화원) effect under the same 【tag】 has ONE bare "ID::tag"
// script, authored for the own text — the inherited pending (trigger.inherited) must not run it. True when `text` is that inherited segment.
const INH_COLLIDE = new Map();
function inheritedCollides(cardId, tags, text) {
  const key = cardId + '|' + tags[0] + '|' + text;
  let r = INH_COLLIDE.get(key);
  if (r !== undefined) return r;
  r = false;
  try {
    const c = ALL_CARDS[cardId];
    if (c && c.effectKo && c.inheritedKo) {
      const norm = (x) => String(x).replace(/\([^()]*\)/g, '').replace(/\s+/g, '').replace(/^[\[〔]턴에?\d*회[\]〕]/, '').replace(/[.。]\s*$/, '');
      const t = norm(text);
      const own = parseSegs(c.effectKo).segments.filter((x) => x.tags[0] === tags[0]);
      const inh = parseSegs(c.inheritedKo).segments.filter((x) => x.tags[0] === tags[0]);
      r = own.length > 0 && inh.some((x) => norm(x.body) === t) && !own.some((x) => norm(x.body) === t);
    }
  } catch (e) { r = false; }
  INH_COLLIDE.set(key, r);
  return r;
}
export function lookupCardSpecific(cardId, tags, text, inherited = false) {
  if (typeof cardId === 'string' && cardId.includes('~')) cardId = cardId.split('~')[0]; // synthetic "<id>~<tag>" cards (effects gained from an evolution source, EX10-059) run the source card's own scripts
  const key = `${cardId}::${tags[0]}`;
  if (text != null && atIndex()[key]) { const hit = atIndex()[key].find(([needle]) => text.includes(needle)); if (hit) return hit[1]; }
  if (inherited && text != null && (CARD_SCRIPTS[key] || CARD_SPECIFIC[key]) && inheritedCollides(cardId, tags, text)) return null; // -> the generic compiler reads the inherited text itself
  return CARD_SCRIPTS[key] || CARD_SPECIFIC[key] || (String(tags[0]).startsWith('__') ? CARD_SCRIPTS['*::' + tags[0]] || CARD_SPECIFIC['*::' + tags[0]] || null : null);
}

// helpers for per-card shard scripts (src/cards/shard1X.js): compile a printed sentence / evaluate a printed condition at run time
// main.js: a 〔턴에 1회〕 effect whose whole script is one leading condition ("자신의 패가 8장 이상일 때, …") that is unmet is not activated, so it must not use up the once-per-turn count
export const evalConditionPublic = (cond, ctx) => evalCondition(cond, ctx);
// 15-7-1 / 15-14-1 (unresolved-b Q3): an effect whose only interaction was a CANCELLED pick/confirm and that changed nothing was never activated, so its 〔턴에 N회〕 use
// must be given back. onceGuard(ctx) wraps ctx.choose and fingerprints the game state; guard.noop() is true when a choice was cancelled AND the state is unchanged.
const _GUARD_SKIP = new Set(['log', 'fxHistory', 'fxQueue', 'pending', 'pendingVanishFlash', 'ownedIds', 'turnEffectUses', 'art', 'contTs', 'hookEvt', 'attackCtx']);
const _GUARD_SKIP_STRICT = new Set(['log', 'fxHistory', 'fxQueue', 'pending', 'pendingVanishFlash', 'ownedIds', 'turnEffectUses', 'art', 'contTs', 'hookEvt', 'attackCtx', '_contSig', '_prGrp', '_qaAns']);
function _stateFp(state, strict) {
  const seen = new WeakSet(); const skip = strict ? _GUARD_SKIP_STRICT : _GUARD_SKIP;
  try { return JSON.stringify(state, function (k, v) { if (skip.has(k) || (typeof k === 'string' && k[0] === '_' && (!strict || this === state))) return undefined; if (v && typeof v === 'object') { if (seen.has(v)) return '~'; seen.add(v); } return v; }); } catch (e) { return null; }
}
// open-d (1): an effect that NEVER asked a question (no legal target / unmet condition / nothing to do) and left the state completely untouched (incl. private "_" flags,
// no new pending note) was never activated either (15-7-1 / 15-14-1), so its 〔턴에 N회〕 use is given back as well.
export function onceGuard(ctx) {
  const orig = ctx.choose; let cancelled = false, asked = 0;
  ctx.choose = async (k, o) => { asked++; const r = await orig(k, o); if (r == null || r === false || (Array.isArray(r) && !r.length)) cancelled = true; return r; };
  const before = _stateFp(ctx.state), beforeStrict = _stateFp(ctx.state, true), pend0 = (ctx.state.pending || []).length;
  return { noop: () => {
    if (before == null) return false;
    if (cancelled) return _stateFp(ctx.state) === before;
    if (asked || beforeStrict == null || ctx._manualNote || (ctx.state.pending || []).length !== pend0) return false;
    const _a = _stateFp(ctx.state, true);
    return _a === beforeStrict;
  } };
}
export const FX_HELPERS = { compileSecurityLook, prepText, strictCardFilter, xrosOptsFor, effectPlayPlan, parseConditionText, condTestFor, parseCardFilter, matchesFilter, compileToScript, perCount };

// verify-reveal-1: re-reads the whole "덱 위에서부터 N장 오픈한다. 그중 … " text of a compiled revealTop and fills in what the first pass can't:
//   per-clause destinations (패에 추가 / 파기 / 코스트 없이 등장 / 이 디지몬(으로부터) 진화 / 코스트 없이 사용 / 진화원·테이머 아래 / 시큐리티 위), 「전부」, "상대 디지몬 1마리마다",
//   "그 카드가 <조건>일 때 …", and where the rest goes (파기 / 패에 추가 / 덱 위·아래). A clause it can't read leaves the first-pass result untouched.
function refineRevealTop(t, ins) {
  const T = t.replace(/\([^()]*\)/g, '');
  const sents = splitSentences(T);
  if (/상대\s*디지몬\s*1\s*마리마다,?\s*자신의\s*덱/.test(T)) ins.nMulOpp = true;
  const rIdx = sents.findIndex(x => /(?:남은\s*카드|나머지|오픈한\s*카드)(?:는|를|을)/.test(x));
  if (rIdx >= 0) {
    const r = sents[rIdx];
    ins.restTo = /파기한다/.test(r) ? 'trash' : /패에\s*추가한다/.test(r) ? 'hand' : /덱(?:\s*의)?\s*위(?:\s*또는|나)\s*(?:덱(?:\s*의)?\s*)?아래/.test(r) ? 'either' : /덱(?:\s*의)?\s*위(?:로|에)/.test(r) ? 'top' : 'bottom';
  }
  const P = sents.find(x => /그\s*중|그\s*카드가/.test(x));
  if (!P || /^자신의\s*디지몬\s*1\s*마리는/.test(P.trim()) || /합계/.test(P)) return;
  const noTrig = /이\s*효과로\s*등장(?:시킨|한)\s*디지몬의\s*【등장\s*시】\s*효과는\s*발휘하지\s*않는다/.test(T);
  const mkGroups = (desc) => {
    desc = desc.trim().replace(/^[,\s]+/, '');
    if (/전부$/.test(desc)) { const d = desc.replace(/\s*전부$/, ''); const fl = criterionFilter(d); return [{ ...(Object.keys(fl).length ? { filter: fl } : {}), max: 99, all: true, label: d }]; }
    if (/^\d+\s*장(?:까지)?씩?$/.test(desc)) return [{ max: Number(desc.match(/\d+/)[0]), label: '카드' }];
    return parsePickGroups(desc);
  };
  const gs = [];
  let mm;
  if ((mm = P.match(/^그\s*카드가\s*(.*?)\s*(?:이)?(?:라면|다면|일\s*때|일\s*경우),?\s*(.*?)[.。]?$/s))) { // top-1 reveal: only a matching card may be taken / played
    const fl = criterionFilter(mm[1]);
    const play = /등장/.test(mm[2]);
    if (!play && !/패(?:에|로)\s*추가/.test(mm[2])) return;
    gs.push({ ...(Object.keys(fl).length ? { filter: fl } : {}), max: 1, dest: play ? 'play' : 'hand', label: mm[1], ...(play ? { rested: /레스트\s*상태로/.test(mm[2]), noTriggers: noTrig } : {}) });
  } else {
    const body = P.replace(/^.*?그\s*중(?:에서|에)?\s*/, '').replace(/[.。]\s*$/, '').replace(/(?:을|를)\s*전부\s+(?=파기|패에)/g, ' 전부를 '); // "테이머 카드를 전부 파기한다" -> "… 전부를 파기한다"
    const clauses = body.split(/(?<=추가한다|추가하고|파기한다|파기하고|등장시킬\s*수\s*있다|등장시킨다|진화할\s*수\s*있다|사용할\s*수\s*있다|놓는다|둔다)\s*,?\s*(?=\S)/).map(x => x.trim()).filter(Boolean);
    for (const c of clauses) {
      let dest, gg, ex = {};
      if ((mm = c.match(/^(.*?)\s*(\d+)\s*장(?:까지)?(?:에|으로|로),?\s*(이\s*디지몬|어택한\s*디지몬|자신의\s*디지몬\s*1\s*마리)(?:에서|으로부터|을|를)?\s*코스트를?\s*지불하지\s*않고\s*진화할\s*수\s*있다$/s))) { dest = 'evolve'; gg = mkGroups(mm[1] + ' ' + mm[2] + '장'); ex = { evoTarget: /^이/.test(mm[3]) ? 'this' : /^어택/.test(mm[3]) ? 'attacker' : 'any' }; }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*패(?:에|로)\s*추가(?:한다|하고)$/s))) { dest = 'hand'; gg = mkGroups(mm[1]); }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*파기(?:한다|하고)$/s))) { dest = 'trash'; gg = mkGroups(mm[1]); }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*,?\s*(레스트\s*상태로\s*)?코스트를?\s*지불하지\s*않고\s*(레스트\s*상태로\s*)?등장(?:시킬\s*수\s*있다|시킨다)$/s))) { dest = 'play'; gg = mkGroups(mm[1]); ex = { rested: !!(mm[2] || mm[3]), noTriggers: noTrig }; }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*코스트를?\s*지불하지\s*않고\s*사용할\s*수\s*있다$/s))) { dest = 'useOption'; gg = mkGroups(mm[1]); }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*이\s*디지몬의\s*진화원\s*아래에\s*놓는다$/s))) { dest = 'sourcesThis'; gg = mkGroups(mm[1]); }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*이\s*테이머\s*아래에\s*놓는다$/s))) { dest = 'tamerUnder'; gg = mkGroups(mm[1]); }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*자신의\s*「([^」]+)」\s*1\s*마리의\s*진화원의\s*가장\s*아래에\s*놓는다$/s))) { dest = 'sourcesOf'; gg = mkGroups(mm[1]); ex = { targetFilter: { exactAny: [mm[2]] } }; }
      else if ((mm = c.match(/^(.*?)\s*(?:을|를)\s*자신의\s*시큐리티\s*위에\s*(?:뒷면으로\s*)?(?:둔다|놓는다)$/s))) { dest = 'security'; gg = mkGroups(mm[1]); ex = { secPos: 'top' }; }
      else return;
      if (!gg) return;
      for (const g of gg) gs.push({ ...g, dest, ...ex });
    }
  }
  if (!gs.length) return;
  const optional = /수\s*있다|장까지/.test(P);
  const pick = { min: 0, max: gs.reduce((a, g) => a + g.max, 0), ...(optional ? { optional: true } : {}) };
  if (gs.length === 1) {
    const { dest, filter, max, all, label, ...ex } = gs[0];
    Object.assign(pick, { max }, filter ? { filter } : {}, dest !== 'hand' ? { action: dest } : {}, all ? { all: true } : {}, ex);
  } else { if (gs.some(g => g.all)) return; pick.groups = gs; }
  if (/상대\s*디지몬\s*1\s*마리마다/.test(P)) pick.maxMulOpp = true;
  ins.pick = pick;
}
