// Shard 6 — bespoke card scripts (BT22 / BT23 / EX10 / P-19x-20x / LM-05x / ST22 …).
//
//  SCRIPTS  { 'CARD-ID::firstTag@needle': [ops] }   one entry per printed segment (needle = substring of the segment text,
//                                                    see lookupCardSpecific in effects.js).
//  OPS      custom ops (prefix s6_) used by those scripts.
//  HOOKS    { 'CARD-ID': [descriptor] }             continuous / replacement / event abilities consumed by state.js
//                                                    (descriptor API documented next to activeHooks in state.js).
//
// The file imports state.js / effects.js (import cycle: only touched inside functions, never at load time).
import * as S from '../state.js';
import { compileToScript, lookupCardSpecific } from '../effects.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ==================================================================== tiny helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDigimon = (id) => C(id).category === 'digimon';
const stackList = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findSt = (state, p, uid) => stackList(state, p).find(s => s.uid === uid) || null;
const ownerOf = (state, st) => ['p1', 'p2'].find(p => stackList(state, p).includes(st)) || null;
const digimonsOf = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const tamersOf = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const srcSt = (ctx) => findSt(ctx.state, ctx.self, ctx.sourceStackUid);
const cnt = (arr, f) => arr.filter(f).length;
const COLOR = { 레드: 'red', 블루: 'blue', 옐로: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };

// "「X」가 기술되어 있는" — name, trait line or printed text mentions X.
function mentions(id, x) {
  const c = C(id);
  return (c.nameKo || '').includes(x) || (c.types || []).some(t => t.includes(x)) || `${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes(x);
}
// Card matcher: every given field must hold; `or:[spec…]` = at least one alternative.
function M(spec = {}) {
  return (id) => {
    const c = C(id), t = c.types || [];
    if (spec.cat && c.category !== spec.cat) return false;
    if (spec.notCat && c.category === spec.notCat) return false;
    if (spec.lv != null && c.level !== spec.lv) return false;
    if (spec.lvMax != null && (c.level ?? 0) > spec.lvMax) return false;
    if (spec.lvMin != null && (c.level ?? 0) < spec.lvMin) return false;
    if (spec.costMax != null && (c.cost ?? 0) > spec.costMax) return false;
    if (spec.dpMax != null && (c.dp ?? 0) > spec.dpMax) return false;
    if (spec.colors && !(c.colors || []).some(x => spec.colors.includes(x))) return false;
    if (spec.nameEq && !spec.nameEq.includes(c.nameKo)) return false;
    if (spec.nameInc && !spec.nameInc.some(x => c.nameKo.includes(x))) return false;
    if (spec.trait && !spec.trait.some(x => t.includes(x))) return false;
    if (spec.traitInc && !spec.traitInc.some(x => t.some(y => y.includes(x)))) return false;
    if (spec.notTrait && spec.notTrait.some(x => t.includes(x))) return false;
    if (spec.mention && !spec.mention.some(x => mentions(id, x))) return false;
    if (spec.or && !spec.or.some(s => M(s)(id))) return false;
    if (spec.fn && !spec.fn(id)) return false;
    return true;
  };
}
const stM = (spec) => { const m = M(spec); return (st) => m(st.cardId); };

// Synchronous yes/no for replacement effects (deleteStack & co. are synchronous): a real dialog in the browser, "yes" elsewhere.
function askSync(msg, def = true) {
  try { if (typeof globalThis.confirm === 'function') return !!globalThis.confirm(msg); } catch (e) { /* ignore */ }
  return def;
}

// ==================================================================== choosing
const confirmFx = async (ctx, who, prompt) => !!(await ctx.choose('confirmEffect', { player: who, prompt }));
async function pickStackOf(ctx, player, stacks, prompt, fxKind) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player, uids: stacks.map(s => s.uid), prompt, ...(fxKind ? { fxKind } : {}) });
  return stacks.find(s => s.uid === uid) || null;
}
async function pickAnySide(ctx, entries, prompt) {
  if (!entries.length) return null;
  return ctx.choose('pickStackAnySide', { entries, prompt });
}
// Index into pl[zone] (or null when nothing eligible / declined).
async function pickZoneCard(ctx, who, zone, pred, prompt) {
  const arr = ctx.state.players[who][zone];
  const idxs = arr.map((id, i) => i).filter(i => pred(arr[i]));
  if (!idxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return i == null ? null : i;
}
// Pick up to `max` entries of an arbitrary id list (sources, revealed lists…). Returns indexes into `ids`.
async function pickFromIds(ctx, who, ids, pred, prompt, max = 1) {
  const eligible = ids.map((id, i) => ({ id, i })).filter(x => pred(x.id));
  if (!eligible.length) return [];
  const r = await ctx.choose('pickFromRevealed', { player: who, revealed: ids, eligible, min: 0, max, prompt });
  return (r || []).slice(0, max);
}

// ==================================================================== board mutators
function placeSources(state, p, st, ids, where = 'bottom') {
  if (!ids.length) return;
  if (where === 'bottom') { st.sources.unshift(...ids); if (S.fdCount(st) || st.s5fd) { /* face-down block stays the bottom block; placed cards are face-up unless caller says */ } }
  else st.sources.push(...ids);
  S.recomputeStackGrants(st);
  S.log(state, `${p} ${ids.map(id => C(id).nameKo).join(', ')} → ${C(st.cardId).nameKo} 진화원 ${where === 'bottom' ? '아래' : '위'}에 놓음`);
}
// Face-down placement at the bottom (the face-down block grows by ids.length).
function placeSourcesFaceDown(state, p, st, ids) {
  const fd = S.fdCount(st);
  st.sources.unshift(...ids);
  st.s5fd = fd + ids.length;
  S.recomputeStackGrants(st);
  S.log(state, `${p} ${ids.length}장을 ${C(st.cardId).nameKo} 진화원 아래에 뒷면으로 놓음`);
}
function takeFrom(state, p, zone, idx) { return state.players[p][zone].splice(idx, 1)[0]; }
// Trash the given source indexes of a stack (keeps the face-down bookkeeping right). Returns removed ids.
function trashSourceIdx(state, p, st, idxs) {
  return S.trashEvoSources(state, p, st.uid, idxs.length, 'bottom', idxs);
}
// Detach a whole stack from the battle area without "deleting" it: returns the top card id (sources/links -> `to`).
function detachStack(state, p, st, to = 'trash') {
  const pl = state.players[p];
  const i = pl.battle.indexOf(st);
  if (i === -1) return null;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map(l => l.cardId);
  pl[to].push(...st.sources, ...linkIds);
  for (const id of [...st.sources, st.cardId]) S.applyOverflowIfAny(state, p, id);
  return st.cardId;
}
// Expiry turn number for "…상대의 턴 종료까지" when resolved by `who` (turn numbers increase per player-turn).
function untilOppTurnEnd(state, who) { return state.activePlayer === who ? state.turnNumber + 1 : state.turnNumber; }

// ==================================================================== evolution helpers
// Cost printed on the target for evolving `src` (a stack) into `tgtId`; null = no printed condition is satisfied.
function printedEvoCost(ctx, src, tgtId) {
  const sc = C(src.cardId);
  if (sc.category === 'tamer') {
    // Tamer -> Digimon: "〔진화〕 … 「<tamer name>」 : 코스트 N" (optionally gated by "자신의 시큐리티가 N장 이하인 동안")
    for (const line of (C(tgtId).effectKo || '').split('\n')) {
      if (!line.includes('〔진화〕') && !line.includes('/')) continue;
      for (const part of line.replace(/〔진화〕/g, '').split('/')) {
        const m = part.match(/(?:자신의\s*시큐리티가\s*(\d+)\s*장\s*이하인\s*동안,?\s*)?「([^」]+)」\s*:\s*코스트\s*(\d+)/);
        if (m && m[2] === sc.nameKo && (!m[1] || ctx.state.players[ctx.self].security.length <= Number(m[1]))) return Number(m[3]);
      }
    }
    return null;
  }
  const chk = ctx.E.canEvolveAny(src.cardId, tgtId, src.extraColors || [], S.evolveTargetRestriction(ctx.state, ctx.self, src));
  return chk.ok ? chk.cost : null;
}
const costFrom = (printed, mode) => {
  if (!mode || mode.mode === 'normal') return printed;
  if (mode.mode === 'free') return 0;
  if (mode.mode === 'fixed') return mode.n;
  if (mode.mode === 'discount') return Math.max(0, printed - mode.n);
  return printed;
};
// Generic "<subject> into a card from <zones>" effect evolution. Returns true when an evolution happened.
//   subject: 'this' | { pred(stack)->bool, other:true } ;  zones: ['hand'|'trash'] ;  card: spec ;  cost: {mode,n}
//   ignoreCond: skip the printed evolution condition (cost then = cost.n for 'fixed' or the printed/normal cost)
async function evolveEffect(ctx, o) {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ cat: 'digimon', ...(o.card || {}) });
  let stacks;
  if (o.subject === 'this') { const s = srcSt(ctx); stacks = s ? [s] : []; }
  else stacks = digimonsOf(state, me).filter(s => (!o.subject.other || s.uid !== ctx.sourceStackUid) && (!o.subject.pred || o.subject.pred(s)));
  const eligibleFor = (st, zone) => pl[zone].map((id, i) => i).filter(i => {
    const id = pl[zone][i];
    if (!cm(id)) return false;
    if (o.ignoreCond) return true;
    return printedEvoCost(ctx, st, id) != null;
  });
  stacks = stacks.filter(st => (o.zones || ['hand']).some(z => eligibleFor(st, z).length));
  if (o.dry) return stacks.length > 0;
  if (!stacks.length) { S.log(state, `${me} 진화시킬 수 있는 조합이 없음`); return false; }
  const st = stacks.length === 1 && o.subject === 'this' ? stacks[0] : await pickStackOf(ctx, me, stacks, o.prompt || '진화시킬 디지몬 선택');
  if (!st) return false;
  let zone = null;
  const zs = (o.zones || ['hand']).filter(z => eligibleFor(st, z).length);
  if (zs.length === 1) zone = zs[0];
  else if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '진화할 카드를 가져올 곳', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return false; zone = zs[k]; }
  if (!zone) return false;
  const idx = await ctx.choose('pickFromZoneIndex', { player: me, zone, eligibleIdxs: eligibleFor(st, zone), prompt: `${zone === 'hand' ? '패' : '트래시'}에서 진화할 카드 선택` });
  if (idx == null) return false;
  const id = pl[zone][idx];
  let printed = printedEvoCost(ctx, st, id);
  if (printed == null) printed = C(id).evoNormal?.cost ?? 0;
  const cost = costFrom(printed, o.cost);
  if (zone === 'trash') pl.trash.splice(idx, 1);
  S.digivolve(state, me, st.uid, id, cost, zone === 'hand' ? 'hand' : 'trash');
  return true;
}

// ==================================================================== running other cards' segments
// Run one segment (by tag substring) of `cardId` as an effect of `stack` (ctx source stack stays the holder).
function scriptOfSegment(cardId, seg) {
  return lookupCardSpecific(cardId, seg.tags, seg.body) || compileToScript(seg.body);
}
async function runSegmentsOf(ctx, cardId, tagPart, R, label) {
  const segs = S.parseEffectSegments(C(cardId).effectKo || '').segments.filter(sg => sg.tags.some(t => t.includes(tagPart)) && !/^[≪《]\s*딜레이/.test(sg.body));
  const usable = segs.filter(sg => scriptOfSegment(cardId, sg).length);
  if (!usable.length) { S.log(ctx.state, `${C(cardId).nameKo}의 【${tagPart}】 효과를 자동 처리할 수 없음 (수동 확인)`); return false; }
  let seg = usable[0];
  if (usable.length > 1) {
    const k = await ctx.choose('multipleChoice', { prompt: `${label || ''} 발휘할 【${tagPart}】 효과 1개 선택`, options: usable.map(sg => sg.body.replace(/\s+/g, ' ').slice(0, 60)) });
    if (k == null) return false;
    seg = usable[k];
  }
  const sub = { ...ctx, sourceCardId: cardId };
  await R.runScript(scriptOfSegment(cardId, seg), sub);
  return true;
}

// ==================================================================== registration helpers
function SC(id, tag, needle, ops) {
  const key = `${id}::${tag}@${needle}`;
  if (SCRIPTS[key]) throw new Error('shard6 duplicate script ' + key);
  SCRIPTS[key] = ops;
}
function HK(id, d) { (HOOKS[id] ||= []).push(d); }
const RUN = (fn) => [{ op: 's6_run', fn }];
OPS.s6_run = async (instr, ctx, R) => { await instr.fn(ctx, R); };

// ==================================================================== more helpers
function takeSource(state, st, idx) {
  const fd = S.fdCount(st);
  const [id] = st.sources.splice(idx, 1);
  if (fd && idx < fd) st.s5fd = fd - 1;
  S.recomputeStackGrants(st);
  return id;
}
// Face-up (앞면) security cards of a player, in security order.
function faceUpIds(pl) {
  const out = [];
  for (const id of new Set(pl.security)) {
    const up = Math.min((pl.secUp && pl.secUp[id]) || 0, cnt(pl.security, x => x === id));
    for (let i = 0; i < up; i++) out.push(id);
  }
  return out;
}
// Choose a card from hand/trash (one of `zones`) matching `spec` and play it for free.
async function playFreeChoose(ctx, o) {
  const { state } = ctx, me = o.who || ctx.self, pl = state.players[me];
  const cm = M({ cat: 'digimon', ...(o.card || {}) });
  const ok = (id) => cm(id) && (!o.filter || o.filter(id));
  const zs = (o.zones || ['hand']).filter(z => pl[z].some(ok));
  if (!zs.length) return null;
  let zone = zs[0];
  if (zs.length > 1) {
    const k = await ctx.choose('multipleChoice', { prompt: '등장시킬 카드를 가져올 곳', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) });
    if (k == null) return null;
    zone = zs[k];
  }
  const idx = await pickZoneCard(ctx, me, zone, ok, o.prompt || '코스트를 지불하지 않고 등장시킬 카드 선택');
  if (idx == null) return null;
  return S.playFreeFromZone(state, me, zone, idx, { rested: !!o.rested });
}
// Optional confirm at the start of an effect that opens with a cost the player might not want to pay.
const optional = (ctx, who, text) => confirmFx(ctx, who || ctx.self, `${text} — 발동할까요?`);

// ---- Link Cards ("이 디지몬에게 코스트를 지불하지 않고 링크할 수 있다")
function linkInfo(id) {
  const m = (C(id).inheritedKo || '').match(/링크\s*(?:[:：]|〉)\s*(.+?)\s*[:：]\s*코스트\s*(\d+)/);
  return m ? { cond: m[1].trim(), cost: Number(m[2]) } : null;
}
function canLinkTo(host, id) {
  const li = linkInfo(id);
  if (!li) return false;
  const pr = S.cardDescPredicate(li.cond);
  return !pr || pr(C(host.cardId));
}
async function linkFree(ctx, host, o) {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ cat: 'digimon', ...(o.card || {}) });
  const ok = (id) => cm(id) && canLinkTo(host, id);
  const zs = (o.zones || ['hand']).filter(z => (z === 'sources' ? host.sources : pl[z]).some(ok));
  if (!zs.length) { S.log(state, `${me} 링크할 수 있는 카드가 없음`); return false; }
  let zone = zs[0];
  if (zs.length > 1) {
    const k = await ctx.choose('multipleChoice', { prompt: '링크할 카드를 가져올 곳', options: zs.map(z => ({ hand: '패', trash: '트래시', sources: '진화원' }[z])) });
    if (k == null) return false;
    zone = zs[k];
  }
  let id, srcKind = 'other';
  if (zone === 'sources') {
    const r = await pickFromIds(ctx, me, host.sources, ok, '링크할 진화원 카드 선택');
    if (!r.length) return false;
    id = takeSource(state, host, r[0]);
  } else {
    const idx = await pickZoneCard(ctx, me, zone, ok, `${zone === 'hand' ? '패' : '트래시'}에서 링크할 카드 선택`);
    if (idx == null) return false;
    id = pl[zone][idx];
    if (zone === 'trash') pl.trash.splice(idx, 1); else srcKind = 'hand';
  }
  const li = linkInfo(id);
  const cost = o.costMinus ? Math.max(0, li.cost - o.costMinus) : 0;
  S.linkCardTo(state, me, host.uid, id, id, cost, srcKind);
  return true;
}
// Discard one link card of `st` (cost / effect); fires the "링크 카드가 효과로 파기되었을 때" watchers.
function discardLinkCard(state, p, st, idx = null) {
  if (!st || !st.linkCards || !st.linkCards.length) return null;
  const [lc] = st.linkCards.splice(idx == null ? st.linkCards.length - 1 : idx, 1);
  state.players[p].trash.push(lc.cardId);
  S.recomputeStackGrants(st);
  S.log(state, `${p} ${C(st.cardId).nameKo}의 링크 카드 ${C(lc.cardId).nameKo} 파기`);
  S.emitGameEvent(state, 'linkDiscarded', { owner: p, stack: st, cause: 'effect', cardId: lc.cardId });
  return lc.cardId;
}
async function linkCostDiscard(ctx, st) {
  if (!st || !(st.linkCards || []).length) return false;
  return discardLinkCard(ctx.state, ctx.self, st) != null;
}

// ---- app fusion ("자신의 디지몬 1마리를 패의 디지몬 카드로 어플 합체할 수 있다")
function appFusionInfo(id) {
  const line = (C(id).effectKo || '').split('\n').find(l => l.includes('〔어플 합체〕'));
  if (!line) return null;
  const names = [...line.matchAll(/「([^」]+)」/g)].map(m => m[1]);
  return names.length ? { names } : null;
}
// A stack can app-fuse into `cardId` when its top card and one link card are two different kinds among the printed names.
function fusionLink(st, cardId) {
  const inf = appFusionInfo(cardId);
  if (!inf) return -1;
  const top = C(st.cardId).nameKo;
  if (!inf.names.includes(top)) return -1;
  return (st.linkCards || []).findIndex(l => l.cardId && inf.names.includes(C(l.cardId).nameKo) && C(l.cardId).nameKo !== top);
}
async function appFusion(ctx) {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const stacks = digimonsOf(state, me).filter(st => pl.hand.some(id => isDigimon(id) && fusionLink(st, id) >= 0));
  if (!stacks.length) { S.log(state, `${me} 어플 합체할 수 있는 조합이 없음`); return false; }
  const st = await pickStackOf(ctx, me, stacks, '어플 합체할 디지몬 선택');
  if (!st) return false;
  const idx = await pickZoneCard(ctx, me, 'hand', (id) => isDigimon(id) && fusionLink(st, id) >= 0, '어플 합체할 패의 카드 선택');
  if (idx == null) return false;
  const id = pl.hand[idx];
  const li = fusionLink(st, id);
  const [lc] = st.linkCards.splice(li, 1);
  pl.hand.splice(idx, 1);
  // the link card is stacked on top of the host, the fusion card goes on top of everything (cost 0)
  S._s4.discardLinkCardsOnNewCard(state, me, st);
  st.sources.push(st.cardId, lc.cardId);
  st.cardId = id;
  S.log(state, `${me} 어플 합체: ${C(st.sources[st.sources.length - 2]).nameKo}+${C(lc.cardId).nameKo} → ${C(id).nameKo}`);
  S.drawCards(state, me, 1);
  S.recomputeStackGrants(st);
  if (state.players[me].battle.includes(st)) { S.queueTriggersForStack(state, me, st, 'digivolve'); S.emitGameEvent(state, 'digivolve', { owner: me, stack: st, cause: 'effect' }); }
  return true;
}

// ---- security face-up helpers
function secHasFaceUpColor(state, p, color) { return faceUpIds(state.players[p]).some(id => (C(id).colors || []).includes(color)); }

// ==================================================================== SECTION 1: [패]【메인】 "…이 카드로 …진화시킨다" / "지불하는 코스트 -5 하여 등장"
function handEvolveMain({ need, subject, cost, under }) {
  return RUN(async (ctx) => {
    const { state } = ctx, me = ctx.self, pl = state.players[me], cardId = ctx.sourceCardId;
    if (!pl.hand.includes(cardId)) { S.log(state, `${C(cardId).nameKo}: 패에 없어 발휘할 수 없음`); return; }
    if (!pl.battle.some(s => C(s.cardId).nameKo === need)) { S.log(state, `${C(cardId).nameKo}: 자신의 「${need}」가 없어 발휘할 수 없음`); return; }
    const cands = digimonsOf(state, me).filter(s => C(s.cardId).nameKo === subject);
    if (!cands.length) { S.log(state, `${C(cardId).nameKo}: 자신의 「${subject}」가 없어 발휘할 수 없음`); return; }
    let underIdx = -1;
    if (under) {
      underIdx = pl.trash.findIndex(id => C(id).nameKo === under);
      if (underIdx === -1) { S.log(state, `${C(cardId).nameKo}: 트래시에 「${under}」가 없어 발휘할 수 없음`); return; }
    }
    const st = cands.length === 1 ? cands[0] : await pickStackOf(ctx, me, cands, `「${subject}」 선택`);
    if (!st) return;
    if (under) { const [id] = pl.trash.splice(underIdx, 1); placeSources(state, me, st, [id], 'bottom'); }
    S.digivolve(state, me, st.uid, cardId, cost, 'hand');
  });
}
SC('BT22-013', '메인', '자신의 「시라미네 노키아」가 있다면', handEvolveMain({ need: '시라미네 노키아', subject: '아구몬', cost: 6 }));
SC('BT22-026', '메인', '자신의 「시라미네 노키아」가 있다면', handEvolveMain({ need: '시라미네 노키아', subject: '파피몬', cost: 6 }));
SC('BT22-024', '메인', '자신의 「야오 친란」이 있다면', handEvolveMain({ need: '야오 친란', subject: '산호몬', cost: 3, under: '쉘몬' }));
SC('BT22-036', '메인', '자신의 「키노사키 아리사」가 있다면', handEvolveMain({ need: '키노사키 아리사', subject: '슈몬', cost: 3, under: '슈슈몬' }));
SC('EX10-032', '메인', '자신의 「클로즈」가 있다면', handEvolveMain({ need: '클로즈', subject: '샌드리자몬', cost: 3, under: '랜드라몬' }));
SC('BT23-065', '메인', '자신의 「바이올렛 인부츠」가 있다면', handEvolveMain({ need: '바이올렛 인부츠', subject: '아이고스몬', cost: 3, under: '고스몬' }));
SC('BT24-016', '메인', '자신의 「오웬 드레드노트」가 있다면', handEvolveMain({ need: '오웬 드레드노트', subject: '엘리자몬', cost: 3, under: '디메트로몬' }));

// 어둠의 4천왕: play from hand for cost -5, destroyed at end of turn; 소멸 시 → face-up under security; 시큐리티 (앞면) → free play
const FOUR_NEEDLE = '「어둠의 4천왕」이 기술되어 있는 디지몬 이외의 자신의 디지몬이 없다면';
const fourKingsPlay = () => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], cardId = ctx.sourceCardId;
  const hi = pl.hand.indexOf(cardId);
  if (hi === -1) { S.log(state, `${C(cardId).nameKo}: 패에 없어 등장시킬 수 없음`); return; }
  if (digimonsOf(state, me).some(s => !mentions(s.cardId, '어둠의 4천왕'))) { S.log(state, `${C(cardId).nameKo}: 「어둠의 4천왕」이 기술된 디지몬 이외의 디지몬이 있어 등장시킬 수 없음`); return; }
  const cost = Math.max(0, (C(cardId).cost || 0) - 5);
  S.spendMemory(state, cost);
  const st = S.playDigimonFresh(state, me, hi);
  if (!st) return;
  const uid = st.uid;
  S.scheduleEndOfTurn(state, () => { if (findSt(state, me, uid)) S.deleteStack(state, me, uid, 'trash', 'ownEffect'); });
});
const fourKingsDeleted = (color) => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], cardId = ctx.sourceCardId;
  if (secHasFaceUpColor(state, me, color)) { S.log(state, `${me} 시큐리티에 ${color} 앞면 카드가 있어 시큐리티 아래에 놓지 않음`); return; }
  const i = pl.trash.lastIndexOf(cardId);
  if (i === -1) return;
  pl.trash.splice(i, 1);
  S.secAddFaceUp(state, me, cardId, 'bottom');
  S.log(state, `${me} ${C(cardId).nameKo}을(를) 시큐리티 아래에 앞면으로 놓음`);
});
const fourKingsSecurity = () => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const r = state.secReveal;
  if (!r || r.cardId !== ctx.sourceCardId || !r.up) { S.log(state, `${C(ctx.sourceCardId).nameKo}: 앞면이 아니어서 효과를 발휘하지 않음`); return; }
  await playFreeChoose(ctx, { zones: ['hand', 'trash'], card: { lvMax: 5, mention: ['어둠의 4천왕'] } });
});
for (const [id, color] of [['EX10-012', 'blue'], ['EX10-020', 'green'], ['EX10-035', 'black'], ['EX10-057', 'purple']]) {
  SC(id, '메인', FOUR_NEEDLE, fourKingsPlay());
  SC(id, '소멸 시', '앞면의 카드가 없다면', fourKingsDeleted(color));
  SC(id, '시큐리티', '이 카드가 앞면이었다면', fourKingsSecurity());
}

// ==================================================================== SECTION 2: triggered effects (등장/진화/어택 …)
// DP change with an explicit expiry turn (S.modifyDP's 'opponentTurn' lasts one turn too long for opponent-side stacks).
function dpMod(state, p, st, amount, until) {
  S.modifyDP(state, p, st.uid, amount, 'turn');
  if (typeof until === 'number' && st.dpExpiry !== 'permanent' && until > st.dpExpiry) st.dpExpiry = until;
}
const oppDigimonDP = (fnAmount, fx = 'dpDown') => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const n = fnAmount(ctx);
  if (!n) return;
  const st = await pickStackOf(ctx, o, digimonsOf(state, o), 'DP를 낮출 상대 디지몬 선택', fx);
  if (st) dpMod(state, o, st, n, state.turnNumber);
});

// #2 P-191
SC('P-191', '등장 시', '올림포스 12신', RUN(async (ctx, R) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const n = cnt(digimonsOf(state, me), stM({ trait: ['올림포스 12신'] }));
  const st = await pickStackOf(ctx, o, digimonsOf(state, o), 'DP를 낮출 상대 디지몬 선택', 'dpDown');
  if (st && n > 0) dpMod(state, o, st, -4000 * n, state.turnNumber);
  await R.runScript([{ op: 'destroySum', stat: 'dp', limit: 7000 }], ctx);
}));

// #0 EX9-073
SC('EX9-073', '등장 시', '놓은 카드의 【등장 시】 효과 1개를', RUN(async (ctx, R) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  if (!st) return;
  const cm = M({ lv: 5, trait: ['사이보그형', 'Ver.5'] });
  const zs = ['hand', 'trash'].filter(z => pl[z].some(cm));
  if (!zs.length || !(await optional(ctx, me, 'EX9-073: 패/트래시의 카드를 진화원 위에 놓고 【등장 시】 효과를 발휘'))) return;
  let zone = zs[0];
  if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '가져올 곳', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zs[k]; }
  const idx = await pickZoneCard(ctx, me, zone, cm, '진화원 위에 놓을 카드 선택');
  if (idx == null) return;
  const id = takeFrom(state, me, zone, idx);
  placeSources(state, me, st, [id], 'top');
  await runSegmentsOf(ctx, id, '등장 시', R, C(id).nameKo);
}));

// #7 BT22-016 inh 링크 시
SC('BT22-016', '링크 시', '진화원을 선택해서 1장 파기한다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const st = await pickStackOf(ctx, o, digimonsOf(state, o).filter(s => s.sources.length), '진화원을 파기할 상대 디지몬 선택', 'other');
  if (!st) return;
  const r = await pickFromIds(ctx, me, st.sources, () => true, '파기할 진화원 1장 선택');
  if (r.length) S.trashEvoSources(state, o, st.uid, 1, 'bottom', [r[0]]);
}));

// #8 BT22-021
SC('BT22-021', '등장 시', '진화원 아래에 놓을 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const cm = M({ cat: 'digimon', lvMax: 5, traitInc: ['수생'] });
  const idx = await pickZoneCard(ctx, me, 'hand', cm, '진화원 아래에 놓을 카드 선택 (선택 안 함 가능)');
  if (idx == null) return;
  const st = await pickStackOf(ctx, me, digimonsOf(state, me), '카드를 아래에 놓을 자신의 디지몬 선택');
  if (!st) return;
  placeSources(state, me, st, [takeFrom(state, me, 'hand', idx)], 'bottom');
}));

// #9 BT22-023 (turn end, blue unsuspend)
SC('BT22-023', '자신의 턴 종료 시', '블루인 자신의 디지몬/테이머 1마리(명)를 액티브로 할 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const cands = [...digimonsOf(state, me), ...tamersOf(state, me)].filter(s => s.suspended && ([...(C(s.cardId).colors || []), ...(s.extraColors || [])]).includes('blue'));
  const st = await pickStackOf(ctx, me, cands, '액티브로 할 블루 디지몬/테이머 선택');
  if (st) S.unsuspendStack(state, me, st.uid);
}));

// #12 BT22-030 inh 어택 시
SC('BT22-030', '어택 시', 'DP-2000', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const st = await pickStackOf(ctx, o, digimonsOf(state, o), 'DP -2000 상대 디지몬 선택', 'dpDown');
  if (st) dpMod(state, o, st, -2000, state.turnNumber);
}));

// link-free effects
const linkEffect = (o) => RUN(async (ctx) => { const st = srcSt(ctx); if (st) await linkFree(ctx, st, o); });
SC('BT22-035', '등장 시', '이 디지몬의 진화원에서 Lv.4 이하의 디지몬 카드 1장을', linkEffect({ zones: ['hand', 'sources'], card: { lvMax: 4 } }));
SC('BT22-075', '등장 시', '자신의 트래시 또는 이 디지몬의 진화원에서 Lv.4 이하', linkEffect({ zones: ['trash', 'sources'], card: { lvMax: 4 } }));
SC('EX10-019', '등장 시', '자신의 트래시 또는 이 디지몬의 진화원에서, Lv.4 이하', linkEffect({ zones: ['trash', 'sources'], card: { lvMax: 4 } }));
SC('EX10-030', '등장 시', '자신의 패 또는 이 디지몬의 진화원에서, Lv.4 이하', linkEffect({ zones: ['hand', 'sources'], card: { lvMax: 4 } }));
SC('BT23-022', '진화 시', '자신의 패 또는 이 디지몬의 진화원에서, Lv.4 이하', linkEffect({ zones: ['hand', 'sources'], card: { lvMax: 4 } }));
SC('BT23-033', '등장 시', '자신의 트래시 또는 이 디지몬의 진화원에서, Lv.4 이하', linkEffect({ zones: ['trash', 'sources'], card: { lvMax: 4 } }));
SC('BT23-024', '진화 시', '특징 「어플몬」을 가진 디지몬 카드 1장을 이 디지몬에게', linkEffect({ zones: ['hand', 'sources'], card: { trait: ['어플몬'] } }));
SC('ST22-12', '어택 시', '링크 코스트 -2로 링크', linkEffect({ zones: ['hand', 'sources'], card: { fn: (id) => { const c = C(id); return ['소셜', '내비', '툴'].some(x => c.attribute === x || (c.types || []).includes(x)); } }, costMinus: 2 }));
SC('EX10-073', '진화 시', '그 후, 이 디지몬의 진화원에서, 디지몬 카드 1장을', RUN(async (ctx) => {
  const st = srcSt(ctx);
  if (!st) return;
  await linkFree(ctx, st, { zones: ['hand'], card: {} });
  const st2 = srcSt(ctx);
  if (st2) await linkFree(ctx, st2, { zones: ['sources'], card: {} });
}));

// #14 BT22-035 inh 링크 시
SC('BT22-035', '링크 시', '특징에 「어플몬」 을 가지는 자신의 디지몬', oppDigimonDP((ctx) => -4000 * cnt(digimonsOf(ctx.state, ctx.self), stM({ trait: ['어플몬'] }))));

// #17 BT22-038 / #133 BT23-034 : suppress 【진화 시】 + DP
const noEvoAndDP = (dp, needCost) => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), st = srcSt(ctx);
  if (needCost) {
    if (!st || S.fdCount(st) < 1) { S.log(state, '뒷면의 진화원이 없어 발휘할 수 없음'); return; }
    if (!(await optional(ctx, me, '뒷면의 진화원 1장을 파기'))) return;
    S.trashEvoSources(state, me, st.uid, 1, 'bottom');
  }
  const t = await pickStackOf(ctx, o, digimonsOf(state, o), '상대 디지몬 선택', 'dpDown');
  if (!t) return;
  const until = untilOppTurnEnd(state, me);
  t.noEvoTrigUntil = until;
  dpMod(state, o, t, dp, until);
  S.log(state, `${o} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 【진화 시】 효과 발휘 불가, DP ${dp}`);
});
SC('BT22-038', '진화 시', '상대의 턴 종료까지 상대의 디지몬 1마리의 【진화 시】', noEvoAndDP(-4000, true));
SC('BT23-034', '등장 시', '상대의 턴 종료까지, 상대의 디지몬 1마리의 【진화 시】', noEvoAndDP(-6000, false));

// #18 BT22-041
SC('BT22-041', '등장 시', '옐로인 카드 1장을 시큐리티 위에 놓을 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const idx = await pickZoneCard(ctx, me, 'hand', M({ colors: ['yellow'] }), '시큐리티 위에 놓을 옐로 카드 선택 (선택 안 함 가능)');
  if (idx != null) S.addToSecurity(state, me, takeFrom(state, me, 'hand', idx), 'top');
}));

// #19 BT22-049
SC('BT22-049', '자신의 턴 종료 시', '뒷면으로 놓는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  const cm = M({ cat: 'digimon', trait: ['Ver.2'] });
  if (!st || cnt(pl.trash, cm) < 3) return;
  if (!(await optional(ctx, me, '트래시의 Ver.2 디지몬 3장을 진화원 아래에 뒷면으로 놓고 진화'))) return;
  const ids = [];
  for (let i = 0; i < 3; i++) { const idx = await pickZoneCard(ctx, me, 'trash', cm, `진화원 아래에 뒷면으로 놓을 카드 (${i + 1}/3)`); if (idx == null) break; ids.push(takeFrom(state, me, 'trash', idx)); }
  if (ids.length < 3) { pl.trash.push(...ids); return; }
  placeSourcesFaceDown(state, me, st, ids);
  await evolveEffect(ctx, { subject: 'this', zones: ['hand', 'trash'], card: { trait: ['Ver.2'] }, cost: { mode: 'normal' } });
}));

// #22/#23 opp-turn-end forced attack
const forceOppAttack = () => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const cands = digimonsOf(state, o).filter(s => !s.suspended && (state.turnNumber >= s.attackEligibleTurn || S.hasKeyword(s, '속공')));
  const st = await pickStackOf(ctx, o, cands, '어택시킬 상대 디지몬 선택 (선택 안 함 가능)');
  if (!st) return;
  ctx.startAttack(o, st.uid);
});
SC('BT22-060', '상대의 턴 종료 시', '선택한 디지몬을 어택시킨다', forceOppAttack());
SC('BT22-062', '상대의 턴 종료 시', '선택한 디지몬을 어택시킨다', forceOppAttack());

// #21 BT22-060 등장/진화
SC('BT22-060', '등장 시', '뒷면의 진화원 1장마다 DP +1000', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st) return;
  const until = untilOppTurnEnd(state, me);
  S.grantShield(state, me, st.uid, { kinds: ['retreat'], until });
  const n = S.fdCount(st);
  if (n) dpMod(state, me, st, 1000 * n, until);
}));

// #24 BT22-068 / #98 BT23-017 / #65 EX10-027 : trash -> hand
const trashToHand = (spec, costDiscard) => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M(spec);
  if (!pl.trash.some(cm)) return;
  if (costDiscard) {
    if (!pl.hand.length || !(await optional(ctx, me, '패 1장을 파기하고 트래시에서 카드를 패로'))) return;
    const idx = await ctx.choose('pickFromHandIndexes', { player: me, eligibleIdxs: pl.hand.map((_, i) => i), n: 1, prompt: '파기할 패 1장 선택' });
    if (!idx || idx.length < 1) return;
    S.trashFromHand(state, me, idx[0]);
  }
  const i = await pickZoneCard(ctx, me, 'trash', cm, '패로 되돌릴 카드 선택 (선택 안 함 가능)');
  if (i != null) { const id = takeFrom(state, me, 'trash', i); pl.hand.push(id); S.log(state, `${me} 트래시의 ${C(id).nameKo}을(를) 패로`); }
});
SC('BT22-068', '등장 시', '명칭에 「티라노몬」을 포함하거나 특징 「공룡형」을 가진 디지몬 카드 1장을 패로', trashToHand({ cat: 'digimon', or: [{ nameInc: ['티라노몬'] }, { trait: ['공룡형'] }] }));
SC('BT23-017', '등장 시', '자신의 패 1장을 파기하는 것으로', trashToHand({ notCat: 'digitama', trait: ['CS'] }, true));
SC('EX10-027', '등장 시', '자신의 패 1장을 파기하는 것으로', trashToHand({ cat: 'digimon', or: [{ mention: ['나이트몬'] }, { trait: ['바그라군', '트와일라잇'] }] }, true));

// #25 BT22-070
SC('BT22-070', '어택 시', '이 디지몬을 패의 명칭에 「티라노몬」을 포함하거나', RUN(async (ctx) => {
  await evolveEffect(ctx, { subject: 'this', zones: ['hand'], card: { or: [{ nameInc: ['티라노몬'] }, { trait: ['공룡형'] }] }, cost: { mode: 'normal' } });
}));

// #27 BT22-076
SC('BT22-076', '진화 시', '이 디지몬의 DP 이하의 디지몬 1마리를 시큐리티 위에 놓는다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || S.fdCount(st) < 1) { S.log(state, '뒷면의 진화원이 없어 발휘할 수 없음'); return; }
  if (!(await optional(ctx, me, '뒷면의 진화원 1장을 파기'))) return;
  S.trashEvoSources(state, me, st.uid, 1, 'bottom');
  const dp = S.effectiveDP(state, me, st);
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of digimonsOf(state, p)) if (s !== st && S.effectiveDP(state, p, s) <= dp) entries.push({ player: p, uid: s.uid });
  const pick = await pickAnySide(ctx, entries, '시큐리티 위에 놓을 디지몬 선택');
  if (!pick) return;
  const t = findSt(state, pick.player, pick.uid);
  if (!t) return;
  const top = detachStack(state, pick.player, t, 'trash');
  S.addToSecurity(state, pick.player, top, 'top');
}));

// #29 BT22-080
SC('BT22-080', '진화 시', '이터(원종형태)', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx), mother = state.players[me].raising;
  if (!st || !mother || C(mother.cardId).nameKo !== '마더 이터') return;
  const r = await pickFromIds(ctx, me, st.sources, (id) => C(id).nameKo === '이터(원종형태)', '「마더 이터」 아래에 놓을 「이터(원종형태)」 선택 (선택 안 함 가능)');
  if (!r.length) return;
  const id = takeSource(state, st, r[0]);
  placeSources(state, me, mother, [id], 'bottom');
}));

// ==================================================================== SECTION 3: evolution-by-effect cards

// Move a whole stack (top card + sources) to the bottom of another stack's sources; its link cards are trashed.
function moveStackUnder(state, p, from, to) {
  const pl = state.players[p];
  const i = pl.battle.indexOf(from);
  if (i === -1) return false;
  pl.battle.splice(i, 1);
  pl.trash.push(...(from.linkCards || []).map(l => l.cardId));
  placeSources(state, p, to, [...from.sources, from.cardId], 'bottom');
  return true;
}
const effMem = (ctx) => (ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory);
const dpEvo = (o) => RUN(async (ctx) => { await evolveEffect(ctx, o); });

// P-196 / P-197 / P-198 : main phase start, memory <= 4
for (const [id, tr] of [['P-196', ['바다짐승형', 'TS']], ['P-197', ['천사형', 'TS']], ['P-198', ['타천사형', 'TS']]]) {
  SC(id, '자신의 메인 페이즈 개시 시', '메모리가 4 이하라면', RUN(async (ctx) => {
    if (effMem(ctx) > 4) return;
    await evolveEffect(ctx, { subject: 'this', zones: ['hand'], card: { trait: tr }, cost: { mode: 'free' } });
  }));
}

// #16 BT22-037 진화 시
SC('BT22-037', '진화 시', '자신의 시큐리티를 위에서부터 1장 파기하는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const o = { subject: 'this', zones: ['hand'], card: { or: [{ nameInc: ['슬레이프몬', '미타마몬'] }, { trait: ['CS'] }] }, cost: { mode: 'discount', n: 2 } };
  if (!state.players[me].security.length || !(await evolveEffect(ctx, { ...o, dry: true }))) return;
  if (!(await optional(ctx, me, '시큐리티 위에서 1장을 파기하고 진화'))) return;
  S.trashTopSecurityByEffect(state, me);
  await evolveEffect(ctx, o);
}));

// #31 BT22-090 (tamer) turn end
SC('BT22-090', '자신의 턴 종료 시', '로드나이트몬', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const o = { subject: 'this', zones: ['hand'], card: { nameEq: ['로드나이트몬'] }, cost: { mode: 'discount', n: 3 } };
  if (!self || !(await evolveEffect(ctx, { ...o, dry: true }))) return;
  const pm = M({ or: [{ mention: ['나이트몬'] }, { trait: ['CS'] }] });
  const cands = [...digimonsOf(state, me), ...tamersOf(state, me)].filter(s => s !== self && pm(s.cardId));
  if (!cands.length || !(await optional(ctx, me, '다른 자신의 디지몬/테이머 1마리를 소멸시키고 로드나이트몬으로 진화'))) return;
  const v = await pickStackOf(ctx, me, cands, '소멸시킬 디지몬/테이머 선택');
  if (!v) return;
  S.deleteStack(state, me, v.uid, 'trash', 'ownEffect');
  await evolveEffect(ctx, o);
}));

// #50 EX10-013 turn end
SC('EX10-013', '자신의 턴 종료 시', '루체몬: 폴다운 모드', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ mention: ['루체몬'] });
  const o = { subject: 'this', zones: ['trash'], card: { nameEq: ['루체몬: 폴다운 모드'] }, cost: { mode: 'free' }, ignoreCond: false };
  if (cnt(pl.trash, cm) < 5 || !(await evolveEffect(ctx, { ...o, dry: true }))) return;
  if (!(await optional(ctx, me, '트래시의 「루체몬」 카드 5장을 덱 아래로 되돌리고 진화'))) return;
  const ids = [];
  for (let i = 0; i < 5; i++) { const idx = await pickZoneCard(ctx, me, 'trash', cm, `덱 아래로 되돌릴 카드 (${i + 1}/5)`); if (idx == null) break; ids.push(takeFrom(state, me, 'trash', idx)); }
  if (ids.length < 5) { pl.trash.push(...ids); return; }
  pl.deck.push(...ids);
  await evolveEffect(ctx, o);
}));

// #91 EX10-066 (tamer) turn end
SC('EX10-066', '자신의 턴 종료 시', '벨페몬', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], self = srcSt(ctx);
  if (!self || pl.hand.length > 6) return;
  const cands = digimonsOf(state, me).filter(s => C(s.cardId).nameKo.includes('벨페몬') && pl.trash.some(id => isDigimon(id) && C(id).nameKo.includes('벨페몬')));
  if (!cands.length || !(await optional(ctx, me, '이 테이머를 벨페몬 디지몬의 진화원 아래에 놓고 트래시의 벨페몬으로 진화'))) return;
  const st = await pickStackOf(ctx, me, cands, '진화시킬 「벨페몬」 디지몬 선택');
  if (!st) return;
  moveStackUnder(state, me, self, st);
  const idx = await pickZoneCard(ctx, me, 'trash', (id) => isDigimon(id) && C(id).nameKo.includes('벨페몬'), '진화할 트래시의 「벨페몬」 카드 선택');
  if (idx == null) return;
  const id = takeFrom(state, me, 'trash', idx);
  S.digivolve(state, me, st.uid, id, 0, 'trash');
}));

// #95 BT23-036
SC('BT23-036', '등장 시', '다른 자신의 디지몬 1마리를 패의 Lv.6 이하의', dpEvo({ subject: { other: true }, zones: ['hand'], card: { lvMax: 6, or: [{ nameInc: ['레오몬'] }, { trait: ['CS'] }] }, cost: { mode: 'free' } }));

// #110 BT23-040
SC('BT23-040', '자신의 메인 페이즈 개시 시', '미시마 에리카', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const o = { subject: 'this', zones: ['hand', 'trash'], card: { nameEq: ['후디에몬'] }, cost: { mode: 'discount', n: 2 } };
  const erika = tamersOf(state, me).find(s => C(s.cardId).nameKo === '미시마 에리카');
  if (!self || !erika || !(await evolveEffect(ctx, { ...o, dry: true }))) return;
  if (!(await optional(ctx, me, '「미시마 에리카」를 진화원 아래에 놓고 「후디에몬」으로 진화'))) return;
  moveStackUnder(state, me, erika, self);
  await evolveEffect(ctx, o);
}));

// #123 BT23-088 (tamer) turn end
SC('BT23-088', '자신의 턴 종료 시', '이 테이머를 소멸시키는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const o = { subject: { pred: () => true }, zones: ['trash'], card: { lvMax: 5, trait: ['언데드형', '마수형'] }, cost: { mode: 'free' } };
  if (!self || !(await evolveEffect(ctx, { ...o, dry: true }))) return;
  if (!(await optional(ctx, me, '이 테이머를 소멸시키고 디지몬을 트래시의 카드로 진화'))) return;
  S.deleteStack(state, me, self.uid, 'trash', 'ownEffect');
  await evolveEffect(ctx, o);
}));

// #37 BT22-101 (tamer, became active) / #126 BT23-053 (option placed) / #77 EX10-042 (sources added)
SC('BT22-101', '자신의 턴', '이 테이머가 액티브가 되었을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  if (tamersOf(state, me).concat(digimonsOf(state, me)).some(s => C(s.cardId).nameKo === '알파몬')) return;
  await evolveEffect(ctx, { subject: 'this', zones: ['hand'], card: { nameEq: ['알파몬'] }, cost: { mode: 'discount', n: 2 } });
}));
SC('BT23-053', '자신의 턴', '배틀 에어리어에 자신의 옵션 카드가 놓였을 때', dpEvo({ subject: 'this', zones: ['hand'], card: { or: [{ nameInc: ['사이버드라몬'] }, { trait: ['CS'] }] }, cost: { mode: 'discount', n: 2 } }));
SC('EX10-042', '자신의 턴', '진화원이 효과로 늘어났을 때', dpEvo({ subject: 'this', zones: ['hand', 'trash'], card: { nameEq: ['레굴루스몬'] }, cost: { mode: 'discount', n: 1 } }));
SC('BT22-004', '자신의 턴', '효과로 놓였을 때', dpEvo({ subject: 'this', zones: ['hand'], card: { trait: ['CS'] }, cost: { mode: 'discount', n: 1 } }));

// #38 BT22-102 (tamer) : attacker with >=2 same-Lv cards stacked -> rest tamer, evolve from trash
SC('BT22-102', '자신의 턴', '트래시의 특징 「나이트 클로」', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const ev = self && self.hookEvt;
  const target = ev && findSt(state, me, ev.stackUid);
  if (!self || self.suspended || !target) return;
  const o = { subject: { pred: (s) => s.uid === target.uid }, zones: ['trash'], card: { trait: ['나이트 클로', '라이트 팽', '은하형', 'CS'] }, cost: { mode: 'discount', n: 2 } };
  if (!(await evolveEffect(ctx, { ...o, dry: true }))) return;
  if (!(await optional(ctx, me, '이 테이머를 레스트시키고 어택한 디지몬을 트래시의 카드로 진화'))) return;
  S.restStack(state, me, self.uid);
  await evolveEffect(ctx, o);
}));

// ==================================================================== SECTION 4: other triggered effects
const anyDigimonEntries = (state, pred = () => true) => {
  const out = [];
  for (const p of ['p1', 'p2']) for (const s of digimonsOf(state, p)) if (pred(s, p)) out.push({ player: p, uid: s.uid });
  return out;
};
const delCause = (ctx, owner) => (owner === ctx.self ? 'ownEffect' : 'effect');
const startCost = (st) => (C(st.cardId).cost || 0) + ((st.s6CostMod && st.s6CostMod.until >= 0 ? st.s6CostMod.amount : 0) || 0);

// forced attack ("【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다." granted to an opponent's digimon)
function grantForcedAttack(ctx, o, st, until, chargeKw) {
  const { state } = ctx;
  if (chargeKw) { S.grantKeyword(state, o, st.uid, '충돌', true, 'turn'); if (st.keywordExpiry && st.keywordExpiry['충돌'] !== 'permanent') st.keywordExpiry['충돌'] = Math.max(st.keywordExpiry['충돌'] || 0, until); }
  (st.s3 ||= {}).forceAtkMain = { until, src: ctx.sourceCardId }; // consumed by state.queueForcedAttacks at main-phase start
  S.log(state, `${o} ${C(st.cardId).nameKo}: 상대의 턴 종료까지 【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다${chargeKw ? ' + 《충돌》' : ''}`);
}
const forcedGrant = (chargeKw, needTamer) => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  if (needTamer && !tamersOf(state, me).some(s => C(s.cardId).types.includes('CS'))) return;
  const st = await pickStackOf(ctx, o, digimonsOf(state, o), '효과를 줄 상대 디지몬 선택', 'other');
  if (st) grantForcedAttack(ctx, o, st, untilOppTurnEnd(state, me), chargeKw);
});
SC('EX10-008', '등장 시', '「【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.」의 효과를 준다', forcedGrant(true, false));
SC('EX10-034', '등장 시', '「【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다.」의 효과를 준다', forcedGrant(false, false));
SC('BT23-056', '등장 시', '특징 「CS」를 가진 자신의 테이머가 있다면', forcedGrant(false, true));
for (const id of ['EX10-008', 'EX10-034', 'BT23-056']) SCRIPTS[`${id}::s3ForceAttack`] = [{ op: 'attackNow', who: 'self', thisStack: true }];

// #40 EX10-007
SC('EX10-007', '등장 시', '상대의 턴 종료까지, 디지몬 1마리를 DP +3000', RUN(async (ctx) => {
  const { state } = ctx;
  const pick = await pickAnySide(ctx, anyDigimonEntries(state), 'DP +3000 디지몬 선택');
  if (!pick) return;
  const st = findSt(state, pick.player, pick.uid);
  if (st) dpMod(state, pick.player, st, 3000, untilOppTurnEnd(state, ctx.self));
}));

// #42 EX10-010 등장/진화
SC('EX10-010', '등장 시', '등장 코스트 7 이하의 상대의 디지몬/테이머', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const cands = [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => startCost(s) <= 7);
  const st = await pickStackOf(ctx, o, cands, '소멸시킬 상대 디지몬/테이머 선택 (등장 코스트 7 이하)', 'delete');
  if (st) S.deleteStack(state, o, st.uid, 'trash', 'effect');
}));

// #44 EX10-011
SC('EX10-011', '등장 시', '액티브 상태인 다른 디지몬 2마리를 소멸시킨다', RUN(async (ctx) => {
  const { state } = ctx;
  const chosen = [];
  for (let i = 0; i < 2; i++) {
    const entries = anyDigimonEntries(state, (s) => s.uid !== ctx.sourceStackUid && !s.suspended && !chosen.includes(s.uid));
    const pick = await pickAnySide(ctx, entries, `소멸시킬 액티브 디지몬 선택 (${i + 1}/2)`);
    if (!pick) break;
    chosen.push(pick.uid);
    S.deleteStack(state, pick.player, pick.uid, 'trash', delCause(ctx, pick.player));
  }
}));

// #46 EX10-012 등장/어택
SC('EX10-012', '등장 시', '상대의 턴 종료까지, 상대의 디지몬과 테이머 1마리(명)씩은 레스트할 수 없다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), until = untilOppTurnEnd(state, me);
  const d = await pickStackOf(ctx, o, digimonsOf(state, o), '레스트할 수 없게 할 상대 디지몬 선택', 'other');
  if (d) S.preventRest(state, o, d.uid, until);
  const t = await pickStackOf(ctx, o, tamersOf(state, o), '레스트할 수 없게 할 상대 테이머 선택', 'other');
  if (t) S.preventRest(state, o, t.uid, until);
}));

// #49 EX10-013 [육성]진화 시: move to the battle area
SC('EX10-013', '진화 시', '이 디지몬을 이동시킬 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  if (!st || pl.raising !== st) return;
  if (!(await optional(ctx, me, '이 디지몬을 배틀 에어리어로 이동'))) return;
  pl.battle.push(st); pl.raising = null;
  S.log(state, `${me} ${C(st.cardId).nameKo} 육성→배틀 에어리어 이동 (효과)`);
  S.queueTriggersForStack(state, me, st, 'move');
}));

// #51 EX10-016 inh 어택 시
SC('EX10-016', '어택 시', '링크 카드 1장을 파기하는 것으로, 상대의 디지몬 2마리를 레스트', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), st = srcSt(ctx);
  if (!st || !(st.linkCards || []).length || !(await optional(ctx, me, '링크 카드 1장을 파기'))) return;
  await linkCostDiscard(ctx, st);
  for (let i = 0; i < 2; i++) {
    const t = await pickStackOf(ctx, o, digimonsOf(state, o).filter(s => !s.suspended), `레스트시킬 상대 디지몬 선택 (${i + 1}/2)`, 'rest');
    if (t) S.restStack(state, o, t.uid);
  }
}));

// #53 EX10-019 (link -> rest opp digimon/tamer)
SC('EX10-019', '서로의 턴', '이 디지몬이 링크했을 때, 상대의 디지몬/테이머 1마리(명)를 레스트', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStackOf(ctx, o, [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => !s.suspended), '레스트시킬 상대 디지몬/테이머 선택 (선택 안 함 가능)', 'rest');
  if (!t) return;
  S.restStack(state, o, t.uid);
  if (t.suspended) S.setSkipNextUnsuspend(state, o, t.uid);
}));
// #54 EX10-019 inh (opp digimon rested -> link card cost -> trash opp security top)
SC('EX10-019', '서로의 턴', '상대의 디지몬이 레스트 했을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || !(st.linkCards || []).length || !state.players[opp(me)].security.length) return;
  if (!(await optional(ctx, me, '링크 카드 1장을 파기하고 상대의 시큐리티 위에서 1장 파기'))) return;
  await linkCostDiscard(ctx, st);
  S.trashTopSecurityByEffect(state, opp(me));
}));

// #58 EX10-021
SC('EX10-021', '등장 시', '벨페몬: 레이지 모드」 1장을 이 디지몬의 진화원 위에 놓는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  if (!st) return;
  const idx = await pickZoneCard(ctx, me, 'trash', (id) => C(id).nameKo === '벨페몬: 레이지 모드', '진화원 위에 놓을 「벨페몬: 레이지 모드」 선택 (선택 안 함 가능)');
  if (idx == null) return;
  placeSources(state, me, st, [takeFrom(state, me, 'trash', idx)], 'top');
  const until = untilOppTurnEnd(state, me);
  S.restrictAttack(state, me, st.uid, until);
  S.grantShield(state, me, st.uid, { kinds: ['all'], until });
}));

// #59 EX10-022 (variant: destroy rested opp digimon/tamer)
SC('EX10-022', '자신의 메인 페이즈 개시 시', '레스트 상태인 상대의 디지몬/테이머 1마리(명)를 소멸시킨다', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStackOf(ctx, o, [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => s.suspended), '소멸시킬 레스트 상태의 상대 디지몬/테이머 선택', 'delete');
  if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
}));
// #60 EX10-022 inh
SC('EX10-022', '상대의 턴 종료 시', '벨페몬: 슬립 모드」라면', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || C(st.cardId).nameKo !== '벨페몬: 슬립 모드' || !st.sources.length) return;
  S.trashEvoSources(state, me, st.uid, 1, 'top');
}));

// #61 EX10-023
SC('EX10-023', '등장 시', '다른 디지몬과 테이머 전부를 레스트시킨다', RUN(async (ctx) => {
  const { state } = ctx;
  for (const p of ['p1', 'p2']) for (const s of [...state.players[p].battle]) {
    if (s.uid === ctx.sourceStackUid || !['digimon', 'tamer'].includes(C(s.cardId).category)) continue;
    S.restStack(state, p, s.uid);
  }
}));

// #63 EX10-024 inh 어택 시
SC('EX10-024', '어택 시', '링크 카드 1장을 파기하는 것으로, 상대의 디지몬 1장을 《퇴화 1》', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), st = srcSt(ctx);
  if (!st || !(st.linkCards || []).length || !(await optional(ctx, me, '링크 카드 1장을 파기'))) return;
  await linkCostDiscard(ctx, st);
  const t = await pickStackOf(ctx, o, digimonsOf(state, o), '《퇴화 1》 시킬 상대 디지몬 선택', 'retreat');
  if (t) S.retreat(state, o, t.uid, 1);
}));

// #64 EX10-025
SC('EX10-025', '등장 시', '특징 「광물형」/「광석형」을 가진 카드 2장을', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ trait: ['광물형', '광석형'] });
  const hosts = digimonsOf(state, me).filter(stM({ trait: ['광물형', '광석형'] }));
  if (!hosts.length || cnt(pl.trash, cm) < 1) return;
  const st = await pickStackOf(ctx, me, hosts, '카드를 놓을 광물형/광석형 디지몬 선택 (선택 안 함 가능)');
  if (!st) return;
  const ids = [];
  for (let i = 0; i < 2; i++) { const idx = await pickZoneCard(ctx, me, 'trash', cm, `진화원 아래에 놓을 카드 (${i + 1}/2)`); if (idx == null) break; ids.push(takeFrom(state, me, 'trash', idx)); }
  placeSources(state, me, st, ids, 'bottom');
}));

// #66 EX10-029 inh 링크 시 / #68 EX10-031 / #136 BT23-044 : shields
SC('EX10-029', '링크 시', '링크 카드 1장을 파기하는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || !(st.linkCards || []).length || !(await optional(ctx, me, '링크 카드 1장을 파기'))) return;
  await linkCostDiscard(ctx, st);
  const t = await pickStackOf(ctx, me, digimonsOf(state, me), '《퇴화》 효과를 받지 않을 자신의 디지몬 선택');
  if (t) S.grantShield(state, me, t.uid, { kinds: ['retreat'], until: untilOppTurnEnd(state, me) });
}));
SC('EX10-031', '등장 시', '자신의 디지몬 1마리는 상대의 《퇴화》의 효과를 받지 않고', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const t = await pickStackOf(ctx, me, digimonsOf(state, me), '효과를 줄 자신의 디지몬 선택');
  if (!t) return;
  const until = untilOppTurnEnd(state, me);
  S.grantShield(state, me, t.uid, { kinds: ['retreat'], until });
  dpMod(state, me, t, 3000, until);
}));
SC('BT23-044', '등장 시', '디지몬 1마리를 레스트시키는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const own = digimonsOf(state, me).filter(stM({ or: [{ traitInc: ['식물형', '요정형'] }, { trait: ['CS'] }] }));
  if (!own.length) return;
  const pick = await pickAnySide(ctx, anyDigimonEntries(state, (s) => !s.suspended), '레스트시킬 디지몬 선택 (선택 안 함 가능)');
  if (!pick) return;
  S.restStack(state, pick.player, pick.uid);
  const t = await pickStackOf(ctx, me, own, '패/덱으로 되돌아가지 않을 자신의 디지몬 선택');
  if (t) S.grantShield(state, me, t.uid, { kinds: ['bounce'], until: untilOppTurnEnd(state, me) });
}));

// #70/#71 EX10-033
SC('EX10-033', '진화 시', '3장까지를 이 디지몬의 진화원 아래에 놓을 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  if (!st) return;
  const cm = M({ trait: ['광물형', '광석형'] });
  const ids = [];
  for (let i = 0; i < 3; i++) { const idx = await pickZoneCard(ctx, me, 'trash', cm, `진화원 아래에 놓을 카드 (${i + 1}/3, 선택 안 함 가능)`); if (idx == null) break; ids.push(takeFrom(state, me, 'trash', idx)); }
  placeSources(state, me, st, ids, 'bottom');
}));
SC('EX10-033', '진화 시', '파기한 1장마다, 등장 코스트 -2', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const cm = M({ trait: ['광물형', '광석형'] });
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const hosts = digimonsOf(state, me).filter(s => s.sources.some(cm));
    const h = await pickStackOf(ctx, me, hosts, `진화원을 파기할 자신의 디지몬 선택 (${i + 1}/3, 선택 안 함 가능)`);
    if (!h) break;
    const r = await pickFromIds(ctx, me, h.sources, cm, '파기할 광물형/광석형 진화원 선택');
    if (!r.length) break;
    S.trashEvoSources(state, me, h.uid, 1, 'bottom', [r[0]]);
    n++;
  }
  if (!n) return;
  const t = await pickStackOf(ctx, o, digimonsOf(state, o), '등장 코스트를 낮출 상대 디지몬 선택', 'other');
  if (t) { t.s6CostMod = { amount: -2 * n, until: untilOppTurnEnd(state, me) }; S.log(state, `${o} ${C(t.cardId).nameKo} 등장 코스트 ${-2 * n}`); }
}));

// #76 EX10-039
SC('EX10-039', '자신의 메인 페이즈 개시 시', '바그라군」을 가진 자신의 디지몬의 진화원 아래 또는', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ cat: 'digimon', trait: ['바그라군'] });
  const hosts = [...digimonsOf(state, me), ...tamersOf(state, me)].filter(stM({ trait: ['바그라군'] }));
  if (!hosts.length) return;
  const zs = ['hand', 'trash'].filter(z => pl[z].some(cm));
  if (!zs.length) return;
  let zone = zs[0];
  if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '가져올 곳', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zs[k]; }
  const idx = await pickZoneCard(ctx, me, zone, cm, '진화원/테이머 아래에 놓을 카드 선택 (선택 안 함 가능)');
  if (idx == null) return;
  const st = await pickStackOf(ctx, me, hosts, '카드를 놓을 「바그라군」 디지몬/테이머 선택');
  if (!st) return;
  placeSources(state, me, st, [takeFrom(state, me, zone, idx)], 'bottom');
}));

// #78 EX10-047 / #79 EX10-052 / #88 EX10-060 (built from existing ops)
SC('EX10-047', '등장 시', 'DP 합계 6000까지, 상대의 디지몬을 소멸', [{ op: 'costGroup', cost: [{ op: 'trashHand', who: 'self', n: 1 }], then: [{ op: 'destroySum', stat: 'dp', limit: 6000 }] }]);
SC('EX10-052', '진화 시', '상대는 본인의 디지몬/테이머 1마리(명)를 소멸시킬 수 있다', [{ op: 'costGroup', cost: [{ op: 'trashHand', who: 'self', n: 1 }], then: [{ op: 'oppMayPay', pay: 'destroy', else: [{ op: 'recoverTop', who: 'self' }] }] }]);
SC('EX10-060', '진화 시', '이 효과로 소멸하지 않았다면, 상대의 시큐리티를 위에서부터 1장 파기하고', [{ op: 'oppMayPay', pay: 'destroy', else: [{ op: 'removeSecurity', who: 'opponent' }, { op: 'unsuspend', target: 'thisStack' }] }]);

// #81 EX10-053 turn end
SC('EX10-053', '자신의 턴 종료 시', '이 디지몬의 진화원이 5장 이상이라면', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || st.sources.length < 5) return;
  if (!(await optional(ctx, me, '이 디지몬으로 레스트시키지 않고 어택'))) return;
  ctx.startAttack(me, st.uid, undefined, { noRest: true, allowSuspended: true });
}));

// #82 EX10-056
SC('EX10-056', '등장 시', '상대의 디지몬 1마리를 다른 상대의 디지몬의 진화원 아래 또는 테이머 아래에 놓을 수 있다', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const from = await pickStackOf(ctx, o, digimonsOf(state, o), '아래에 놓을 상대 디지몬 선택 (선택 안 함 가능)', 'other');
  if (!from) return;
  const dests = [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => s !== from);
  const to = await pickStackOf(ctx, o, dests, '카드를 놓을 상대 디지몬/테이머 선택', 'other');
  if (to) moveStackUnder(state, o, from, to);
}));

// #86 EX10-059
SC('EX10-059', '등장 시', '상대의 패 1장을 보지 않고 선택하고', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), pl = state.players[me], opl = state.players[o], st = srcSt(ctx);
  if (opl.hand.length) {
    const hosts = [...digimonsOf(state, o), ...tamersOf(state, o)];
    const to = await pickStackOf(ctx, o, hosts, '상대 패의 무작위 1장을 아래에 놓을 상대 디지몬/테이머 선택', 'other');
    if (to) { const i = Math.floor(Math.random() * opl.hand.length); placeSources(state, o, to, [opl.hand.splice(i, 1)[0]], 'bottom'); }
  }
  const cm = M({ cat: 'digimon', trait: ['바그라군'] });
  if (!st || cnt(pl.trash, cm) < 3) return;
  const targets = [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => s.sources.length > 0);
  if (!targets.length || !(await optional(ctx, me, '트래시의 바그라군 디지몬 3장을 진화원 위에 놓고 아래에 카드가 있는 상대의 디지몬/테이머를 소멸'))) return;
  const ids = [];
  for (let i = 0; i < 3; i++) { const idx = await pickZoneCard(ctx, me, 'trash', cm, `진화원 위에 놓을 카드 (${i + 1}/3)`); if (idx == null) break; ids.push(takeFrom(state, me, 'trash', idx)); }
  if (ids.length < 3) { pl.trash.push(...ids); return; }
  placeSources(state, me, st, ids, 'top');
  const t = await pickStackOf(ctx, o, targets.filter(s => s.sources.length > 0), '소멸시킬 상대 디지몬/테이머 선택', 'delete');
  if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
}));

// #89 EX10-062 (tamer) / #120 part of BT23-079: app fusion
SC('EX10-062', '자신의 턴 종료 시', '어플 합체할 수 있다', RUN(async (ctx) => { await appFusion(ctx); }));

// #118 BT23-060 어택 시
SC('BT23-060', '어택 시', '앞면의 디지몬 카드 1장의 【등장 시】 효과', RUN(async (ctx, R) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const ups = faceUpIds(pl).filter(id => isDigimon(id) && (C(id).types || []).includes('잭슨'));
  if (!ups.length) { S.log(state, '앞면의 「잭슨」 디지몬 카드가 없음'); return; }
  const r = await pickFromIds(ctx, me, ups, () => true, '【등장 시】 효과를 발휘할 앞면의 시큐리티 카드 선택');
  if (!r.length) return;
  await runSegmentsOf(ctx, ups[r[0]], '등장 시', R, C(ups[r[0]]).nameKo);
}));

// #121/#122 BT23-086 (tamer)
SC('BT23-086', '등장 시', '자신의 시큐리티를 위에서부터 1장 패에 추가하는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cm = M({ cat: 'digimon', trait: ['잭슨'] });
  if (!pl.security.length || !(pl.hand.some(cm) || pl.trash.some(cm)) || !(await optional(ctx, me, '시큐리티 위에서 1장을 패에 추가'))) return;
  pl.hand.push(pl.security.shift());
  S.emitGameEvent(state, 'securityDecrease', { owner: me, stack: null, cause: 'effect' });
  const zs = ['hand', 'trash'].filter(z => pl[z].some(cm));
  let zone = zs[0];
  if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '가져올 곳', options: zs.map(z => (z === 'hand' ? '패' : '트래시')) }); if (k == null) return; zone = zs[k]; }
  const idx = await pickZoneCard(ctx, me, zone, cm, '시큐리티 아래에 앞면으로 놓을 「잭슨」 디지몬 선택 (선택 안 함 가능)');
  if (idx != null) S.secAddFaceUp(state, me, takeFrom(state, me, zone, idx), 'bottom');
}));
SC('BT23-086', '자신의 턴 종료 시', '플레이어에게 어택할 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const cands = digimonsOf(state, me).filter(s => C(s.cardId).level === 6 && (C(s.cardId).types || []).some(t => ['머신형', '잭슨'].includes(t)) && !s.suspended);
  if (!self || self.suspended || !cands.length || !(await optional(ctx, me, '이 테이머를 레스트시키고 디지몬으로 플레이어에게 어택'))) return;
  const st = await pickStackOf(ctx, me, cands, '플레이어에게 어택할 디지몬 선택');
  if (!st) return;
  S.restStack(state, me, self.uid);
  ctx.startAttack(me, st.uid, 'PLAYER');
}));

// #124 BT23-101 어택 시
SC('BT23-101', '어택 시', '특징 「CS」를 가진 자신의 테이머 1명을 패로 되돌리는 것으로', RUN(async (ctx, R) => {
  const { state } = ctx, me = ctx.self;
  const tams = tamersOf(state, me).filter(stM({ trait: ['CS'] }));
  if (!tams.length || !(await optional(ctx, me, 'CS 테이머 1명을 패로 되돌리고 【등장 시】 효과 1개를 발휘'))) return;
  const t = await pickStackOf(ctx, me, tams, '패로 되돌릴 CS 테이머 선택');
  if (!t) return;
  const top = detachStack(state, me, t, 'trash');
  const pl = state.players[me];
  for (const sid of t.sources) { const k = pl.trash.lastIndexOf(sid); if (k !== -1) pl.trash.splice(k, 1); }
  pl.hand.push(top, ...t.sources);
  await runSegmentsOf(ctx, ctx.sourceCardId, '등장 시', R, C(ctx.sourceCardId).nameKo);
}));

// #125 ST22-07 (tamer)
SC('ST22-07', '자신의 턴', '이 테이머의 아래에 있는 그 디지몬의 Lv. 이하의 코스트의', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const ev = self && self.hookEvt;
  const att = ev && findSt(state, me, ev.stackUid);
  if (!self || self.suspended || !att) return;
  const lv = C(att.cardId).level ?? 0;
  const om = M({ cat: 'option', trait: ['음양술', '플러그인'], costMax: lv });
  const r = await pickFromIds(ctx, me, self.sources, (id) => om(id) && S.optionColorOk(state, me, id), '코스트를 지불하지 않고 사용할 옵션 카드 선택 (선택 안 함 가능)');
  if (!r.length) return;
  S.restStack(state, me, self.uid);
  const id = takeSource(state, self, r[0]);
  state.players[me].trash.push(id);
  S.log(state, `${me} ${C(id).nameKo} 사용 (코스트 없이)`);
  S.queueTriggersFor(state, me, id, 'use');
}));

// #129 BT23-074
SC('BT23-074', '등장 시', '육성 에어리어에 자신의 「마더 이터」가 있다면', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const mo = pl.raising;
  if (!mo || C(mo.cardId).nameKo !== '마더 이터') return;
  let left = 6;
  for (;;) {
    const cm = M({ cat: 'digimon', trait: ['이터'], costMax: left });
    if (!pl.hand.some(cm)) break;
    const idx = await pickZoneCard(ctx, me, 'hand', cm, `코스트 없이 등장시킬 「이터」 디지몬 선택 (남은 코스트 합계 ${left}, 선택 안 함으로 종료)`);
    if (idx == null) break;
    left -= C(pl.hand[idx]).cost || 0;
    S.playFreeFromZone(state, me, 'hand', idx);
  }
}));

// #130 BT23-075
SC('BT23-075', '등장 시', '등장 코스트 6 이하의 상대의 디지몬/테이머 1마리(명)를 덱 아래로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), mo = state.players[me].raising;
  const limit = 6 + (mo ? mo.sources.length : 0);
  const cands = [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => startCost(s) <= limit);
  const t = await pickStackOf(ctx, o, cands, `덱 아래로 되돌릴 상대 디지몬/테이머 선택 (등장 코스트 ${limit} 이하)`, 'bounce');
  if (!t) return;
  if (S.effectBlocked(state, o, t, 'bounce')) return;
  const top = detachStack(state, o, t, 'trash');
  state.players[o].deck.push(top);
  S.log(state, `${o} ${C(top).nameKo} 덱 아래로 (진화원 파기)`);
}));

// #134/#135 BT23-008 / BT23-018 (activated 메인)
const rotateAndPlay = (names) => RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  if (!st || !st.sources.length) { S.log(state, '겹쳐져 있는 카드가 없어 발휘할 수 없음'); return; }
  const cm = (id) => names.includes(C(id).nameKo);
  if (!pl.hand.some(cm)) { S.log(state, `패에 ${names.map(n => `「${n}」`).join('/')}가 없음`); return; }
  const idx = await pickZoneCard(ctx, me, 'hand', cm, '지불하는 코스트 -2 하여 등장시킬 카드 선택');
  if (idx == null) return;
  const top = st.sources.pop();
  st.sources.unshift(top);
  S.recomputeStackGrants(st);
  S.log(state, `${me} ${C(st.cardId).nameKo}: 겹쳐져 있는 카드 ${C(top).nameKo}를 진화원 아래로`);
  const cost = Math.max(0, (C(pl.hand[idx]).cost || 0) - 2);
  S.spendMemory(state, cost);
  S.playDigimonFresh(state, me, idx);
});
SC('BT23-008', '메인', '이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장', rotateAndPlay(['파피몬', '시라미네 노키아']));
SC('BT23-018', '메인', '이 디지몬에 겹쳐져 있는 카드를 위에서부터 1장', rotateAndPlay(['아구몬', '시라미네 노키아']));

// #138 BT23-014 등장/진화 (no free play from trash)
SC('BT23-014', '등장 시', '상대는 트래시에서, 디지몬과 테이머를 효과로 등장시킬 수 없다', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  (state.s6TrashLock ||= {})[o] = untilOppTurnEnd(state, ctx.self);
  S.log(state, `${o}: 상대의 턴 종료까지 트래시에서 디지몬/테이머를 효과로 등장시킬 수 없음`);
}));

// #142 ST22-14
SC('ST22-14', '등장 시', '상대는 자신의 패가 6장이 되도록 파기한다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me), opl = state.players[o];
  const n = opl.hand.length - 6;
  if (n > 0) {
    const idxs = await ctx.choose('pickFromHandIndexes', { player: o, eligibleIdxs: opl.hand.map((_, i) => i), n, prompt: `패가 6장이 되도록 ${n}장 파기` });
    (idxs || []).slice().sort((a, b) => b - a).forEach(i => S.trashFromHand(state, o, i));
    return;
  }
  await playFreeChoose(ctx, { zones: ['trash'], card: { trait: ['타천사형'], lvMax: 5 } });
}));

// #145 ST22-13 inh 어택 시
SC('ST22-13', '어택 시', '액티브 상태인 상대의 디지몬이 없다면', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || !(C(st.cardId).types || []).includes('볼텍스 워리어')) return;
  if (digimonsOf(state, opp(me)).some(s => !s.suspended)) return;
  if (st.suspended) S.unsuspendStack(state, me, st.uid);
}));

// ==================================================================== SECTION 5: continuous / replacement / event hooks
// (HOOKS descriptors are consumed by state.js — see activeHooks / dispatchHookEvents / hookPreventLeave …)
const isTam = (st) => C(st.cardId).category === 'tamer';
const isDig = (st) => C(st.cardId).category === 'digimon';
const hasTr = (st, t) => (C(st.cardId).types || []).includes(t);
const askPick = (cands, label) => { for (const c of cands) if (askSync(label(c))) return c; return null; };
// A leave/delete replacement: `fn(state,hp,holder,target,tp,cause,mode,once)` returns true when the leave was prevented.
function leaveHook(id, base) {
  const d = { ...base };
  d.preventLeave = (state, hp, holder, target, tp, cause, mode) => base.fn(state, hp, holder, target, tp, cause, mode, () => S.hookUseOnce(holder, id, d, 1));
  delete d.fn;
  HK(id, d);
}
const samePairIdx = (st) => {
  const seen = new Map();
  for (let i = 0; i < st.sources.length; i++) {
    const lv = C(st.sources[i]).level;
    if (seen.has(lv)) return [seen.get(lv), i];
    seen.set(lv, i);
  }
  return null;
};

// ---- #1 EX9-073 서로의 턴: leaving -> trash 2 bottom sources that are 사이보그형 or face-down instead
HK('EX9-073', { tag: '서로의 턴', has: '벗어날 때', preventLeave: (state, hp, holder, target) => {
  if (target !== holder) return false;
  const fd = S.fdCount(holder);
  const idxs = holder.sources.map((id, i) => i).filter(i => i < fd || (C(holder.sources[i]).types || []).includes('사이보그형')).slice(0, 2);
  if (idxs.length < 2) return false;
  if (!askSync(`${C(holder.cardId).nameKo}: 진화원 2장을 파기하고 배틀 에어리어를 벗어나지 않을까요?`)) return false;
  const removed = S.trashEvoSources(state, hp, holder.uid, 2, 'bottom', idxs);
  if (removed.length < 2) return false;
  S.log(state, `${hp} ${C(holder.cardId).nameKo} 진화원 2장 파기 — 벗어나지 않음`);
  return true;
} });

// ---- #4/#5 BT22-007 (마더 이터, [육성])
HK('BT22-007', { tag: '서로의 턴', has: 'DP 16000으로 취급한다', dp: (state, hp, holder, target, tp) => {
  if (state.players[hp].raising !== holder || tp !== hp || !state.players[hp].battle.includes(target)) return 0;
  return C(target.cardId).nameKo === '마더 이터' ? 16000 - (C(target.cardId).dp || 0) : 0;
} });
HK('BT22-007', { tag: '서로의 턴', src: 'inheritedKo', has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', limit: 1, events: { delete: (state, hp, holder, info) => {
  if (state.players[hp].raising !== holder || info.owner !== hp || !info.stack || info.stack === holder || info.cause === 'ownEffect') return false;
  if (!(C(info.stack.cardId).types || []).includes('이터') || !isDigimon(info.stack.cardId)) return false;
  holder.s6Left = [...info.stack.sources, info.stack.cardId];
  return true;
} } });
SC('BT22-007', '서로의 턴', '그 디지몬을 이 디지몬의 진화원 아래에 놓을 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me], st = srcSt(ctx);
  const ids = st && st.s6Left;
  if (!st || !ids || !ids.length) return;
  st.s6Left = null;
  if (!(await optional(ctx, me, '소멸한 「이터」 디지몬을 이 디지몬의 진화원 아래에 놓기'))) return;
  const got = [];
  for (const id of ids) { const k = pl.trash.lastIndexOf(id); if (k !== -1) { pl.trash.splice(k, 1); got.push(id); } }
  placeSources(state, me, st, got, 'bottom');
}));

// ---- source-added watchers (BT22-004 inh / EX10-042)
HK('BT22-004', { tag: '자신의 턴', src: 'inheritedKo', has: '효과로 놓였을 때', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && info.owner === hp && (info.added || []).some(id => isDigimon(id) && (C(id).types || []).includes('CS')) } });
HK('EX10-042', { tag: '자신의 턴', has: '진화원이 효과로 늘어났을 때', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && info.owner === hp } });

// ---- #20 BT22-058 / #97 BT23-021 / #53 EX10-019 (link events on this digimon)
const onSelfLinked = (state, hp, holder, info) => info.stack === holder && info.owner === hp;
HK('BT22-058', { tag: '서로의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
SC('BT22-058', '서로의 턴', '이 디지몬이 링크했을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const t = await pickStackOf(ctx, me, digimonsOf(state, me), '패/덱으로 되돌아가지 않을 자신의 디지몬 선택');
  if (t) S.grantShield(state, me, t.uid, { kinds: ['bounce'], until: untilOppTurnEnd(state, me) });
}));
HK('BT23-021', { tag: '자신의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
SC('BT23-021', '자신의 턴', '이 디지몬이 링크했을 때', RUN(async (ctx) => {
  const st = srcSt(ctx);
  if (st) S.grantBattleImmunity(ctx.state, ctx.self, st.uid);
}));
HK('EX10-019', { tag: '서로의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
HK('EX10-019', { tag: '서로의 턴', src: 'inheritedKo', has: '상대의 디지몬이 레스트 했을 때', events: { rest: (state, hp, holder, info) => info.owner !== hp && !!info.stack && (holder.linkCards || []).length > 0 } });

// ---- #28 BT22-078: gains the 【메인】 effects of its 화염형 sources
HK('BT22-078', { tag: '자신의 턴', has: '「화염형」을 가진 카드의 【메인】 효과 전부를 얻는다', extraMain: (state, hp, holder) => {
  const out = [];
  for (const id of holder.sources.slice(S.fdCount(holder))) {
    if (!(C(id).types || []).includes('화염형')) continue;
    for (const seg of S.parseEffectSegments(C(id).effectKo).segments) {
      if (seg.tags.length !== 1 || seg.tags[0] !== '메인' || seg.zoneMarker || /^[≪《]\s*딜레이/.test(seg.body.trim())) continue;
      out.push({ cardId: id, tags: seg.tags, text: seg.body.trim() });
    }
  }
  return out;
} });

// ---- #30 BT22-083 (tamer): attack target changed
HK('BT22-083', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때, 이 테이머를 레스트시키는 것으로', events: { redirect: (state, hp, holder) => isTam(holder) && !holder.suspended } });
SC('BT22-083', '서로의 턴', '어택의 대상이 변경되었을 때, 이 테이머를 레스트시키는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  if (!self || self.suspended) return;
  const cands = digimonsOf(state, me).filter(stM({ or: [{ nameInc: ['그레이몬'] }, { trait: ['CS'] }] }));
  if (!cands.length || !(await optional(ctx, me, '이 테이머를 레스트시키고 디지몬에게 상대 디지몬의 효과 무효 + DP +3000'))) return;
  const t = await pickStackOf(ctx, me, cands, '효과를 줄 자신의 디지몬 선택');
  if (!t) return;
  S.restStack(state, me, self.uid);
  S.grantShield(state, me, t.uid, { kinds: ['all'], fromCategory: 'digimon', until: state.turnNumber });
  dpMod(state, me, t, 3000, state.turnNumber);
}));

// ---- #32/#33 BT22-091 (tamer + inherited) / #137 BT23-046: redirect options
const redirKey = (id) => S.onceLimitKey(id, ['어택대상변경']);
HK('BT22-091', { tag: '상대의 턴', has: '이 테이머를 레스트시키는 것으로, 어택의 대상을', redirectOptions: (state, hp, holder) => {
  if (!isTam(holder) || holder.suspended) return [];
  const pay = async () => { if (holder.suspended) return false; S.restStack(state, hp, holder.uid); return holder.suspended; };
  return digimonsOf(state, hp).filter(s => hasTr(s, '종족불명') || hasTr(s, 'CS')).map(s => ({ targetUid: s.uid, pay, label: `${C(holder.cardId).nameKo}를 레스트시키고 ${C(s.cardId).nameKo}(으)로 어택 대상 변경` }));
} });
HK('BT22-091', { tag: '상대의 턴', src: 'inheritedKo', has: '「이터 아담」이라면', redirectOptions: (state, hp, holder) => {
  if (C(holder.cardId).nameKo !== '이터 아담' || S.turnUsesRemaining(holder, redirKey('BT22-091'), 1) <= 0) return [];
  return digimonsOf(state, hp).filter(s => hasTr(s, '종족불명') || hasTr(s, 'CS')).map(s => ({ targetUid: s.uid, limit: 1, label: `${C(s.cardId).nameKo}(으)로 어택 대상 변경` }));
} });
HK('BT23-046', { tag: '상대의 턴', has: '레스트 상태인, 특징으로', redirectOptions: (state, hp, holder) => {
  if (S.turnUsesRemaining(holder, redirKey('BT23-046'), 1) <= 0) return [];
  const pm = stM({ or: [{ traitInc: ['식물형', '요정형'] }, { trait: ['CS'] }] });
  return digimonsOf(state, hp).filter(s => s.suspended && pm(s)).map(s => ({ targetUid: s.uid, limit: 1, label: `레스트 상태인 ${C(s.cardId).nameKo}(으)로 어택 대상 변경` }));
} });

// ---- #34 BT22-092 (tamer): own 화염형/CS digimon played/evolved -> use its 【메인】 effect
const onOwnPlayEvo = (state, hp, holder, info) => isTam(holder) && !holder.suspended && info.owner === hp && !!info.stack && isDigimon(info.stack.cardId) && (hasTr(info.stack, '화염형') || hasTr(info.stack, 'CS'));
HK('BT22-092', { tag: '자신의 턴', has: '이 테이머를 레스트시키는 것으로, 그 디지몬의 【메인】 효과 1개를 발휘한다', events: { play: onOwnPlayEvo, digivolve: onOwnPlayEvo } });
SC('BT22-092', '자신의 턴', '그 디지몬의 【메인】 효과 1개를 발휘한다', RUN(async (ctx, R) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const ev = self && self.hookEvt;
  const t = ev && findSt(state, me, ev.stackUid);
  if (!self || self.suspended || !t) return;
  const has = S.parseEffectSegments(C(t.cardId).effectKo).segments.some(sg => sg.tags.includes('메인') && !sg.zoneMarker && !/^[≪《]\s*딜레이/.test(sg.body));
  if (!has || !(await optional(ctx, me, `이 테이머를 레스트시키고 ${C(t.cardId).nameKo}의 【메인】 효과 발휘`))) return;
  S.restStack(state, me, self.uid);
  const sub = { ...ctx, sourceStackUid: t.uid };
  const done = await runSegmentsOf(sub, t.cardId, '메인', R, C(t.cardId).nameKo);
  if (done) S.grantMemory(state, me, 1, ctx.sourceCardId);
}));

// ---- #35 BT22-094 / #102 P-199 (play cost) / #103 P-200 / #104 P-202 (evolution cost)
HK('BT22-094', { tag: '자신의 턴', has: '이 테이머를 덱 아래로 되돌리는 것으로, 지불하는 코스트 -2', playDiscount: (state, hp, holder, cardId) => {
  if (!isTam(holder) || !['digimon', 'tamer'].includes(C(cardId).category) || !(C(cardId).types || []).includes('CS')) return null;
  return { label: `${C(holder.cardId).nameKo}를 덱 아래로 되돌리고 ${C(cardId).nameKo}의 등장 코스트 -2?`, apply: () => {
    const top = detachStack(state, hp, holder, 'trash');
    if (top) state.players[hp].deck.push(top);
    return -2;
  } };
} });
HK('P-199', { tag: '자신의 턴', has: '이 테이머를 레스트시키는 것으로, 지불하는 등장 코스트 -1', playDiscount: (state, hp, holder, cardId) => {
  if (!isTam(holder) || holder.suspended || C(cardId).category !== 'digimon' || !(C(cardId).types || []).includes('TS')) return null;
  return { label: `${C(holder.cardId).nameKo}를 레스트시키고 ${C(cardId).nameKo}의 등장 코스트 -1?`, apply: () => { S.restStack(state, hp, holder.uid); return holder.suspended ? -1 : 0; } };
} });
HK('P-200', { tag: '자신의 턴', has: '이 테이머를 레스트시키는 것으로, 지불하는 진화 코스트 -1', evoOption: (state, hp, holder, stack, targetCardId) => {
  if (!isTam(holder) || holder.suspended || !isDig(stack) || !hasTr(stack, 'TS')) return null;
  return { label: `${C(holder.cardId).nameKo}를 레스트시키고 ${C(targetCardId).nameKo}로의 진화 코스트 -1?`, apply: () => { S.restStack(state, hp, holder.uid); return holder.suspended ? -1 : 0; } };
} });
HK('P-202', { tag: '자신의 턴', has: '레스트 상태의 자신의 디지몬이', evoDiscount: (state, hp, holder, stack, targetCardId) => {
  if (!stack.suspended || !isDig(stack)) return 0;
  const t = C(targetCardId);
  if (!(t.nameKo.includes('티라노몬') || (t.types || []).some(x => ['공룡형', 'Ver.1'].includes(x)))) return 0;
  const key = S.onceLimitKey('P-202', ['자신의 턴']);
  if (S.turnUsesRemaining(holder, key, 1) <= 0) return 0;
  S.markTurnEffectUsed(holder, key);
  return -1;
} });

// ---- #36 BT22-095 (tamer) 메인: place this tamer under own 「마더 이터」
SC('BT22-095', '메인', '이 테이머를 자신의 「마더 이터」의 진화원 아래에 놓는다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const cands = stackList(state, me).filter(s => s !== self && C(s.cardId).nameKo === '마더 이터');
  if (!self || !cands.length) { S.log(state, '자신의 「마더 이터」가 없어 발휘할 수 없음'); return; }
  const to = cands.length === 1 ? cands[0] : await pickStackOf(ctx, me, cands, '카드를 놓을 「마더 이터」 선택');
  if (to) moveStackUnder(state, me, self, to);
}));

// ---- #39 EX10-003 inh: end the attack
HK('EX10-003', { tag: '상대의 턴', src: 'inheritedKo', has: '그 어택을 종료한다', limit: 1, events: { attack: (state, hp, holder, info) => info.owner !== hp && cnt(holder.sources, M({ trait: ['광물형', '광석형'] })) >= 3 } });
SC('EX10-003', '상대의 턴', '그 어택을 종료한다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  const cm = M({ trait: ['광물형', '광석형'] });
  if (!st || cnt(st.sources, cm) < 3 || !(await optional(ctx, me, '진화원의 광물형/광석형 카드 3장을 파기하고 그 어택을 종료'))) return;
  const idxs = await pickFromIds(ctx, me, st.sources, cm, '파기할 광물형/광석형 진화원 3장 선택', 3);
  if (idxs.length < 3) return;
  S.trashEvoSources(state, me, st.uid, 3, 'bottom', idxs);
  if (ctx.endAttack) ctx.endAttack(); else S.log(state, '어택을 종료할 수 없음 (수동 처리)');
}));

// ---- #43 EX10-010: while an opposing DP>=13000 digimon exists: immune to opposing digimon effects, DP +3000
let dpGuard = false;
const bigOppExists = (state, hp) => {
  if (dpGuard) return false;
  dpGuard = true;
  try { return digimonsOf(state, opp(hp)).some(s => S.effectiveDP(state, opp(hp), s) >= 13000); } finally { dpGuard = false; }
};
HK('EX10-010', { tag: '서로의 턴', has: 'DP 13000 이상의 상대의 디지몬이 있는 동안',
  dp: (state, hp, holder, target, tp) => (target === holder && tp === hp && bigOppExists(state, hp) ? 3000 : 0),
  effectImmune: (state, hp, holder, target, tp, o) => target === holder && !!o.src && o.src.category === 'digimon' && bigOppExists(state, hp) });

// ---- #62 EX10-023: nobody else becomes active during the active phase
HK('EX10-023', { tag: '서로의 턴', has: '액티브 페이즈에서는, 이 디지몬 이외의 디지몬과 테이머 전부는 액티브가 되지 않는다', noUnsuspendOthers: (state, hp, holder, target) => state.phase === 'unsuspend' && ['digimon', 'tamer'].includes(C(target.cardId).category) });

// ---- #80 EX10-052: leaving -> the opponent may delete one of their own digimon/tamers; if they don't, it does not leave
leaveHook('EX10-052', { tag: '서로의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', fn: (state, hp, holder, target, tp, cause, mode, once) => {
  if (target !== holder) return false;
  const o = opp(hp);
  const cands = [...digimonsOf(state, o), ...tamersOf(state, o)];
  if (!once()) return false;
  if (cands.length && askSync(`${o}: 「${C(holder.cardId).nameKo}」가 벗어납니다 — 본인의 디지몬/테이머 1마리를 소멸시킬까요? (소멸시키지 않으면 벗어나지 않음)`, false)) {
    const v = askPick(cands, (s) => `${o}: ${C(s.cardId).nameKo}을(를) 소멸시킬까요?`) || cands[cands.length - 1];
    S.deleteStack(state, o, v.uid, 'trash', 'ownEffect');
    return false; // the opponent paid, so it leaves as normal
  }
  S.log(state, `${hp} ${C(holder.cardId).nameKo}: 상대가 소멸시키지 않아 벗어나지 않음`);
  return true;
} });

// ---- #87 EX10-059: gains the 【서로의 턴】 effects of its Lv.6 바그라군 sources
HK('EX10-059', { tag: '서로의 턴', has: '진화원에 있는 특징 「바그라군」을 가진 Lv.6의 디지몬 카드 전부의 【서로의 턴】 효과 전부를 얻는다', gainTag: '서로의 턴', gainFrom: (id) => { const c = C(id); return c.category === 'digimon' && c.level === 6 && (c.types || []).includes('바그라군'); } });

// ---- #90 EX10-064 (tamer): DigiXros may also use 1 card under this tamer and 1 from the trash
HK('EX10-064', { tag: '서로의 턴', has: '디지크로스 조건을 가진 자신의 디지몬 카드가 등장할 때', xrosExtra: (state, hp, holder, cardId) => {
  if (!isTam(holder) || !(C(cardId).types || []).some(t => ['바그라군', '트와일라잇'].includes(t)) || !S.parseDigiXros(cardId)) return null;
  return { under: 1, trash: 1 };
} });

// ---- delayed reactions of option cards in the battle area (EX10-070 / P-204 / P-203)
const delayUsable = (state, holder) => C(holder.cardId).category === 'option' && state.turnNumber > holder.placedTurn;
HK('EX10-070', { tag: '서로의 턴', has: '링크 카드가 효과로 파기되었을 때', events: { linkDiscarded: (state, hp, holder, info) => delayUsable(state, holder) && info.owner === hp } });
SC('EX10-070', '서로의 턴', '링크 카드가 효과로 파기되었을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  const ev = st && st.hookEvt;
  if (!st || !ev) return;
  const hostUid = ev.stackUid;
  if (!(await optional(ctx, me, '《딜레이》 — 이 카드를 파기하고 트래시의 어플몬 디지몬을 링크'))) return;
  S.discardForDelay(state, me, st.uid);
  const host = findSt(state, me, hostUid);
  if (host) await linkFree(ctx, host, { zones: ['trash'], card: { trait: ['어플몬'] } });
}));
HK('P-204', { tag: '서로의 턴', has: '디지몬이 플레이어에게 어택했을 때', events: { attackTarget: (state, hp, holder, info) => delayUsable(state, holder) && info.targetKind === 'player' } });
SC('P-204', '서로의 턴', '디지몬이 플레이어에게 어택했을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st) return;
  const o = { subject: { pred: (s) => C(s.cardId).nameKo === '그레이드몬' || hasTr(s, '크로니클') }, zones: ['hand'], card: { lvMax: 6, or: [{ nameEq: ['알파몬'] }, { trait: ['크로니클'] }] }, cost: { mode: 'free' } };
  if (!(await evolveEffect(ctx, { ...o, dry: true })) || !(await optional(ctx, me, '《딜레이》 — 이 카드를 파기하고 디지몬을 패의 카드로 진화'))) return;
  S.discardForDelay(state, me, st.uid);
  await evolveEffect(ctx, o);
}));
// bullets of the ordinary 《딜레이》 option cards (LM-054/055/056, P-206)
for (const [id, cols] of [['LM-056', ['purple', 'blue']], ['LM-055', ['green', 'red']], ['LM-054', ['yellow', 'black']]]) {
  SC(id, '메인', '진화 코스트 -2 하여 진화 시킬 수 있다', RUN(async (ctx) => { await evolveEffect(ctx, { subject: { pred: () => true }, zones: ['hand'], card: { colors: cols }, cost: { mode: 'discount', n: 2 } }); }));
}
SC('P-206', '메인', '지불하는 등장 코스트 -4로 등장 시킬 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const cols = new Set(digimonsOf(state, me).flatMap(s => [...(C(s.cardId).colors || []), ...(s.extraColors || [])]));
  const cm = (id) => C(id).category === 'tamer' && (C(id).colors || []).some(c => cols.has(c));
  const idx = await pickZoneCard(ctx, me, 'hand', cm, '등장 코스트 -4로 등장시킬 테이머 선택 (선택 안 함 가능)');
  if (idx == null) return;
  S.spendMemory(state, Math.max(0, (C(pl.hand[idx]).cost || 0) - 4));
  S.playDigimonFresh(state, me, idx);
}));
const onOptionTrashed = (state, hp, holder, info) => { const c = info.stack && C(info.stack.cardId); return !!c && c.category === 'option'; };
HK('P-203', { tag: '서로의 턴', has: '배틀 에어리어의 옵션 카드가 파기되었을 때', limit: 1, events: { optionTrashed: onOptionTrashed, delete: onOptionTrashed } });
SC('P-203', '서로의 턴', '배틀 에어리어의 옵션 카드가 파기되었을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const t = await pickStackOf(ctx, o, digimonsOf(state, o), '진화/플레이어 어택을 못하게 할 상대 디지몬 선택', 'other');
  if (!t) return;
  const until = untilOppTurnEnd(state, me);
  t.cannotEvolveUntil = until;
  S.restrictAttackPlayer(state, o, t.uid, until);
  S.log(state, `${o} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 진화할 수 없고 플레이어에게 어택할 수 없음`);
}));

// ---- #93 EX10-071 [트래시] turn end
SC('EX10-071', '자신의 턴 종료 시', '이 카드를 덱 아래로 되돌리는 것으로', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const k = pl.trash.lastIndexOf(ctx.sourceCardId);
  const cands = digimonsOf(state, me);
  if (k === -1 || !cands.some(stM({ nameInc: ['루체몬'] })) || !pl.security.length) return;
  if (!(await optional(ctx, me, '이 카드를 덱 아래로 되돌리고 시큐리티 1장을 파기, 디지몬으로 어택'))) return;
  pl.trash.splice(k, 1); pl.deck.push(ctx.sourceCardId);
  S.trashTopSecurityByEffect(state, me);
  const st = await pickStackOf(ctx, me, cands, '레스트시키지 않고 어택할 디지몬 선택');
  if (st) ctx.startAttack(me, st.uid, undefined, { noRest: true, allowSuspended: true });
}));

// ---- BT22-101 / BT22-102 / BT23-053 / BT23-003 / BT23-029 / BT23-047 / BT23-079 / BT23-102 (event watchers)
const onSelfActive = (state, hp, holder, info) => info.stack === holder && info.owner === hp;
HK('BT22-101', { tag: '자신의 턴', has: '이 테이머가 액티브가 되었을 때', limit: 1, events: { active: onSelfActive, unsuspend: onSelfActive } });
HK('BT22-102', { tag: '자신의 턴', has: 'Lv.이 같은 카드가 2장 이상 겹쳐져 있는', events: { attack: (state, hp, holder, info) => {
  if (!isTam(holder) || holder.suspended || info.owner !== hp || !info.stack || !isDigimon(info.stack.cardId)) return false;
  const lvs = [info.stack.cardId, ...info.stack.sources].map(id => C(id).level);
  return lvs.some((lv, i) => lv != null && lvs.indexOf(lv) !== i);
} } });
HK('BT23-053', { tag: '자신의 턴', has: '배틀 에어리어에 자신의 옵션 카드가 놓였을 때', events: { optionPlaced: (state, hp, holder, info) => isDig(holder) && info.owner === hp } });
HK('BT23-003', { tag: '자신의 턴', src: 'inheritedKo', has: '옵션 카드가 놓였을 때', limit: 1, events: { optionPlaced: (state, hp, holder, info) => info.owner === hp && !!info.stack && (C(info.stack.cardId).types || []).includes('CS') } });
SC('BT23-003', '자신의 턴', '이 디지몬으로 어택할 수 있다', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, st = srcSt(ctx);
  if (!st || st.suspended || !(await optional(ctx, me, '이 디지몬으로 어택'))) return;
  ctx.startAttack(me, st.uid);
}));
HK('BT23-029', { tag: '서로의 턴', has: '자신의 카드가 등장했을 때', limit: 1, events: { play: (state, hp, holder, info) => info.owner === hp && !!info.stack && (C(info.stack.cardId).types || []).some(t => ['짐승형', '수인형', 'CS'].includes(t)) } });
SC('BT23-029', '서로의 턴', '자신의 카드가 등장했을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, o = opp(me);
  const t = await pickStackOf(ctx, o, digimonsOf(state, o), '【진화 시】 효과를 봉인할 상대 디지몬 선택', 'other');
  if (t) { t.noEvoTrigUntil = untilOppTurnEnd(state, me); S.log(state, `${o} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 【진화 시】 효과 발휘 불가`); }
}));
HK('BT23-047', { tag: '자신의 턴', has: '상대의 시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner !== hp } });
SC('BT23-047', '자신의 턴', '상대의 시큐리티가 줄어들었을 때', RUN(async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const opt = await pickStackOf(ctx, o, state.players[o].battle.filter(s => C(s.cardId).category === 'option'), '파기할 상대 배틀 에어리어의 옵션 카드 선택', 'delete');
  if (opt) S.deleteStack(state, o, opt.uid, 'trash', 'effect');
  const t = await pickStackOf(ctx, o, [...digimonsOf(state, o), ...tamersOf(state, o)].filter(s => s.suspended), '소멸시킬 레스트 상태의 상대 디지몬/테이머 선택', 'delete');
  if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
}));
HK('BT23-079', { tag: '자신의 턴', has: '자신의 디지몬이 링크했을 때', events: { linked: (state, hp, holder, info) => isTam(holder) && !holder.suspended && info.owner === hp && !!info.stack } });
SC('BT23-079', '자신의 턴', '자신의 디지몬이 링크했을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, self = srcSt(ctx);
  const ev = self && self.hookEvt;
  const t = ev && findSt(state, me, ev.stackUid);
  if (!self || self.suspended || !t) return;
  if (!(await optional(ctx, me, '이 테이머를 레스트시키고 그 디지몬 DP +3000, 어플 합체'))) return;
  S.restStack(state, me, self.uid);
  dpMod(state, me, t, 3000, untilOppTurnEnd(state, me));
  await appFusion(ctx);
}));
HK('BT23-102', { tag: '서로의 턴', has: '시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: () => true } });
SC('BT23-102', '서로의 턴', '시큐리티가 줄어들었을 때', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const t = await pickStackOf(ctx, me, digimonsOf(state, me), '시큐리티 아래에 놓을 자신의 디지몬 선택 (선택 안 함 가능)');
  if (!t) return;
  const top = detachStack(state, me, t, 'trash');
  S.addToSecurity(state, me, top, 'bottom');
}));

// ---- #117 BT23-026: alternative evolution into 「안티라몬」
HK('BT23-026', { tag: '자신의 턴', has: '패의 「안티라몬」으로 진화 조건을 무시하고 진화 코스트 3으로 진화할 수 있다', evoAlt: (state, hp, holder, stack) => {
  if (stack !== holder || !state.players[hp].battle.some(s => C(s.cardId).nameKo === '다테 마키코')) return null;
  return { cost: 3, test: (tgt) => tgt.nameKo === '안티라몬' };
} });

// ---- #108 BT23-080 (tamer): CS digimon would be deleted -> tamer to deck bottom, the digimon goes to the top of security instead
leaveHook('BT23-080', { tag: '서로의 턴', has: '이 테이머를 덱 아래로 되돌리는 것으로', fn: (state, hp, holder, target, tp, cause, mode) => {
  if (mode !== 'delete' || tp !== hp || !isTam(holder) || !isDig(target) || !hasTr(target, 'CS')) return false;
  if (!askSync(`${C(holder.cardId).nameKo}를 덱 아래로 되돌리고 ${C(target.cardId).nameKo}을(를) 시큐리티 위에 놓을까요?`)) return false;
  const ttop = detachStack(state, hp, holder, 'trash');
  if (ttop) state.players[hp].deck.push(ttop);
  const top = detachStack(state, tp, target, 'trash');
  S.addToSecurity(state, tp, top, 'top');
  return true;
} });

// ---- #115 BT23-089 (tamer): CS digimon would leave -> rest tamer + trash two same-Lv sources of a CS digimon
leaveHook('BT23-089', { tag: '서로의 턴', has: '이 테이머를 레스트시키고', fn: (state, hp, holder, target) => {
  if (!isTam(holder) || holder.suspended || !isDig(target) || !hasTr(target, 'CS') || state.players[hp].battle.indexOf(target) === -1) return false;
  const cands = digimonsOf(state, hp).filter(s => hasTr(s, 'CS') && samePairIdx(s));
  if (!cands.length) return false;
  const v = askPick(cands, (s) => `${C(s.cardId).nameKo}의 진화원에서 Lv.이 같은 카드 2장을 파기하고 ${C(target.cardId).nameKo}이(가) 벗어나지 않게 할까요? (테이머 레스트)`);
  if (!v) return false;
  const pair = samePairIdx(v);
  S.restStack(state, hp, holder.uid);
  const removed = S.trashEvoSources(state, hp, v.uid, 2, 'bottom', pair);
  if (removed.length < 2) return false;
  S.log(state, `${hp} ${C(target.cardId).nameKo}: 벗어나지 않음 (${C(holder.cardId).nameKo})`);
  return true;
} });

// ---- #131 BT23-073: another 이터/후디에 digimon would leave -> delete this digimon / place it under 「마더 이터」 instead
leaveHook('BT23-073', { tag: '서로의 턴', has: '이 디지몬을 소멸시키거나 육성 에어리어의 자신의 「마더 이터」의 진화원 아래에 놓는 것으로', fn: (state, hp, holder, target, tp, cause, mode, once) => {
  if (tp !== hp || target === holder || !isDig(target) || !(hasTr(target, '이터') || hasTr(target, '후디에'))) return false;
  const mo = state.players[hp].raising && C(state.players[hp].raising.cardId).nameKo === '마더 이터' ? state.players[hp].raising : null;
  if (!askSync(`${C(holder.cardId).nameKo}: ${C(target.cardId).nameKo}이(가) 벗어나지 않도록 이 디지몬을 ${mo ? '소멸시키거나 「마더 이터」 아래에 놓을까요?' : '소멸시킬까요?'}`)) return false;
  if (!once()) return false;
  if (mo && askSync('이 디지몬을 「마더 이터」의 진화원 아래에 놓을까요? (아니오 = 소멸)')) moveStackUnder(state, hp, holder, mo);
  else S.deleteStack(state, hp, holder.uid, 'trash', 'ownEffect');
  return true;
} });

// ---- #140/#141 BT23-043: flip the top face-up security card face-down instead of leaving
const flipTopFaceUpDown = (state, hp) => {
  const pl = state.players[hp];
  const id = faceUpIds(pl)[0];
  if (!id) return false;
  pl.secUp[id] = Math.max(0, (pl.secUp[id] || 0) - 1);
  S.log(state, `${hp} 시큐리티의 앞면 ${C(id).nameKo}을(를) 뒷면으로`);
  return true;
};
leaveHook('BT23-043', { tag: '서로의 턴', has: '이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때', fn: (state, hp, holder, target, tp, cause, mode, once) => {
  if (target !== holder || cause === 'ownEffect' || !faceUpIds(state.players[hp]).length) return false;
  if (!askSync(`${C(holder.cardId).nameKo}: 앞면의 시큐리티 1장을 뒷면으로 하고 벗어나지 않을까요?`)) return false;
  if (!once()) return false;
  return flipTopFaceUpDown(state, hp);
} });
leaveHook('BT23-043', { tag: '서로의 턴', src: 'inheritedKo', has: '특징 「로얄 베이스」를 가진 자신의 디지몬이 자신의 효과 이외로', fn: (state, hp, holder, target, tp, cause, mode, once) => {
  if (tp !== hp || cause === 'ownEffect' || !isDig(target) || !hasTr(target, '로얄 베이스') || !faceUpIds(state.players[hp]).length) return false;
  if (!askSync(`${C(target.cardId).nameKo}: 앞면의 시큐리티 1장을 뒷면으로 하고 벗어나지 않을까요?`)) return false;
  if (!once()) return false;
  return flipTopFaceUpDown(state, hp);
} });

// ==================================================================== delay leftovers
SC('P-193', '서로의 턴 종료 시', '밀레니엄몬', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const mills = pl.battle.filter(s => C(s.cardId).nameKo === '밀레니엄몬');
  if (!mills.length) return;
  if (!await ctx.choose('confirmEffect', { prompt: '「밀레니엄몬」 1마리를 소멸시키고 「사신형」 디지몬을 등장시킬까요?' })) return;
  const uid = mills.length === 1 ? mills[0].uid : await ctx.choose('pickStack', { player: me, uids: mills.map(s => s.uid), prompt: '소멸시킬 「밀레니엄몬」 선택' });
  if (!uid) return;
  S.deleteStack(state, me, uid, 'trash', 'ownEffect');
  await playFreeChoose(ctx, { zones: ['hand', 'trash'], card: { trait: ['사신형'] } });
}));
SC('EX10-072', '상대의 턴 종료 시', '앞면의 디지몬 카드', RUN(async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const ids = [...new Set(faceUpIds(pl).filter(id => isDigimon(id) && (C(id).types || []).includes('어둠의 4천왕')))];
  if (!ids.length) return;
  if (!await ctx.choose('confirmEffect', { prompt: '시큐리티의 앞면 「어둠의 4천왕」 디지몬을 등장시킬까요?' })) return;
  const id = ids[0];
  const si = pl.security.indexOf(id);
  pl.security.splice(si, 1);
  S.secFaceUpTake(pl, id);
  pl.hand.push(id);
  const st = S.playFreeFromZone(state, me, 'hand', pl.hand.length - 1);
  if (!st) { pl.hand.pop(); pl.security.splice(si, 0, id); return; }
  S.emitGameEvent(state, 'securityDecrease', { owner: me, stack: null, cause: 'effect' });
  const uid = st.uid;
  const tn = state.turnNumber + 1;
  state.endOfTurnEffects = state.endOfTurnEffects || [];
  state.endOfTurnEffects.push({ turnNumber: tn, fn: () => {
    if (pl.battle.some(s => s.uid === uid)) S.deleteStack(state, me, uid, 'trash', 'ownEffect');
  } });
}));
