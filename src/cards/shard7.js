// Shard 7 — bespoke per-card scripts / hooks (ST22, BT24, BT25, EX11, AD1, P-2xx ...).
//
//  SCRIPTS  { 'CARD-ID::firstTag[@needle]': [ops] }
//  OPS      custom ops (prefix s7_)
//  HOOKS    { 'CARD-ID': [descriptor] }  continuous / replacement / event abilities consumed by state.js
//
// Imports state.js (import cycle: only touched inside functions, never at load time).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ==================================================================== helpers
const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digimonsOf = (state, p) => state.players[p].battle.filter(s => S.isDigimonLike(s));
const tamersOf = (state, p) => state.players[p].battle.filter((s) => C(s.cardId).category === 'tamer');
const findSt = (state, p, uid) => stacksOf(state, p).find((s) => s.uid === uid) || null;
const ownerOf = (state, st) => ['p1', 'p2'].find((p) => stacksOf(state, p).includes(st)) || null;
const holderOf = (ctx) => findSt(ctx.state, ctx.self, ctx.sourceStackUid);
const evtOf = (ctx) => (ctx.trigger && (ctx.trigger.evt || ctx.trigger.hookEvt)) || (holderOf(ctx) && holderOf(ctx).hookEvt) || null;
const F = (fn) => ({ op: 's7_fn', fn });
OPS.s7_fn = async (instr, ctx) => { await instr.fn(ctx); };

// 〈룰〉 lines add names / traits that are not in the data columns.
const _rule = {};
function ruleOf(id) {
  if (_rule[id]) return _rule[id];
  const t = C(id).effectKo || '';
  const names = [], types = [];
  for (const line of t.split('\n')) {
    if (!/〈룰〉/.test(line)) continue;
    for (const m of line.matchAll(/명칭\s*[:：]\s*「([^」]+)」/g)) names.push(m[1]);
    for (const m of line.matchAll(/(?:유형|특징)\s*[:：]?\s*「([^」]+)」/g)) types.push(m[1]);
  }
  return (_rule[id] = { names: S.cardNames(id).slice(1), types }); // names: central parser (state.js cardNameInfo)
}
const typesOf = (id) => [...(C(id).types || []), ...ruleOf(id).types];
const namesOf = (id) => [C(id).nameKo, ...ruleOf(id).names];
const hasType = (id, ...l) => typesOf(id).some((t) => l.includes(t));
const typeIncl = (id, ...l) => typesOf(id).some((t) => l.some((x) => t.includes(x)));
const nameIs = (id, ...l) => namesOf(id).some((n) => l.includes(n));
const nameIncl = (id, ...l) => namesOf(id).some((n) => l.some((x) => n.includes(x)));
const lv = (id) => C(id).level || 0;
const isDig = (id) => C(id).category === 'digimon';
const colorsOfStack = (st) => S.stackColors(st);
const stackHasType = (st, ...l) => hasType(st.cardId, ...l);
// "「X」이/가 기술되어 있는" / "「X」의 기술이 있는": name or card text mentions 「X」 (see S.cardMentions)
const mentions = (id, ...l) => l.some((x) => S.cardMentions(id, x));
const BIRD = (id) => typeIncl(id, '조', '새', '병아리') || hasType(id, '볼텍스 워리어');

// turn windows
const untilTurn = (state) => state.turnNumber;
const untilOppEnd = (ctx) => (ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber);

async function confirm(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }

function targets(ctx, who, stacks, kind = 'other') {
  if (who === ctx.self) return stacks;
  return stacks.filter((st) => !S.effectBlocked(ctx.state, who, st, kind));
}
async function pickStack(ctx, who, stacks, prompt, o = {}) {
  stacks = targets(ctx, who, stacks, o.kind);
  if (!stacks.length) return null;
  if (o.mandatory && stacks.length === 1) return stacks[0];
  // g6-batch4 audit: wrapChoose() infers required/optional from the WHOLE printed 【tag】 segment text, which is wrong
  // whenever that segment mixes a mandatory clause with a later optional one ("…레스트시키고, …할 수 있다" reads as
  // optional as a whole even though the rest is mandatory, AD1-024/Q6916). o.mandatory is the caller's explicit say-so
  // for THIS pick and must win over that heuristic — only set when true so calls that don't pass it keep the old inference.
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map((s) => s.uid), prompt, fxKind: o.kind, ...(o.mandatory ? { required: true } : {}) });
  return stacks.find((s) => s.uid === uid) || null;
}
// pick an index from a player's real zone
async function pickIdx(ctx, who, zone, pred, prompt) {
  const arr = ctx.state.players[who][zone];
  const idxs = arr.map((id, i) => i).filter((i) => pred(arr[i]));
  if (!idxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return i == null ? null : i;
}
// pick from an arbitrary list of card ids (shown through a temporary virtual zone)
async function pickFromList(ctx, who, ids, prompt, decider) { // `decider`: the effect's user when the cards belong to the opponent (evolution sources of an opposing Digimon ...)
  if (!ids.length) return null;
  const pl = ctx.state.players[who];
  pl._s7vz = ids.slice();
  try {
    const i = await ctx.choose('pickFromZoneIndex', { player: who, zone: '_s7vz', eligibleIdxs: ids.map((x, k) => k), prompt, ...(decider ? { decider } : {}) });
    return i == null ? null : i;
  } finally { delete pl._s7vz; }
}
function payMemory(state, p, n) {
  if (n <= 0) return;
  state.memory = Math.max(-10, Math.min(10, state.memory + (p === 'p1' ? -n : n)));
  S.log(state, `${p} 코스트 ${n} 지불 → 메모리 ${state.memory}`);
}
const oppMemory = (state, p) => Math.max(0, p === 'p1' ? -state.memory : state.memory);
const ownMemory = (state, p) => (p === 'p1' ? state.memory : -state.memory);

async function restIt(ctx, who, st) {
  const was = st.suspended;
  S.restStack(ctx.state, who, st.uid);
  return !was && st.suspended;
}
function destroyIt(ctx, who, st) {
  return S.deleteStack(ctx.state, who, st.uid, 'trash', who === ctx.self ? 'ownEffect' : 'effect');
}
const oppEffectCause = (ctx, who) => (who === ctx.self ? 'ownEffect' : 'effect');

// Move a battle stack off the board: top card to `dest`, sources/links to trash.
function bounceIt(ctx, who, st, dest = 'hand') {
  const { state } = ctx;
  if (S.effectBlocked(state, who, st, 'bounce')) return false;
  const pl = state.players[who];
  const i = pl.battle.indexOf(st);
  if (i < 0) return false;
  if (S.leaveGate(state, who, st, oppEffectCause(ctx, who), 'bounce', () => bounceIt(ctx, who, st, dest))) return false;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map((l) => l.cardId);
  const real = (x) => !S.isTokenId(x);
  if (real(st.cardId)) {
    if (dest === 'hand') pl.hand.push(st.cardId);
    else if (dest === 'deckTop') pl.deck.unshift(st.cardId);
    else if (dest === 'deckBottom') pl.deck.push(st.cardId);
    else if (dest === 'secTop') pl.security.unshift(st.cardId);
    else if (dest === 'secBottom') pl.security.push(st.cardId);
  }
  pl.trash.push(...st.sources.filter(real), ...linkIds.filter(real));
  S.log(state, `${who} ${C(st.cardId).nameKo} 배틀 에어리어를 벗어남 (${dest})`);
  S.applyOverflowBatch(state, who, [...st.sources, st.cardId]);
  return true;
}

// ---- link cards (real rule: the "링크: 조건 : 코스트 N" line is printed on the LINK card itself)
function linkLine(id) {
  const m = (C(id).inheritedKo || '').match(/링크\s*[:：]\s*(.+?)\s*[:：]\s*코스트\s*(\d+)/);
  return m ? { cond: m[1].trim(), cost: Number(m[2]) } : null;
}
function hostMeets(st, cond) {
  const id = st.cardId;
  let m;
  if ((m = cond.match(/Lv\.\s*(\d+)\s*이상/))) return lv(id) >= Number(m[1]);
  if ((m = cond.match(/Lv\.\s*(\d+)\s*이하/))) return lv(id) <= Number(m[1]);
  const pr = S.cardDescPredicate(cond.replace(/\s*(?:을|를)?\s*$/, '') + (/특징/.test(cond) ? ' 가진' : ''));
  if (pr) {
    const c = C(id);
    if (pr(c)) return true;
    if (/특징/.test(cond)) { const l = [...cond.matchAll(/「([^」]+)」/g)].map((x) => x[1]); return hasType(id, ...l); }
    return false;
  }
  return false;
}
const canLink = (cardId, host) => { const ll = linkLine(cardId); return !!ll && hostMeets(host, ll.cond); };
function linkCostFor(state, hp, host, cardId, delta) {
  const ll = linkLine(cardId);
  let cost = ll ? ll.cost : 0;
  if (delta === 'free') return 0;
  cost += delta || 0;
  cost += (S.s7LinkCostDelta ? S.s7LinkCostDelta(state, hp, host, cardId) : 0);
  return Math.max(0, cost);
}
// take a card out of hand / trash / host's sources and link it
async function linkFrom(ctx, who, host, zone, cardId, delta) {
  const { state } = ctx;
  const pl = state.players[who];
  if (zone === 'hand') { const i = pl.hand.indexOf(cardId); if (i < 0) return false; }
  else if (zone === 'trash') { const i = pl.trash.lastIndexOf(cardId); if (i < 0) return false; pl.trash.splice(i, 1); }
  else if (zone === 'sources') { const i = host.sources.lastIndexOf(cardId); if (i < 0) return false; host.sources.splice(i, 1); S.recomputeStackGrants(host); }
  const cost = linkCostFor(state, who, host, cardId, delta);
  if (cost > 0) payMemory(state, who, cost);
  // 4-9-5: at the Link cap the player chooses which existing Link Card is discarded (asynchronous picker)
  const dIdx = await S.linkDiscardIdx(state, who, host.uid, ctx.choose);
  S.linkCardTo(state, who, host.uid, cardId, cardId, 0, zone === 'hand' ? 'hand' : 'none', dIdx);
  return true;
}

// ---- evolving
function evoCheck(ctx, st, cardId, o = {}) {
  const E = ctx.E;
  if (o.ignoreCond && !S.s1HookAny(ctx.state, 's1evoIgnoreLocked', {})) { // BT8-059 (Q1100-1103): the ignore-lock voids it. 8-1-2-2: ignoring the condition does not lift "cannot evolve"/"only evolves into X" restrictions
    const rc = E.evoRestrictionCheck(cardId, S.evolveTargetRestriction(ctx.state, ownerOf(ctx.state, st), st));
    return rc.ok ? { ok: true, cost: (C(cardId).evoNormal && C(cardId).evoNormal.cost) || 0 } : rc;
  }
  const xa = S.evoExtraArg(ctx.state, null, st); if (o.ignoreLevel) xa.ignoreLevel = true; // W8 (Q5604 BT24-025): "Lv.을 무시하고" — every printed condition is checked with only its Lv. dropped, so the cheapest satisfied one (e.g. 「TS」 Lv.5: 코스트 3) applies, not always the normal-line cost
  const r = E.canEvolveAny(st.cardId, cardId, xa, S.evolveTargetRestriction(ctx.state, ownerOf(ctx.state, st), st));
  if (r.ok || !o.ignoreLevel || S.s1HookAny(ctx.state, 's1evoIgnoreLocked', {})) return r;
  // ignore the Lv. requirement: accept when the colour of the normal condition matches
  const tgt = C(cardId);
  const cols = (tgt.evoNormal && tgt.evoNormal.colors) || [];
  const sc = colorsOfStack(st);
  if (!cols.length || cols.length >= 7 || cols.some((c) => sc.includes(c))) return { ok: true, cost: (tgt.evoNormal && tgt.evoNormal.cost) || 0 };
  return r;
}
// Evolve `st` (raising or battle) into a card of hand/trash. mode: {free} | {discount:n} | {fixed:n} | {normal}
async function evolveStack(ctx, who, st, zone, pred, mode, o = {}) {
  const { state } = ctx;
  const pl = state.players[who];
  const arr = zone === 'trash' ? pl.trash : pl.hand;
  const idxs = arr.map((id, i) => i).filter((i) => isDig(arr[i]) && pred(arr[i]) && evoCheck(ctx, st, arr[i], o).ok);
  if (!idxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt: o.prompt || `${zone === 'trash' ? '트래시' : '패'}에서 진화할 카드 선택` });
  if (i == null) return null;
  const cardId = arr[i];
  const chk = evoCheck(ctx, st, cardId, o);
  let cost = chk.cost || 0;
  if (mode.free) cost = 0; else if (mode.fixed != null) cost = mode.fixed; else if (mode.discount) cost = Math.max(0, cost - mode.discount);
  if (zone === 'trash') arr.splice(i, 1);
  if (cost > 0) payMemory(state, who, cost);
  S.digivolve(state, who, st.uid, cardId, 0, zone === 'trash' ? 'trash' : 'hand');
  return cardId;
}

// ---- options used without paying
async function resolveNewPendings(ctx, before, cardId) {
  const Fx = await import('../effects.js');
  for (const t of [...ctx.state.pending]) {
    if (t.resolved || before.has(t.uid) || t.cardId !== cardId) continue;
    const script = Fx.lookupCardSpecific(t.cardId, t.tags, t.text) || Fx.compileToScript(t.text);
    if (script && script.length) {
      const c2 = { ...ctx, self: t.player, opp: opp(t.player), sourceCardId: t.cardId, sourceStackUid: t.stackUid, trigger: t };
      await Fx.runScript(script, c2);
      S.resolvePending(ctx.state, t.uid);
    }
  }
}
async function useOptionFree(ctx, who, id, costPaid = 0) {
  const { state } = ctx;
  if (!S.optionColorOk(state, who, id)) { S.log(state, `${who} ${C(id).nameKo} 사용 불가: 색 조건 미충족`); state.players[who].trash.push(id); return false; }
  const before = new Set(state.pending.map((t) => t.uid));
  state.players[who].trash.push(id);
  S.log(state, `${who} ${C(id).nameKo} 사용 (효과, 코스트 ${costPaid})`);
  S.queueTriggersFor(state, who, id, 'use');
  S.emitGameEvent(state, 'optionUsed', { owner: who, stack: null, cause: null, cardId: id, useCost: costPaid });
  await resolveNewPendings(ctx, before, id);
  return true;
}
// choose an option among hand / tamer sources / trash
async function useOptionFrom(ctx, who, zones, pred, prompt) {
  const { state } = ctx;
  const pl = state.players[who];
  const cands = [];
  if (zones.includes('hand')) pl.hand.forEach((id, i) => { if (C(id).category === 'option' && pred(id)) cands.push({ id, zone: 'hand', i }); });
  if (zones.includes('trash')) pl.trash.forEach((id, i) => { if (C(id).category === 'option' && pred(id)) cands.push({ id, zone: 'trash', i }); });
  if (zones.includes('tamerUnder')) for (const t of tamersOf(state, who)) t.sources.forEach((id, i) => { if (C(id).category === 'option' && pred(id)) cands.push({ id, zone: 'tamer', i, t }); });
  const ok = cands.filter((c) => S.optionColorOk(state, who, c.id));
  if (!ok.length) return null;
  const k = await pickFromList(ctx, who, ok.map((c) => c.id), prompt);
  if (k == null) return null;
  const c = ok[k];
  if (c.zone === 'hand') pl.hand.splice(pl.hand.indexOf(c.id), 1);
  else if (c.zone === 'trash') pl.trash.splice(pl.trash.lastIndexOf(c.id), 1);
  else c.t.sources.splice(c.t.sources.indexOf(c.id), 1);
  await useOptionFree(ctx, who, c.id);
  return c.id;
}

// ---- placing cards under the source stack
function placeUnder(ctx, who, st, id) {
  st.sources.unshift(id);
  S.recomputeStackGrants(st);
  S.log(ctx.state, `${who} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
}
async function costPlaceUnder(ctx, st, zones, pred, prompt) {
  const { state, self } = ctx;
  const pl = state.players[self];
  const cands = [];
  if (zones.includes('hand')) pl.hand.forEach((id, i) => { if (pred(id)) cands.push({ id, zone: 'hand' }); });
  if (zones.includes('trash')) pl.trash.forEach((id, i) => { if (pred(id)) cands.push({ id, zone: 'trash' }); });
  if (!cands.length) return null;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), prompt);
  if (k == null) return null;
  const c = cands[k];
  const arr = c.zone === 'hand' ? pl.hand : pl.trash;
  arr.splice(arr.lastIndexOf(c.id), 1);
  placeUnder(ctx, self, st, c.id);
  return c.id;
}

// ---- reveal N from deck top, choose up to one per group, rest to bottom
async function revealPick(ctx, n, groups, rest = 'bottom') {
  const { state, self } = ctx;
  const revealed = S.revealTop(state, self, n);
  const chosen = [];
  // a card fitting several criteria must not be spent on the wrong one: only offer cards that keep the remaining criteria as fillable as possible (verify-reveal-3)
  const maxFill = (avail, preds) => { const owner = new Map(); const tryK = (k, seen) => { for (const ci of avail) { if (seen.has(ci) || !preds[k](revealed[ci])) continue; seen.add(ci); if (!owner.has(ci) || tryK(owner.get(ci), seen)) { owner.set(ci, k); return true; } } return false; }; let c = 0; for (let k = 0; k < preds.length; k++) if (tryK(k, new Set())) c++; return c; };
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const avail0 = revealed.map((_, i) => i).filter((i) => !chosen.includes(i));
    const best = maxFill(avail0, groups.slice(gi));
    const elig = revealed.map((id, i) => ({ id, i })).filter((x) => !chosen.includes(x.i) && g(x.id) && 1 + maxFill(avail0.filter((j) => j !== x.i), groups.slice(gi + 1)) >= best);
    if (!elig.length) continue;
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed, eligible: elig, min: 0, max: 1, prompt: '공개된 카드 중 패에 추가할 카드 선택' });
    for (const i of r || []) if (!chosen.includes(i)) chosen.push(i);
  }
  await S.resolveRevealOrdered(state, ctx.choose, self, n, chosen, chosen, rest);
  return chosen.length;
}

const H = (id, d) => { (HOOKS[id] ||= []).push(d); };
const TOUCH_OPT = (id) => hasType(id, '음양술', '플러그인');

// ==================================================================== ST22
// Link this option card (currently in trash after being used) to one of own digimon, free.
async function linkThisOption(ctx) {
  const { state, self } = ctx;
  const id = ctx.sourceCardId;
  const hosts = digimonsOf(state, self).filter((s) => canLink(id, s));
  if (!hosts.length || state.players[self].trash.lastIndexOf(id) < 0) return null;
  if (!(await confirm(ctx, `${C(id).nameKo}: 자신의 디지몬에 코스트 없이 링크할까요?`))) return null;
  const host = await pickStack(ctx, self, hosts, '링크할 디지몬 선택');
  if (!host) return null;
  return (await linkFrom(ctx, self, host, 'trash', id, 'free')) ? host : null;
}
SCRIPTS['ST22-08::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  await linkThisOption(ctx);
  if (!digimonsOf(state, ctx.opp).length) return; // no opposing Digimon: skip the pointless DP-reference prompt
  const mine = await pickStack(ctx, self, digimonsOf(state, self), 'DP 기준이 될 자신의 디지몬 선택 (취소=소멸 안 함)');
  if (!mine) return;
  const dp = S.effectiveDP(state, self, mine);
  const cands = digimonsOf(state, ctx.opp).filter((s) => S.effectiveDP(state, ctx.opp, s) <= dp);
  const t = await pickStack(ctx, ctx.opp, cands, `DP ${dp} 이하의 상대 디지몬 선택`, { kind: 'delete' });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
SCRIPTS['ST22-09::메인'] = [F(async (ctx) => {
  const { state } = ctx;
  await linkThisOption(ctx);
  const t = await pickStack(ctx, ctx.opp, state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트할 수 없게 할 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) S.preventRest(state, ctx.opp, t.uid, untilOppEnd(ctx));
})];
SCRIPTS['ST22-06::등장 시'] = [F(async (ctx) => {
  if (!(await confirm(ctx, '음양술/플러그인 옵션을 코스트 없이 사용할까요?'))) return;
  await useOptionFrom(ctx, ctx.self, ['hand', 'tamerUnder'], TOUCH_OPT, '사용할 옵션 카드 선택');
})];
SCRIPTS['ST22-04::어택 시'] = SCRIPTS['ST22-06::등장 시'];
SCRIPTS['ST22-04::등장 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp), '【진화 시】 봉인 + DP-3000 대상 선택', { kind: 'dpDown' });
  if (!t) return;
  t.noEvoTrigUntil = untilOppEnd(ctx);
  S.s7AddDpMod(ctx.state, ctx.opp, t.uid, -3000, untilOppEnd(ctx));
})];
// ST22-01 (inherited): after own use of an 음양술/플러그인 option, evolve this digimon
H('ST22-01', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { optionUsed: (state, hp, holder, info) => info.owner === hp && TOUCH_OPT(info.cardId) } });
SCRIPTS['ST22-01::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  if (!(await confirm(ctx, '패의 구미호몬/도사몬/샤크라몬으로 진화 코스트 -3 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIncl(id, '구미호몬', '도사몬', '샤크라몬'), { discount: 3 });
})];
// ST22-10: face-up in security -> protects Renamon-line digimon leaving other than by battle
H('ST22-10', {
  tag: '서로의 턴', zone: 'security',
  preventLeave: (state, hp, holder, target, tp, cause, mode, id) => {
    if (cause === 'battle') return false;
    if (!nameIncl(target.cardId, '레나몬', '구미호몬', '도사몬', '샤크라몬')) return false;
    if (!S.s7TrashFaceUpSecurity(state, hp, id)) return false;
    S.log(state, `${hp} ${C(id).nameKo} 파기 — ${C(target.cardId).nameKo}는 벗어나지 않음`);
    return true;
  },
});

// ==================================================================== BT24 (part 1)
SCRIPTS['BT24-085::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  const lim = oppMemory(state, self);
  const opts = state.players[self].hand.filter((id) => C(id).category === 'option' && hasType(id, 'TS') && (C(id).cost || 0) <= lim && S.optionColorOk(state, self, id));
  if (!opts.length) return;
  if (!(await confirm(ctx, '이 테이머를 레스트시켜 TS 옵션을 코스트 없이 사용할까요?'))) return;
  S.restStack(state, self, t.uid);
  await useOptionFrom(ctx, self, ['hand'], (id) => hasType(id, 'TS') && (C(id).cost || 0) <= lim, '사용할 TS 옵션 선택');
  const atk = digimonsOf(state, self).filter((s) => hasType(s.cardId, 'TS') && !s.suspended);
  const a = await pickStack(ctx, self, atk, '어택할 TS 디지몬 선택 (취소=어택 안 함)');
  if (a && ctx.startAttack) ctx.startAttack(self, a.uid);
})];
// BT24-054 (inherited): rests itself -> rest opp digimon/tamer with cost <= own cost
H('BT24-054', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { rest: (state, hp, holder, info) => info.stack === holder } });
SCRIPTS['BT24-054::서로의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const cost = C(st.cardId).cost || 0;
  const c = ctx.state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category) && (C(s.cardId).cost || 0) <= cost);
  const t = await pickStack(ctx, ctx.opp, c, `등장 코스트 ${cost} 이하의 상대 디지몬/테이머 선택`, { kind: 'rest' });
  if (t) await restIt(ctx, ctx.opp, t);
})];
SCRIPTS['BT24-055::등장 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const placed = await costPlaceUnder(ctx, st, ['hand'], (id) => nameIs(id, '서월령'), '진화원 아래에 놓을 「서월령」 선택');
  if (!placed) return;
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self).filter((s) => hasType(s.cardId, '디지대', '시커즈')), '《퇴화》를 받지 않을 디지몬 선택', { mandatory: true });
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['retreat'], until: untilOppEnd(ctx) });
})];
H('BT24-003', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['BT24-003::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '신인형 디지몬으로 진화 코스트 -1 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => hasType(id, '신인형'), { discount: 1 });
})];
H('BT24-007', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { discard: (state, hp, holder, info) => info.owner === hp && info.cardId && isDig(info.cardId) && lv(info.cardId) >= 4 && hasType(info.cardId, '귀인형', '타이탄족') } });
SCRIPTS['BT24-007::자신의 턴'] = [F(async (ctx) => {
  const e = evtOf(ctx);
  const { state, self } = ctx;
  const pl = state.players[self];
  if (!e || pl.trash.lastIndexOf(e.cardId) < 0) return;
  const cost = Math.max(0, (C(e.cardId).cost || 0) - 2);
  if (!(await confirm(ctx, `${C(e.cardId).nameKo}을(를) 등장 코스트 ${cost}로 등장시킬까요?`))) return;
  payMemory(state, self, cost);
  S.playFreeFromZone(state, self, 'trash', pl.trash.lastIndexOf(e.cardId));
})];
// BT24-012: another own 파충류형/용인형 digimon leaves by opp effect -> return this digimon to hand instead
// BT24-012 (inherited): opp security decreased during own turn -> memory +1 (generic script)
H('BT24-012', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === opp(hp) } });
H('BT24-012', {
  tag: '서로의 턴',
  preventLeave: (state, hp, holder, target, tp, cause) => {
    if (cause !== 'effect' || target === holder || !hasType(target.cardId, '파충류형', '용인형')) return false;
    if (!state.players[hp].battle.includes(holder)) return false;
    const pl = state.players[hp];
    pl.battle.splice(pl.battle.indexOf(holder), 1);
    if (!S.isTokenId(holder.cardId)) pl.hand.push(holder.cardId);
    pl.trash.push(...holder.sources.filter((x) => !S.isTokenId(x)), ...(holder.linkCards || []).map((l) => l.cardId));
    S.log(state, `${hp} ${C(holder.cardId).nameKo}을(를) 패로 되돌려 ${C(target.cardId).nameKo}는 벗어나지 않음`);
    return true;
  },
});
SCRIPTS['BT24-024::어택 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const i = await pickIdx(ctx, self, 'hand', (id) => C(id).category === 'tamer' && hasType(id, 'TS'), '코스트 -2로 등장시킬 TS 테이머 선택');
  if (i == null) return;
  payMemory(state, self, Math.max(0, (C(pl.hand[i]).cost || 0) - 2));
  S.playFreeFromZone(state, self, 'hand', i);
})];
const BT25_ACT = (state, hp, holder, info) => info.owner === hp && info.stack !== holder && hasType(info.stack.cardId, 'TS') && colorsOfStack(info.stack).includes('blue');
H('BT24-025', { tag: '자신의 턴', has: '액티브가 되었을 때', events: { active: BT25_ACT, unsuspend: BT25_ACT } });
SCRIPTS['BT24-025::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 「베누스몬」으로 Lv.을 무시하고 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIs(id, '베누스몬'), { normal: true }, { ignoreLevel: true });
})];
SCRIPTS['BT24-025::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => hasType(s.cardId, 'TS') && s.suspended), '액티브로 할 TS 디지몬 선택 (취소=안 함)');
  if (t) S.unsuspendStack(state, self, t.uid);
})];
SCRIPTS['BT24-027::등장 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const placed = await costPlaceUnder(ctx, st, ['hand'], (id) => isDig(id) && hasType(id, 'TS') && (C(id).colors || []).includes('blue') && lv(id) <= 4, '진화원 아래에 놓을 카드 선택');
  if (!placed) return;
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self).filter((s) => hasType(s.cardId, 'TS') && colorsOfStack(s).includes('blue')), '배틀로 소멸하지 않을 디지몬 선택', { mandatory: true });
  if (t) t.battleImmuneUntilTurn = untilOppEnd(ctx);
})];
SCRIPTS['BT24-029::등장 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const placed = await costPlaceUnder(ctx, st, ['hand'], (id) => (C(id).cost || 0) <= 5 && (typeIncl(id, '수생') || hasType(id, '바다짐승형', 'TS')), '진화원 아래에 놓을 카드 선택');
  if (!placed) return;
  const t = await pickStack(ctx, ctx.opp, ctx.state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트할 수 없게 할 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) S.preventRest(ctx.state, ctx.opp, t.uid, untilOppEnd(ctx));
})];
// play (free) a card from the holder's own evolution sources
async function playFromOwnSources(ctx, host, pred, prompt) {
  const { state, self } = ctx;
  if (!host) return null;
  const idxs = host.sources.map((id, i) => i).filter((i) => pred(host.sources[i]));
  if (!idxs.length) return null;
  const k = await pickFromList(ctx, self, idxs.map((i) => host.sources[i]), prompt || '진화원에서 코스트 없이 등장시킬 카드 선택 (취소=안 함)');
  if (k == null) return null;
  const pl = state.players[self];
  const [id] = host.sources.splice(idxs[k], 1);
  S.recomputeStackGrants(host);
  pl.trash.push(id);
  const st = S.playFreeFromZone(state, self, 'trash', pl.trash.length - 1, { fromSources: true });
  if (st) S.emitGameEvent(state, 'playFromSources', { owner: self, stack: st, cause: 'effect', level: C(st.cardId).level });
  return st;
}
SCRIPTS['BT24-029::어택 종료 시'] = [F(async (ctx) => {
  await playFromOwnSources(ctx, holderOf(ctx), (id) => (C(id).category === 'digimon' || C(id).category === 'tamer') && hasType(id, 'TS') && (C(id).cost || 0) <= 5);
})];
SCRIPTS['BT24-029::어택 시'] = [F(async (ctx) => {
  await playFromOwnSources(ctx, holderOf(ctx), (id) => isDig(id) && hasType(id, 'TS') && (C(id).colors || []).includes('blue') && lv(id) <= 4);
})];
SCRIPTS['BT24-031::어택 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (pl.security.length && (await confirm(ctx, '시큐리티 위 1장을 패에 추가할까요?'))) secToHand(state, self, 0);
  if (pl.security.length === 0) S.recoverTopOfDeckToSecurity(state, self);
})];
SCRIPTS['BT24-038::등장 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const { state, self } = ctx;
  const pl = state.players[self];
  const ok = (id) => isDig(id) && lv(id) <= 4 && canLink(id, st);
  const cands = [...pl.hand.filter(ok).map((id) => ({ id, zone: 'hand' })), ...st.sources.filter(ok).map((id) => ({ id, zone: 'sources' }))];
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '링크할 Lv.4 이하 디지몬 카드 선택');
  if (k == null) return;
  await linkFrom(ctx, self, st, cands[k].zone, cands[k].id, 'free');
})];
// BT24-038: 【서로의 턴】[턴에 1회] this digimon got linked -> opp digimon DP -7000 (generic script)
H('BT24-038', { tag: '서로의 턴', has: '링크했을 때', limit: 1, events: { linked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
// ---- shared helpers (part 2)
function once(holder, id, key, limit = 1) {
  const k = S.onceLimitKey(id, [key]);
  if (S.turnUsesRemaining(holder, k, limit) <= 0) return false;
  S.markTurnEffectUsed(holder, k);
  return true;
}
function moveOut(state, who, st, dest) {
  const pl = state.players[who];
  const i = pl.battle.indexOf(st);
  if (i < 0) return false;
  pl.battle.splice(i, 1);
  const real = (x) => !S.isTokenId(x);
  if (real(st.cardId)) {
    if (dest === 'hand') pl.hand.push(st.cardId);
    else if (dest === 'deckTop') pl.deck.unshift(st.cardId);
    else if (dest === 'deckBottom') pl.deck.push(st.cardId);
    else if (dest === 'secBottom') pl.security.push(st.cardId);
  }
  pl.trash.push(...st.sources.filter(real), ...(st.linkCards || []).map((l) => l.cardId).filter(real));
  S.applyOverflowBatch(state, who, [...st.sources, st.cardId]);
  return true;
}
// mind link: this tamer goes under a digimon that has no tamer card among its sources
function mindLink(ctx, who, tamer, host) {
  const { state } = ctx;
  const pl = state.players[who];
  if (host.sources.some((id) => C(id).category === 'tamer')) return false;
  const i = pl.battle.indexOf(tamer);
  if (i < 0) return false;
  pl.battle.splice(i, 1);
  pl.trash.push(...tamer.sources.filter((x) => !S.isTokenId(x)));
  host.sources.unshift(tamer.cardId);
  S.recomputeStackGrants(host);
  S.log(state, `${who} ${C(tamer.cardId).nameKo} 《마인드 링크》 → ${C(host.cardId).nameKo}`);
  return true;
}
// tokens
const TOKENS = {
  'S7-TOKEN-DAERONG': { nameKo: '대롱 여우', colors: ['yellow'], dp: 6000, effectKo: '《블로커》', level: null },
};
function spawnToken(ctx, who, tid) {
  const { state } = ctx;
  if (!S.CARDS[tid]) S.CARDS[tid] = { cardId: tid, id: tid, category: 'digimon', cost: 0, evoNormal: null, inheritedKo: '', imgUrl: '', types: [], isToken: true, ...TOKENS[tid] };
  const pl = state.players[who];
  pl.trash.push(tid);
  return S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1);
}
// run one printed 【등장 시】/【진화 시】 segment of a stack
async function runSegmentOf(ctx, who, stack, tagPred, prompt) {
  const Fx = await import('../effects.js');
  const onceOf = (sg) => { const m = sg.body.trim().match(/^[\[〔]턴\s*에?\s*(\d+)\s*회[\]〕]/); return m ? Number(m[1]) : null; };
  // 공식 Q&A idx6137 (BT24-102): 《계승》으로 얻고 있는 【등장 시】/【진화 시】 효과도 발휘할 수 있다 — the inherited source card's printed segments count as this stack's own
  const ik = S.inheritKeywordSource ? S.inheritKeywordSource(stack) : null;
  const cids = ik && ik !== stack.cardId ? [stack.cardId, ik] : [stack.cardId];
  const segs = [];
  for (const cid of cids) {
    for (const sg of S.parseEffectSegments(C(cid).effectKo || '').segments.filter((sg) => sg.tags.some(tagPred))
      // W8 (Q5721/Q6029 BT24-102): a 【진화 시】-only (or 【등장 시】-only) effect the target is barred from ("발휘하지 않는다") cannot be borrowed — a 【등장 시】【진화 시】 dual one can still be used as its 【등장 시】;
      // and a [턴에 N회] effect that is already used up this turn cannot be activated through another card's effect either.
      .filter((sg) => !(sg.tags.some((t) => t.includes('진화 시')) && !sg.tags.some((t) => t.includes('등장 시')) && S.evoTrigSuppressed(ctx.state, who, stack)))
      .filter((sg) => !(sg.tags.some((t) => t.includes('등장 시')) && !sg.tags.some((t) => t.includes('진화 시')) && S.hookSuppressTrigger(ctx.state, who, stack, '등장 시')))
      .filter((sg) => { const lim = onceOf(sg); return lim == null || S.turnUsesRemaining(stack, S.onceLimitKey(cid, sg.tags), lim) > 0; })) segs.push({ cid, sg });
  }
  if (!segs.length) return false;
  let pick = segs[0];
  if (segs.length > 1) {
    const k = await ctx.choose('multipleChoice', { prompt, options: segs.map((x) => x.sg.body.slice(0, 40)) });
    pick = segs[k == null ? 0 : k];
  }
  const { cid, sg: seg } = pick;
  const script = Fx.lookupCardSpecific(cid, seg.tags, seg.body) || Fx.compileToScript(seg.body);
  if (!script || !script.length) return false;
  if (onceOf(seg) != null) S.markTurnEffectUsed(stack, S.onceLimitKey(cid, seg.tags)); // the borrowed activation spends the [턴에 N회] (15-x)
  const c2 = { ...ctx, self: who, opp: opp(who), sourceCardId: cid, sourceStackUid: stack.uid, trigger: { tags: seg.tags, text: seg.body, evt: { kind: 'play' } } };
  await Fx.runScript(script, c2);
  return true;
}
async function trashSourcesPicked(ctx, who, st, n) {
  const idxs = [];
  for (let k = 0; k < n; k++) {
    const rest = st.sources.map((id, i) => ({ id, i })).filter((x) => !idxs.includes(x.i));
    if (!rest.length) break;
    const pick = await pickFromList(ctx, who, rest.map((x) => x.id), `${C(st.cardId).nameKo}의 진화원에서 파기할 카드 선택 (${k + 1}/${n})`, who !== ctx.self ? ctx.self : undefined);
    if (pick == null) break;
    idxs.push(rest[pick].i);
  }
  if (idxs.length) S.trashEvoSources(ctx.state, who, st.uid, idxs.length, 'bottom', idxs);
}
const LOWLV = (state, who) => { const ds = digimonsOf(state, who); if (!ds.length) return []; const m = Math.min(...ds.map((s) => lv(s.cardId))); return ds.filter((s) => lv(s.cardId) === m); };

// ==================================================================== BT24 (part 2)
H('BT24-040', {
  tag: '서로의 턴', has: '벗어날 때', limit: 1,
  // every eligible source-less Digimon is its own candidate, so the player chooses which one goes under security (S.hookPreventLeave)
  preventLeaveOptions: (state, hp, holder, target, tp, cause, mode, id) => {
    if (cause === 'ownEffect' || !S.isDigimonLike(target) || !hasType(target.cardId, 'TS')) return [];
    return state.players[hp].battle.filter((s) => s !== holder && s !== target && S.isDigimonLike(s) && s.sources.length === 0).map((pay) => ({ apply() {
      if (!once(holder, id, 'BT24-040-leave')) return false;
      moveOut(state, hp, pay, 'secBottom');
      S.log(state, `${hp} ${C(pay.cardId).nameKo}을(를) 시큐리티 아래에 놓아 ${C(target.cardId).nameKo}는 벗어나지 않음`);
      return true;
    } }));
  },
});
SCRIPTS['BT24-043::어택 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp), '레스트시킬 상대 디지몬 선택', { kind: 'rest' });
  if (t) await restIt(ctx, ctx.opp, t);
})];
SCRIPTS['BT24-044::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const all = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid, s })), ...digimonsOf(state, ctx.opp).map((s) => ({ player: ctx.opp, uid: s.uid, s }))].filter((e) => lv(e.s.cardId) <= 6);
  if (!all.length) return;
  const entries = all.filter((e) => e.player === self || !S.effectBlocked(state, e.player, e.s, 'rest')).map(({ player, uid }) => ({ player, uid }));
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: 'Lv.6 이하 디지몬 1장 레스트 (취소=안 함)' });
  if (!pick) return;
  const st = findSt(state, pick.player, pick.uid);
  if (!st || !(await restIt(ctx, pick.player, st)) || pick.player !== self) return;
  await revealPick(ctx, 3, [(id) => nameIs(id, '카자마 쇼토'), (id) => BIRD(id)]);
})];
H('BT24-044', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { battleWin: (state, hp, holder, info) => info.stack === holder && info.loser && !state.players[opp(hp)].battle.includes(info.loser) } });
SCRIPTS['BT24-044::서로의 턴'] = [F(async (ctx) => { S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId); })];
SCRIPTS['BT24-045::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (!pl.hand.length || !digimonsOf(state, ctx.opp).length) return;
  const i = await ctx.choose('pickFromHandIndexes', { player: self, eligibleIdxs: pl.hand.map((x, k) => k), n: 1, prompt: '파기할 패 1장 선택' });
  if (!i || !i.length) return;
  S.trashFromHand(state, self, i[0]);
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '레스트시킬 상대 디지몬 선택', { kind: 'rest' });
  if (!t) return;
  await restIt(ctx, ctx.opp, t);
  S.setSkipNextUnsuspend(state, ctx.opp, t.uid);
})];
SCRIPTS['BT24-045::어택 시'] = SCRIPTS['BT24-045::등장 시'];
SCRIPTS['BT24-047::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
  if (!pick) return;
  const st = findSt(state, pick.player, pick.uid);
  if (!st || !(await restIt(ctx, pick.player, st)) || pick.player !== self) return;
  const cands = digimonsOf(state, self).filter((s) => BIRD(s.cardId) && s.suspended);
  const a = await pickStack(ctx, self, cands, '액티브로 할 디지몬 선택');
  if (!a) return;
  S.unsuspendStack(state, self, a.uid);
  if (!a.suspended && ctx.startAttack && (await confirm(ctx, `${C(a.cardId).nameKo}(으)로 어택할까요?`))) ctx.startAttack(self, a.uid);
})];
SCRIPTS['BT24-048::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  if (!state.players[self].raising && state.players[self].digitamaDeck.length && await confirm(ctx, '육성 에어리어를 부화할까요?')) S.s7HatchByEffect(state, self);
  const r = state.players[self].raising;
  if (!r || !BIRD(r.cardId)) return;
  if (!(await confirm(ctx, '육성 에어리어의 디지몬을 코스트 없이 진화시킬까요?'))) return;
  await evolveStack(ctx, self, r, 'hand', (id) => BIRD(id) && lv(id) <= 5, { free: true });
})];
H('BT24-052', {
  tag: '서로의 턴', src: 'inheritedKo', limit: 1,
  preventLeave: (state, hp, holder, target, tp, cause, mode, id) => {
    if (target !== holder || !mentions(target.cardId, '디아블로몬')) return false;
    const o = state.players[hp].battle.find((s) => s !== holder && C(s.cardId).nameKo === '디아블로몬');
    if (!o || !once(holder, id, 'BT24-052-leave')) return false;
    S.deleteStack(state, hp, o.uid, 'trash', 'ownEffect');
    return true;
  },
});
SCRIPTS['BT24-056::등장 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self).filter((s) => hasType(s.cardId, '시스템', '라이프', '변화')), '상대 효과로 패/덱으로 돌아가지 않을 디지몬 선택', { mandatory: true });
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['bounce'], until: untilOppEnd(ctx) });
})];
SCRIPTS['BT24-061::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const c = state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category) && (C(s.cardId).cost || 0) <= 3);
  const t = await pickStack(ctx, ctx.opp, c, '덱 위로 되돌릴 상대 디지몬/테이머 선택', { kind: 'bounce' });
  if (t) bounceIt(ctx, ctx.opp, t, 'deckTop');
})];
SCRIPTS['BT24-074::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length), '진화원을 파기할 상대 디지몬 선택', { kind: 'srcTrash' });
  if (t) await trashSourcesPicked(ctx, ctx.opp, t, 3);
  const st = holderOf(ctx);
  if (!st || !st.s7ByEffect || !(ctx.trigger && ctx.trigger.evt && ctx.trigger.evt.kind === 'play')) return;
  const c = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length === 0), '소멸시킬 진화원 없는 상대 디지몬 선택', { kind: 'delete' });
  if (c) destroyIt(ctx, ctx.opp, c);
})];
SCRIPTS['BT24-075::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (!pl.hand.length) return;
  const i = await ctx.choose('pickFromHandIndexes', { player: self, eligibleIdxs: pl.hand.map((x, k) => k), n: 1, prompt: '파기할 패 1장 선택' });
  if (!i || !i.length) return;
  S.trashFromHand(state, self, i[0]);
  for (const L of [3, 4]) {
    const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => lv(s.cardId) === L), `Lv.${L} 상대 디지몬 선택`, { kind: 'delete' });
    if (t) destroyIt(ctx, ctx.opp, t);
  }
})];
SCRIPTS['BT24-076::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const id = ctx.sourceCardId;
  const i = pl.trash.lastIndexOf(id);
  if (i < 0 || pl.hand.length > 4) return;
  payMemory(state, self, Math.max(0, (C(id).cost || 0) - 2));
  S.playFreeFromZone(state, self, 'trash', i);
})];
SCRIPTS['BT24-077::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const st = holderOf(ctx);
  const pl = state.players[self];
  const hosts = digimonsOf(state, self);
  const cands = [];
  const okAny = (id) => isDig(id) && lv(id) <= 4 && hosts.some((h) => canLink(id, h));
  pl.trash.forEach((id) => { if (okAny(id) && !cands.some((c) => c.id === id && c.zone === 'trash')) cands.push({ id, zone: 'trash' }); });
  if (st) st.sources.forEach((id) => { if (okAny(id) && !cands.some((c) => c.id === id && c.zone === 'sources')) cands.push({ id, zone: 'sources' }); });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '링크할 Lv.4 이하 디지몬 카드 선택');
  if (k == null) return;
  const c = cands[k];
  const host = await pickStack(ctx, self, hosts.filter((h) => canLink(c.id, h)), '링크할 디지몬 선택', { mandatory: true });
  if (!host) return;
  if (c.zone === 'sources') { const i = st.sources.lastIndexOf(c.id); st.sources.splice(i, 1); S.recomputeStackGrants(st); await linkFrom(ctx, self, host, 'none', c.id, 'free'); }
  else await linkFrom(ctx, self, host, 'trash', c.id, 'free');
})];
SCRIPTS['BT24-080::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const id = ctx.sourceCardId;
  if (pl.hand.length > 4 || pl.trash.lastIndexOf(id) < 0) return;
  const st = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => hasType(s.cardId, '마룡형', '사룡형')), '이 카드로 진화시킬 디지몬 선택 (취소=안 함)');
  if (!st) return;
  pl.trash.splice(pl.trash.lastIndexOf(id), 1);
  S.digivolve(state, self, st.uid, id, 0, 'trash');
})];
SCRIPTS['BT24-080::등장 시'] = [F(async (ctx) => {
  for (const s of LOWLV(ctx.state, ctx.opp)) destroyIt(ctx, ctx.opp, s);
})];
H('BT24-084', { tag: '서로의 턴', has: '이 테이머를 레스트', events: { securityDecrease: (state, hp, holder, info) => info.owner === hp && !holder.suspended && C(holder.cardId).category === 'tamer' } });
SCRIPTS['BT24-084::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  const c = digimonsOf(state, self).filter((s) => nameIs(s.cardId, '아이기오몬'));
  if (!c.length || !state.players[self].hand.some((id) => isDig(id) && nameIncl(id, '아이기오투스몬'))) return;
  if (!(await confirm(ctx, '이 테이머를 레스트시켜 「아이기오몬」을 아이기오투스몬으로 진화시킬까요?'))) return;
  S.restStack(state, self, t.uid);
  const st = await pickStack(ctx, self, c, '진화시킬 「아이기오몬」 선택', { mandatory: true });
  if (st) await evolveStack(ctx, self, st, 'hand', (id) => nameIncl(id, '아이기오투스몬'), { free: true });
})];
H('BT24-086', { tag: '서로의 턴', has: '마인드 링크', events: {
  play: (state, hp, holder, info) => info.owner === hp && C(holder.cardId).category === 'tamer' && S.isDigimonLike(info.stack),
  digivolve: (state, hp, holder, info) => info.owner === hp && C(holder.cardId).category === 'tamer' && S.isDigimonLike(info.stack) } });
H('BT24-086', { tag: '서로의 턴', has: '얻는다', src: 'inheritedKo', kw: (state, hp, holder, name) => (name === '연계' || name === '재기동') && hasType(holder.cardId, 'X항체', '디지대', '시커즈') });
SCRIPTS['BT24-086::서로의 턴@마인드 링크'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t) return;
  const hosts = digimonsOf(state, self).filter((s) => hasType(s.cardId, 'X항체', '디지대', '시커즈') && !s.sources.some((id) => C(id).category === 'tamer'));
  const h = await pickStack(ctx, self, hosts, '《마인드 링크》할 디지몬 선택 (취소=안 함)');
  if (h) mindLink(ctx, self, t, h);
})];
SCRIPTS['BT24-091::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  let n = 0;
  for (const s of LOWLV(state, ctx.opp)) if (bounceIt(ctx, ctx.opp, s, 'hand')) n++;
  if (n) {
    const t = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => hasType(s.cardId, 'TS') && s.suspended), '액티브로 할 TS 디지몬 선택');
    if (t) S.unsuspendStack(state, self, t.uid);
  }
  await linkThisOption(ctx);
})];
SCRIPTS['BT24-091::시큐리티'] = SCRIPTS['BT24-091::메인'];
SCRIPTS['BT24-091::어택 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, LOWLV(ctx.state, ctx.opp), 'Lv.이 가장 낮은 상대 디지몬 선택', { kind: 'bounce', mandatory: true });
  if (t) bounceIt(ctx, ctx.opp, t, 'hand');
})];
SCRIPTS['BT24-095::메인'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트시킬 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) { await restIt(ctx, ctx.opp, t); S.setSkipNextUnsuspend(state, ctx.opp, t.uid); }
  await linkThisOption(ctx);
})];
SCRIPTS['BT24-095::시큐리티'] = SCRIPTS['BT24-095::메인'];
SCRIPTS['BT24-095::어택 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp).filter((s) => s.suspended), '패로 되돌릴 레스트 상태의 상대 디지몬 선택', { kind: 'bounce' });
  if (t) bounceIt(ctx, ctx.opp, t, 'hand');
})];
// BT24-093: 딜레이 — when own security decreases, discard this placed option to put a source card on top of security
H('BT24-093', { tag: '서로의 턴', has: '딜레이', events: { securityDecrease: (state, hp, holder, info) => info.owner === hp && C(holder.cardId).category === 'option' && state.turnNumber > holder.placedTurn } });
SCRIPTS['BT24-093::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (!h || state.turnNumber <= h.placedTurn) return;
  const c = digimonsOf(state, self).filter((s) => nameIncl(s.cardId, '아이기오투스몬', '유피테르몬') && s.sources.length);
  if (!c.length || !(await confirm(ctx, '《딜레이》 — 이 카드를 파기하여 디지몬의 겹쳐진 카드를 시큐리티 위에 놓을까요?'))) return;
  S.discardForDelay(state, self, h.uid);
  const t = await pickStack(ctx, self, c, '겹쳐진 카드를 시큐리티 위에 놓을 디지몬 선택', { mandatory: true });
  if (!t) return;
  const id = t.sources.pop();
  S.recomputeStackGrants(t);
  state.players[self].security.unshift(id);
  S.log(state, `${self} ${C(t.cardId).nameKo}의 겹쳐진 ${C(id).nameKo}을(를) 시큐리티 위에 놓음`);
  S.emitGameEvent(state, 'securityIncrease', { owner: self, stack: null, cause: 'effect' });
})];
H('BT24-101', { tag: '서로의 턴', has: '줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['BT24-101::서로의 턴@줄어들었을 때'] = [F(async (ctx) => { S.trashTopSecurityByEffect(ctx.state, ctx.opp); })];
H('BT24-101', {
  tag: '서로의 턴', has: '벗어날 때',
  preventLeave: (state, hp, holder, target, tp, cause, mode, id) => {
    if (!hasType(target.cardId, 'TS') || !['digimon', 'tamer'].includes(C(target.cardId).category)) return false;
    if (!state.players[hp].security.length || !once(holder, id, 'BT24-101-leave')) return false;
    S.trashTopSecurityByEffect(state, hp);
    return true;
  },
});
H('BT24-102', { tag: '서로의 턴', has: 'DP +1000', dp: (state, hp, holder, target, tp) => (tp === hp && C(target.cardId).category === 'digimon' && hasType(target.cardId, 'TS') ? 1000 : 0) });
SCRIPTS['BT24-102::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  const c = digimonsOf(state, self).filter((s) => hasType(s.cardId, '올림포스 12신'));
  if (!c.length || !(await confirm(ctx, '이 테이머를 레스트시켜 올림포스 12신의 【등장 시】/【진화 시】 효과를 발휘할까요?'))) return;
  S.restStack(state, self, t.uid);
  const d = await pickStack(ctx, self, c, '효과를 발휘할 디지몬 선택', { mandatory: true });
  if (d) await runSegmentOf(ctx, self, d, (tg) => tg.includes('등장 시') || tg.includes('진화 시'), '발휘할 효과 선택');
})];

// ==================================================================== P-2xx
SCRIPTS['P-215::이동 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st) return;
  const T3 = (id) => hasType(id, '빙설형', '광물형', '광석형');
  const placed = await costPlaceUnder(ctx, st, ['hand', 'trash'], (id) => T3(id) && lv(id) <= 4, '진화원 아래에 놓을 카드 선택');
  if (!placed) return;
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self).filter((s) => T3(s.cardId)), '보호할 디지몬 선택', { mandatory: true });
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['bounce', 'retreat'], until: untilOppEnd(ctx) });
})];
SCRIPTS['P-215::등장 시'] = SCRIPTS['P-215::이동 시'];
SCRIPTS['P-215::진화 시'] = SCRIPTS['P-215::이동 시'];
SCRIPTS['P-221::진화 시@조그레스 진화하고 있다면'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (st && st.viaFusion) S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until: untilOppEnd(ctx) });
})];
SCRIPTS['P-221::진화 시@DP -10000'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp), 'DP -10000 대상 선택', { kind: 'dpDown' });
  if (t) S.s7AddDpMod(ctx.state, ctx.opp, t.uid, -10000, untilOppEnd(ctx));
})];
SCRIPTS['P-222::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
  if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) await restIt(ctx, pick.player, st); }
})];
SCRIPTS['P-223::등장 시'] = [F(async (ctx) => {
  if (!(await confirm(ctx, '음양술/플러그인 옵션을 코스트 없이 사용할까요?'))) return;
  await useOptionFrom(ctx, ctx.self, ['hand', 'trash'], TOUCH_OPT, '사용할 옵션 카드 선택');
})];
H('P-223', { tag: '서로의 턴', has: '대롱 여우', limit: 1, events: { optionUsed: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['P-223::서로의 턴'] = [F(async (ctx) => {
  if (await confirm(ctx, '「대롱 여우」 토큰을 등장시킬까요?')) spawnToken(ctx, ctx.self, 'S7-TOKEN-DAERONG');
})];
// ==================================================================== EX11 helpers
function faceDownTopIdx(state, p) {
  const pl = state.players[p];
  for (let i = 0; i < pl.security.length; i++) {
    const id = pl.security[i];
    const up = (pl.secUp && pl.secUp[id]) || 0;
    if (pl.security.filter((x) => x === id).length > up) return i;
  }
  return -1;
}
function secToHand(state, p, idx) {
  const pl = state.players[p];
  const [id] = pl.security.splice(idx, 1);
  if (!id) return null;
  pl.hand.push(id);
  S.secFaceUpTake(pl, id);
  S.log(state, `${p} 시큐리티의 카드를 패에 추가: ${C(id).nameKo}`);
  S.emitGameEvent(state, 'securityDecrease', { owner: p, stack: null, cause: 'effect' });
  return id;
}
const ROYAL = (id) => hasType(id, '로얄 베이스');
// "자신의 뒷면 시큐리티를 위에서부터 1장 패에 추가한다. 그 후, 패의 로얄 베이스 디지몬을 시큐리티 아래에 앞면으로"
async function royalSecurityCycle(ctx, optionalPlace) {
  const { state, self } = ctx;
  const pl = state.players[self];
  const i = faceDownTopIdx(state, self);
  if (i >= 0) secToHand(state, self, i);
  const hi = await pickIdx(ctx, self, 'hand', (id) => isDig(id) && ROYAL(id), '시큐리티 아래에 앞면으로 놓을 「로얄 베이스」 디지몬 선택' + (optionalPlace ? ' (취소=안 함)' : ''));
  if (hi == null) return;
  const id = pl.hand.splice(hi, 1)[0];
  S.secAddFaceUp(state, self, id, 'bottom');
}
// generic link effect
async function doLink(ctx, o) {
  const { state, self } = ctx;
  const pl = state.players[self];
  const me = holderOf(ctx);
  for (let n = 0; n < (o.times || 1); n++) {
    const hosts = o.host === 'this' ? (me ? [me] : []) : digimonsOf(state, self).filter((s) => o.host !== 'other' || s !== me);
    const cands = [];
    const okFor = (id) => o.pred(id) && hosts.some((h) => canLink(id, h));
    if (o.zones.includes('hand')) pl.hand.forEach((id) => { if (okFor(id)) cands.push({ id, zone: 'hand' }); });
    if (o.zones.includes('trash')) pl.trash.forEach((id) => { if (okFor(id) && !cands.some((c) => c.id === id && c.zone === 'trash')) cands.push({ id, zone: 'trash' }); });
    if (o.zones.includes('sources') && me) me.sources.forEach((id) => { if (okFor(id) && !cands.some((c) => c.id === id && c.zone === 'sources')) cands.push({ id, zone: 'sources' }); });
    if (!cands.length) return;
    const k = await pickFromList(ctx, self, cands.map((c) => c.id), o.prompt || '링크할 카드 선택 (취소=안 함)');
    if (k == null) return;
    const c = cands[k];
    const host = await pickStack(ctx, self, hosts.filter((h) => canLink(c.id, h)), '링크할 디지몬 선택', { mandatory: true });
    if (!host) return;
    if (c.zone === 'sources') { me.sources.splice(me.sources.lastIndexOf(c.id), 1); S.recomputeStackGrants(me); await linkFrom(ctx, self, host, 'none', c.id, o.delta ?? 'free'); }
    else await linkFrom(ctx, self, host, c.zone, c.id, o.delta ?? 'free');
  }
}
// pick an own digimon that has an eligible evolution card, then evolve it
async function evolveOwn(ctx, stackPred, zone, cardPred, mode, o = {}) {
  const { state, self } = ctx;
  const pl = state.players[self];
  const arr = zone === 'trash' ? pl.trash : pl.hand;
  const okStacks = digimonsOf(state, self).filter((s) => stackPred(s) && arr.some((id) => isDig(id) && cardPred(id) && evoCheck(ctx, s, id, o).ok));
  const st = await pickStack(ctx, self, okStacks, o.stackPrompt || '진화시킬 디지몬 선택 (취소=안 함)', { mandatory: true });
  if (!st) return null;
  return evolveStack(ctx, self, st, zone, cardPred, mode, o);
}
async function jogressFromHand(ctx, who, cardPred) {
  const { state } = ctx;
  const pl = state.players[who];
  const ds = digimonsOf(state, who);
  const pairsFor = (id) => { const out = []; for (let a = 0; a < ds.length; a++) for (let b = a + 1; b < ds.length; b++) if (S.canJogress(ds[a], ds[b], id).ok) out.push([ds[a], ds[b]]); return out; };
  const i = await pickIdx(ctx, who, 'hand', (id) => isDig(id) && cardPred(id) && !!S.parseJogress(id) && pairsFor(id).length > 0, '조그레스 진화할 카드 선택 (취소=안 함)');
  if (i == null) return null;
  const id = pl.hand[i];
  const pairs = pairsFor(id);
  const firsts = [...new Set(pairs.flat())];
  const a = await pickStack(ctx, who, firsts, '조그레스 소재 1 선택', { mandatory: true });
  if (!a) return null;
  const partners = pairs.filter((p2) => p2.includes(a)).map((p2) => p2.find((x) => x !== a));
  const b = await pickStack(ctx, who, partners, '조그레스 소재 2 선택', { mandatory: true });
  if (!b) return null;
  const j = S.parseJogress(id);
  return S.fuseJogress(state, who, a, b, id);
}
const cost2 = (ctx) => 0;
const trashCards = (id, ...t) => hasType(id, ...t);
const MIN = (id) => hasType(id, '광물형', '광석형');

// ==================================================================== EX11 (part 1)
SCRIPTS['P-224::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  const cands = [];
  for (const tm of tamersOf(state, self)) tm.sources.forEach((id) => { if (isDig(id) && lv(id) >= 5 && hasType(id, '크로스 하트')) cands.push({ id, tm }); });
  if (!cands.length || !(await confirm(ctx, '이 테이머를 레스트시켜 테이머 아래의 크로스 하트 디지몬을 코스트 -1로 등장시킬까요?'))) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '등장시킬 카드 선택');
  if (k == null) return;
  const c = cands[k];
  S.restStack(state, self, t.uid);
  c.tm.sources.splice(c.tm.sources.indexOf(c.id), 1);
  payMemory(state, self, Math.max(0, (C(c.id).cost || 0) - 1));
  const pl = state.players[self];
  pl.trash.push(c.id);
  S.playFreeFromZone(state, self, 'trash', pl.trash.length - 1);
})];
H('P-224', { tag: '자신의 턴', has: '이 테이머를 레스트', activate: true });

SCRIPTS['EX11-034::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const up = S.secFaceUpCount(pl);
  const i = await pickIdx(ctx, self, 'hand', (id) => mentions(id, '로얄 베이스') && C(id).category !== 'option', '등장시킬 「로얄 베이스」 카드 선택 (취소=안 함)');
  if (i == null) return;
  const id = pl.hand[i];
  payMemory(state, self, Math.max(0, (C(id).cost || 0) - up));
  S.playFreeFromZone(state, self, 'hand', i);
})];
SCRIPTS['EX11-063::등장 시'] = [F(async (ctx) => { await royalSecurityCycle(ctx, false); })];
SCRIPTS['EX11-025::자신의 메인 페이즈 개시 시'] = SCRIPTS['EX11-063::등장 시'];
SCRIPTS['EX11-030::등장 시'] = [F(async (ctx) => { await royalSecurityCycle(ctx, true); })];
SCRIPTS['EX11-051::소멸 시'] = [F(async (ctx) => {
  await evolveOwn(ctx, (s) => hasType(s.cardId, '고스트형'), 'hand', (id) => hasType(id, '고스트형'), { free: true });
})];
SCRIPTS['EX11-070::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const fused = await jogressFromHand(ctx, self, (id) => nameIs(id, '엑스마키나몬'));
  if (!t || !state.players[self].battle.includes(t)) return;
  const hosts = digimonsOf(state, self).filter((s) => mentions(s.cardId, '마키나몬') && !s.sources.some((id) => C(id).category === 'tamer'));
  if (!hosts.length) return;
  const h = await pickStack(ctx, self, hosts, '《마인드 링크》할 「마키나몬」 디지몬 선택 (취소=안 함)');
  if (h) mindLink(ctx, self, t, h);
})];
H('EX11-070', {
  tag: '서로의 턴', has: '1000보다', src: 'inheritedKo',
  dpFloor: (state, hp, holder) => (mentions(holder.cardId, '마키나몬') ? 1000 : null),
  effectImmune: (state, hp, holder, target, tp, o) => target === holder && mentions(holder.cardId, '마키나몬') && o.kind === 'srcTrash',
});
SCRIPTS['EX11-040::등장 시'] = [F(async (ctx) => { await doLink(ctx, { zones: ['hand', 'sources'], pred: (id) => nameIs(id, '마키나몬'), host: 'any' }); })];
SCRIPTS['EX11-006::어택 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(st.linkCards || []).some((l) => nameIs(l.cardId, '마키나몬'))) return;
  if (!(await confirm(ctx, '패의 「마키나몬」 디지몬으로 진화 코스트 -2 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => mentions(id, '마키나몬'), { discount: 2 });
})];
SCRIPTS['EX11-067::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const c = digimonsOf(state, self).filter((s) => nameIncl(s.cardId, '루체몬'));
  if (!c.length) return;
  const ok = (id) => isDig(id) && nameIncl(id, '루체몬');
  const zones = ['hand', 'trash'].filter((z) => pl[z].some(ok));
  if (!zones.length) return;
  let z = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '진화할 카드의 위치', options: ['패', '트래시'] }); z = k === 1 ? 'trash' : 'hand'; }
  await evolveOwn(ctx, (s) => nameIncl(s.cardId, '루체몬'), z, ok, { free: true });
})];
SCRIPTS['EX11-069::서로의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const pl = state.players[self];
  if (!t || t.suspended || pl.hand.length > 4) return;
  const i = await pickIdx(ctx, self, 'trash', (id) => hasType(id, '소악마형', '마룡형', '사룡형'), '패로 되돌릴 카드 선택 (취소=안 함)');
  if (i == null) return;
  S.restStack(state, self, t.uid);
  pl.hand.push(pl.trash.splice(i, 1)[0]);
})];
H('EX11-021', { tag: '상대의 턴', src: 'inheritedKo', has: '어택을 종료', limit: 1, events: { attack: (state, hp, holder, info) => info.owner !== hp } });
SCRIPTS['EX11-021::상대의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  const c = digimonsOf(state, self).filter((s) => s !== h);
  if (!c.length || !(await confirm(ctx, '다른 자신의 디지몬 1장을 소멸시켜 그 어택을 종료할까요?'))) return;
  const t = await pickStack(ctx, self, c, '소멸시킬 디지몬 선택', { mandatory: true });
  if (!t) return;
  destroyIt(ctx, self, t);
  if (ctx.endAttack) ctx.endAttack();
})];
SCRIPTS['EX11-016::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length), '진화원을 파기할 상대 디지몬 선택', { kind: 'srcTrash' });
  if (t) await trashSourcesPicked(ctx, ctx.opp, t, 2);
  const c = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length === 0), '시큐리티에 둘 진화원 없는 상대 디지몬 선택 (취소=안 함)', { kind: 'bounce' });
  if (!c) return;
  const k = await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] });
  if (bounceIt(ctx, ctx.opp, c, k === 1 ? 'secBottom' : 'secTop')) S.emitGameEvent(state, 'securityIncrease', { owner: ctx.opp, stack: null, cause: 'effect' });
})];
const FACEUP_CHECK = { tag: '자신의 턴', has: '앞면', events: { faceUpChecked: (state, hp, holder, info) => info.owner === hp } };
H('EX11-041', { ...FACEUP_CHECK });
H('EX11-043', { ...FACEUP_CHECK });
SCRIPTS['EX11-041::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (!h || !h.sources.length || !(await confirm(ctx, '이 디지몬의 겹쳐진 카드를 시큐리티 아래에 앞면으로 놓을까요?'))) return;
  const id = h.sources.pop();
  S.recomputeStackGrants(h);
  S.secAddFaceUp(state, self, id, 'bottom');
})];
SCRIPTS['EX11-043::자신의 턴'] = SCRIPTS['EX11-041::자신의 턴'];
SCRIPTS['EX11-011::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (entries.length) {
    const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
    if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) await restIt(ctx, pick.player, st); }
  }
  const keep = [];
  for (const who of [self, ctx.opp]) {
    const ds = digimonsOf(state, who).filter((s) => !(C(s.cardId).isToken || /TOKEN/i.test(String(s.cardId)))); // Q5796: tokens have no play cost, they cannot be "the highest-cost digimon"
    if (!ds.length) continue;
    const max = Math.max(...ds.map((s) => C(s.cardId).cost || 0));
    const top = ds.filter((s) => (C(s.cardId).cost || 0) === max);
    const k = top.length === 1 ? top[0] : await pickStack(ctx, self, top, `${who}의 등장 코스트가 가장 높은 디지몬 선택`, { mandatory: true });
    if (k) keep.push(k);
  }
  for (const who of [self, ctx.opp]) for (const s of [...digimonsOf(state, who)]) if (!keep.includes(s)) destroyIt(ctx, who, s);
})];
H('EX11-011', {
  tag: '상대의 턴', has: '어택 할 수 없다',
  atkTargetBlocked: (state, hp, holder, attackerP, attacker, target) => holder.suspended && !target.suspended,
  atkPlayerBlocked: (state, hp, holder) => holder.suspended,
});
H('EX11-062', { tag: '자신의 턴', has: '볼텍스', vortexPlayer: (state, hp) => !digimonsOf(state, opp(hp)).some((s) => !s.suspended) });
H('EX11-062', { tag: '서로의 턴', has: '레스트했을 때', events: { rest: (state, hp, holder, info) => C(info.stack.cardId).category === 'digimon' && !holder.suspended && C(holder.cardId).category === 'tamer' } });
SCRIPTS['EX11-062::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const e = evtOf(ctx);
  if (!t || t.suspended || !(await confirm(ctx, '이 테이머를 레스트시켜 효과를 발동할까요?'))) return;
  S.restStack(state, self, t.uid);
  if (e && e.cause === 'effect') S.drawCards(state, self, 1);
  const d = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => BIRD(s.cardId)), 'DP +3000 받을 디지몬 선택', { mandatory: true });
  if (d) S.s7AddDpMod(state, self, d.uid, 3000, untilOppEnd(ctx));
})];
SCRIPTS['EX11-035::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const all = () => [...digimonsOf(state, self), ...digimonsOf(state, ctx.opp)];
  let entries = [...digimonsOf(state, self).filter((s) => s.suspended).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => s.suspended && !S.effectBlocked(state, ctx.opp, s, 'other')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (entries.length) {
    const p1 = await ctx.choose('pickStackAnySide', { entries, prompt: '액티브로 할 디지몬 선택 (취소=안 함)' });
    if (p1) { const st = findSt(state, p1.player, p1.uid); if (st) S.unsuspendStack(state, p1.player, st.uid); }
  }
  entries = [...digimonsOf(state, self).filter((s) => !s.suspended).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !s.suspended && !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (entries.length) {
    const p2 = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
    if (p2) { const st = findSt(state, p2.player, p2.uid); if (st) await restIt(ctx, p2.player, st); }
  }
})];
SCRIPTS['EX11-026::이동 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
  if (!pick) return;
  const st = findSt(state, pick.player, pick.uid);
  if (!st || !(await restIt(ctx, pick.player, st)) || pick.player !== self) return;
  const d = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => BIRD(s.cardId)), 'DP +3000 받을 디지몬 선택', { mandatory: true });
  if (d) S.s7AddDpMod(state, self, d.uid, 3000, untilOppEnd(ctx));
})];
const MINERAL_EVT = { tag: '서로의 턴', has: '진화원 아래에 놓을', events: {
  play: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && MIN(info.stack.cardId) && !holder.suspended && C(holder.cardId).category === 'tamer',
  digivolve: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && MIN(info.stack.cardId) && !holder.suspended && C(holder.cardId).category === 'tamer' } };
H('EX11-065', { ...MINERAL_EVT });
SCRIPTS['EX11-065::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const e = evtOf(ctx);
  const target = e && findSt(state, self, e.stackUid);
  if (!t || t.suspended || !target) return;
  if (!(await confirm(ctx, '이 테이머를 레스트시켜 카드를 진화원 아래에 놓을까요?'))) return;
  const pl = state.players[self];
  const cands = [...pl.hand.filter(MIN).map((id) => ({ id, z: 'hand' })), ...pl.trash.filter(MIN).map((id) => ({ id, z: 'trash' }))];
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '진화원 아래에 놓을 카드 선택 (취소=안 함)');
  if (k == null) return;
  S.restStack(state, self, t.uid);
  const c = cands[k];
  const arr = c.z === 'hand' ? pl.hand : pl.trash;
  arr.splice(arr.lastIndexOf(c.id), 1);
  placeUnder(ctx, self, target, c.id);
  S.emitGameEvent(state, 'sourcesAdded', { owner: self, stack: target, cause: 'effect', added: [c.id], srcPlayer: self });
})];
SCRIPTS['EX11-044::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const hosts = digimonsOf(state, self).filter((s) => s.sources.filter(MIN).length >= 3);
  const h = await pickStack(ctx, self, hosts, '진화원 3장을 파기할 자신의 디지몬 선택 (취소=안 함)');
  if (!h) return;
  const idxs = [];
  for (let k = 0; k < 3; k++) {
    const rest = h.sources.map((id, i) => ({ id, i })).filter((x) => MIN(x.id) && !idxs.includes(x.i));
    const pk = await pickFromList(ctx, self, rest.map((x) => x.id), `파기할 광물형/광석형 진화원 선택 (${k + 1}/3)`);
    if (pk == null) return;
    idxs.push(rest[pk].i);
  }
  S.trashEvoSources(state, self, h.uid, 3, 'bottom', idxs);
  const all = state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category));
  if (!all.length) return;
  const max = Math.max(...all.map((s) => C(s.cardId).cost || 0));
  const t = await pickStack(ctx, ctx.opp, all.filter((s) => (C(s.cardId).cost || 0) === max), '등장 코스트가 가장 높은 상대 디지몬/테이머 선택', { kind: 'delete', mandatory: true });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
H('EX11-044', { tag: '서로의 턴', has: '진화원이 효과로 파기', limit: 1, events: { sourcesTrashed: (state, hp, holder, info) => info.stack === holder && info.cause === 'effect' } });
SCRIPTS['EX11-044::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  const pl = state.players[self];
  if (!h || pl.trash.filter(MIN).length < 3 || !(await confirm(ctx, '트래시의 광물형/광석형 3장을 이 디지몬의 진화원 아래에 놓을까요?'))) return;
  for (let k = 0; k < 3; k++) {
    const rest = pl.trash.filter(MIN);
    const pk = await pickFromList(ctx, self, rest, `진화원 아래에 놓을 카드 선택 (${k + 1}/3)`);
    if (pk == null) return;
    const id = rest[pk];
    pl.trash.splice(pl.trash.lastIndexOf(id), 1);
    placeUnder(ctx, self, h, id);
  }
})];
const VEMMON = { tag: '서로의 턴', has: '벰몬', events: {
  play: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && mentions(info.stack.cardId, '벰몬') && !holder.suspended && C(holder.cardId).category === 'tamer',
  digivolve: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && mentions(info.stack.cardId, '벰몬') && !holder.suspended && C(holder.cardId).category === 'tamer' } };
H('EX11-066', { ...VEMMON });
SCRIPTS['EX11-066::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const e = evtOf(ctx);
  const target = e && findSt(state, self, e.stackUid);
  if (!t || t.suspended || !target || !(await confirm(ctx, '이 테이머를 레스트시켜 덱 위 2장을 오픈할까요?'))) return;
  S.restStack(state, self, t.uid);
  const pl = state.players[self];
  const top = pl.deck.splice(0, 2);
  for (const id of top) {
    if (nameIs(id, '벰몬')) placeUnder(ctx, self, target, id); else pl.trash.push(id);
  }
  S.log(state, `${self} 덱 위 2장 오픈: ${top.map((id) => C(id).nameKo).join(', ')}`);
})];
SCRIPTS['EX11-046::상대의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const st = holderOf(ctx);
  const pl = state.players[self];
  if (!st || !state.players[self].battle.includes(st)) return;
  const ok = (id) => isDig(id) && nameIs(id, '라그나몬');
  const zones = ['hand', 'trash'].filter((z) => pl[z].some(ok));
  if (!zones.length || !(await confirm(ctx, '「라그나몬」으로 조건 무시·코스트 없이 진화할까요?'))) return;
  let z = zones[0];
  if (zones.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '진화할 카드의 위치', options: ['패', '트래시'] }); z = k === 1 ? 'trash' : 'hand'; }
  await evolveStack(ctx, self, st, z, ok, { free: true }, { ignoreCond: true });
})];
SCRIPTS['EX11-013::이동 시'] = [F(async (ctx) => { if (ctx.state.players[ctx.self].hand.length <= 7) S.drawCards(ctx.state, ctx.self, 1); })];
SCRIPTS['EX11-024::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const n = digimonsOf(state, self).length;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), `DP -${3000 * n} 대상 선택`, { kind: 'dpDown', mandatory: true });
  if (t && n) S.s7AddDpMod(state, ctx.opp, t.uid, -3000 * n, untilTurn(state));
})];
H('EX11-027', {
  tag: '서로의 턴', src: 'inheritedKo', has: '링크 카드',
  preventLeave: (state, hp, holder, target) => {
    if (target !== holder || !(holder.linkCards || []).length) return false;
    const l = holder.linkCards.pop();
    holder.sources.unshift(l.cardId);
    S.recomputeStackGrants(holder);
    S.log(state, `${hp} ${C(holder.cardId).nameKo}의 링크 카드 ${C(l.cardId).nameKo}을(를) 진화원 아래에 놓아 벗어나지 않음`);
    S.emitGameEvent(state, 'sourcesAdded', { owner: hp, stack: holder, cause: 'effect', added: [l.cardId], srcPlayer: hp, srcCategory: C(l.cardId).category }); // W8 (Q5823): the card moved from the link slot under the sources IS an increase of this digimon's 진화원 (「진화원이 효과로 늘어났을 때」 fires)
    return true;
  },
});
SCRIPTS['EX11-045::자신의 턴 종료 시'] = [F(async (ctx) => {
  const me = holderOf(ctx);
  await evolveOwn(ctx, (s) => s !== me, 'hand', (id) => mentions(id, '마키나몬') && (C(id).colors || []).includes('green'), { free: true });
})];
SCRIPTS['EX11-020::소멸 시'] = [F(async (ctx) => {
  const ds = ctx.trigger && ctx.trigger.delStack;
  if (ds && ds.s7DelCause === 'battle') return;
  const { state, self } = ctx;
  const i = await pickIdx(ctx, self, 'hand', (id) => isDig(id) && nameIs(id, '슈몬'), '등장시킬 「슈몬」 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
})];
SCRIPTS['EX11-064::등장 시'] = [F(async (ctx) => { S.secFlipTopFaceUp(ctx.state, ctx.opp); })];
SCRIPTS['EX11-029::이동 시'] = [F(async (ctx) => { await doLink(ctx, { zones: ['hand', 'sources'], pred: (id) => nameIs(id, '마키나몬'), host: 'any' }); })];
H('EX11-033', { tag: '자신의 턴', has: '링크했을 때', limit: 1, events: { linked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['EX11-033::자신의 턴'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '레스트시킬 상대 디지몬 선택', { kind: 'rest' });
  if (t) await restIt(ctx, ctx.opp, t);
  const u = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '액티브가 되지 않을 상대 디지몬 선택', { kind: 'rest' });
  if (u) S.setSkipNextUnsuspend(state, ctx.opp, u.uid);
})];
H('EX11-022', {
  tag: '서로의 턴', src: 'inheritedKo', limit: 1,
  preventLeaveOptions: (state, hp, holder, target, tp, cause, mode, id) => {
    if (target !== holder || cause === 'ownEffect') return [];
    return state.players[hp].battle.filter((s) => s !== holder && (S.isTokenId(s.cardId) || hasType(s.cardId, '퍼펫형'))).map((pay) => ({ apply() {
      if (!once(holder, id, 'EX11-022-leave')) return false;
      S.deleteStack(state, hp, pay.uid, 'trash', 'ownEffect');
      return true;
    } }));
  },
});
SCRIPTS['EX11-036::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const pool = () => state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category));
  for (let k = 0; k < 2; k++) {
    const t = await pickStack(ctx, ctx.opp, pool().filter((s) => !s.suspended), '레스트시킬 상대 디지몬/테이머 선택', { kind: 'rest', mandatory: true });
    if (t) await restIt(ctx, ctx.opp, t);
  }
  const u = await pickStack(ctx, ctx.opp, pool(), '액티브가 되지 않을 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (u) S.setSkipNextUnsuspend(state, ctx.opp, u.uid);
})];
SCRIPTS['EX11-073::진화 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !st.viaFusion) return;
  await doLink(ctx, { zones: ['hand', 'trash', 'sources'], pred: (id) => nameIs(id, '마키나몬'), host: 'this', times: 3 });
})];
H('EX11-012', {
  tag: '서로의 턴', has: '토큰',
  preventLeaveOptions: (state, hp, holder, target) => {
    if (target !== holder) return [];
    return state.players[hp].battle.filter((s) => S.isTokenId(s.cardId)).map((pay) => ({ apply() {
      S.deleteStack(state, hp, pay.uid, 'trash', 'ownEffect');
      return true;
    } }));
  },
});
// EX11-052 【서로의 턴】[턴에 1회] 특징 「마룡형」/「사룡형」을 가진 자신의 디지몬이 배틀 에어리어를 벗어날 때, 자신의 패가 4장 이하라면,
// 상대의 시큐리티 1장을 파기한다 — prospective tense ("벗어날 때") = 즉시형 (15-8-5-1, docs/effect-classification-rules.md) and MANDATORY
// ("파기한다", no "…수 있다"). Unlike BT14-018 this isn't self-only ("이 디지몬이"): it watches ANY of hp's qualifying digimon leaving
// (including EX11-052 itself), so it uses forcedOnAnyLeave (state.js hookPreventLeave) rather than forcedOnLeave. Also now correctly
// covers a bounce/return-to-deck leave too (hookPreventLeave is shared by deleteStack and leaveGate/leavePass), not just deletion.
H('EX11-052', {
  tag: '서로의 턴', has: '벗어날 때',
  forcedOnAnyLeave(state, hp, holder, target, cause, mode, id) {
    if (!hasType(target.cardId, '마룡형', '사룡형') || state.players[hp].hand.length > 4) return;
    if (!S.hookUseOnce(holder, id, { tag: '서로의 턴', has: '벗어날 때' }, 1)) return;
    S.trashTopSecurityByEffect(state, opp(hp));
  },
});
H('EX11-017', { tag: '서로의 턴', has: '등장/진화했을 때', limit: 1, events: {
  play: (state, hp, holder, info) => info.stack !== holder && S.isDigimonLike(info.stack), digivolve: (state, hp, holder, info) => info.stack !== holder && S.isDigimonLike(info.stack) } });
SCRIPTS['EX11-017::서로의 턴'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length), '진화원을 파기할 상대 디지몬 선택', { kind: 'srcTrash' });
  if (t) await trashSourcesPicked(ctx, ctx.opp, t, 3);
  const c = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length === 0), '레스트 못하게 할 진화원 없는 상대 디지몬 선택', { kind: 'rest' });
  if (c) S.preventRest(state, ctx.opp, c.uid, untilOppEnd(ctx));
})];
H('EX11-030', { tag: '서로의 턴', src: 'inheritedKo', has: 'DP', dp: (state, hp, holder, target) => (target === holder ? 1000 : 0) });
SCRIPTS['EX11-031::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const n = S.secFaceUpCount(state.players[self]);
  const pool = () => state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category));
  for (let k = 0; k < n; k++) {
    const t = await pickStack(ctx, ctx.opp, pool().filter((s) => !s.suspended), '레스트시킬 상대 디지몬/테이머 선택', { kind: 'rest', mandatory: true });
    if (!t) break;
    await restIt(ctx, ctx.opp, t);
  }
  const u = await pickStack(ctx, ctx.opp, pool(), '액티브가 되지 않을 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (u) S.setSkipNextUnsuspend(state, ctx.opp, u.uid);
})];
H('EX11-031', {
  tag: '서로의 턴', src: 'inheritedKo', has: '앞면인 시큐리티', limit: 1,
  preventLeave: (state, hp, holder, target, tp, cause, mode, id) => {
    if (cause === 'ownEffect' || !hasType(target.cardId, '로얄 베이스') || !S.isDigimonLike(target)) return false;
    const pl = state.players[hp];
    const upId = pl.security.find((sid) => (pl.secUp && pl.secUp[sid]) > 0);
    if (!upId || !once(holder, id, 'EX11-031-leave')) return false;
    pl.secUp[upId] -= 1;
    S.log(state, `${hp} 앞면 시큐리티 ${C(upId).nameKo}을(를) 뒷면으로 — ${C(target.cardId).nameKo}는 벗어나지 않음`);
    return true;
  },
});
SCRIPTS['EX11-032::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const id = ctx.sourceCardId;
  if (!digimonsOf(state, self).length || !tamersOf(state, self).some((s) => nameIs(s.cardId, '카자마 쇼토'))) return;
  const targets2 = digimonsOf(state, self).filter((s) => nameIs(s.cardId, '프테로몬'));
  const gi = pl.trash.findIndex((x) => nameIs(x, '게일몬'));
  if (!targets2.length || gi < 0 || pl.hand.indexOf(id) < 0) return;
  const st = await pickStack(ctx, self, targets2, '진화시킬 「프테로몬」 선택 (취소=안 함)', { mandatory: true });
  if (!st) return;
  const gid = pl.trash.splice(gi, 1)[0];
  placeUnder(ctx, self, st, gid);
  payMemory(state, self, 3);
  S.digivolve(state, self, st.uid, id, 0, 'hand');
})];
SCRIPTS['EX11-071::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const t = holderOf(ctx);
  const ok = (id) => (hasType(id, '로얄 나이츠', '리버레이터')) && (C(id).cost || 0) >= 4 && C(id).category !== 'option';
  if (!t || !pl.hand.some(ok)) return;
  const i = await pickIdx(ctx, self, 'hand', ok, '등장 코스트 -2로 등장시킬 카드 선택 (취소=안 함)');
  if (i == null) return;
  moveOut(state, self, t, 'deckBottom');
  const id = pl.hand[i];
  payMemory(state, self, Math.max(0, (C(id).cost || 0) - 2));
  S.playFreeFromZone(state, self, 'hand', pl.hand.indexOf(id));
})];
SCRIPTS['EX11-057::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const n = digimonsOf(state, self).filter((s) => hasType(s.cardId, '빙설형')).length;
  for (let k = 0; k < n; k++) {
    const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length), '진화원을 파기할 상대 디지몬 선택', { kind: 'srcTrash' });
    if (!t) break;
    await trashSourcesPicked(ctx, ctx.opp, t, 1);
  }
})];
SCRIPTS['EX11-001::어택 시'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 티라노몬/공룡형 디지몬으로 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIncl(id, '티라노몬') || hasType(id, '공룡형'), { normal: true });
})];
SCRIPTS['EX11-010::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (entries.length) {
    const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
    if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) await restIt(ctx, pick.player, st); }
  }
  const me = holderOf(ctx);
  if (me && me.suspended) S.s7AddDpMod(state, self, me.uid, 4000, untilOppEnd(ctx));
})];
// ==================================================================== verification additions (BT24 / EX11)
// BT24-043 【등장 시】 reveal 3: a 수/짐승/신인형 digimon (minus the excluded types) + a 「TS」 card
const EXCL_043 = ['수장룡형', '수생형', '수생포유류형', '정보수집 타입'];
SCRIPTS['BT24-043::등장 시'] = [F(async (ctx) => {
  await revealPick(ctx, 3, [
    (id) => isDig(id) && typesOf(id).some((t) => ['수', '짐승', '신인형'].some((x) => t.includes(x)) && !EXCL_043.includes(t)),
    (id) => hasType(id, 'TS'),
  ]);
})];
// EX11-027 【등장 시】 reveal 3: 「마키나몬」 + a 「마키나몬」-mentioning card; then link this / a hand 「마키나몬」 to another own digimon (free)
SCRIPTS['EX11-027::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  await revealPick(ctx, 3, [(id) => nameIs(id, '마키나몬'), (id) => mentions(id, '마키나몬')]);
  const me = holderOf(ctx);
  const pl = state.players[self];
  const hostsFor = (id) => digimonsOf(state, self).filter((h) => h !== me && S.linkCheck(state, self, h, id).ok);
  const cands = [];
  if (me && state.players[self].battle.includes(me) && hostsFor(me.cardId).length) cands.push({ id: me.cardId, z: 'battle' });
  for (const id of pl.hand) if (isDig(id) && nameIs(id, '마키나몬') && hostsFor(id).length && !cands.some((c) => c.z === 'hand' && c.id === id)) cands.push({ id, z: 'hand' });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '링크할 「마키나몬」 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  const host = await pickStack(ctx, self, hostsFor(c.id), '링크할 다른 자신의 디지몬 선택', { mandatory: true });
  if (!host) return;
  if (c.z === 'battle') S.linkFromBattle(state, self, me.uid, host.uid, 0);
  else await linkFrom(ctx, self, host, 'hand', c.id, 'free');
})];
// EX11-034 【등장 시】【진화 시】【어택 시】: place a 「로얄 베이스」 card face-up in security, then delete opp digimon up to total cost 8 (+2 per own face-up security)
SCRIPTS['EX11-034::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const cands = [];
  pl.hand.forEach((id) => { if (hasType(id, '로얄 베이스')) cands.push({ id, z: 'hand' }); });
  pl.trash.forEach((id) => { if (hasType(id, '로얄 베이스')) cands.push({ id, z: 'trash' }); });
  if (cands.length) {
    const k = await pickFromList(ctx, self, cands.map((c) => c.id), '시큐리티에 앞면으로 놓을 「로얄 베이스」 카드 선택 (취소=안 함)');
    if (k != null) {
      const c = cands[k];
      const arr = c.z === 'hand' ? pl.hand : pl.trash;
      arr.splice(arr.lastIndexOf(c.id), 1);
      const pos = await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] });
      S.secAddFaceUp(state, self, c.id, pos === 1 ? 'bottom' : 'top');
    }
  }
  let left = 8 + 2 * S.secFaceUpCount(pl);
  const chosen = [];
  for (;;) {
    const pool = digimonsOf(state, ctx.opp).filter((s) => !chosen.includes(s) && (C(s.cardId).cost || 0) <= left);
    const t = await pickStack(ctx, ctx.opp, pool, `소멸시킬 상대 디지몬 선택 (남은 등장 코스트 합계 ${left}, 취소=그만)`, { kind: 'delete' });
    if (!t) break;
    chosen.push(t);
    left -= C(t.cardId).cost || 0;
  }
  for (const t of chosen) destroyIt(ctx, ctx.opp, t);
})];
// play a card of the holder's sources (inherited 【서로의 턴 종료 시】)
SCRIPTS['BT24-086::서로의 턴 종료 시'] = [F(async (ctx) => { await playFromOwnSources(ctx, holderOf(ctx), (id) => nameIs(id, '서월령')); })];
SCRIPTS['EX11-070::서로의 턴 종료 시'] = [F(async (ctx) => { await playFromOwnSources(ctx, holderOf(ctx), (id) => nameIs(id, '언체인')); })];
// EX11-051 【등장 시】【진화 시】【소멸 시】 destroy one lowest-Lv opp digimon ("1장"), then may play a 고스트형 Lv.4-or-lower digimon card from trash free
SCRIPTS['EX11-051::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, ctx.opp, LOWLV(state, ctx.opp), '소멸시킬 (Lv.이 가장 낮은) 상대 디지몬 선택', { kind: 'delete', mandatory: true });
  if (t) destroyIt(ctx, ctx.opp, t);
  const i = await pickIdx(ctx, self, 'trash', (id) => isDig(id) && hasType(id, '고스트형') && lv(id) <= 4, '코스트 없이 등장시킬 고스트형 카드 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'trash', i);
})];
// EX11-012 【진화 시】【어택 종료 시】 destroy an opp digimon with DP <= this digimon's; then return 1 card of opp's trash to its deck bottom -> opp gets a 「석화」 token
TOKENS['S7-TOKEN-SEOKHWA'] = { nameKo: '석화', colors: ['white'], dp: 3000, level: null, cost: 0, effectKo: '【자신의 턴】 이 디지몬은 레스트할 수 없다.\n【소멸 시】 자신의 시큐리티를 위에서부터 1장 파기한다.' };
SCRIPTS['EX11-012::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (h) {
    const dp = S.effectiveDP(state, self, h);
    const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => S.effectiveDP(state, ctx.opp, s) <= dp), `DP ${dp} 이하의 소멸시킬 상대 디지몬 선택 (취소=안 함)`, { kind: 'delete' });
    if (t) destroyIt(ctx, ctx.opp, t);
  }
  const opl = state.players[ctx.opp];
  if (!opl.trash.length) return;
  const k = await pickFromList(ctx, self, opl.trash.slice(), '덱 아래로 되돌릴 상대 트래시의 카드 선택 (취소=안 함 — 상대는 「석화」 토큰을 얻지 않음)');
  if (k == null) return;
  opl.deck.push(opl.trash.splice(k, 1)[0]);
  spawnToken(ctx, ctx.opp, 'S7-TOKEN-SEOKHWA');
})];
// EX11-035 【서로의 턴】 / EX11-032 【진화 시】: play a green 조/새/병아리 digimon card from hand free; DP limit = base + per * (rested digimon on both sides)
const restedDigimon = (state) => ['p1', 'p2'].reduce((n, p) => n + digimonsOf(state, p).filter((s) => s.suspended).length, 0);
async function playGreenBird(ctx, base, per) {
  const { state, self } = ctx;
  const limit = base + per * restedDigimon(state);
  const i = await pickIdx(ctx, self, 'hand', (id) => isDig(id) && typeIncl(id, '조', '새', '병아리') && (C(id).colors || []).includes('green') && (C(id).dp || 0) <= limit, `코스트 없이 등장시킬 DP ${limit} 이하 그린 카드 선택 (취소=안 함)`);
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
}
SCRIPTS['EX11-035::서로의 턴'] = [F((ctx) => playGreenBird(ctx, 3000, 2000))];
SCRIPTS['EX11-032::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const entries = [...digimonsOf(state, self).map((s) => ({ player: self, uid: s.uid })), ...digimonsOf(state, ctx.opp).filter((s) => !S.effectBlocked(state, ctx.opp, s, 'rest')).map((s) => ({ player: ctx.opp, uid: s.uid }))];
  if (entries.length) {
    const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
    if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) await restIt(ctx, pick.player, st); }
  }
  await playGreenBird(ctx, 3000, 1000);
})];
// EX11-022 【등장 시】【진화 시】 play a 퍼펫형 digimon card (DP <= 4000) from hand/trash free; destroy it at turn end
SCRIPTS['EX11-022::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const cands = [];
  pl.hand.forEach((id) => { if (isDig(id) && hasType(id, '퍼펫형') && (C(id).dp || 0) <= 4000) cands.push({ id, z: 'hand' }); });
  pl.trash.forEach((id) => { if (isDig(id) && hasType(id, '퍼펫형') && (C(id).dp || 0) <= 4000) cands.push({ id, z: 'trash' }); });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 퍼펫형 카드 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  const arr = c.z === 'hand' ? pl.hand : pl.trash;
  const st = S.playFreeFromZone(state, self, c.z, arr.lastIndexOf(c.id));
  if (!st) return;
  const uid = st.uid;
  S.scheduleEndOfTurn(state, () => { const s = findSt(state, self, uid); if (s) S.deleteStack(state, self, uid, 'trash', 'ownEffect'); }, { player: self, label: '이 턴 종료 시 소멸' });
})];
// EX11-017 【등장 시】【진화 시】【어택 시】[턴에 1회] play 「카즈키 스즈네」 or a Lv.4-or-lower 빙설형 digimon card from hand free
SCRIPTS['EX11-017::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const i = await pickIdx(ctx, self, 'hand', (id) => nameIs(id, '카즈키 스즈네') || (isDig(id) && hasType(id, '빙설형') && lv(id) <= 4), '코스트 없이 등장시킬 카드 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
})];
// EX11-041 (inherited) 【자신의 턴】 this digimon's attack target can't be changed
H('EX11-041', { tag: '자신의 턴', src: 'inheritedKo', has: '변경되지', redirectImmune: (state, hp, holder, aStack) => aStack === holder });
// EX11-016 (inherited) 【자신의 턴】 while no opp digimon has sources: this 빙설형 digimon gets 《관통》 and 《S 어택 +1》
const NO_OPP_SRC = (state, hp, holder) => hasType(holder.cardId, '빙설형') && !digimonsOf(state, opp(hp)).some((s) => s.sources.length > 0);
H('EX11-016', { tag: '자신의 턴', src: 'inheritedKo', has: '진화원을 가진 상대의 디지몬이 없는 동안', kw: (state, hp, holder, name) => name === '관통' && NO_OPP_SRC(state, hp, holder), kwNum: (state, hp, holder) => (NO_OPP_SRC(state, hp, holder) ? 1 : 0) });
// EX11-040 / EX11-029 【자신의 턴】[턴에 1회] this digimon got linked: if own tamers <= 1, play 「언체인」 from hand/trash free
async function playUnchain(ctx) {
  const { state, self } = ctx;
  if (tamersOf(state, self).length > 1) return;
  const pl = state.players[self];
  const cands = [];
  pl.hand.forEach((id) => { if (nameIs(id, '언체인')) cands.push({ id, z: 'hand' }); });
  pl.trash.forEach((id) => { if (nameIs(id, '언체인')) cands.push({ id, z: 'trash' }); });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 「언체인」 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  const arr = c.z === 'hand' ? pl.hand : pl.trash;
  S.playFreeFromZone(state, self, c.z, arr.lastIndexOf(c.id));
}
const LINKED_SELF = (state, hp, holder, info) => info.owner === hp && info.stack === holder;
for (const id of ['EX11-040', 'EX11-029']) {
  H(id, { tag: '자신의 턴', has: '링크했을 때', limit: 1, events: { linked: LINKED_SELF } });
  SCRIPTS[`${id}::자신의 턴`] = [F(playUnchain)];
}
// EX11-036 (inherited) 【자신의 턴】[턴에 1회] this digimon got linked: rest 1 opp digimon, then may attack with this digimon
H('EX11-036', { tag: '자신의 턴', src: 'inheritedKo', has: '링크했을 때', limit: 1, events: { linked: LINKED_SELF } });
SCRIPTS['EX11-036::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '레스트시킬 상대 디지몬 선택', { kind: 'rest' });
  if (t) await restIt(ctx, ctx.opp, t);
  const h = holderOf(ctx);
  if (h && !h.suspended && ctx.startAttack && (await confirm(ctx, `${C(h.cardId).nameKo}(으)로 어택할까요?`))) ctx.startAttack(self, h.uid);
})];
// EX11-033 【이동 시】【진화 시】 play a 「마키나몬」 from hand or from this digimon's link cards, free
SCRIPTS['EX11-033::이동 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const h = holderOf(ctx);
  const cands = [];
  pl.hand.forEach((id) => { if (isDig(id) && nameIs(id, '마키나몬')) cands.push({ id, z: 'hand' }); });
  if (h) (h.linkCards || []).forEach((l, i) => { if (isDig(l.cardId) && nameIs(l.cardId, '마키나몬')) cands.push({ id: l.cardId, z: 'link', i }); });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 「마키나몬」 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  if (c.z === 'hand') { S.playFreeFromZone(state, self, 'hand', pl.hand.indexOf(c.id)); return; }
  h.linkCards.splice(c.i, 1);
  S.recomputeStackGrants(h);
  pl.trash.push(c.id);
  S.playFreeFromZone(state, self, 'trash', pl.trash.length - 1);
})];
// EX11-045 【등장 시】【진화 시】【어택 시】[턴에 1회] opp digimon 《퇴화 2》, then an opp digimon/tamer cannot evolve until the end of opp's turn
SCRIPTS['EX11-045::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '《퇴화 2》 대상 선택', { kind: 'retreat' });
  if (t) await S.declareAndRetreat(ctx, ctx.opp, t.uid, 2); // 16-12-1: 1~2장 중 선언 (단일 《퇴화 2》, 반복 아님)
  const u = await pickStack(ctx, ctx.opp, state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '진화할 수 없게 할 상대 디지몬/테이머 선택', { kind: 'other' });
  if (u) u.cannotEvolveUntil = untilOppEnd(ctx);
})];
// EX11-045 (inherited) 【서로의 턴】[턴에 1회] this digimon's sources increased by an effect: destroy the lowest-cost opp digimon (generic script)
H('EX11-045', { tag: '서로의 턴', src: 'inheritedKo', has: '늘어났을 때', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && info.cause === 'effect' } });
// EX11-046 【등장 시】【진화 시】 keep one highest-cost opp digimon, destroy all the others; with >= 4 「벰몬」 in sources: 《블로커》 + immune to opp effects until opp's turn end
SCRIPTS['EX11-046::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const ds = digimonsOf(state, ctx.opp);
  if (ds.length) {
    const costed = ds.filter((s) => !(C(s.cardId).isToken || /TOKEN/i.test(String(s.cardId)))); // Q5895: tokens have no play cost -> not selectable; with only tokens ALL get deleted
    const max = costed.length ? Math.max(...costed.map((s) => C(s.cardId).cost || 0)) : null;
    const keep = costed.length ? await pickStack(ctx, ctx.opp, costed.filter((s) => (C(s.cardId).cost || 0) === max), '남길 (등장 코스트가 가장 높은) 상대 디지몬 선택', { mandatory: true }) : null;
    for (const s of ds) if (s !== keep) destroyIt(ctx, ctx.opp, s);
  }
  const h = holderOf(ctx);
  if (h && h.sources.filter((id) => nameIs(id, '벰몬')).length >= 4) {
    S.grantKeyword(state, self, h.uid, '블로커', undefined, 'opponentTurn');
    S.grantShield(state, self, h.uid, { kinds: ['all'], until: untilOppEnd(ctx) });
  }
})];
// EX11-073 【상대의 턴 종료 시】[턴에 1회] per link card: trash opp's top security and put an opp digimon at the deck bottom
// official Q&A (5947): a "○○마다, △△하고, □□한다" effect resolves as "○○ 개수만큼 △△를 전부 한 다음, □□를 전부" — NOT
// interleaved (△,□,△,□,…) per occurrence. So all N security discards happen first, then all N digimon bounces.
SCRIPTS['EX11-073::상대의 턴 종료 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const h = holderOf(ctx);
  const n = h ? (h.linkCards || []).length : 0;
  for (let k = 0; k < n; k++) {
    if (state.players[ctx.opp].security.length) S.trashTopSecurityByEffect(state, ctx.opp);
  }
  for (let k = 0; k < n; k++) {
    const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '덱 아래로 되돌릴 상대 디지몬 선택', { kind: 'bounce' });
    if (t) bounceIt(ctx, ctx.opp, t, 'deckBottom');
  }
})];
// EX11-043 【등장 시】【진화 시】 flip opp's top face-down security face-up, put the lowest-cost opp digimon at the deck bottom, then this digimon gets 《S 어택 +1》
SCRIPTS['EX11-043::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  S.secFlipTopFaceUp(state, ctx.opp);
  const ds = digimonsOf(state, ctx.opp);
  if (ds.length) {
    const min = Math.min(...ds.map((s) => C(s.cardId).cost || 0));
    const t = await pickStack(ctx, ctx.opp, ds.filter((s) => (C(s.cardId).cost || 0) === min), '등장 코스트가 가장 낮은 상대 디지몬 선택', { kind: 'bounce', mandatory: true });
    if (t) bounceIt(ctx, ctx.opp, t, 'deckBottom');
  }
  const h = holderOf(ctx);
  if (h) S.grantKeyword(state, self, h.uid, '시큐리티어택', 1, 'turn');
})];
// EX11-041 【등장 시】【진화 시】 flip opp's top face-down security face-up, opp digimon 《퇴화 1》, then (on opp's turn) may evolve into 「인비지몬」 free
SCRIPTS['EX11-041::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  S.secFlipTopFaceUp(state, ctx.opp);
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '《퇴화 1》 대상 선택', { kind: 'retreat' });
  if (t) S.retreat(state, ctx.opp, t.uid, 1);
  const h = holderOf(ctx);
  if (state.activePlayer === self || !h || !state.players[self].battle.includes(h)) return;
  if (!state.players[self].hand.some((id) => isDig(id) && nameIs(id, '인비지몬') && evoCheck(ctx, h, id).ok)) return;
  if (!(await confirm(ctx, '패의 「인비지몬」으로 코스트 없이 진화할까요?'))) return;
  await evolveStack(ctx, self, h, 'hand', (id) => nameIs(id, '인비지몬'), { free: true });
})];
// EX11-063 【자신의 턴 종료 시】 rest this tamer: one active 「로얄 베이스」 digimon gets 《충돌》《관통》 until turn end and attacks
SCRIPTS['EX11-063::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const c = digimonsOf(state, self).filter((s) => hasType(s.cardId, '로얄 베이스') && !s.suspended);
  if (!t || t.suspended || !c.length || !(await confirm(ctx, '이 테이머를 레스트시켜 로얄 베이스 디지몬에게 《충돌》《관통》을 주고 어택할까요?'))) return;
  S.restStack(state, self, t.uid);
  const d = await pickStack(ctx, self, c, '《충돌》《관통》을 얻고 어택할 「로얄 베이스」 디지몬 선택', { mandatory: true });
  if (!d) return;
  S.grantKeyword(state, self, d.uid, '충돌', undefined, 'turn');
  S.grantKeyword(state, self, d.uid, '관통', undefined, 'turn');
  if (ctx.startAttack) ctx.startAttack(self, d.uid);
})];
// EX11-065 【자신의 메인 페이즈 개시 시】 discard a 광물형/광석형 card from hand / own digimon sources -> memory +1
SCRIPTS['EX11-065::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const cands = [];
  pl.hand.forEach((id) => { if (MIN(id)) cands.push({ id, z: 'hand' }); });
  for (const d of digimonsOf(state, self)) d.sources.forEach((id, i) => { if (MIN(id)) cands.push({ id, z: 'src', d, i }); });
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '파기할 광물형/광석형 카드 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  if (c.z === 'hand') S.trashFromHand(state, self, pl.hand.indexOf(c.id));
  else if (!S.trashEvoSources(state, self, c.d.uid, 1, 'bottom', [c.i]).length) return;
  S.grantMemory(state, self, 1, ctx.sourceCardId);
})];
// EX11-066 【자신의 메인 페이즈 개시 시】【등장 시】 discard a 「벰몬」-mentioning hand card -> draw 1, memory +1
SCRIPTS['EX11-066::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const i = await pickIdx(ctx, self, 'hand', (id) => mentions(id, '벰몬'), '파기할 「벰몬」이 기술된 카드 선택 (취소=안 함)');
  if (i == null) return;
  S.trashFromHand(state, self, i);
  S.drawCards(state, self, 1);
  S.grantMemory(state, self, 1, ctx.sourceCardId);
})];
// EX11-067 【자신의 턴】 own digimon evolved into a 「루체몬」-named digimon -> rest this tamer: memory +1
H('EX11-067', { tag: '자신의 턴', has: '루체몬', events: { digivolve: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && nameIncl(info.stack.cardId, '루체몬') && !holder.suspended && C(holder.cardId).category === 'tamer' } });
SCRIPTS['EX11-067::자신의 턴'] = [F(async (ctx) => {
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  S.restStack(ctx.state, ctx.self, t.uid);
  S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
})];
// EX11-069 【자신의 턴】[턴에 1회] own digimon attacked, hand <= 4 -> evolve it from trash (마룡형/사룡형), cost -1
H('EX11-069', { tag: '자신의 턴', has: '어택했을 때', limit: 1, events: { attack: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && state.players[hp].hand.length <= 4 } });
SCRIPTS['EX11-069::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const e = evtOf(ctx);
  const st = e && findSt(state, self, e.stackUid);
  if (!st || state.players[self].hand.length > 4) return;
  if (!state.players[self].trash.some((id) => isDig(id) && hasType(id, '마룡형', '사룡형') && evoCheck(ctx, st, id).ok)) return;
  if (!(await confirm(ctx, '트래시의 마룡형/사룡형 디지몬으로 진화 코스트 -1 진화할까요?'))) return;
  await evolveStack(ctx, self, st, 'trash', (id) => hasType(id, '마룡형', '사룡형'), { discount: 1 });
})];
// EX11-064 【자신의 턴】 own 사이보그형/머신형 digimon attacked -> rest this tamer: evolve it from hand (사이보그형/머신형), cost -1 per opp face-up security
H('EX11-064', { tag: '자신의 턴', has: '어택했을 때', events: { attack: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && hasType(info.stack.cardId, '사이보그형', '머신형') && !holder.suspended && C(holder.cardId).category === 'tamer' } });
SCRIPTS['EX11-064::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const e = evtOf(ctx);
  const st = e && findSt(state, self, e.stackUid);
  if (!t || t.suspended || !st) return;
  const okc = (id) => isDig(id) && hasType(id, '사이보그형', '머신형');
  if (!state.players[self].hand.some((id) => okc(id) && evoCheck(ctx, st, id).ok)) return;
  if (!(await confirm(ctx, '이 테이머를 레스트시켜 패의 사이보그형/머신형 디지몬으로 진화시킬까요?'))) return;
  S.restStack(state, self, t.uid);
  await evolveStack(ctx, self, st, 'hand', okc, { discount: S.secFaceUpCount(state.players[ctx.opp]) });
})];
// EX11-020 (inherited) same as EX11-021 (inherited)
H('EX11-020', { tag: '상대의 턴', src: 'inheritedKo', has: '어택을 종료', limit: 1, events: { attack: (state, hp, holder, info) => info.owner !== hp } });
SCRIPTS['EX11-020::상대의 턴'] = SCRIPTS['EX11-021::상대의 턴'];
// inherited "이 디지몬이 배틀에서 상대의 디지몬을 소멸시켰(다면/을 때)" / "배틀에서 이겼(을 때)/승리했을 때" watchers (scripts are the generic compile)
const KILLED = (state, hp, holder, info) => info.stack === holder && info.loser && !state.players[opp(hp)].battle.includes(info.loser);
H('BT24-047', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { battleWin: KILLED } });
H('BT24-048', { tag: '서로의 턴', src: 'inheritedKo', events: { battleWin: KILLED } });
H('EX11-033', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { battleWin: KILLED } });
H('EX11-026', { tag: '자신의 턴', src: 'inheritedKo', has: '배틀에서 이겼', limit: 1, events: { battleWin: (state, hp, holder, info) => info.stack === holder } });
H('EX11-032', { tag: '자신의 턴', src: 'inheritedKo', has: '배틀에서 승리', limit: 1, events: { battleWin: (state, hp, holder, info) => info.stack === holder && hasType(holder.cardId, '볼텍스 워리어') } });
// BT24-045: 【패에서 파기】 (untagged preamble, acts from the trash) + inherited 【자신의 턴】 evolve on own hand discard
// (W8: the 【패에서 파기】 draw preamble is handled by state.queueOwnDiscardTriggers like BT24-013/026 — a second hardcoded hook here made it draw TWICE per discard; removed)
H('BT24-045', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { discard: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(holder) && hasType(holder.cardId, '귀인형', '타이탄족') } });
SCRIPTS['BT24-045::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '트래시의 타이타몬/타이탄족 디지몬으로 진화 코스트 -1 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'trash', (id) => nameIs(id, '타이타몬') || hasType(id, '타이탄족'), { discount: 1 });
})];
// BT24-052 【이동 시】【진화 시】 「디아블로몬」 token (digimon / cost 14 / Lv.6 / white / 궁극체 / 종족불명 / DP3000)
TOKENS['S7-TOKEN-DIABLO'] = { nameKo: '디아블로몬', colors: ['white'], dp: 3000, level: 6, cost: 14, types: ['궁극체', '종족불명'], effectKo: '' };
SCRIPTS['BT24-052::이동 시'] = [F(async (ctx) => { if (await confirm(ctx, '「디아블로몬」 토큰 1장을 코스트 없이 등장시킬까요?')) spawnToken(ctx, ctx.self, 'S7-TOKEN-DIABLO'); })];
// BT24-101 【등장 시】【진화 시】 discard own top security, opp digimon DP -13000, then recovery +2 if own security <= 1
SCRIPTS['BT24-101::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  if (state.players[self].security.length) S.trashTopSecurityByEffect(state, self);
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), 'DP -13000 대상 선택', { kind: 'dpDown' });
  if (t) S.s7AddDpMod(state, ctx.opp, t.uid, -13000, untilOppEnd(ctx));
  if (state.players[self].security.length <= 1) { S.recoverTopOfDeckToSecurity(state, self); S.recoverTopOfDeckToSecurity(state, self); }
})];
// BT24-101 〔진화〕 명칭에 「아이기오투스몬」을 포함한 Lv.5: 자신의 시큐리티 1장당, 코스트 1 (state-dependent cost; see S.evolveTargetRestriction)
H('BT24-101', { tag: '진화', has: '시큐리티 1장당', evoTargetAlt: (state, p, stack, tid) => (nameIncl(stack.cardId, '아이기오투스몬') && lv(stack.cardId) === 5 ? { cost: state.players[p].security.length, test: (tgt) => tgt.id === tid } : null) });
// P-222: 【서로의 턴】[턴에 1회] any digimon got rested -> destroy the lowest-DP opp digimon (generic script); "이 카드가 등장할 때 앞면 시큐리티에 「윈드 가디언즈」가 있다면 코스트 -4"
H('P-222', { tag: '서로의 턴', has: '레스트 했을 때', limit: 1, events: { rest: (state, hp, holder, info) => !!info.stack && C(info.stack.cardId).category === 'digimon' } });
H('P-222', { tag: '__handPlay', selfPlayDiscount: (state, p) => { const pl = state.players[p]; return pl.security.some((id) => ((pl.secUp && pl.secUp[id]) || 0) > 0 && hasType(id, '윈드 가디언즈')) ? -4 : 0; } });
// BT24-102 【자신의 메인 페이즈 개시 시】 memory +1, then if memory >= 5: rest this tamer and draw 1
SCRIPTS['BT24-102::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  S.grantMemory(state, self, 1, ctx.sourceCardId);
  if (ownMemory(state, self) < 5) return;
  const t = holderOf(ctx);
  if (t && !t.suspended) S.restStack(state, self, t.uid);
  S.drawCards(state, self, 1);
})];
// BT24-093 【메인】 own top security -> hand, recovery +1, then this card is placed in the battle area
SCRIPTS['BT24-093::메인'] = [F(async (ctx) => {
  const { state, self } = ctx;
  if (state.players[self].security.length) secToHand(state, self, 0);
  S.recoverTopOfDeckToSecurity(state, self);
}), { op: 'placeThisInBattle' }];
// P-224 【자신의 메인 페이즈 개시 시】【등장 시】 place a 크로스 하트/트와일라잇 digimon card (hand/trash) under this tamer, then draw 1 if hand <= 7
SCRIPTS['P-224::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  if (!t) return;
  const placed = await costPlaceUnder(ctx, t, ['hand', 'trash'], (id) => isDig(id) && hasType(id, '크로스 하트', '트와일라잇'), '테이머 아래에 둘 크로스 하트/트와일라잇 디지몬 카드 선택 (취소=안 함)');
  if (placed && state.players[self].hand.length <= 7) S.drawCards(state, self, 1);
})];
// BT24-074 【소멸 시】 play (free) a Lv.4-or-lower digimon card from trash that is named ~시드라몬 or has 「TS」 (the Lv limit applies to both alternatives)
SCRIPTS['BT24-074::소멸 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const i = await pickIdx(ctx, self, 'trash', (id) => isDig(id) && lv(id) <= 4 && (nameIncl(id, '시드라몬') || hasType(id, 'TS')), '코스트 없이 등장시킬 카드 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'trash', i);
})];
// BT24-074 (inherited) 【어택 시】 place another own digimon under this one -> this digimon becomes active
SCRIPTS['BT24-074::어택 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const st = holderOf(ctx);
  const t = st && await pickStack(ctx, self, digimonsOf(state, self).filter((s) => s !== st), '이 디지몬의 진화원 아래에 놓을 다른 자신의 디지몬 선택 (취소=안 함)');
  if (!t) return;
  const pl = state.players[self];
  const real = (x) => !S.isTokenId(x);
  pl.battle.splice(pl.battle.indexOf(t), 1);
  pl.trash.push(...t.sources.filter(real), ...(t.linkCards || []).map((l) => l.cardId).filter(real));
  if (real(t.cardId)) st.sources.unshift(t.cardId);
  S.recomputeStackGrants(st);
  S.applyOverflowBatch(state, self, [...t.sources]);
  S.log(state, `${self} ${C(t.cardId).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
  S.unsuspendStack(state, self, st.uid);
})];
// EX11-057 【서로의 턴】 opp digimon's sources trashed by an effect -> rest this tamer: memory +1
H('EX11-057', { tag: '서로의 턴', has: '진화원이 효과로 파기', events: { sourcesTrashed: (state, hp, holder, info) => info.owner === opp(hp) && info.cause === 'effect' && !holder.suspended && C(holder.cardId).category === 'tamer' } });
SCRIPTS['EX11-057::서로의 턴'] = [F(async (ctx) => {
  const t = holderOf(ctx);
  if (!t || t.suspended) return;
  S.restStack(ctx.state, ctx.self, t.uid);
  S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
})];

// ==================================================================== AD1
const evtByFx = (state, info) => { info.s7ByFx = !!state._fxSrc || info.cause === 'effect'; return true; };
SCRIPTS['AD1-002::어택 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const i = await pickIdx(ctx, self, 'hand', (id) => hasType(id, '하이브리드체', '10투사'), '파기할 「하이브리드체」/「10투사」 카드 선택 (취소=안 함)');
  if (i == null) return;
  S.trashFromHand(state, self, i);
  S.drawCards(state, self, 2);
  const ok = (id) => C(id).category === 'tamer' && !!(C(id).inheritedKo || '').trim() && (C(id).colors || []).some((c) => ['red', 'blue', 'green'].includes(c));
  const cands = [...pl.hand.filter(ok).map((id) => ({ id, z: 'hand' })), ...pl.trash.filter(ok).map((id) => ({ id, z: 'trash' }))];
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 테이머 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  const arr = c.z === 'hand' ? pl.hand : pl.trash;
  S.playFreeFromZone(state, self, c.z, arr.lastIndexOf(c.id));
})];
SCRIPTS['AD1-002::소멸 시'] = SCRIPTS['AD1-002::어택 종료 시'];
const tamerColors = (state, p) => new Set(tamersOf(state, p).flatMap((s) => C(s.cardId).colors || []));
H('AD1-004', { tag: '서로의 턴', has: '테이머의 색', dp: (state, hp, holder, target) => (target === holder ? 1000 * tamerColors(state, hp).size : 0), kwNum: (state, hp) => (tamerColors(state, hp).size >= 3 ? 1 : 0) });
SCRIPTS['AD1-004::어택 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (!h || !nameIncl(h.cardId, '그레이몬', '오메가몬')) return;
  const dp = S.effectiveDP(state, self, h);
  const entries = [self, ctx.opp].flatMap((w) => digimonsOf(state, w).filter((s) => s !== h && S.effectiveDP(state, w, s) <= dp && (w === self || !S.effectBlocked(state, w, s, 'delete'))).map((s) => ({ player: w, uid: s.uid })));
  if (!entries.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: `DP ${dp} 이하 디지몬 1마리 선택 (취소=안 함)` });
  if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) destroyIt(ctx, pick.player, st); }
})];
SCRIPTS['AD1-007::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  const pl = state.players[self];
  if (!h) return;
  const gam = (id) => isDig(id) && (C(id).nameKo.includes('감마몬') || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes('「감마몬」'));
  const pool = [...pl.hand.map((id, i) => ({ id, z: 'hand', i })), ...pl.trash.map((id, i) => ({ id, z: 'trash', i }))].filter((c) => gam(c.id));
  if (pool.length < 3) return;
  if (!(await confirm(ctx, '패/트래시의 「감마몬」 디지몬 3장을 진화원에 놓고 상대 디지몬을 소멸시킬까요?'))) return;
  const picked = [];
  for (let k = 0; k < 3; k++) {
    const rest = pool.filter((c) => !picked.includes(c));
    const pk = await pickFromList(ctx, self, rest.map((c) => c.id), `진화원에 놓을 「감마몬」 카드 선택 (${k + 1}/3)`);
    if (pk == null) return;
    picked.push(rest[pk]);
  }
  for (const c of picked) {
    const arr = c.z === 'hand' ? pl.hand : pl.trash;
    arr.splice(arr.lastIndexOf(c.id), 1);
    placeUnder(ctx, self, h, c.id);
  }
  S.emitGameEvent(state, 'sourcesAdded', { owner: self, stack: h, cause: 'effect', added: picked.map((c) => c.id), srcPlayer: self });
  const dp = S.effectiveDP(state, self, h);
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => S.effectiveDP(state, ctx.opp, s) <= dp), `DP ${dp} 이하의 상대 디지몬 선택`, { kind: 'delete' });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
SCRIPTS['AD1-007::자신의 턴 종료 시'] = [F(async (ctx) => {
  const h = holderOf(ctx);
  if (!h || h.sources.length < 5 || !ctx.startAttack) return;
  if (await confirm(ctx, '이 디지몬은 레스트하지 않고 어택할까요?')) ctx.startAttack(ctx.self, h.uid, undefined, { noRest: true });
})];
SCRIPTS['AD1-008::진화 시@DP 합계'] = [{ op: 'destroySum', stat: 'dp', limit: 10000 }, F(async (ctx) => {
  const h = holderOf(ctx);
  if (!h || h.suspended || !ctx.startAttack) return;
  if (await confirm(ctx, '이 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, h.uid);
})];
H('AD1-008', {
  tag: '자신의 턴', has: '오유민',
  dp: (state, hp, holder, target) => (target === holder && holder.sources.some((id) => nameIncl(id, '오유민')) ? 5000 : 0),
  effectImmune: (state, hp, holder, target) => target === holder && holder.sources.some((id) => nameIncl(id, '오유민')),
});
H('AD1-011', { tag: '진화 시', has: '조그레스', redirectImmune: (state, hp, holder, aStack) => aStack === holder && holder.s7NoRedirectUntil != null && state.turnNumber <= holder.s7NoRedirectUntil });
SCRIPTS['AD1-011::진화 시'] = [F(async (ctx) => {
  const h = holderOf(ctx);
  if (!h) return;
  h.battleImmuneUntilTurn = untilOppEnd(ctx);
  if (h.viaFusion) h.s7NoRedirectUntil = untilTurn(ctx.state);
})];
H('AD1-012', { tag: '상대의 턴', has: '조그레스', limit: 1, events: { attack: (state, hp, holder, info) => info.owner !== hp } });
SCRIPTS['AD1-012::상대의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const f = await jogressFromHand(ctx, self, (id) => nameIs(id, '오메가몬 Alter-S'));
  const pa = ctx.attack && ctx.attack();
  if (!pa || !pa.targetKind) return;
  const t = await pickStack(ctx, self, digimonsOf(state, self), '어택 대상으로 변경할 자신의 디지몬 선택 (취소=변경 안 함)');
  if (t) { pa.targetKind = 'digimon'; pa.targetUid = t.uid; pa.chargeTarget = null; }
})];
const distinctSrcColors = (holder) => new Set(holder.sources.flatMap((id) => C(id).colors || [])).size;
SCRIPTS['AD1-013::등장 시'] = [F(async (ctx) => {
  const ds = digimonsOf(ctx.state, ctx.opp);
  if (!ds.length) return;
  const min = Math.min(...ds.map((s) => s.sources.length));
  const t = await pickStack(ctx, ctx.opp, ds.filter((s) => s.sources.length === min), '진화원 매수가 가장 적은 상대 디지몬 선택', { kind: 'delete', mandatory: true });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
H('AD1-013', { tag: '서로의 턴', has: '배틀 에어리어를 떠날 때', onLeave: (state, hp, stack, cause) => cause !== 'xros' });
SCRIPTS['AD1-013::서로의 턴@배틀 에어리어를 떠날 때'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const evt = evtOf(ctx);
  if (!evt || !evt.sources) return;
  const idxs = pl.trash.map((id, i) => i).filter((i) => isDig(pl.trash[i]) && lv(pl.trash[i]) <= 5 && hasType(pl.trash[i], '블루 플레어', '크로스 하트') && evt.sources.includes(pl.trash[i]));
  if (!idxs.length || !(await confirm(ctx, '진화원의 「블루 플레어」/「크로스 하트」 Lv.5 이하 디지몬 1장을 코스트 없이 등장시킬까요?'))) return;
  const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: '등장시킬 디지몬 카드 선택' });
  if (i != null) S.playFreeFromZone(state, self, 'trash', i, {});
})];
H('AD1-013', { tag: '서로의 턴', src: 'inheritedKo', has: '진화원의 색', dp: (state, hp, holder, target) => (target === holder && hasType(holder.cardId, '블루 플레어', '크로스 하트') ? 1000 * distinctSrcColors(holder) : 0) });
SCRIPTS['AD1-015::어택 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const okT = (id) => C(id).category === 'tamer' && !!(C(id).inheritedKo || '').trim() && (C(id).colors || []).some((c) => ['yellow', 'black', 'purple'].includes(c));
  const cands = [...pl.hand.filter(okT).map((id) => ({ id, z: 'hand' })), ...pl.trash.filter(okT).map((id) => ({ id, z: 'trash' }))];
  if (cands.length) {
    const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 테이머 선택 (취소=안 함)');
    if (k != null) {
      const c = cands[k];
      const arr = c.z === 'hand' ? pl.hand : pl.trash;
      S.playFreeFromZone(state, self, c.z, arr.lastIndexOf(c.id), {});
    }
  }
  // 그 후: 패의 「하이브리드체」/「10투사」 1장을 이 디지몬이나 자신의 테이머 아래에 놓는 것으로 《2 드로우》
  const h = holderOf(ctx);
  const hosts = [...(h && state.players[self].battle.includes(h) ? [h] : []), ...tamersOf(state, self)];
  if (!hosts.length) return;
  const i = await pickIdx(ctx, self, 'hand', (id) => hasType(id, '하이브리드체', '10투사'), '진화원 아래에 놓을 「하이브리드체」/「10투사」 카드 선택 (취소=안 함)');
  if (i == null) return;
  const host = await pickStack(ctx, self, hosts, '카드를 아래에 놓을 디지몬/테이머 선택', { mandatory: true });
  if (!host) return;
  const [id] = pl.hand.splice(i, 1);
  placeUnder(ctx, self, host, id);
  S.emitGameEvent(state, 'sourcesAdded', { owner: self, stack: host, cause: 'effect', added: [id], srcPlayer: self });
  S.drawCards(state, self, 2);
})];
SCRIPTS['AD1-015::소멸 시'] = SCRIPTS['AD1-015::어택 종료 시'];
SCRIPTS['AD1-015::진화 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp), 'DP -4000 대상 선택', { kind: 'dpDown' });
  if (t) S.s7AddDpMod(ctx.state, ctx.opp, t.uid, -4000, untilTurn(ctx.state));
})];
// "이 카드가 등장할 때, <조건>이라면, 등장 코스트 -5" — printed on the card in hand (state.handSelfPlayDiscount)
H('AD1-018', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digimonsOf(state, hp).some((s) => nameIncl(s.cardId, '나이트몬', '루체몬')) ? -5 : 0) });
const mentionsName = (id, ...l) => l.some((x) => C(id).nameKo.includes(x) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${x}」`));
H('AD1-018', { tag: '서로의 턴', has: '기술이 있는', limit: 1, events: { play: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && mentionsName(info.stack.cardId, '나이트몬', '루체몬') } });
SCRIPTS['AD1-018::등장 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self), '상대 디지몬의 효과를 받지 않을 디지몬 선택', { mandatory: true });
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['all'], fromCategory: 'digimon', until: untilOppEnd(ctx) });
})];
H('AD1-024', { tag: '서로의 턴', has: '등장/진화했을 때', limit: 1, events: { play: (state, hp, holder, info) => S.isDigimonLike(info.stack) && evtByFx(state, info), digivolve: (state, hp, holder, info) => S.isDigimonLike(info.stack) && evtByFx(state, info) } });
SCRIPTS['AD1-024::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const e = evtOf(ctx);
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '레스트시킬 상대 디지몬 선택', { kind: 'rest', mandatory: true }); // Q6916: "…레스트 시키고,"는 필수 — 뒤의 "액티브 시킬 수 있다"만 선택
  if (t) await restIt(ctx, ctx.opp, t);
  const h = holderOf(ctx);
  if (h && h.suspended && await confirm(ctx, '이 디지몬을 액티브로 할까요?')) S.unsuspendStack(state, self, h.uid);
  if (!e || !e.s7ByFx) return;
  const r = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.suspended), '덱 아래로 되돌릴 레스트 상태의 상대 디지몬 선택 (취소=안 함)', { kind: 'bounce' });
  if (r) bounceIt(ctx, ctx.opp, r, 'deckBottom');
})];
SCRIPTS['AD1-024::진화 시'] = [F(async (ctx) => {
  const ds = digimonsOf(ctx.state, ctx.opp);
  if (!ds.length) return;
  const min = Math.min(...ds.map((s) => S.effectiveDP(ctx.state, ctx.opp, s)));
  const t = await pickStack(ctx, ctx.opp, ds.filter((s) => S.effectiveDP(ctx.state, ctx.opp, s) === min), 'DP가 가장 낮은 상대 디지몬 선택', { kind: 'bounce', mandatory: true });
  if (t) bounceIt(ctx, ctx.opp, t, 'deckBottom');
})];
SCRIPTS['AD1-024::어택 시'] = SCRIPTS['AD1-024::진화 시'];

// ==================================================================== BT25
H('P-234', { tag: '자신의 턴', has: '링크 카드가 효과로', events: { s7LinkTrashed: (state, hp, holder, info) => info.owner === hp && C(holder.cardId).category === 'tamer' && !holder.suspended } });
SCRIPTS['P-234::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = holderOf(ctx);
  const pl = state.players[self];
  const ok = (id) => hasType(id, '시스템', '내비', '툴', '리바이어던');
  if (!t || t.suspended || !pl.hand.some(ok) || !digimonsOf(state, self).length) return;
  if (!(await confirm(ctx, '이 테이머를 레스트시켜 카드를 링크 코스트 -2로 링크할까요?'))) return;
  S.restStack(state, self, t.uid);
  await doLink(ctx, { zones: ['hand'], pred: ok, host: 'any', delta: -2 });
})];
const LINKCOST1 = { tag: '자신의 턴', has: '링크 코스트 -1', limit: 1, linkCost: (state, hp, holder, host, cardId) => (host === holder && hasType(cardId, '소셜', '툴', '게임') ? -1 : 0) };
H('BT25-004', { ...LINKCOST1, src: 'inheritedKo' });
H('BT25-045', { ...LINKCOST1 });
H('BT25-005', { tag: '자신의 턴', src: 'inheritedKo', has: '3총사', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && (info.added || []).some((id) => hasType(id, '3총사')) } });
SCRIPTS['BT25-005::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 3총사/TS 디지몬으로 진화 코스트 -2 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => mentionsName(id, '3총사') || hasType(id, 'TS'), { discount: 2 } /* 「3총사」가 기술(=카드명/효과문에 표기)되어 있거나 특징 TS */);
})];
SCRIPTS['BT25-009::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const st = holderOf(ctx);
  if (!st || ownMemory(state, self) > 4 || !(await confirm(ctx, '패의 디지몬으로 코스트 없이 진화할까요?'))) return;
  await evolveStack(ctx, self, st, 'hand', (id) => typeIncl(id, '수', '짐승') || hasType(id, 'TS'), { free: true });
})];
H('BT25-010', { tag: '자신의 턴', has: '진화 코스트 -1', evoDiscount: (state, hp, holder, stack, tgt) => (stack === holder && typeIncl(tgt, '조', '새', '병아리', '수', '짐승') ? -1 : 0) });
H('BT25-048', { tag: '자신의 턴', has: '진화 코스트 -1', evoDiscount: (state, hp, holder, stack, tgt) => (stack === holder && isDig(tgt) && hasType(tgt, 'TS') && (C(tgt).colors || []).includes('green') ? -1 : 0) });
SCRIPTS['BT25-013::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const ok = (id) => isDig(id) && hasType(id, '일리아스') && (C(id).colors || []).some((c) => c === 'red' || c === 'blue');
  if (!pl.hand.length || !pl.trash.some(ok)) return;
  const h = await ctx.choose('pickFromHandIndexes', { player: self, eligibleIdxs: pl.hand.map((x, k) => k), n: 1, prompt: '파기할 패 1장 선택 (취소=안 함)' });
  if (!h || !h.length) return;
  S.trashFromHand(state, self, h[0]);
  const i = await pickIdx(ctx, self, 'trash', ok, '패에 추가할 카드 선택');
  if (i != null) pl.hand.push(pl.trash.splice(i, 1)[0]);
})];
const OWN_EVO_EVT = (colorTest) => ({ events: {
  play: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && colorTest(colorsOfStack(info.stack)),
  digivolve: (state, hp, holder, info) => info.owner === hp && S.isDigimonLike(info.stack) && colorTest(colorsOfStack(info.stack)) } });
const isBlue = (cs) => cs.includes('blue'), isRed = (cs) => cs.includes('red');
H('BT25-013', { tag: '자신의 턴', has: '플레어몬', ...OWN_EVO_EVT(isBlue) });
SCRIPTS['BT25-013::자신의 턴@플레어몬'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 「플레어몬」으로 진화 코스트 -1 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIs(id, '플레어몬'), { discount: 1 });
})];
H('BT25-017', { tag: '자신의 턴', has: '아폴로몬', ...OWN_EVO_EVT(isBlue) });
SCRIPTS['BT25-017::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 「아폴로몬」으로 진화 코스트 -2 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIs(id, '아폴로몬'), { discount: 2 });
})];
H('BT25-024', { tag: '자신의 턴', has: '크레세몬', ...OWN_EVO_EVT(isRed) });
SCRIPTS['BT25-024::자신의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '트래시의 「크레세몬」으로 진화 코스트 -1 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'trash', (id) => nameIs(id, '크레세몬'), { discount: 1 });
})];
SCRIPTS['BT25-026::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '진화원을 아래에서부터 3장 파기할 상대 디지몬 선택', { kind: 'srcTrash' });
  if (t) S.trashEvoSources(state, ctx.opp, t.uid, 3, 'bottom');
  const n = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => !s.sources.length), '레스트할 수 없게 할 진화원이 없는 상대 디지몬 선택', { kind: 'rest' });
  if (n) S.preventRest(state, ctx.opp, n.uid, untilOppEnd(ctx));
})];
H('BT25-026', { tag: '자신의 턴', has: '디아나몬', ...OWN_EVO_EVT(isRed) });
SCRIPTS['BT25-026::자신의 턴@디아나몬'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '트래시의 「디아나몬」으로 진화 코스트 -2 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'trash', (id) => nameIs(id, '디아나몬'), { discount: 2 });
})];
H('BT25-016', { tag: '서로의 턴', has: '13000', events: { attack: (state, hp, holder, info) => S.effectiveDP(state, info.owner, info.stack) >= 13000 } });
SCRIPTS['BT25-016::서로의 턴'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 「마르스몬」/「칼리스몬」으로 코스트 없이 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIs(id, '마르스몬', '칼리스몬'), { free: true });
})];
SCRIPTS['BT25-019::등장 시'] = [F(async (ctx) => {
  const ds = digimonsOf(ctx.state, ctx.opp);
  if (!ds.length) return;
  const max = Math.max(...ds.map((s) => S.effectiveDP(ctx.state, ctx.opp, s)));
  const t = await pickStack(ctx, ctx.opp, ds.filter((s) => S.effectiveDP(ctx.state, ctx.opp, s) === max), 'DP가 가장 높은 상대 디지몬 선택', { kind: 'delete', mandatory: true });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
SCRIPTS['BT25-019::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (!h) return;
  const om = oppMemory(state, self);
  if (om >= 5) S.grantShield(state, self, h.uid, { kinds: ['all'], fromCategory: 'digimon', until: untilOppEnd(ctx) });
  if (om <= 5) S.grantShield(state, self, h.uid, { kinds: ['all'], fromCategory: 'option', until: untilOppEnd(ctx) });
})];
H('BT25-020', { tag: '__handPlay', selfPlayDiscount: (state, hp) => ([hp, opp(hp)].some((w) => digimonsOf(state, w).some((x) => S.effectiveDP(state, w, x) >= 13000)) ? -5 : 0) });
SCRIPTS['BT25-020::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, self, digimonsOf(state, self), 'DP +3000 받을 자신의 디지몬 선택', { mandatory: true });
  if (t) S.s7AddDpMod(state, self, t.uid, 3000, untilTurn(state));
  const a = await pickStack(ctx, self, digimonsOf(state, self), '배틀할 자신의 디지몬 선택 (취소=안 함)');
  if (!a) return;
  const d = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp), '배틀할 상대의 디지몬 선택 (취소=안 함)');
  if (!d || !state.players[self].battle.includes(a)) return;
  const res = S.resolveDigimonBattle(state, self, a.uid, d.uid);
  // 16-7-3/16-7-4: this scripted battle can also win with ≪관통≫ if granted dynamically — capped at once per attack (S.consumePierceCheck, applied inside ctx.securityCheck).
  if (res && res.piercing && ctx.securityCheck) await ctx.securityCheck(self, a.uid, ctx.opp);
})];
H('BT25-020', { tag: '서로의 턴', has: '배틀에서 승리', limit: 1, events: { battleWin: (state, hp, holder, info) => info.owner === hp && hasType(info.stack.cardId, 'TS') } });
SCRIPTS['BT25-020::서로의 턴'] = [F(async (ctx) => { S.trashTopSecurityByEffect(ctx.state, ctx.opp); })];
// W9r2 (official Q6346/6347, BT25-058 칼리스몬): 「효과로 디지몬이 등장하거나 진화했을 때」 (either side, incl. itself) had NO watcher registered (the "등장하거나 진화했을" wording is not a generic pattern) -> the script never fired.
const byFxEvt = (state, info) => !!state._fxSrc || info.cause === 'effect' || info.cause === 'ownEffect';
H('BT25-058', { tag: '서로의 턴', has: '등장하거나 진화했을', limit: 1, events: { play: (state, hp, holder, info) => S.isDigimonLike(info.stack) && byFxEvt(state, info), digivolve: (state, hp, holder, info) => S.isDigimonLike(info.stack) && byFxEvt(state, info) } });
// W9r2 (BT25-060 리부트몬): 「이 디지몬이 링크되거나 액티브되었을 때」 — same gap (no watcher registered)
const selfLinkedOrActive = (state, hp, holder, info) => info.stack === holder && info.owner === hp;
H('BT25-060', { tag: '서로의 턴', has: '링크되거나 액티브', limit: 1, events: { linked: selfLinkedOrActive, active: selfLinkedOrActive, unsuspend: selfLinkedOrActive } });
H('BT25-028', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digimonsOf(state, opp(hp)).some((x) => lv(x.cardId) >= 6) ? -5 : 0) });
H('BT25-028', { tag: '서로의 턴', has: '등장/진화했을 때', limit: 1, events: { play: (state, hp, holder, info) => S.isDigimonLike(info.stack), digivolve: (state, hp, holder, info) => S.isDigimonLike(info.stack) } });
SCRIPTS['BT25-028::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  for (let k = 0; k < 4; k++) {
    const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => s.sources.length), `진화원을 파기할 상대 디지몬 선택 (${k + 1}/4, 취소=그만)`, { kind: 'srcTrash' });
    if (!t) break;
    await trashSourcesPicked(ctx, ctx.opp, t, 1);
  }
  if (await confirm(ctx, '자신의 디지몬 2마리로 「그레이스노바몬」에 조그레스 진화할까요?')) await jogressFromHand(ctx, self, (id) => nameIs(id, '그레이스노바몬'));
})];
SCRIPTS['BT25-028::등장 시'] = [F(async (ctx) => {
  const { state } = ctx;
  (state.s3RestLocks ||= []).push({ owner: ctx.opp, until: untilOppEnd(ctx), kind: 'maxSources', n: 1 }); // W9r2 official Q6294/6295: 「진화원 1장 이하인 상대의 디지몬 전부」 — dynamic: later arrivals are covered, a digimon that gains sources is released
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => !s.suspended), '소멸시킬 액티브 상태의 상대 디지몬 선택', { kind: 'delete' });
  if (t) destroyIt(ctx, ctx.opp, t);
})];
SCRIPTS['BT25-028::어택 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, ctx.state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트할 수 없게 할 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) S.preventRest(ctx.state, ctx.opp, t.uid, untilOppEnd(ctx));
})];
SCRIPTS['BT25-029::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, ctx.opp, digimonsOf(state, ctx.opp).filter((s) => lv(s.cardId) <= 5), 'Lv.5 이하 상대 디지몬 선택 (취소=안 함)', { kind: 'bounce' });
  if (t) bounceIt(ctx, ctx.opp, t, 'hand');
  const tm = tamersOf(state, self).find((s) => S.fdCount(s) > 0); // 「뒷면 카드」 = face-down block at the bottom of the tamer's sources
  if (!tm) { if (!t) ctx._declined = true; return; } // W9r2 official Q6296: not activating at all keeps the [턴 1회]
  const l = LOWLV(state, ctx.opp);
  if (!l.length || !(await confirm(ctx, '테이머 아래의 카드 1장을 파기하여 Lv.이 가장 낮은 상대 디지몬을 패에 추가할까요?'))) { if (!t) ctx._declined = true; return; }
  const c = await pickStack(ctx, ctx.opp, l, 'Lv.이 가장 낮은 상대 디지몬 선택', { kind: 'bounce', mandatory: true });
  if (!c) return;
  if (S.trashEvoSources(state, self, tm.uid, 1, 'bottom').length !== 1) return; // cost: sources of a tamer are trashed from the bottom (emits sourcesTrashed)
  bounceIt(ctx, ctx.opp, c, 'hand');
})];
SCRIPTS['BT25-029::어택 시'] = SCRIPTS['BT25-029::진화 시'];
H('BT25-029', { tag: '서로의 턴', has: '늘어나거나', limit: 1, events: {
  handIncrease: (state, hp, holder, info) => info.owner !== hp && info.cause === 'effect' && holder.suspended,
  sourcesTrashed: (state, hp, holder, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'tamer' && holder.suspended } });
SCRIPTS['BT25-029::서로의 턴'] = [F(async (ctx) => {
  const h = holderOf(ctx);
  if (h && h.suspended) S.unsuspendStack(ctx.state, ctx.self, h.uid);
})];
SCRIPTS['BT25-030::자신의 메인 페이즈 개시 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  if (!state.players[self].security.length || !(await confirm(ctx, '시큐리티 위 1장을 패에 추가하여 메모리를 1 얻을까요?'))) return;
  secToHand(state, self, 0);
  S.grantMemory(state, self, 1, ctx.sourceCardId);
})];
SCRIPTS['BT25-030::어택 시'] = SCRIPTS['BT24-031::어택 시'];
SCRIPTS['BT25-038::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const ok = (id) => isDig(id) && hasType(id, '천사형', '대천사형', '3대천사', '일리아스');
  const cands = pl.hand.filter(ok).map((id) => ({ id, z: 'hand' }));
  for (const d of digimonsOf(state, self)) d.sources.forEach((id) => { if (ok(id)) cands.push({ id, z: 'src', d }); });
  const h = holderOf(ctx);
  if (cands.length && await confirm(ctx, '카드를 시큐리티 위 또는 아래에 놓을까요?')) {
    const k = await pickFromList(ctx, self, cands.map((c) => c.id), '시큐리티에 놓을 카드 선택');
    if (k != null) {
      const c = cands[k];
      const pos = await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] });
      if (c.z === 'hand') pl.hand.splice(pl.hand.indexOf(c.id), 1); else { c.d.sources.splice(c.d.sources.lastIndexOf(c.id), 1); S.recomputeStackGrants(c.d); }
      S.addToSecurity(state, self, c.id, pos === 1 ? 'bottom' : 'top');
      S.emitGameEvent(state, 'securityIncrease', { owner: self, stack: null, cause: 'effect' });
    }
  }
  if (h && h.viaFusion) { S.trashTopSecurityByEffect(state, self); S.trashTopSecurityByEffect(state, ctx.opp); }
})];
H('BT25-038', { tag: '서로의 턴', has: '늘어났을 때', limit: 1, events: { securityIncrease: (state, hp, holder, info) => info.owner === hp } });
H('BT25-038', { tag: '서로의 턴', src: 'inheritedKo', has: '줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['BT25-038::서로의 턴@늘어났을 때'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, digimonsOf(ctx.state, ctx.opp), '《퇴화 1》 대상 선택', { kind: 'retreat' });
  if (t) S.retreat(ctx.state, ctx.opp, t.uid, 1);
})];
SCRIPTS['BT25-039::자신의 턴 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const hi = pl.hand.findIndex((id) => nameIs(id, '케레스몬') && isDig(id));
  if (hi < 0 || !(await confirm(ctx, '패의 「케레스몬」을 등장 코스트 -7로 등장시킬까요?'))) return;
  const id = pl.hand[hi];
  payMemory(state, self, Math.max(0, (C(id).cost || 0) - 7));
  const st = S.playFreeFromZone(state, self, 'hand', hi);
  const me = ctx.sourceCardId;
  if (st && pl.security.includes(me) && (await confirm(ctx, '이 카드를 등장한 디지몬의 진화원 아래에 놓을까요?'))) {
    pl.security.splice(pl.security.indexOf(me), 1);
    S.secFaceUpTake(pl, me);
    placeUnder(ctx, self, st, me);
    S.emitGameEvent(state, 'securityDecrease', { owner: self, stack: null, cause: 'effect' });
  }
})];
H('BT25-039', {
  tag: '서로의 턴', has: '벗어날 때',
  preventLeave: (state, hp, holder, target, tp, cause) => {
    if (cause === 'ownEffect' || target === holder) return false;
    if (!hasType(target.cardId, '신인형', '일리아스') || !['digimon', 'tamer'].includes(C(target.cardId).category)) return false;
    S.deleteStack(state, hp, holder.uid, 'trash', 'ownEffect');
    return true;
  },
});
SCRIPTS['BT25-039::소멸 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const id = ctx.sourceCardId;
  if (pl.trash.lastIndexOf(id) < 0 || !(await confirm(ctx, '이 카드를 시큐리티 아래에 앞면으로 놓을까요?'))) return;
  pl.trash.splice(pl.trash.lastIndexOf(id), 1);
  S.secAddFaceUp(state, self, id, 'bottom');
})];
const REDIRECT_EVT = { tag: '상대의 턴', src: 'inheritedKo', has: '어택 대상을', limit: 1, events: { attack: (state, hp, holder, info) => info.owner !== hp && state.players[hp].battle.some((s) => C(s.cardId).category === 'digimon' && s.suspended) } };
async function redirectToRested(ctx) {
  const { state, self } = ctx;
  const pa = ctx.attack && ctx.attack();
  const c = digimonsOf(state, self).filter((s) => s.suspended);
  if (!pa || !c.length || !(await confirm(ctx, '어택 대상을 자신의 레스트 상태인 디지몬 1마리로 변경할까요?'))) return;
  const t = await pickStack(ctx, self, c, '새 어택 대상 선택', { mandatory: true });
  if (t && pa.targetKind) { pa.targetKind = 'digimon'; pa.targetUid = t.uid; pa.chargeTarget = null; }
}
H('BT25-039', { ...REDIRECT_EVT });
SCRIPTS['BT25-039::상대의 턴'] = [F(redirectToRested)];
H('BT25-055', { ...REDIRECT_EVT });
SCRIPTS['BT25-055::상대의 턴'] = [F(redirectToRested)];
SCRIPTS['BT25-055::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const all = [self, ctx.opp].flatMap((w) => digimonsOf(state, w).filter((s) => w === self || !S.effectBlocked(state, w, s, 'rest')).map((s) => ({ player: w, uid: s.uid })));
  if (all.length) {
    const pick = await ctx.choose('pickStackAnySide', { entries: all, prompt: '레스트할 디지몬 선택 (취소=안 함)' });
    if (pick) { const st = findSt(state, pick.player, pick.uid); if (st) await restIt(ctx, pick.player, st); }
  }
  const restedN = [self, ctx.opp].reduce((n, w) => n + digimonsOf(state, w).filter((s) => s.suspended).length, 0);
  if (restedN < 2) return;
  const t = await pickStack(ctx, self, digimonsOf(state, self).filter((s) => s.suspended), '액티브로 할 자신의 디지몬 선택 (취소=안 함)');
  if (t) S.unsuspendStack(state, self, t.uid);
})];
SCRIPTS['BT25-055::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const i = await pickIdx(ctx, self, 'hand', (id) => isDig(id) && (C(id).dp || 0) <= 4000 && (typeIncl(id, '식물형', '식물', '조', '새', '병아리') || hasType(id, 'TS')), '코스트 없이 등장시킬 디지몬 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
})];
SCRIPTS['BT25-041::진화 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  if (state.activePlayer !== self) return;
  const pl = state.players[self];
  const ok = (id) => hasType(id, '글로잉 던') && (C(id).category !== 'option' || S.optionColorOk(state, self, id));
  if (!pl.hand.some(ok)) return;
  const tm = tamersOf(state, self).find((s) => S.fdCount(s) > 0);
  const opts = [];
  if (pl.security.length) opts.push('시큐리티 위 1장을 패에 추가');
  if (tm) opts.push('테이머 아래의 뒷면 카드 1장 파기');
  if (!opts.length) return;
  const k = await ctx.choose('multipleChoice', { prompt: '지불할 비용 선택', options: opts });
  if (k == null) return;
  const i = await pickIdx(ctx, self, 'hand', ok, '등장/사용할 「글로잉 던」 카드 선택 (취소=안 함)');
  if (i == null) return;
  if (opts[k].startsWith('시큐리티')) secToHand(state, self, 0);
  else S.trashEvoSources(state, self, tm.uid, 1, 'bottom');
  const idx = pl.hand.indexOf(pl.hand[Math.min(i, pl.hand.length - 1)]);
  const id = pl.hand[Math.min(i, pl.hand.length - 1)];
  const cost = Math.max(0, (C(id).cost || 0) - 3);
  payMemory(state, self, cost);
  if (C(id).category === 'option') { pl.hand.splice(pl.hand.indexOf(id), 1); await useOptionFree(ctx, self, id, cost); }
  else S.playFreeFromZone(state, self, 'hand', pl.hand.indexOf(id));
})];
SCRIPTS['BT25-041::어택 시'] = SCRIPTS['BT25-041::진화 시'];
SCRIPTS['BT25-041::어택 종료 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  if (!h || !h.suspended || !hasType(h.cardId, '글로잉 던')) return;
  const tm = tamersOf(state, self).find((s) => S.fdCount(s) > 0);
  if (!tm || !(await confirm(ctx, '테이머 아래의 뒷면 카드 1장을 파기하여 이 디지몬을 액티브로 할까요?'))) return;
  if (S.trashEvoSources(state, self, tm.uid, 1, 'bottom').length !== 1) return;
  S.unsuspendStack(state, self, h.uid);
})];
SCRIPTS['BT25-042::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const h = holderOf(ctx);
  if (!h || !pl.security.length) return;
  const k = await ctx.choose('multipleChoice', { prompt: '시큐리티 위 또는 아래 1장을 파기하여 상대 디지몬 효과를 받지 않게 할까요?', options: ['위 1장 파기', '아래 1장 파기', '발동하지 않음'] });
  if (k == null || k === 2) return;
  if (k === 0) S.trashTopSecurityByEffect(state, self); else S.trashBottomSecurityByEffect(state, self);
  S.grantShield(state, self, h.uid, { kinds: ['all'], fromCategory: 'digimon', until: untilOppEnd(ctx) });
})];
SCRIPTS['BT25-042::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const i = await pickIdx(ctx, self, 'hand', (id) => isDig(id) && hasType(id, '천사형', '일리아스') && lv(id) <= 4, '코스트 없이 등장시킬 카드 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
  const c = digimonsOf(state, self);
  for (let k = 0; k < 2; k++) {
    const t = await pickStack(ctx, self, c.filter((s) => !s.s7Picked), `《재기동》/《블로커》를 얻을 디지몬 선택 (${k + 1}/2)`);
    if (!t) break;
    t.s7Picked = true;
    S.grantKeyword(state, self, t.uid, '재기동', undefined, 'turn');
    S.grantKeyword(state, self, t.uid, '블로커', undefined, 'turn');
    t.keywordExpiry['재기동'] = untilOppEnd(ctx); t.keywordExpiry['블로커'] = untilOppEnd(ctx);
  }
  for (const s of c) delete s.s7Picked;
})];
H('BT25-042', { tag: '서로의 턴', has: '줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['BT25-044::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const h = holderOf(ctx);
  const c = [self, ctx.opp].flatMap((w) => digimonsOf(state, w).filter((s) => s !== h).map((s) => ({ player: w, uid: s.uid })));
  const okc = c.filter((e) => e.player === self || !S.effectBlocked(state, e.player, findSt(state, e.player, e.uid), 'bounce'));
  if (!okc.length) return;
  const pick = await ctx.choose('pickStackAnySide', { entries: okc, prompt: '시큐리티 위에 놓을 다른 디지몬 선택 (취소=안 함)' });
  if (!pick) return;
  const st = findSt(state, pick.player, pick.uid);
  if (!st || !bounceIt(ctx, pick.player, st, 'secTop')) return;
  S.emitGameEvent(state, 'securityIncrease', { owner: pick.player, stack: null, cause: 'effect' });
  S.trashTopSecurityByEffect(state, self);
  S.trashTopSecurityByEffect(state, ctx.opp);
})];
H('BT25-044', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (state.players[hp].security.length + state.players[opp(hp)].security.length <= 6 ? -5 : 0) });
H('BT25-044', { tag: '서로의 턴', has: '줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp } });
SCRIPTS['BT25-044::서로의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  const ok = (id) => hasType(id, '천사형', '대천사형', '일리아스') && (C(id).cost || 0) <= 8 && C(id).category !== 'option';
  const cands = [...pl.hand.filter(ok).map((id) => ({ id, z: 'hand' })), ...pl.trash.filter(ok).map((id) => ({ id, z: 'trash' }))];
  if (!cands.length) return;
  const k = await pickFromList(ctx, self, cands.map((c) => c.id), '코스트 없이 등장시킬 카드 선택 (취소=안 함)');
  if (k == null) return;
  const c = cands[k];
  const arr = c.z === 'hand' ? pl.hand : pl.trash;
  S.playFreeFromZone(state, self, c.z, arr.lastIndexOf(c.id));
})];
H('BT25-049', { tag: '자신의 턴', has: '사용 코스트 -3', limit: 1, playDiscount: (state, hp, holder, cardId) => {
  const tm = tamersOf(state, hp).find((s) => S.fdCount(s) > 0);
  if (!tm || C(cardId).category !== 'option' || !hasType(cardId, '글로잉 던')) return null;
  return { label: `${C(holder.cardId).nameKo}: 테이머 아래의 뒷면 카드 1장을 파기하여 ${C(cardId).nameKo} 사용 코스트 -3?`, apply() { S.trashEvoSources(state, hp, tm.uid, 1, 'bottom'); return -3; } };
} });
SCRIPTS['BT25-051::등장 시'] = [F(async (ctx) => {
  const t = await pickStack(ctx, ctx.self, digimonsOf(ctx.state, ctx.self).filter((s) => typeIncl(s.cardId, '수', '짐승') || hasType(s.cardId, '신인형', 'TS')), 'DP +3000 받을 디지몬 선택', { mandatory: true });
  if (t) S.s7AddDpMod(ctx.state, ctx.self, t.uid, 3000, untilOppEnd(ctx));
})];
SCRIPTS['BT25-052::메인'] = [F(async (ctx) => {
  await doLink(ctx, { zones: ['hand', 'sources'], pred: (id) => isDig(id) && hasType(id, '소셜', '툴', '게임'), host: 'this', delta: -1 });
})];
H('BT25-052', { tag: '자신의 턴', has: '링크되었을 때', limit: 1, events: { linked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['BT25-052::자신의 턴'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const pl = state.players[self];
  if (tamersOf(state, self).length > 1) return;
  const i = await pickIdx(ctx, self, 'hand', (id) => C(id).category === 'tamer' && nameIs(id, '카즈키 & 이츠키'), '코스트 없이 등장시킬 「카즈키 & 이츠키」 선택 (취소=안 함)');
  if (i != null) S.playFreeFromZone(state, self, 'hand', i);
})];
H('BT25-056', { tag: '서로의 턴', has: '링크되었을 때', events: { linked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['BT25-053::등장 시'] = [F(async (ctx) => {
  const { state, self } = ctx;
  const t = await pickStack(ctx, ctx.opp, state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트시킬 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) {
    await restIt(ctx, ctx.opp, t);
    t.s2NoActiveUntil = untilOppEnd(ctx); // 상대의 턴 종료까지 액티브로 할 수 없다
  }
  const h = holderOf(ctx);
  if (h && state.players[self].security.length <= 3) {
    S.grantKeyword(state, self, h.uid, '관통', undefined, 'turn');
    S.s7AddDpMod(state, self, h.uid, 5000, untilTurn(state));
  }
})];
H('BT25-053', { tag: '서로의 턴', src: 'inheritedKo', has: '줄어들었을 때', limit: 1, events: { securityDecrease: () => true } });
SCRIPTS['BT25-053::서로의 턴'] = [F(async (ctx) => {
  if (!(await confirm(ctx, '상대의 디지몬/테이머 1마리(명)를 레스트시킬까요?'))) return;
  const t = await pickStack(ctx, ctx.opp, ctx.state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category)), '레스트시킬 상대 디지몬/테이머 선택', { kind: 'rest' });
  if (t) await restIt(ctx, ctx.opp, t);
})];
H('BT25-054', { tag: '서로의 턴', has: '배틀에서 승리', events: { battleWin: (state, hp, holder, info) => info.stack === holder } });
// 「이 디지몬이 배틀에서 승리했을 때, 《1 드로우》」 (inherited) — battle-win watcher is not covered by the generic parser
H('BT25-048', { tag: '서로의 턴', src: 'inheritedKo', has: '배틀에서 승리', limit: 1, events: { battleWin: (state, hp, holder, info) => info.stack === holder } });
H('BT25-051', { tag: '서로의 턴', src: 'inheritedKo', has: '배틀에서 승리', limit: 1, events: { battleWin: (state, hp, holder, info) => info.stack === holder } });
SCRIPTS['BT25-054::서로의 턴@마르스몬'] = [F(async (ctx) => {
  const st = holderOf(ctx);
  if (!st || !(await confirm(ctx, '패의 「칼리스몬」/「마르스몬」으로 코스트 없이 진화할까요?'))) return;
  await evolveStack(ctx, ctx.self, st, 'hand', (id) => nameIs(id, '칼리스몬', '마르스몬'), { free: true });
})];
SCRIPTS['BT25-056::등장 시'] = [F(async (ctx) => {
  if (ctx.state.activePlayer !== ctx.self) return;
  await doLink(ctx, { zones: ['hand', 'sources'], pred: (id) => isDig(id) && hasType(id, '소셜', '툴', '게임'), host: 'this', delta: -2 });
})];
// @@PART-END
