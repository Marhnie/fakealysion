// Shard 3 — bespoke per-card scripts (SCRIPTS), custom ops (OPS, prefixed s3_) and continuous/event hooks (HOOKS).
// Keys: 'CARD-ID::firstTag' or 'CARD-ID::firstTag@needle' (needle must appear in the effect text; disambiguates
// several same-tag segments on one card). S is imported for RUNTIME use only (state.js imports this module: no top-level S use).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const PL = (ctx, p) => ctx.state.players[p];
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
// 특징 = 유형(types) + 속성(attribute: 백신종/바이러스종/프리…) + 형태(form: 완전체…)
const traitsOf = (id) => { const c = C(id); return [...(c.types || []), c.attribute, c.form].filter(Boolean); };
const traitAny = (id, list) => traitsOf(id).some(t => list.includes(t));
const nameHas = (id, list) => list.some(n => C(id).nameKo.includes(n));
const colorHas = (id, col) => (C(id).colors || []).includes(col);
const stackHasColor = (st, col) => S.stackColors(st).includes(col);
const dp = (ctx, p, st) => S.effectiveDP(ctx.state, p, st);
const lvl = (id) => C(id).level ?? 0;
const memSelf = (ctx) => (ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory); // >0: own side
const untilOppTurnEnd = (ctx) => (ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber);
const untilOwnTurnEnd = (ctx) => (ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber : ctx.state.turnNumber + 1);
const fn = (f) => ({ op: 's3_fn', fn: f });
OPS.s3_fn = async (instr, ctx) => { await instr.fn(ctx); };
const sc = (key, script) => { SCRIPTS[key] = script; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };

async function pickStack(ctx, player, stacks, prompt, extra = {}) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player, uids: stacks.map(s => s.uid), prompt, ...extra });
  return stacks.find(s => s.uid === uid) || null;
}
// index into pl[zone] of a card chosen by the player among those matching pred(id, idx); -1 if none/cancelled
async function pickIdx(ctx, who, pred, prompt, zone = 'hand') {
  const arr = PL(ctx, who)[zone];
  const idxs = arr.map((id, i) => i).filter(i => pred(arr[i], i));
  if (!idxs.length) return -1;
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return idx == null ? -1 : idx;
}
async function confirm(ctx, prompt, who = ctx.self) { return !!(await ctx.choose('confirmEffect', { player: who, prompt })); }
function destroy(ctx, p, st) { return S.deleteStack(ctx.state, p, st.uid, 'trash', p === ctx.self ? 'ownEffect' : 'effect'); }
const stillThere = (ctx, p, st) => !!findStack(ctx.state, p, st.uid);
// temp DP with an explicit last-turn expiry
function dpTemp(ctx, p, st, amount, until) {
  S.modifyDP(ctx.state, p, st.uid, amount, 'turn');
  if (findStack(ctx.state, p, st.uid)) st.dpExpiry = Math.max(until, typeof st.dpExpiry === 'number' ? st.dpExpiry : 0);
}
// a card taken from hand goes under a stack's evolution sources (bottom)
function addSourcesBottom(ctx, p, st, ids) { st.sources.unshift(...ids); S.recomputeStackGrants(st); S.log(ctx.state, `${p} ${ids.map(i => C(i).nameKo).join(', ')} → ${C(st.cardId).nameKo} 진화원 아래`); }
function removeFromHand(ctx, p, idx) { const [id] = PL(ctx, p).hand.splice(idx, 1); return id; }
// leave the battle area to a hand/deck/security destination (sources/links trashed)
function bounceStack(ctx, p, st, dest = 'hand') {
  const pl = PL(ctx, p);
  const i = pl.battle.indexOf(st);
  if (i < 0) return false;
  if (S.effectBlocked(ctx.state, p, st, 'bounce') || S.leaveGate(ctx.state, p, st, p === ctx.self ? 'ownEffect' : 'effect', 'bounce', () => bounceStack(ctx, p, st, dest))) return false;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map(l => l.cardId);
  pl.trash.push(...st.sources, ...linkIds);
  if (dest === 'hand') pl.hand.push(st.cardId);
  else if (dest === 'deckBottom') pl.deck.push(st.cardId);
  else if (dest === 'securityTop') pl.security.unshift(st.cardId);
  else if (dest === 'securityBottom') pl.security.push(st.cardId);
  S.log(ctx.state, `${p} ${C(st.cardId).nameKo} → ${dest} (진화원 ${st.sources.length}장 파기)`);
  S.applyOverflowBatch(ctx.state, p, [...st.sources, st.cardId]);
  S.hookLeaveTriggers(ctx.state, p, st, p === ctx.self ? 'ownEffect' : 'effect');
  if (dest.startsWith('security')) S.emitGameEvent(ctx.state, 'securityIncrease', { owner: p, stack: null, cause: 'effect' });
  return true;
}
// tokens
function ensureToken(def) {
  const id = 'TOKEN-' + def.name;
  if (!S.CARDS[id]) S.CARDS[id] = { id, cardId: id, nameKo: def.name, category: 'digimon', level: def.level ?? null, cost: def.cost ?? 0, dp: def.dp, colors: def.colors, types: def.types || [], form: def.form || null, attribute: def.attribute || null, effectKo: def.effectKo || '', inheritedKo: '', evoNormal: null, isToken: true };
  return id;
}
function spawnToken(ctx, p, def, rested = false) {
  const id = ensureToken(def);
  const pl = PL(ctx, p);
  pl.hand.push(id);
  return S.playFreeFromZone(ctx.state, p, 'hand', pl.hand.length - 1, { rested });
}
// play a card from hand/trash choosing among pred matches, paying (cost - reduction) memory
async function playPay(ctx, who, zone, pred, reduction, prompt, opts = {}) {
  const idx = await pickIdx(ctx, who, pred, prompt, zone);
  if (idx < 0) return null;
  const id = PL(ctx, who)[zone][idx];
  const locked = S.isPlayCostLocked(ctx.state);
  const cost = Math.max(0, (C(id).cost || 0) - (locked ? 0 : reduction));
  if (cost > 0) S.spendMemory(ctx.state, cost);
  return S.playFreeFromZone(ctx.state, who, zone, idx, opts);
}
async function playFreeWhere(ctx, who, zone, pred, prompt, opts = {}) {
  const idx = await pickIdx(ctx, who, pred, prompt, zone);
  if (idx < 0) return null;
  return S.playFreeFromZone(ctx.state, who, zone, idx, opts);
}
// evolve: subject 'this' or (stack)=>bool over own digimon; cardPred(id) over `zone`; cost {mode:'free'|'fixed'|'discount'|'normal', n}
async function evolveGeneric(ctx, o) {
  const { state } = ctx;
  const pl = PL(ctx, ctx.self);
  const zone = o.zone || 'hand';
  const cands = o.subject === 'this' ? [me(ctx)].filter(Boolean) : pl.battle.filter(s => isDig(s) && (!o.subject || o.subject(s)));
  const okCards = (st) => pl[zone].map((id, i) => i).filter(i => C(pl[zone][i]).category === 'digimon' && (!o.cardPred || o.cardPred(pl[zone][i])) &&
    (o.ignoreCond ? ctx.E.evoRestrictionCheck(pl[zone][i], S.evolveTargetRestriction(state, ctx.self, st)).ok : ctx.E.canEvolveAny(st.cardId, pl[zone][i], st.extraColors || [], S.evolveTargetRestriction(state, ctx.self, st)).ok));
  const stacks = cands.filter(s => okCards(s).length);
  if (!stacks.length) { S.log(state, `${ctx.self} 진화시킬 수 있는 조합이 없음`); return null; }
  const st = stacks.length === 1 ? stacks[0] : await pickStack(ctx, ctx.self, stacks, o.prompt || '진화시킬 디지몬 선택');
  if (!st) return null;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone, eligibleIdxs: okCards(st), prompt: o.cardPrompt || '진화할 카드 선택' });
  if (idx == null) return null;
  const cardId = pl[zone][idx];
  const chk = ctx.E.canEvolveAny(st.cardId, cardId, st.extraColors || [], null);
  const printed = chk.ok ? chk.cost : (C(cardId).evoNormal?.cost ?? 0);
  const c = o.cost || { mode: 'normal' };
  const cost = c.mode === 'free' ? 0 : c.mode === 'fixed' ? c.n : c.mode === 'discount' ? Math.max(0, printed - c.n) : printed;
  if (zone === 'trash') pl.trash.splice(idx, 1);
  return S.digivolve(state, ctx.self, st.uid, cardId, cost, zone === 'trash' ? 'trash' : 'hand');
}
// memory positions: own-perspective value; opponent-side amount = -memSelf
const oppSideMem = (ctx) => -memSelf(ctx);

// ------------------------------------------------------------------ shared ops
// discard N random cards from a hand without looking
OPS.s3_randomDiscard = async (instr, ctx) => {
  const who = instr.who === 'opponent' ? ctx.opp : ctx.self;
  for (let i = 0; i < (instr.n || 1); i++) {
    const hand = PL(ctx, who).hand;
    if (!hand.length) break;
    S.trashFromHand(ctx.state, who, Math.floor(Math.random() * hand.length));
  }
};
// take security top to hand (cost), then optionally place a matching hand card into security
async function secSwap(ctx, pred, positions, prompt) {
  const pl = PL(ctx, ctx.self);
  if (!pl.security.length) return;
  if (!(await confirm(ctx, prompt))) return;
  pl.hand.push(pl.security.shift());
  S.log(ctx.state, `${ctx.self} 시큐리티 맨 위 카드를 패에 추가`);
  S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' });
  const idx = await pickIdx(ctx, ctx.self, pred, '시큐리티에 놓을 카드 선택');
  if (idx < 0) return;
  let pos = positions[0];
  if (positions.length > 1) pos = (await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] })) === 1 ? 'bottom' : 'top';
  S.addToSecurity(ctx.state, ctx.self, removeFromHand(ctx, ctx.self, idx), pos);
}
async function handToSecurity(ctx, pred, pos, prompt, optional = true) {
  const idx = await pickIdx(ctx, ctx.self, pred, prompt);
  if (idx < 0) return;
  S.addToSecurity(ctx.state, ctx.self, removeFromHand(ctx, ctx.self, idx), pos);
}

// ------------------------------------------------------------------ BT14
// BT14-029 어택 시
sc('BT14-029::어택 시', [{ op: 'condition', if: { test: (ctx) => { const st = me(ctx); return !!st && !PL(ctx, ctx.opp).battle.some(s => isDig(s) && s.sources.length >= st.sources.length); } }, then: [{ op: 'unsuspend', target: 'thisStack' }], else: [] }]);
// BT14-038
sc('BT14-038::시큐리티', [{ op: 'condition', if: { test: (ctx) => PL(ctx, ctx.self).trash.filter(id => C(id).nameKo.includes('스카몬')).length >= 3 },
  then: [{ op: 'playFree', who: 'self', zone: 'hand', filter: { nameAny: ['에테몬'], level: 6, category: 'digimon' } }], else: [] }]);
sc('BT14-038::소멸 시@이 카드를 시큐리티 아래에', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self); const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (i >= 0) { pl.trash.splice(i, 1); S.addToSecurity(ctx.state, ctx.self, ctx.sourceCardId, 'bottom'); }
})]);
sc('BT14-038::소멸 시@「에테몬」 1장을 시큐리티 아래에', [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).nameKo === '에테몬', '시큐리티 아래에 놓을 「에테몬」 선택', 'trash');
  if (idx >= 0) S.addToSecurity(ctx.state, ctx.self, PL(ctx, ctx.self).trash.splice(idx, 1)[0], 'bottom');
})]);
// BT14-040
sc('BT14-040::등장 시', [fn((ctx) => handToSecurity(ctx, (id) => C(id).category === 'tamer', 'top', '시큐리티 위에 놓을 테이머 카드 선택'))]);
// BT14-062 (서로의 턴): 상대의 효과로 소멸하지 않는다
hk('BT14-062', { tag: '서로의 턴', has: '소멸하지', effectImmune: (state, hp, holder, target, tp, o) => target === holder && o.kind === 'delete' });
// BT14-075 / EX6-059: 상대의 패 1장을 보지 않고 파기
sc('BT14-075::소멸 시', [{ op: 's3_randomDiscard', who: 'opponent', n: 1 }]);
sc('EX6-059::등장 시', [{ op: 's3_randomDiscard', who: 'opponent', n: 1 }]);
// BT14-081 (자신의 턴): 턴 종료 조건이 메모리가 상대 쪽의 3 이상
hk('BT14-081', { tag: '자신의 턴', has: '턴 종료 조건', turnEndAt: () => 3 });
// BT14-084 등장 시
sc('BT14-084::등장 시', [fn((ctx) => secSwap(ctx, (id) => C(id).category !== 'unknown' && traitAny(id, ['백신종']) && colorHas(id, 'yellow'), ['bottom'], '시큐리티 맨 위 1장을 패에 추가하고 백신종 옐로 카드를 시큐리티 아래에 놓을까요?'))]);
// P-127 / P-129 (자신의 메인 페이즈 개시 시)
sc('P-127::자신의 메인 페이즈 개시 시', [{ op: 'condition', if: { test: (ctx) => PL(ctx, ctx.self).security.length < PL(ctx, ctx.opp).security.length }, then: [{ op: 'gainMemory', who: 'self', n: 1 }], else: [] }]);
sc('P-129::자신의 메인 페이즈 개시 시', [{ op: 'condition', if: { test: (ctx) => PL(ctx, ctx.self).security.length > PL(ctx, ctx.opp).security.length }, then: [{ op: 'gainMemory', who: 'self', n: 1 }], else: [] }]);
// P-130 등장 시: 육성 에어리어의 Lv.3 이상 디지몬 → 배틀 에어리어 (부화/이동 제한과 무관한 효과 이동)
sc('P-130::등장 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  if (!pl.raising || lvl(pl.raising.cardId) < 3 || !(await confirm(ctx, '육성 에어리어의 디지몬을 배틀 에어리어로 이동시킬까요?'))) return;
  const prev = ctx.state.breedingActionTaken; ctx.state.breedingActionTaken = false;
  S.moveRaisingToBattle(ctx.state, ctx.self);
  ctx.state.breedingActionTaken = prev;
})]);
// BT15-016 등장 시/진화 시
sc('BT15-016::등장 시', [fn(async (ctx) => {
  if (oppSideMem(ctx) <= 4) {
    const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && dp(ctx, ctx.opp, s) >= 8000), '어택할 수 없게 될 DP 8000 이상 디지몬 선택');
    if (t) S.restrictAttack(ctx.state, ctx.opp, t.uid, untilOppTurnEnd(ctx));
  }
  if (oppSideMem(ctx) >= 4) {
    const lim = 6000 + S.dpDestroyCapBoost(ctx.state, ctx.self, ctx.sourceStackUid);
    const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && dp(ctx, ctx.opp, s) <= lim), '소멸시킬 DP 6000 이하 디지몬 선택', { fxKind: 'delete' });
    if (t) destroy(ctx, ctx.opp, t);
  }
})]);
// BT15-022 등장 시: 효과로 등장하고 있었다면
sc('BT15-022::등장 시', [fn(async (ctx) => {
  const st = me(ctx);
  if (!st || !st.playedByEffect) return;
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), '어택할 수 없게 될 디지몬 선택');
  if (t) S.restrictAttack(ctx.state, ctx.opp, t.uid, untilOppTurnEnd(ctx));
})]);

// ------------------------------------------------------------------ 마인드 링크 / 진화원 아래에 놓고 진화
// 《마인드 링크》: this Tamer (in the battle area) goes under the bottom of a Digimon's sources; that Digimon must have no Tamer card in its sources.
function mindLink(pred, label) {
  return [fn(async (ctx) => {
    const t = me(ctx);
    if (!t || !isTam(t)) return;
    const pl = PL(ctx, ctx.self);
    const cands = pl.battle.filter(s => isDig(s) && pred(C(s.cardId)) && !s.sources.some(id => C(id).category === 'tamer'));
    const tgt = await pickStack(ctx, ctx.self, cands, `《마인드 링크》 ${label}: 진화원에 테이머가 없는 디지몬 선택`);
    if (!tgt) return;
    pl.battle.splice(pl.battle.indexOf(t), 1);
    pl.trash.push(...t.sources, ...(t.linkCards || []).map(l => l.cardId));
    addSourcesBottom(ctx, ctx.self, tgt, [t.cardId]);
    S.emitGameEvent(ctx.state, 'sourcesAdded', { owner: ctx.self, stack: tgt, cause: 'effect', added: [t.cardId], srcPlayer: ctx.self, srcCategory: 'tamer' });
  })];
}
const tn = (list) => (c) => list.some(n => c.nameKo.includes(n));
const tt = (list) => (c) => (c.types || []).some(t => list.includes(t));
sc('BT14-086::메인', mindLink((c) => tn(['워매몬', '퍼펫몬'])(c) || tt(['디지대'])(c), '워매몬/퍼펫몬/디지대'));
sc('BT14-087::메인', mindLink(tt(['마수형', 'SoC']), '마수형/SoC'));
sc('BT15-086::메인', mindLink(tt(['머신형', '사이보그형', 'SoC']), '머신형/사이보그형/SoC'));
sc('BT15-087::메인', mindLink(tt(['X항체', '디지대']), 'X항체/디지대'));
sc('BT16-086::메인', mindLink(tn(['펄스몬']), '펄스몬'));
sc('BT16-087::메인', mindLink(tt(['X항체', 'SoC']), 'X항체/SoC'));

// place named cards (trash / this tamer) under an own named digimon, then evolve it into a named hand card
function placeThenEvolve(o) {
  return [fn(async (ctx) => {
    const pl = PL(ctx, ctx.self);
    const subjects = pl.battle.filter(s => isDig(s) && C(s.cardId).nameKo === o.subjName);
    const hIdx = pl.hand.findIndex(id => C(id).nameKo === o.targetName);
    const tIdx = o.trashNames.map(n => pl.trash.findIndex(id => C(id).nameKo === n));
    const tamer = o.thisTamer ? me(ctx) : null;
    if (!subjects.length || hIdx < 0 || tIdx.some(i => i < 0) || (o.thisTamer && !isTam(tamer))) return;
    if (!(await confirm(ctx, `${o.trashNames.map(n => `「${n}」`).join('・')}을(를) 「${o.subjName}」 아래에 놓고 「${o.targetName}」(으)로 진화시킬까요?`))) return;
    const sub = await pickStack(ctx, ctx.self, subjects, `「${o.subjName}」 선택`);
    if (!sub) return;
    const placed = [];
    for (const n of o.trashNames) { const i = pl.trash.findIndex(id => C(id).nameKo === n); placed.push(pl.trash.splice(i, 1)[0]); }
    if (tamer) { pl.battle.splice(pl.battle.indexOf(tamer), 1); pl.trash.push(...tamer.sources); placed.push(tamer.cardId); }
    addSourcesBottom(ctx, ctx.self, sub, placed);
    S.emitGameEvent(ctx.state, 'sourcesAdded', { owner: ctx.self, stack: sub, cause: 'effect', added: placed, srcPlayer: ctx.self, srcCategory: 'option' });
    const idx = pl.hand.findIndex(id => C(id).nameKo === o.targetName);
    const res = S.digivolve(ctx.state, ctx.self, sub.uid, pl.hand[idx], o.cost ?? 0, 'hand');
    if (res && o.after) o.after(ctx, res);
  })];
}
sc('BT14-090::메인', placeThenEvolve({ trashNames: ['그레이몬', '메탈그레이몬'], subjName: '아구몬', targetName: '워그레이몬' }));
sc('BT15-091::메인', placeThenEvolve({ trashNames: ['가루몬', '워가루몬'], subjName: '파피몬', targetName: '메탈가루몬' }));
sc('ST17-10::메인', placeThenEvolve({ trashNames: ['가르고몬', '래피드몬'], subjName: '테리어몬', targetName: '세인트가르고몬', thisTamer: true, cost: 4,
  after: (ctx, st) => S.grantKeyword(ctx.state, ctx.self, st.uid, '속공', undefined, 'turn') }));

// BT14-092 물고기 행진
sc('BT14-092::메인', [fn(async (ctx) => {
  const mine = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(isDig), '기준이 될 자신의 디지몬 선택');
  if (!mine) return;
  const until = untilOppTurnEnd(ctx);
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && !chosen.includes(s) && s.sources.length <= mine.sources.length), `어택/블록 불가로 만들 디지몬 선택 (${i + 1}/3)`);
    if (!t) break;
    chosen.push(t);
    S.restrictAttack(ctx.state, ctx.opp, t.uid, until);
    S.setS3Flag(t, 'noBlock', until);
  }
})]);
// BT14-097 스카의 저주
sc('BT14-097::메인', [fn(async (ctx) => {
  await evolveGeneric(ctx, { subject: (s) => !stackHasColor(s, 'white') || (C(s.cardId).colors || []).some(c => c !== 'white'), cardPred: (id) => C(id).nameKo.includes('스카몬'), ignoreCond: true, cost: { mode: 'free' }, prompt: '화이트 이외의 진화시킬 디지몬 선택' });
})]);
sc('BT14-097::시큐리티', [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), '원래 명칭 「스카몬」·화이트·DP 3000으로 바꿀 디지몬 선택');
  if (!t) return;
  const until = untilOwnTurnEnd(ctx);
  if (S.effectBlocked(ctx.state, ctx.opp, t, 'other')) return;
  S.setBaseInfo(ctx.state, ctx.opp, t, { name: '스카몬', colors: ['white'], dp: 3000, until }); // 15-8-2-5: timestamped 원래 명칭/색/DP 변경
  S._s4.ruleCheckDP(ctx.state, ctx.opp, t);
})]);
// BT14-102
sc('BT14-102::소멸 시@이 카드를 시큐리티 아래에', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self); const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  if (i >= 0) { pl.trash.splice(i, 1); S.addToSecurity(ctx.state, ctx.self, ctx.sourceCardId, 'bottom'); }
  if (pl.battle.some(isTam) && !pl.raising && pl.digitamaDeck.length && await confirm(ctx, '육성 에어리어에 부화시킬까요?')) {
    const prev = ctx.state.breedingActionTaken; ctx.state.breedingActionTaken = false;
    S.hatchDigitama(ctx.state, ctx.self);
    ctx.state.breedingActionTaken = prev;
  }
})]);
sc('BT14-102::소멸 시@백신종', [fn((ctx) => handToSecurity(ctx, (id) => traitAny(id, ['백신종']) && colorHas(id, 'yellow'), 'bottom', '시큐리티 아래에 놓을 백신종 옐로 카드 선택'))]);
// P-111 등장 시/진화 시
sc('P-111::등장 시', [fn(async (ctx) => {
  const n = PL(ctx, ctx.self).battle.filter(isDig).length;
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), `DP -${3000 * n} 받을 디지몬 선택`);
  if (t && n) dpTemp(ctx, ctx.opp, t, -3000 * n, ctx.state.turnNumber);
})]);

// ------------------------------------------------------------------ EX5
// EX5-001 (진화원 효과, 자신의 턴 [턴에 1회]): this digimon's top card placed into its own sources by an effect → may evolve for -1
hk('EX5-001', { tag: '자신의 턴', src: 'inheritedKo', has: '효과로 놓였을 때', limit: 1, events: { topPlaced: (state, hp, holder, info) => info.stack === holder } });
sc('EX5-001::자신의 턴', [fn((ctx) => evolveGeneric(ctx, { subject: 'this', cost: { mode: 'discount', n: 1 }, cardPrompt: '패에서 진화할 디지몬 카드 선택 (진화 코스트 -1)' }))]);
// EX5-029 어택 시
sc('EX5-029::어택 시', [{ op: 'costGroup', cost: [{ op: 'removeSecurity', who: 'self', position: 'top' }], then: [{ op: 'evoCostMod', delta: -2, filter: {}, duration: 'turn' }] }]);
// EX5-031 (진화원) 어택 시 [턴에 1회]
sc('EX5-031::어택 시', [{ op: 'condition', if: { test: (ctx) => PL(ctx, ctx.self).security.length + PL(ctx, ctx.opp).security.length <= 6 },
  then: [fn((ctx) => handToSecurity(ctx, (id) => colorHas(id, 'yellow'), 'top', '시큐리티 위에 놓을 옐로 카드 선택'))], else: [] }]);
// EX5-043 진화 시/메인 [턴에 1회]
sc('EX5-043::진화 시', [fn(async (ctx) => {
  const st = me(ctx);
  const bonus = st && st.sources.some(id => C(id).nameKo.includes('두프트몬') || C(id).nameKo === 'X항체' || (C(id).types || []).includes('X항체')) ? 3 : 0;
  await playPay(ctx, ctx.self, 'hand', (id) => C(id).category === 'digimon' && colorHas(id, 'green'), 4 + bonus, '등장시킬 그린 디지몬 카드 선택');
})]);
// EX5-045 (진화원) 소멸 시
sc('EX5-045::소멸 시', [fn(async (ctx) => {
  const top = ctx.trigger?.delStack?.cardId;
  if (!top || !nameHas(top, ['스카몬', '에테몬'])) return;
  await playFreeWhere(ctx, ctx.self, 'trash', (id) => C(id).nameKo === '츄몬' && C(id).category === 'digimon', '트래시에서 등장시킬 「츄몬」 선택', { rested: true });
})]);
// EX5-048 / EX6-042: gives "【자신의 메인 페이즈 개시 시】 이 디지몬으로 어택한다." until the opponent's turn ends
function giveForcedAttack(ctx, st, srcId) { st.s3 = st.s3 || {}; st.s3.forceAtkMain = { until: untilOppTurnEnd(ctx), src: srcId }; S.log(ctx.state, `${C(st.cardId).nameKo}에게 「메인 페이즈 개시 시 어택」 효과 부여`); }
sc('EX5-048::등장 시', [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), 'DP -3000 및 어택 강제 효과를 줄 디지몬 선택');
  if (!t) return;
  dpTemp(ctx, ctx.opp, t, -3000, untilOppTurnEnd(ctx));
  if (findStack(ctx.state, ctx.opp, t.uid)) giveForcedAttack(ctx, t, 'EX5-048');
})]);
sc('EX5-048::s3ForceAttack', [{ op: 'attackNow', who: 'self', thisStack: true }]);
sc('EX6-042::s3ForceAttack', [{ op: 'attackNow', who: 'self', thisStack: true }]);
// EX5-052 (상대의 턴): 등장 코스트 2 이하의 상대의 테이머 전부는 레스트할 수 없다
hk('EX5-052', { tag: '상대의 턴', has: '레스트할 수 없다', restLock: (state, hp, holder, target) => isTam(target) && (C(target.cardId).cost || 0) <= 2 });
// EX5-054 등장 시/진화 시
sc('EX5-054::등장 시', [fn(async (ctx) => {
  const lim = 3 + PL(ctx, ctx.self).trash.filter(id => nameHas(id, ['에테몬', '스카몬'])).length;
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && (C(s.cardId).cost || 0) <= lim), `소멸시킬 등장 코스트 ${lim} 이하 디지몬/테이머 선택`, { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
})]);
// EX5-054 상대의 턴 [턴에 1회]: attack redirect (cost: 에테몬/스카몬 hand card → own security top)
hk('EX5-054', { tag: '상대의 턴', has: '어택의 대상을', redirectOptions: (state, hp, holder) => {
  const pl = state.players[hp];
  if (!isDig(holder) || !pl.hand.some(id => nameHas(id, ['에테몬', '스카몬']))) return [];
  if (S.turnUsesRemaining(holder, S.onceLimitKey('EX5-054', ['어택대상변경']), 1) <= 0) return [];
  const pay = async (choose) => {
    const c = { state, choose };
    const idx = await pickIdx(c, hp, (id) => nameHas(id, ['에테몬', '스카몬']), '시큐리티 위에 놓을 「에테몬」/「스카몬」 카드 선택');
    if (idx < 0) return false;
    S.addToSecurity(state, hp, pl.hand.splice(idx, 1)[0], 'top');
    return true;
  };
  return [{ targetUid: holder.uid, limit: 1, pay, label: '패의 에테몬/스카몬 카드를 시큐리티 위에 놓고 이 디지몬으로 어택 대상 변경' },
    { targetUid: null, toPlayer: true, limit: 1, pay, label: '패의 에테몬/스카몬 카드를 시큐리티 위에 놓고 플레이어로 어택 대상 변경' }];
} });
// EX5-058 옥토몬: 후지쓰몬 토큰
const FUJITSU = { name: '후지쓰몬', cost: 0, level: null, dp: 3000, colors: ['purple'], types: [], effectKo: '【서로의 턴】 이 디지몬은 액티브가 되지 않는다.\n【소멸 시】 자신의 패 1장을 파기한다.' };
hk('TOKEN-후지쓰몬', { tag: '서로의 턴', has: '액티브가 되지', noUnsuspend: () => true });
sc('TOKEN-후지쓰몬::소멸 시', [{ op: 'trashHand', who: 'self', n: 1 }]);
sc('EX5-058::등장 시', [fn(async (ctx) => {
  const total = PL(ctx, ctx.self).battle.filter(isDig).length + PL(ctx, ctx.opp).battle.filter(isDig).length;
  spawnToken(ctx, total >= 4 ? ctx.self : ctx.opp, FUJITSU, true);
})]);
// EX5-062 진화 시/메인 [턴에 1회]
sc('EX5-062::진화 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  let n = 0;
  if (pl.hand.length) {
    const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: pl.hand.map((id, i) => i), n: Math.min(3, pl.hand.length), prompt: '파기할 패를 3장까지 선택 (안 해도 됨)' });
    const idxs = [...new Set(chosen || [])].slice(0, 3).sort((a, b) => b - a);
    idxs.forEach(i => S.trashFromHand(ctx.state, ctx.self, i)); n = idxs.length;
  }
  await playPay(ctx, ctx.self, 'trash', (id) => C(id).category === 'digimon' && colorHas(id, 'purple'), 3 + n, '트래시에서 등장시킬 퍼플 디지몬 선택');
})]);
// EX5-063 등장 시/진화 시
async function destroyByLevel(ctx, highest) {
  const ds = PL(ctx, ctx.opp).battle.filter(isDig);
  if (!ds.length) return;
  const target = highest ? Math.max(...ds.map(s => lvl(s.cardId))) : Math.min(...ds.map(s => lvl(s.cardId)));
  const t = await pickStack(ctx, ctx.opp, ds.filter(s => lvl(s.cardId) === target), `소멸시킬 ${highest ? '가장 Lv.이 높은' : '가장 Lv.이 낮은'} 디지몬 선택`, { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
}
const boardCount = (ctx, p) => PL(ctx, p).battle.filter(s => isDig(s) || isTam(s)).length;
sc('EX5-063::등장 시', [{ op: 'condition', if: { test: (ctx) => boardCount(ctx, ctx.opp) >= boardCount(ctx, ctx.self) }, then: [fn(async (ctx) => { await destroyByLevel(ctx, true); await destroyByLevel(ctx, false); })], else: [] }]);

// EX5-064 코우＆사요 등장 시/메인: rest this tamer + move a 라이트 팽/나이트 클로 digimon's top card to the bottom of its own sources → free evolve
function rotateTopToBottom(ctx, p, st) {
  const oldTop = st.cardId;
  st.cardId = st.sources.pop();
  st.sources.unshift(oldTop);
  S._s4.discardLinkCardsOnNewCard(ctx.state, p, st);
  S.recomputeStackGrants(st);
  S._s4.ruleCheckDP(ctx.state, p, st);
  S.log(ctx.state, `${p} ${C(oldTop).nameKo}이(가) 진화원 아래로 (현재 최상단 ${C(st.cardId).nameKo})`);
  S.emitGameEvent(ctx.state, 'topPlaced', { owner: p, stack: st, cause: 'effect' });
}
sc('EX5-064::등장 시', [fn(async (ctx) => {
  const t = me(ctx);
  if (!t || !isTam(t) || t.suspended) return;
  const cands = PL(ctx, ctx.self).battle.filter(s => isDig(s) && s.sources.length && traitAny(s.cardId, ['라이트 팽', '나이트 클로']));
  if (!cands.length || !(await confirm(ctx, '이 테이머를 레스트시키고 디지몬의 최상단 카드를 진화원 아래로 옮겨 무료 진화할까요?'))) return;
  const d = await pickStack(ctx, ctx.self, cands, '최상단 카드를 진화원 아래로 옮길 디지몬 선택');
  if (!d) return;
  S.restStack(ctx.state, ctx.self, t.uid);
  if (!t.suspended) return;
  rotateTopToBottom(ctx, ctx.self, d);
  await evolveGeneric(ctx, { subject: null, cost: { mode: 'free' }, prompt: '진화시킬 디지몬 선택' });
})]);
// EX5-070 (진화원) 서로의 턴: leaves the battle area other than by own effect
hk('EX5-070', { tag: '서로의 턴', src: 'inheritedKo', has: '벗어날 때', onLeave: (state, hp, stack, cause) => cause !== 'ownEffect' });
sc('EX5-070::서로의 턴', [fn(async (ctx) => {
  const evt = ctx.trigger?.evt; if (!evt) return;
  const pl = PL(ctx, ctx.self);
  const inTrash = (id) => pl.trash.includes(id);
  const pool = evt.sources.filter(inTrash);
  const dIdx = pool.findIndex(id => C(id).category === 'digimon');
  const cand = pool.filter(id => C(id).category === 'digimon');
  if (cand.length) {
    const pick = cand.length === 1 ? cand[0] : cand[await ctx.choose('multipleChoice', { prompt: '패로 되돌릴 디지몬 카드', options: cand.map(id => C(id).nameKo) }) || 0];
    pl.trash.splice(pl.trash.lastIndexOf(pick), 1); pl.hand.push(pick);
  }
  const x = evt.sources.find(id => C(id).nameKo === 'X항체' && pl.trash.includes(id));
  if (x) { pl.trash.splice(pl.trash.lastIndexOf(x), 1); S.addToSecurity(ctx.state, ctx.self, x, 'top'); }
})]);
// EX5-074 (서로의 턴): 상대의 디지몬의 효과를 받지 않는다
hk('EX5-074', { tag: '서로의 턴', has: '효과를 받지 않는다', effectImmune: (state, hp, holder, target, tp, o) => target === holder && o.src?.category === 'digimon' });
// P-085 등장 시
sc('P-085::등장 시', [{ op: 'condition', if: { test: (ctx) => ctx.state.activePlayer === ctx.self && PL(ctx, ctx.self).battle.some(s => isTam(s) && stackHasColor(s, 'purple')) },
  then: [fn((ctx) => evolveGeneric(ctx, { subject: 'this', zone: 'trash', cardPred: (id) => traitAny(id, ['마수형', '언데드형']), cardPrompt: '트래시에서 진화할 카드 선택' }))], else: [] }]);
// P-086 등장 시
sc('P-086::등장 시', [{ op: 'condition', if: { test: (ctx) => PL(ctx, ctx.self).battle.some(s => isTam(s) && stackHasColor(s, 'blue')) },
  then: [fn(async (ctx) => {
    const t = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(isDig), '어택당하지 않게 될 디지몬 선택');
    if (t) { S.setS3Flag(t, 'unattackable', untilOppTurnEnd(ctx)); S.log(ctx.state, `${C(t.cardId).nameKo} 상대의 턴 종료까지 어택당하지 않음`); }
  })], else: [] }]);
// P-091 (진화원) 소멸 시
sc('P-091::소멸 시', [{ op: 'returnFromTrash', who: 'self', filter: { colors: ['red', 'purple'], category: 'digimon' } }]);
// P-094 등장 시/진화 시: 등장 코스트 합계 3 + (진화원의 「벰몬」 수) 이하가 되도록 선택하여 소멸
sc('P-094::등장 시', [fn(async (ctx) => {
  const st = me(ctx);
  let left = 3 + (st ? st.sources.filter(id => C(id).nameKo === '벰몬').length : 0);
  const chosen = [];
  for (;;) {
    const opts = PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && !chosen.includes(s) && (C(s.cardId).cost || 0) <= left);
    const t = await pickStack(ctx, ctx.opp, opts, `소멸시킬 대상 선택 (남은 등장 코스트 합계 ${left}, 없으면 취소)`, { fxKind: 'delete' });
    if (!t) break;
    chosen.push(t); left -= C(t.cardId).cost || 0;
  }
  for (const t of chosen) destroy(ctx, ctx.opp, t);
})]);
// P-094 (진화원) 상대의 턴 [턴에 1회]: redirect to this digimon by returning 2 벰몬 from own 라그나몬's sources to the deck bottom
hk('P-094', { tag: '상대의 턴', src: 'inheritedKo', has: '어택의 대상을', redirectOptions: (state, hp, holder) => {
  const pl = state.players[hp];
  if (!isDig(holder) || S.turnUsesRemaining(holder, S.onceLimitKey('P-094', ['어택대상변경']), 1) <= 0) return [];
  const src = pl.battle.filter(s => C(s.cardId).nameKo === '라그나몬' && s.sources.filter(id => C(id).nameKo === '벰몬').length >= 2);
  if (!src.length) return [];
  const pay = async (choose) => {
    const c = { state, choose };
    const st = src.length === 1 ? src[0] : await pickStack(c, hp, src, '벰몬 2장을 덱 아래로 되돌릴 「라그나몬」 선택');
    if (!st) return false;
    for (let k = 0; k < 2; k++) { const i = st.sources.findIndex(id => C(id).nameKo === '벰몬'); pl.deck.push(st.sources.splice(i, 1)[0]); }
    S.recomputeStackGrants(st);
    return true;
  };
  return [{ targetUid: holder.uid, limit: 1, pay, label: '「라그나몬」의 진화원 벰몬 2장을 덱 아래로 되돌리고 이 디지몬으로 어택 대상 변경' }];
} });
// P-096 프리즘 가렛 메인
sc('P-096::메인', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const hasSave = (id) => /《세이브/.test(`${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`);
  const tgts = pl.battle.filter(s => isDig(s) && hasSave(s.cardId));
  if (!tgts.length) return;
  const pool = () => [
    ...pl.battle.filter(isTam).flatMap(t => t.sources.map((id, i) => ({ id, from: t, i }))).filter(x => C(x.id).category === 'digimon' && hasSave(x.id)),
    ...pl.trash.map((id, i) => ({ id, from: null, i })).filter(x => C(x.id).category === 'digimon' && hasSave(x.id)),
  ];
  if (!pool().length) return;
  const tgt = await pickStack(ctx, ctx.self, tgts, '진화원 아래에 놓을 《세이브》 디지몬 선택');
  if (!tgt) return;
  let n = 0;
  for (let k = 0; k < 2; k++) {
    const p = pool(); if (!p.length) break;
    const a = await ctx.choose('multipleChoice', { prompt: `놓을 《세이브》 디지몬 카드 (${k + 1}/2)`, options: [...p.map(x => `${C(x.id).nameKo} (${x.from ? '테이머 아래' : '트래시'})`), '더 놓지 않음'] });
    if (a == null || a >= p.length) break;
    const x = p[a];
    if (x.from) x.from.sources.splice(x.i, 1); else pl.trash.splice(x.i, 1);
    addSourcesBottom(ctx, ctx.self, tgt, [x.id]); n++;
  }
  if (n) dpTemp(ctx, ctx.self, tgt, 1000 * n, ctx.state.turnNumber);
})]);
// P-098 등장 시/진화 시
sc('P-098::등장 시', [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(s => isDig(s) && stackHasColor(s, 'blue')), '배틀로는 소멸하지 않게 될 블루 디지몬 선택');
  if (t) S.grantBattleImmunity(ctx.state, ctx.self, t.uid);
})]);
// P-109 등장 시/진화 시: rest 1 digimon, then unsuspend 1 digimon (either side)
sc('P-109::등장 시', [fn(async (ctx) => {
  const entries = () => ['p1', 'p2'].flatMap(p => PL(ctx, p).battle.filter(isDig).map(s => ({ player: p, uid: s.uid })));
  let e = entries();
  if (e.length) { const pk = await ctx.choose('pickStackAnySide', { entries: e, prompt: '레스트시킬 디지몬 선택' }); if (pk) S.restStack(ctx.state, pk.player, pk.uid); }
  e = entries();
  if (e.length) { const pk = await ctx.choose('pickStackAnySide', { entries: e, prompt: '액티브로 만들 디지몬 선택' }); if (pk) S.unsuspendStack(ctx.state, pk.player, pk.uid); }
})]);
// P-117 (자신의 턴) [턴에 1회]: 프리 특징 카드로 진화할 때, 자신의 테이머가 있다면 진화 코스트 -1
{ const d = { tag: '자신의 턴', has: '프리', evoDiscount: (state, hp, holder, stack, targetId) => {
  if (holder !== stack || !traitAny(targetId, ['프리']) || !state.players[hp].battle.some(isTam)) return 0;
  return S.hookUseOnce(holder, 'P-117', d) ? -1 : 0;
} }; hk('P-117', d); }

// ------------------------------------------------------------------ BT15
const hasSrc = (st, pred) => !!st && st.sources.some(id => pred(C(id)));
const srcTamerTrait = (t) => (c) => c.category === 'tamer' && (c.types || []).includes(t);
// BT15-034 자신의 메인 페이즈 개시 시
sc('BT15-034::자신의 메인 페이즈 개시 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  if (pl.security.length >= 3 && await confirm(ctx, '시큐리티 맨 위 1장을 패에 추가할까요?')) {
    pl.hand.push(pl.security.shift());
    S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' });
  }
  if (pl.security.length <= 2) {
    const idx = await pickIdx(ctx, ctx.self, (id) => C(id).category === 'digimon' && traitAny(id, ['백신종']) && colorHas(id, 'yellow'), '시큐리티에 놓을 백신종 옐로 디지몬 카드 선택 (안 해도 됨)');
    if (idx >= 0) {
      const pos = (await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] })) === 1 ? 'bottom' : 'top';
      S.addToSecurity(ctx.state, ctx.self, removeFromHand(ctx, ctx.self, idx), pos);
    }
  }
})]);
// BT15-040 진화 시
sc('BT15-040::진화 시', [fn(async (ctx) => {
  const st = me(ctx);
  if (!hasSrc(st, (c) => c.nameKo.includes('퍼펫몬') || c.nameKo === 'X항체' || (c.types || []).includes('X항체'))) return;
  await playFreeWhere(ctx, ctx.self, 'hand', (id) => C(id).category === 'digimon' && (C(id).nameKo === '워매몬' || lvl(id) === 3), '등장시킬 「워매몬」 또는 Lv.3 디지몬 선택');
})]);
// BT15-042 서로의 턴 [턴에 1회]
hk('BT15-042', { tag: '서로의 턴', has: '시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, holder, info) => info.owner === hp && state.players[hp].security.length <= 3 } });
sc('BT15-042::서로의 턴', [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, (id) => colorHas(id, 'yellow'), '시큐리티에 놓을 옐로 카드 선택 (안 해도 됨)');
  if (idx < 0) return;
  const pos = (await ctx.choose('multipleChoice', { prompt: '시큐리티 위 / 아래', options: ['위', '아래'] })) === 1 ? 'bottom' : 'top';
  S.addToSecurity(ctx.state, ctx.self, removeFromHand(ctx, ctx.self, idx), pos);
})]);
// BT15-047 / 049 / 053 / BT16-048 (서로의 턴): 레스트 상태인 이 디지몬은 상대의 디지몬의 효과를 받지 않는다
for (const id of ['BT15-047', 'BT15-049', 'BT15-053', 'BT16-048']) hk(id, { tag: '서로의 턴', has: '효과를 받지 않는다', effectImmune: (state, hp, holder, target, tp, o) => target === holder && holder.suspended && o.src?.category === 'digimon' });
// BT15-051 진화 시
sc('BT15-051::진화 시', [fn(async (ctx) => {
  const st = me(ctx);
  if (['p1', 'p2'].some(p => PL(ctx, p).battle.some(s => isDig(s) && s.suspended))) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
  if (hasSrc(st, (c) => c.nameKo === '릴리몬' || c.nameKo === 'X항체' || (c.types || []).includes('X항체'))) {
    const n = PL(ctx, ctx.opp).battle.filter(s => isDig(s) && s.suspended).length;
    if (n) S.drawCards(ctx.state, ctx.self, n);
  }
})]);
// BT15-054 진화 시: rest 1 opp digimon + 1 opp tamer; they stay rested through the opponent's next unsuspend
sc('BT15-054::진화 시', [fn(async (ctx) => {
  for (const [pred, label] of [[isDig, '디지몬'], [isTam, '테이머']]) {
    const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(pred), `레스트시킬 상대의 ${label} 선택`);
    if (!t) continue;
    S.restStack(ctx.state, ctx.opp, t.uid);
    if (t.suspended) S.setSkipNextUnsuspend(ctx.state, ctx.opp, t.uid);
  }
})]);
// BT15-056 자신의 메인 페이즈 개시 시
sc('BT15-056::자신의 메인 페이즈 개시 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).nameKo === '서월령', '진화원 아래에 놓을 「서월령」 선택 (안 해도 됨)');
  if (idx < 0) return;
  addSourcesBottom(ctx, ctx.self, st, [removeFromHand(ctx, ctx.self, idx)]);
  S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until: untilOppTurnEnd(ctx), fromCategory: 'digimon' });
})]);
// BT15-061 등장 시/진화 시
sc('BT15-061::등장 시', [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, (id) => traitAny(id, ['머신형', '사이보그형']), '파기할 머신형/사이보그형 카드 선택 (안 해도 됨)');
  if (idx < 0) return;
  S.trashFromHand(ctx.state, ctx.self, idx);
  const t = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(isDig), '상대의 효과로 소멸하지 않게 될 디지몬 선택');
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['delete'], until: untilOppTurnEnd(ctx) });
})]);
// BT15-063 서로의 턴: another digimon/tamer suspended by an effect
hk('BT15-063', { tag: '서로의 턴', has: '레스트했을 때', events: { rest: (state, hp, holder, info) => info.cause === 'effect' && info.stack !== holder && hasSrc(holder, srcTamerTrait('디지대')) } });
sc('BT15-063::서로의 턴@디지몬 카드로', [fn((ctx) => evolveGeneric(ctx, { subject: 'this', cost: { mode: 'free' }, cardPred: (id) => traitAny(id, ['수룡형', '디지대']), cardPrompt: '진화할 수룡형/디지대 디지몬 카드 선택' }))]);
// BT15-064 어택 시
sc('BT15-064::어택 시', [{ op: 'condition', if: { test: (ctx) => hasSrc(me(ctx), srcTamerTrait('SoC')) }, then: [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && (C(s.cardId).cost || 0) <= 3), '소멸시킬 등장 코스트 3 이하 디지몬/테이머 선택', { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
})], else: [] }]);
// BT15-067 진화 시
sc('BT15-067::진화 시', [{ op: 'condition', if: { test: (ctx) => hasSrc(me(ctx), srcTamerTrait('디지대')) }, then: [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, requireSuspended: true, dest: 'deckBottom' }], else: [] }]);
// BT15-069 소멸 시
sc('BT15-069::소멸 시', [fn(async (ctx) => {
  if (oppSideMem(ctx) <= 1) S.drawCards(ctx.state, ctx.self, 1);
  if (oppSideMem(ctx) >= 1) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
})]);
// BT15-072 서로의 턴: 아포카리몬 / 어둠의 4천왕 leaving → delete this digimon instead
hk('BT15-072', { tag: '서로의 턴', has: '벗어날 때', preventLeave: (state, hp, holder, target, tp, cause) => {
  if (target === holder || cause === 'ownEffect' || cause == null || !isDig(target)) return false;
  if (!(C(target.cardId).nameKo === '아포카리몬' || traitAny(target.cardId, ['어둠의 4천왕']))) return false;
  if (!state.players[hp].battle.includes(holder)) return false;
  S.deleteStack(state, hp, holder.uid, 'trash', 'ownEffect');
  return !state.players[hp].battle.includes(holder);
} });
// BT15-081 진화 시
sc('BT15-081::진화 시', [{ op: 'condition', if: { test: (ctx) => boardCount(ctx, ctx.opp) >= boardCount(ctx, ctx.self) }, then: [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isTam), '소멸시킬 상대의 테이머 선택', { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
  for (const L of [3, 5, 7]) {
    const d = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && lvl(s.cardId) === L), `소멸시킬 Lv.${L} 상대 디지몬 선택`, { fxKind: 'delete' });
    if (d) destroy(ctx, ctx.opp, d);
  }
})], else: [] }]);
// BT15-085 상대의 턴 (테이머): rest this tamer → attack target becomes an own rested 곤충형 digimon
hk('BT15-085', { tag: '상대의 턴', has: '어택의 대상을', redirectOptions: (state, hp, holder) => {
  if (!isTam(holder) || holder.suspended) return [];
  return state.players[hp].battle.filter(s => isDig(s) && s.suspended && traitAny(s.cardId, ['곤충형'])).map(s => ({
    targetUid: s.uid, label: `이 테이머를 레스트시켜 ${C(s.cardId).nameKo}(으)로 어택 대상 변경`,
    pay: async () => { S.restStack(state, hp, holder.uid); return holder.suspended; },
  }));
} });
// BT15-092 (진화원) 시큐리티: until own turn end, opponent's digimon and security digimon -5000 DP
sc('BT15-092::시큐리티', [fn(async (ctx) => {
  const until = untilOwnTurnEnd(ctx);
  for (const s of [...PL(ctx, ctx.opp).battle].filter(isDig)) dpTemp(ctx, ctx.opp, s, -5000, until);
  S.addSecurityDPMod(ctx.state, ctx.opp, -5000, until);
})]);
// BT15-096 딜레이 (지고의 커넥션!!)
sc('BT15-096::메인@등장 코스트 -3 하여', [fn((ctx) => playPay(ctx, ctx.self, 'hand', (id) => C(id).category === 'digimon' && traitAny(id, ['머신형', '사이보그형']) && lvl(id) >= 5, 3, '등장시킬 머신형/사이보그형 Lv.5 이상 디지몬 선택'))]);
// BT15-097 / BT15-100 (메인 & 시큐리티: 이 카드의 【메인】 효과)
const bt15097 = [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).category === 'digimon' && traitAny(id, ['머신형', '사이보그형', 'SoC']), '파기할 머신형/사이보그형/SoC 디지몬 카드 선택');
  if (idx < 0) return;
  S.trashFromHand(ctx.state, ctx.self, idx);
  const all = PL(ctx, ctx.opp).battle.filter(s => isDig(s) || isTam(s));
  if (!all.length) return;
  const min = Math.min(...all.map(s => C(s.cardId).cost || 0));
  const t = await pickStack(ctx, ctx.opp, all.filter(s => (C(s.cardId).cost || 0) === min), '소멸시킬 가장 등장 코스트가 낮은 디지몬/테이머 선택', { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
})];
sc('BT15-097::메인', bt15097); sc('BT15-097::시큐리티', bt15097);
const bt15100 = [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, () => true, '파기할 패 1장 선택');
  if (idx < 0) return;
  S.trashFromHand(ctx.state, ctx.self, idx);
  for (const L of [4, 6]) {
    const d = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && lvl(s.cardId) === L), `소멸시킬 Lv.${L} 상대 디지몬 선택`, { fxKind: 'delete' });
    if (d) destroy(ctx, ctx.opp, d);
  }
})];
sc('BT15-100::메인', bt15100); sc('BT15-100::시큐리티', bt15100);

// ------------------------------------------------------------------ LM
const anyDigimon = (ctx, pred = () => true) => ['p1', 'p2'].flatMap(p => PL(ctx, p).battle.filter(s => isDig(s) && pred(s)).map(s => ({ p, s })));
async function pickAnyDigimon(ctx, list, prompt, extra = {}) {
  if (!list.length) return null;
  const pk = await ctx.choose('pickStackAnySide', { entries: list.map(x => ({ player: x.p, uid: x.s.uid })), prompt, ...extra });
  return pk ? list.find(x => x.p === pk.player && x.s.uid === pk.uid) || null : null;
}
// LM-003 어택 시
sc('LM-003::어택 시', [fn(async (ctx) => {
  const idx = await pickIdx(ctx, ctx.self, (id) => colorHas(id, 'blue'), '파기할 블루 카드 선택');
  if (idx < 0) return;
  S.trashFromHand(ctx.state, ctx.self, idx);
  const st = me(ctx); if (st) { st.battleImmuneUntilTurn = ctx.state.turnNumber; S.log(ctx.state, `${C(st.cardId).nameKo} 턴 종료까지 배틀로 소멸하지 않음`); }
})]);
// LM-005 등장 시/진화 시
sc('LM-005::등장 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  let n = 0;
  const blue = pl.hand.map((id, i) => i).filter(i => colorHas(pl.hand[i], 'blue'));
  if (blue.length) {
    const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: blue, n: Math.min(4, blue.length), prompt: '파기할 블루 카드를 4장까지 선택 (안 해도 됨)' });
    const idxs = [...new Set(chosen || [])].filter(i => blue.includes(i)).slice(0, 4).sort((a, b) => b - a);
    idxs.forEach(i => S.trashFromHand(ctx.state, ctx.self, i)); n = idxs.length;
  }
  for (let k = 0; k < n; k++) {
    const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && s.sources.length), `아래의 카드를 파기할 상대 디지몬/테이머 선택 (${k + 1}/${n})`);
    if (!t) break;
    const a = await ctx.choose('multipleChoice', { prompt: '파기할 진화원 선택', options: t.sources.map(id => C(id).nameKo) });
    S.trashEvoSources(ctx.state, ctx.opp, t.uid, 1, 'bottom', [a == null ? 0 : a]);
  }
  const b = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && !s.sources.length), '패로 되돌릴 아래에 카드가 없는 상대 디지몬/테이머 선택');
  if (b) bounceStack(ctx, ctx.opp, b, 'hand');
})]);
// LM-006 [트래시]【메인】
sc('LM-006::메인', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const zi = pl.trash.lastIndexOf(ctx.sourceCardId);
  const t = await pickStack(ctx, ctx.self, pl.battle.filter(isTam), '덱 아래로 되돌릴 자신의 테이머 선택');
  if (zi < 0 || !t) return;
  const red = C(t.cardId).cost || 0;
  if (!bounceStack(ctx, ctx.self, t, 'deckBottom')) return;
  const cost = Math.max(0, (C(ctx.sourceCardId).cost || 0) - (S.isPlayCostLocked(ctx.state) ? 0 : red));
  if (cost > 0) S.spendMemory(ctx.state, cost);
  S.playFreeFromZone(ctx.state, ctx.self, 'trash', pl.trash.lastIndexOf(ctx.sourceCardId), {});
})]);
// LM-007 어택 종료 시
sc('LM-007::어택 종료 시', [fn(async (ctx) => { const st = me(ctx); if (st) bounceStack(ctx, ctx.self, st, 'securityTop'); })]);
// LM-009 (자신의 턴): 「앙고라몬」이 기술되어 있는 카드의 등장/진화 코스트 -2 (이 디지몬을 레스트)
const angora = (id) => C(id).nameKo.includes('앙고라몬') || /「앙고라몬」/.test(`${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`);
hk('LM-009', { tag: '자신의 턴', has: '지불하는 등장/진화 코스트',
  playDiscount: (state, hp, holder, cardId) => (isDig(holder) && !holder.suspended && angora(cardId)) ? { label: `${C(holder.cardId).nameKo}을(를) 레스트시켜 등장 코스트 -2?`, apply: () => { S.restStack(state, hp, holder.uid); return holder.suspended ? -2 : 0; } } : null,
  evoOption: (state, hp, holder, stack, targetId) => (isDig(holder) && !holder.suspended && angora(targetId)) ? { label: `${C(holder.cardId).nameKo}을(를) 레스트시켜 진화 코스트 -2?`, apply: () => { S.restStack(state, hp, holder.uid); return holder.suspended ? -2 : 0; } } : null });
// LM-010 등장 시
sc('LM-010::등장 시', [fn(async (ctx) => {
  const all = ['p1', 'p2'].flatMap(p => PL(ctx, p).battle.filter(isTam).map(s => ({ player: p, uid: s.uid })));
  if (all.length) { const pk = await ctx.choose('pickStackAnySide', { entries: all, prompt: '레스트시킬 테이머 선택' }); if (pk) S.restStack(ctx.state, pk.player, pk.uid); }
  for (const t of PL(ctx, ctx.opp).battle.filter(isTam)) S.setSkipNextUnsuspend(ctx.state, ctx.opp, t.uid);
})]);
// LM-018 등장 시
sc('LM-018::등장 시', [fn(async (ctx) => {
  const pk = await pickAnyDigimon(ctx, anyDigimon(ctx, (s) => lvl(s.cardId) <= 4), '소멸시킬 Lv.4 이하 디지몬 선택', { fxKind: 'delete' });
  if (!pk) return;
  destroy(ctx, pk.p, pk.s);
  if (stillThere(ctx, pk.p, pk.s)) return;
  if (await confirm(ctx, '「규우키몬」 토큰을 등장시킬까요?')) spawnToken(ctx, ctx.self, { name: '규우키몬', cost: 7, level: 5, dp: 3000, colors: ['purple'], form: '완전체', attribute: '바이러스종', types: ['마수형'] });
})]);
// LM-020 진화 시
sc('LM-020::진화 시', [fn(async (ctx) => {
  const pk = await pickAnyDigimon(ctx, anyDigimon(ctx), '시큐리티 위에 놓을 디지몬 선택 (소유자의 시큐리티)');
  if (!pk || !bounceStack(ctx, pk.p, pk.s, 'securityTop')) return;
  const sec = PL(ctx, ctx.opp).security;
  if (!sec.length) return;
  S.log(ctx.state, `${ctx.opp} 시큐리티 전부 오픈: ${sec.map(id => C(id).nameKo).join(', ')}`);
  const a = await ctx.choose('multipleChoice', { prompt: '덱 위에 놓을 시큐리티 카드 선택', options: sec.map(id => C(id).nameKo) });
  const oppPl = PL(ctx, ctx.opp);
  const [top] = oppPl.security.splice(a == null ? 0 : a, 1);
  oppPl.deck.unshift(top);
  for (let i = oppPl.security.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [oppPl.security[i], oppPl.security[j]] = [oppPl.security[j], oppPl.security[i]]; }
  S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.opp, stack: null, cause: 'effect' });
})]);

// ------------------------------------------------------------------ BT16 / P-058
// P-058 (자신의 턴): 레드인 자신의 테이머가 있는 동안 액티브 상태의 상대 디지몬에게도 어택할 수 있다
hk('P-058', { tag: '자신의 턴', has: '액티브 상태', attackAnyActive: (state, hp, holder) => state.players[hp].battle.some(s => isTam(s) && stackHasColor(s, 'red')) });
// use an option card from hand without paying its cost (color requirement still applies)
async function useOptionFree(ctx, pred, prompt) {
  const pl = PL(ctx, ctx.self);
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).category === 'option' && pred(id) && S.optionColorOk(ctx.state, ctx.self, id), prompt);
  if (idx < 0) return;
  const [id] = pl.hand.splice(idx, 1);
  pl.trash.push(id);
  S.log(ctx.state, `${ctx.self} ${C(id).nameKo} 코스트 없이 사용`);
  S.queueTriggersFor(ctx.state, ctx.self, id, 'use');
}
// BT16-014 진화 시/어택 시
sc('BT16-014::진화 시', [fn((ctx) => useOptionFree(ctx, (id) => C(id).nameKo === '갓 플레임' || traitAny(id, ['4대용']), '코스트 없이 사용할 「갓 플레임」/4대용 옵션 카드 선택'))]);
// BT16-015 (자신의 턴): 진화원에 「페닉스몬」/「X항체」가 있는 동안 【소멸 시】 효과 전부가 【어택 종료 시】에도 발휘된다
hk('BT16-015', { tag: '자신의 턴', has: '어택 종료 시', selfContained: true, events: { attackEnd: (state, hp, holder, info) => {
  if (info.owner === hp && info.stack === holder && hasSrc(holder, (c) => c.nameKo === '페닉스몬' || c.nameKo === 'X항체' || (c.types || []).includes('X항체'))) S.queueTriggersForStack(state, hp, holder, 'delete');
  return false;
} } });
// BT16-031 등장 시/진화 시
sc('BT16-031::등장 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const ok = (id) => C(id).category === 'digimon' && lvl(id) <= 6 && (C(id).colors || []).length === 2 && colorHas(id, 'purple') && colorHas(id, 'red');
  if (!pl.hand.length || !pl.trash.some(ok)) return;
  const h = await pickIdx(ctx, ctx.self, () => true, '파기할 패 1장 선택 (안 해도 됨)');
  if (h < 0) return;
  S.trashFromHand(ctx.state, ctx.self, h);
  const t = await pickIdx(ctx, ctx.self, ok, '패로 되돌릴 퍼플/레드 2색 디지몬 카드 선택', 'trash');
  if (t >= 0) pl.hand.push(pl.trash.splice(t, 1)[0]);
})]);
// BT16-032 서로의 턴 [턴에 1회]: attack target changed → may end that attack
hk('BT16-032', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: () => true } });
sc('BT16-032::서로의 턴', [fn(async (ctx) => {
  if (await confirm(ctx, '그 어택을 종료할까요?')) ctx.state.attackCtx?.terminate?.();
})]);
// BT16-036 상대의 턴 종료 시
sc('BT16-036::상대의 턴 종료 시', [{ op: 'removeSecurity', who: 'self', position: 'top' }, { op: 'removeSecurity', who: 'opponent', position: 'top' }]);
// BT16-048 진화 시
sc('BT16-048::진화 시', [fn((ctx) => playPay(ctx, ctx.self, 'hand', (id) => C(id).category === 'digimon' && traitAny(id, ['곤충형', '유충형']), 8, '등장시킬 곤충형/유충형 디지몬 선택 (등장 코스트 -8)'))]);
// BT16-051 자신의 메인 페이즈 개시 시: 소멸 이외로 배틀 에어리어를 벗어나지 않는다
hk('BT16-051', { tag: '자신의 메인 페이즈 개시 시', has: '벗어나지', preventLeave: (state, hp, holder, target, tp, cause, mode) => target === holder && mode !== 'delete' && S.s3Flag(state, holder, 'noLeave') });
sc('BT16-051::자신의 메인 페이즈 개시 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).nameKo === '키사카타 코우스케', '진화원 아래에 놓을 「키사카타 코우스케」 선택 (안 해도 됨)');
  if (idx < 0) return;
  addSourcesBottom(ctx, ctx.self, st, [removeFromHand(ctx, ctx.self, idx)]);
  S.setS3Flag(st, 'noLeave', untilOppTurnEnd(ctx));
})]);
// BT16-052 진화 시: 「꼬마 톱니몬」 토큰
const KOMA = { name: '꼬마 톱니몬', cost: 0, level: null, dp: 1000, colors: ['black'], types: [], effectKo: '《블로커》《디코이《블랙》》\n【자신의 턴】 이 디지몬은 어택할 수 없다.' };
hk('TOKEN-꼬마 톱니몬', { tag: '자신의 턴', has: '어택할 수 없다', noAttack: () => true });
sc('BT16-052::진화 시', [fn(async (ctx) => { if (await confirm(ctx, '「꼬마 톱니몬」 토큰을 등장시킬까요?')) spawnToken(ctx, ctx.self, KOMA); })]);

// BT16-056 퍼블리몬: 등장 시/진화 시 — a 백신종 opp digimon's top card goes on top of THEIR security
function topToSecurityTop(ctx, p, st) {
  const pl = PL(ctx, p);
  if (!st.sources.length) return bounceStack(ctx, p, st, 'securityTop');
  const oldTop = st.cardId;
  st.cardId = st.sources.pop();
  S._s4.discardLinkCardsOnNewCard(ctx.state, p, st);
  S.recomputeStackGrants(st); S._s4.ruleCheckDP(ctx.state, p, st);
  pl.security.unshift(oldTop);
  S.log(ctx.state, `${p} ${C(oldTop).nameKo}이(가) 시큐리티 위로`);
  S.emitGameEvent(ctx.state, 'securityIncrease', { owner: p, stack: null, cause: 'effect' });
  return true;
}
sc('BT16-056::등장 시', [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && traitAny(s.cardId, ['백신종'])), '최상단 카드를 시큐리티 위에 놓을 백신종 디지몬 선택 (안 해도 됨)');
  if (t) topToSecurityTop(ctx, ctx.opp, t);
})]);
hk('BT16-056', { tag: '서로의 턴', has: '시큐리티가 늘어났을 때', limit: 1, events: { securityIncrease: (state, hp, holder, info) => info.owner !== hp && state.players[info.owner].security.length >= 3 } });
sc('BT16-056::서로의 턴', [fn(async (ctx) => {
  const a = await ctx.choose('multipleChoice', { prompt: '상대의 시큐리티를 위/아래에서 1장 파기', options: ['위에서', '아래에서'] });
  if (a === 1) S.trashBottomSecurityByEffect(ctx.state, ctx.opp); else S.trashTopSecurityByEffect(ctx.state, ctx.opp);
})]);
// BT16-057 (자신의 턴): 진화원을 갖지 않은 이 디지몬은 어택할 수 없다
hk('BT16-057', { tag: '자신의 턴', has: '진화원을 갖지 않은', noAttack: (state, hp, holder) => holder.sources.length === 0 });
// BT16-061 서로의 턴: attack target changed & SoC tamer under this digimon → free evolve
hk('BT16-061', { tag: '서로의 턴', has: '어택의 대상이 변경되었을 때', events: { redirect: (state, hp, holder) => hasSrc(holder, srcTamerTrait('SoC')) } });
sc('BT16-061::서로의 턴', [fn((ctx) => evolveGeneric(ctx, { subject: 'this', cost: { mode: 'free' }, cardPred: (id) => traitAny(id, ['수룡형', '언데드형', 'SoC']), cardPrompt: '진화할 수룡형/언데드형/SoC 디지몬 카드 선택' }))]);
// BT16-063 진화 시
sc('BT16-063::진화 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until: untilOppTurnEnd(ctx), fromCategory: 'digimon' });
  if (!st.viaFusion) return;
  const lim = Math.max(PL(ctx, ctx.self).security.length, PL(ctx, ctx.opp).security.length);
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && lvl(s.cardId) <= lim), `상대의 시큐리티 아래에 놓을 Lv.${lim} 이하 디지몬 선택`);
  if (t) bounceStack(ctx, ctx.opp, t, 'securityBottom');
})]);
// BT16-064 진화 시
sc('BT16-064::진화 시', [{ op: 'condition', if: { test: (ctx) => hasSrc(me(ctx), srcTamerTrait('SoC')) }, then: [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => (isDig(s) || isTam(s)) && !s.suspended), '소멸시킬 액티브 상태의 상대 디지몬/테이머 선택', { fxKind: 'delete' });
  if (t) destroy(ctx, ctx.opp, t);
})], else: [] }]);
// BT16-065 자신의 턴 종료 시: 자신의 디지몬 2마리로 패의 「카오스몬」으로 조그레스 진화
sc('BT16-065::자신의 턴 종료 시', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const digs = pl.battle.filter(isDig);
  const okCards = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).nameKo === '카오스몬' && S.parseJogress(pl.hand[i]) && digs.some(a => digs.some(b => a !== b && S.canJogress(a, b, pl.hand[i]).ok)));
  if (!okCards.length || !(await confirm(ctx, '「카오스몬」으로 조그레스 진화할까요?'))) return;
  const hi = okCards[0], cardId = pl.hand[hi];
  const a = await pickStack(ctx, ctx.self, digs.filter(x => digs.some(y => x !== y && S.canJogress(x, y, cardId).ok)), '조그레스 진화시킬 디지몬 1 선택');
  if (!a) return;
  const b = await pickStack(ctx, ctx.self, digs.filter(y => y !== a && S.canJogress(a, y, cardId).ok), '조그레스 진화시킬 디지몬 2 선택');
  if (b) S.fuseStacks(ctx.state, ctx.self, a.uid, b.uid, cardId, S.parseJogress(cardId).cost, 'hand');
})]);
// BT16-070 진화 시/어택 시
sc('BT16-070::진화 시', [fn(async (ctx) => {
  const mine = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(isDig), '소멸시킬 자신의 디지몬 선택 (안 해도 됨)');
  if (!mine) return;
  const lim = dp(ctx, ctx.self, mine);
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && dp(ctx, ctx.opp, s) <= lim), `함께 소멸시킬 DP ${lim} 이하 상대 디지몬 선택`, { fxKind: 'delete' });
  destroy(ctx, ctx.self, mine);
  if (t) destroy(ctx, ctx.opp, t);
})]);
// BT16-078 / ST17-04: Lv 이하 디지몬 1마리 소멸 (양측)
sc('BT16-078::등장 시', [fn(async (ctx) => {
  const pk = await pickAnyDigimon(ctx, anyDigimon(ctx, (s) => lvl(s.cardId) <= 4), '소멸시킬 Lv.4 이하 디지몬 선택', { fxKind: 'delete' });
  if (pk) destroy(ctx, pk.p, pk.s);
})]);
// BT16-089 (자신의 턴, 테이머): 「아라크네몬」/「미이라몬」이 등장할 때 이 테이머를 소멸시키는 것으로 등장 코스트 -3
hk('BT16-089', { tag: '자신의 턴', has: '지불하는 등장 코스트', playDiscount: (state, hp, holder, cardId) => (isTam(holder) && ['아라크네몬', '미이라몬'].includes(C(cardId).nameKo)) ? { label: `${C(holder.cardId).nameKo}을(를) 소멸시켜 등장 코스트 -3?`, apply: () => { S.deleteStack(state, hp, holder.uid, 'trash', 'ownEffect'); return state.players[hp].battle.includes(holder) ? 0 : -3; } } : null });
// BT16-090 메인 [턴에 1회]
sc('BT16-090::메인', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const uk = pl.battle.filter(s => C(s.cardId).nameKo === '웃코몬');
  const bi = pl.hand.findIndex(id => C(id).nameKo === '빅웃코몬');
  if (!uk.length || !pl.raising || bi < 0 || !(await confirm(ctx, '「웃코몬」을 소멸시키고 육성 에어리어의 디지몬을 파기하여 「빅웃코몬」을 육성 에어리어에 등장시킬까요?'))) return;
  const u = await pickStack(ctx, ctx.self, uk, '소멸시킬 「웃코몬」 선택');
  if (!u) return;
  destroy(ctx, ctx.self, u);
  if (stillThere(ctx, ctx.self, u)) return;
  const r = pl.raising; pl.raising = null; pl.trash.push(...r.sources, r.cardId);
  S.log(ctx.state, `${ctx.self} 육성 에어리어의 ${C(r.cardId).nameKo} 파기`);
  const bIdx = pl.hand.findIndex(id => C(id).nameKo === '빅웃코몬');
  if (bIdx < 0) return;
  S.spendMemory(ctx.state, 3);
  const st = S.playFreeFromZone(ctx.state, ctx.self, 'hand', bIdx, {});
  if (st) { pl.battle.splice(pl.battle.indexOf(st), 1); pl.raising = st; S.log(ctx.state, `${ctx.self} ${C(st.cardId).nameKo} 육성 에어리어에 등장`); }
})]);
// BT16-094 딜레이 (드래곤 브레스)
sc('BT16-094::메인@4대용의 시련', [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const trial = pl.hand.findIndex(id => C(id).nameKo === '4대용의 시련');
  const disc = pl.hand.map((id, i) => i).filter(i => traitAny(pl.hand[i], ['4대용']));
  const opts = [];
  if (trial >= 0) opts.push('「4대용의 시련」을 배틀 에어리어에 놓는다');
  if (disc.length) opts.push('4대용 카드 1장을 파기한다');
  if (!opts.length) return;
  const a = await ctx.choose('multipleChoice', { prompt: '어느 쪽을 할까요?', options: [...opts, '하지 않는다'] });
  if (a == null || a >= opts.length) return;
  if (opts[a].startsWith('「')) { const [id] = pl.hand.splice(trial, 1); pl.trash.push(id); S.placeThisInBattle(ctx.state, ctx.self, id); }
  else { const i = await pickIdx(ctx, ctx.self, (id) => traitAny(id, ['4대용']), '파기할 4대용 카드 선택'); if (i < 0) return; S.trashFromHand(ctx.state, ctx.self, i); }
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), 'DP -7000 받을 상대 디지몬 선택');
  if (t) dpTemp(ctx, ctx.opp, t, -7000, ctx.state.turnNumber);
})]);
// BT16-099 딜레이 (구랑성의 마랑)
sc('BT16-099::메인@등장 코스트 -2 하여', [fn((ctx) => playPay(ctx, ctx.self, 'trash', (id) => C(id).category !== 'option' && traitAny(id, ['SoC']), 2, '등장시킬 SoC 카드 선택 (등장 코스트 -2)'))]);
// BT16-102 진화 시 / 서로의 턴 [턴에 1회]
sc('BT16-102::진화 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!hasSrc(st, (c) => c.nameKo === '매그너몬 X항체' || (c.types || []).includes('아머체'))) return;
  const until = untilOppTurnEnd(ctx);
  S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until });
  dpTemp(ctx, ctx.self, st, 3000, until);
  if (findStack(ctx.state, ctx.self, st.uid)) S.unsuspendStack(ctx.state, ctx.self, st.uid);
})]);
hk('BT16-102', { tag: '서로의 턴', has: '시큐리티가 줄어들었을 때', limit: 1, events: { securityDecrease: () => true } });
sc('BT16-102::서로의 턴', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  const opts = [];
  for (const { id, own } of [{ id: st.cardId, own: true }, ...st.sources.map(id => ({ id, own: false }))]) {
    const text = own ? C(id).effectKo : C(id).inheritedKo;
    for (const seg of S.parseEffectSegments(text || '').segments) if (seg.tags.some(t => t.includes('진화 시'))) opts.push({ id, own, seg });
  }
  if (!opts.length) return;
  const a = opts.length === 1 ? 0 : await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: opts.map(o => `${C(o.id).nameKo}: ${o.seg.body.slice(0, 40)}`) });
  const o = opts[a || 0];
  S.queuePending(ctx.state, { player: ctx.self, cardId: o.id, stackUid: st.uid, tags: o.seg.tags, text: o.seg.body.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, ''), inherited: !o.own });
})]);

// ------------------------------------------------------------------ ST17
// ST17-02 메인 [턴에 1회]
sc('ST17-02::메인', [fn((ctx) => playPay(ctx, ctx.self, 'hand', (id) => (C(id).category === 'tamer' && colorHas(id, 'green')) || (C(id).category === 'digimon' && lvl(id) === 3 && C(id).nameKo.includes('로프몬')), 2, '등장시킬 그린 테이머 또는 「로프몬」 Lv.3 디지몬 선택 (등장 코스트 -2)'))]);
// ST17-04 등장 시/진화 시
sc('ST17-04::등장 시', [fn(async (ctx) => {
  const pk = await pickAnyDigimon(ctx, anyDigimon(ctx, (s) => lvl(s.cardId) <= 3), '소멸시킬 Lv.3 이하 디지몬 선택', { fxKind: 'delete' });
  if (!pk) return;
  destroy(ctx, pk.p, pk.s);
  if (pk.p !== ctx.self || stillThere(ctx, pk.p, pk.s)) return;
  await playFreeWhere(ctx, ctx.self, 'trash', (id) => C(id).category === 'digimon' && lvl(id) === 3 && nameHas(id, ['테리어몬', '로프몬']), '트래시에서 등장시킬 「테리어몬」/「로프몬」 Lv.3 선택');
})]);
// ST17-13 시큐리티: 《퇴화 1》 + 배틀 종료 시 이 카드로 진화
const s3BattleEnd = (state, kind) => {
  if (kind !== 'attackEnd' || !state.s3AfterBattle?.length) return;
  const q = state.s3AfterBattle.splice(0);
  for (const e of q) S.queuePending(state, { player: e.p, cardId: e.cardId, stackUid: null, tags: ['s3AfterBattle'], text: '배틀 종료 시', watcher: true });
};
sc('ST17-13::시큐리티', [fn(async (ctx) => {
  const pk = await pickAnyDigimon(ctx, anyDigimon(ctx), '《퇴화 1》할 디지몬 선택', { fxKind: 'retreat' });
  if (pk) S.retreat(ctx.state, pk.p, pk.s.uid, 1);
  if (!S.EVENT_HOOKS.includes(s3BattleEnd)) S.EVENT_HOOKS.push((state, kind) => s3BattleEnd(state, kind));
  (ctx.state.s3AfterBattle ||= []).push({ p: ctx.self, cardId: ctx.sourceCardId });
})]);
sc('ST17-13::s3AfterBattle', [fn((ctx) => evolveGeneric(ctx, { subject: null, zone: 'trash', cardPred: (id) => id === ctx.sourceCardId, cost: { mode: 'free' }, cardPrompt: '진화할 카드(이 카드) 선택' }))]);

// ------------------------------------------------------------------ EX6
sc('EX6-002::어택 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  const idx = await pickIdx(ctx, ctx.self, (id) => C(id).category === 'digimon' && lvl(id) === 3 && colorHas(id, 'blue'), '진화원 아래에 놓을 블루 Lv.3 디지몬 카드 선택 (안 해도 됨)');
  if (idx >= 0) addSourcesBottom(ctx, ctx.self, st, [removeFromHand(ctx, ctx.self, idx)]);
})]);
sc('EX6-003::어택 시', [fn((ctx) => secSwap(ctx, (id) => C(id).category === 'digimon' && traitAny(id, ['천사형', '대천사형', '3대천사']), ['bottom'], '시큐리티 맨 위 1장을 패에 추가하고 천사형 디지몬 카드를 시큐리티 아래에 놓을까요?'))]);
// EX6-007/008/038/040/042 [패]【메인】: pay N, put this card under a Legend-Arms / Lv.L own digimon
function legendMain(o) {
  return [fn(async (ctx) => {
    const pl = PL(ctx, ctx.self);
    let hi = ctx.trigger?.zoneIdx != null && pl.hand[ctx.trigger.zoneIdx] === ctx.sourceCardId ? ctx.trigger.zoneIdx : pl.hand.indexOf(ctx.sourceCardId);
    if (hi < 0) return;
    const tgts = pl.battle.filter(s => isDig(s) && (traitAny(s.cardId, ['Legend-Arms']) || lvl(s.cardId) === o.level));
    const t = await pickStack(ctx, ctx.self, tgts, `진화원 아래에 놓을 Legend-Arms 또는 Lv.${o.level} 디지몬 선택`);
    if (!t) return;
    S.spendMemory(ctx.state, o.cost);
    hi = pl.hand.indexOf(ctx.sourceCardId);
    if (hi < 0) return;
    addSourcesBottom(ctx, ctx.self, t, [removeFromHand(ctx, ctx.self, hi)]);
    if (o.dp) dpTemp(ctx, ctx.self, t, o.dp, o.opp ? untilOppTurnEnd(ctx) : ctx.state.turnNumber);
    if (o.force) {
      const v = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(isDig), '「메인 페이즈 개시 시 어택」 효과를 줄 상대 디지몬 선택');
      if (v) giveForcedAttack(ctx, v, ctx.sourceCardId);
    }
  })];
}
sc('EX6-007::메인', legendMain({ cost: 1, level: 3, dp: 4000 }));
sc('EX6-008::메인', legendMain({ cost: 1, level: 4, dp: 4000 }));
sc('EX6-038::메인', legendMain({ cost: 1, level: 3, dp: 2000, opp: true }));
sc('EX6-040::메인', legendMain({ cost: 1, level: 4, dp: 2000, opp: true }));
sc('EX6-042::메인', legendMain({ cost: 2, level: 5, force: true }));
// EX6-010 (진화원, 자신의 턴): 「라그나로드몬」인 동안 이 디지몬이 체크한 카드의 【시큐리티】 효과는 발휘하지 않는다
hk('EX6-010', { tag: '자신의 턴', src: 'inheritedKo', has: '체크한 카드', suppressSecurity: (state, hp, holder) => C(holder.cardId).nameKo === '라그나로드몬' });
// EX6-011 / EX6-029 [패]【카운터】 《블래스트 조그레스《「A」+「B」》》
function blastJogress(names) {
  return [fn(async (ctx) => {
    const pl = PL(ctx, ctx.self);
    const [n1, n2] = names;
    const cardId = ctx.sourceCardId;
    if (!pl.hand.includes(cardId)) return;
    const pairs = [];
    for (const [fieldName, handName] of [[n1, n2], [n2, n1]]) {
      const hIdx = pl.hand.findIndex((id, i) => i !== pl.hand.indexOf(cardId) && C(id).nameKo === handName);
      if (hIdx < 0) continue;
      for (const s of pl.battle.filter(x => isDig(x) && C(x.cardId).nameKo === fieldName)) pairs.push({ s, hIdx, fieldName, handName });
    }
    if (!pairs.length || !(await confirm(ctx, '《블래스트 조그레스》 — 조그레스 진화할까요?'))) return;
    const st = await pickStack(ctx, ctx.self, pairs.map(p => p.s), '조그레스 진화시킬 필드의 디지몬 선택');
    const pr = st && pairs.find(p => p.s === st);
    if (!pr) return;
    const handCard = pl.hand[pr.hIdx];
    const piece = (name) => (name === pr.fieldName ? [...st.sources, st.cardId] : [handCard]);
    pl.hand.splice(pl.hand.indexOf(handCard), 1);
    pl.hand.splice(pl.hand.indexOf(cardId), 1);
    pl.battle.splice(pl.battle.indexOf(st), 1);
    S._s4.discardLinkCardsOnNewCard(ctx.state, ctx.self, st);
    const fused = S._s4.makeStack(cardId, ctx.state.turnNumber);
    fused.sources = [...piece(n2), ...piece(n1)];
    fused.suspended = false; fused.attackEligibleTurn = ctx.state.turnNumber; fused.viaFusion = true;
    pl.battle.push(fused);
    S.log(ctx.state, `${ctx.self} 《블래스트 조그레스》: ${pr.fieldName}+${pr.handName} → ${C(cardId).nameKo}`);
    S.drawCards(ctx.state, ctx.self, 1);
    S.recomputeStackGrants(fused);
    S._s4.ruleCheckDP(ctx.state, ctx.self, fused);
    S.queueTriggersForStack(ctx.state, ctx.self, fused, 'digivolve');
    S.emitGameEvent(ctx.state, 'digivolve', { owner: ctx.self, stack: fused, cause: null });
  })];
}
sc('EX6-011::카운터', blastJogress(['듀란다몬', '브리웨루드라몬']));
sc('EX6-029::카운터', blastJogress(['엔젤우몬', '레이디데블몬']));
// EX6-015 등장 시/진화 시
sc('EX6-015::등장 시', [fn(async (ctx) => {
  const me0 = me(ctx); if (!me0) return;
  const pl = PL(ctx, ctx.self);
  let n = 0;
  const others = () => pl.battle.filter(s => s !== me0 && isDig(s) && stackHasColor(s, 'blue'));
  for (let k = 0; k < 3 && others().length; k++) {
    const t = await pickStack(ctx, ctx.self, others(), `진화원 아래에 놓을 블루 디지몬 선택 (${k + 1}/3, 취소=종료)`);
    if (!t) break;
    pl.battle.splice(pl.battle.indexOf(t), 1);
    pl.trash.push(...(t.linkCards || []).map(l => l.cardId));
    addSourcesBottom(ctx, ctx.self, me0, [...t.sources, t.cardId]);
    n++;
  }
  const lim = 4 + n;
  for (const p of ['p1', 'p2']) for (const s of [...PL(ctx, p).battle]) if (s !== me0 && isDig(s) && lvl(s.cardId) <= lim) bounceStack(ctx, p, s, 'hand');
})]);
// EX6-018 자신의 턴 종료 시 [턴에 1회]
sc('EX6-018::자신의 턴 종료 시', [fn(async (ctx) => {
  const st = me(ctx); if (!st) return;
  const pl = PL(ctx, ctx.self);
  if (!pl.trash.some(id => C(id).nameKo === '루체몬: 폴다운 모드')) return;
  const t = await pickStack(ctx, ctx.self, pl.battle.filter(s => isDig(s) && lvl(s.cardId) === 6), '시큐리티 위에 놓을 Lv.6 디지몬 선택 (안 해도 됨)');
  if (!t || !bounceStack(ctx, ctx.self, t, 'securityTop')) return;
  if (t === st) return;
  await evolveGeneric(ctx, { subject: 'this', zone: 'trash', cardPred: (id) => C(id).nameKo === '루체몬: 폴다운 모드', cost: { mode: 'free' }, cardPrompt: '트래시에서 진화할 카드 선택' });
})]);
// EX6-023/024/025/026 서로의 턴: leaves the battle area → return a yellow digimon card from sources to hand
for (const id of ['EX6-023', 'EX6-024', 'EX6-025', 'EX6-026']) {
  hk(id, { tag: '서로의 턴', has: '벗어날 때', onLeave: () => true });
  sc(`${id}::서로의 턴`, [fn(async (ctx) => {
    const evt = ctx.trigger?.evt; if (!evt) return;
    const pl = PL(ctx, ctx.self);
    const cand = evt.sources.filter(x => C(x).category === 'digimon' && colorHas(x, 'yellow') && pl.trash.includes(x));
    if (!cand.length) return;
    const a = cand.length === 1 ? 0 : await ctx.choose('multipleChoice', { prompt: '패로 되돌릴 옐로 디지몬 카드', options: cand.map(x => C(x).nameKo) });
    const pick = cand[a || 0];
    pl.trash.splice(pl.trash.lastIndexOf(pick), 1); pl.hand.push(pick);
  })]);
}
// EX6-031 샤카몬
hk('EX6-031', { tag: '자신의 턴', has: '《S 어택 -》', sAttackFlip: true });
sc('EX6-031::상대의 턴 종료 시', [fn(async (ctx) => {
  const hasSA = (s) => /《(?:S|시큐리티)\s*어택/.test(`${C(s.cardId).effectKo || ''}\n${C(s.cardId).inheritedKo || ''}`) || S.hasKeyword(s, '시큐리티어택');
  const t = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(s => isDig(s) && hasSA(s)), '시큐리티 위에 놓을 《S 어택》 디지몬 선택 (안 해도 됨)');
  if (t) bounceStack(ctx, ctx.self, t, 'securityTop');
})]);
// EX6-036 / EX6-039 (진화원) 소멸 시
const DIABLO = { name: '디아블로몬', cost: 14, level: 6, dp: 3000, colors: ['white'], form: '궁극체', attribute: '불명', types: ['종족불명'] };
const diablo = [fn(async (ctx) => {
  const top = ctx.trigger?.delStack?.cardId;
  if (!top || !traitAny(top, ['종족불명'])) return;
  if (await confirm(ctx, '「디아블로몬」 토큰을 등장시킬까요?')) spawnToken(ctx, ctx.self, DIABLO);
})];
sc('EX6-036::소멸 시', diablo); sc('EX6-039::소멸 시', diablo);
// EX6-044 진화 시 / (진화원) 상대의 턴
sc('EX6-044::진화 시', [fn(async (ctx) => {
  const t = await pickStack(ctx, ctx.self, PL(ctx, ctx.self).battle.filter(isDig), '상대의 디지몬의 효과를 받지 않게 될 디지몬 선택');
  if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['all'], until: untilOppTurnEnd(ctx), fromCategory: 'digimon' });
})]);
hk('EX6-044', { tag: '상대의 턴', src: 'inheritedKo', has: '벗어나지', preventLeave: (state, hp, holder, target, tp, cause, mode) => target === holder && C(holder.cardId).nameKo === '라그나로드몬' && mode !== 'delete' && cause !== 'ownEffect' && cause != null });
// EX6-050 / EX6-051 (진화원) 어택 시 [턴에 1회]
const felesmon = [{ op: 'oppMayPay', pay: 'discard', n: 1, filter: null, else: [{ op: 'playFree', who: 'self', zone: 'trash', filter: { colors: ['purple'], level: 3, category: 'digimon' } }] }];
sc('EX6-050::어택 시', felesmon); sc('EX6-051::어택 시', felesmon);
// EX6-056 / 058 / 060 / 061(2번째) 서로의 턴: 배틀 이외로 벗어날 때 → 트래시의 7대마왕 카드를 육성 에어리어의 「대죄의 문」 진화원 아래에
const sinGate = [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const gate = pl.raising && C(pl.raising.cardId).nameKo === '대죄의 문' ? pl.raising : null;
  const idx = await pickIdx(ctx, ctx.self, (id) => traitAny(id, ['7대마왕']), '「대죄의 문」 아래에 놓을 7대마왕 카드 선택', 'trash');
  if (!gate || idx < 0) return;
  addSourcesBottom(ctx, ctx.self, gate, pl.trash.splice(idx, 1));
})];
for (const id of ['EX6-056', 'EX6-058', 'EX6-060']) { hk(id, { tag: '서로의 턴', has: '벗어날 때', onLeave: (state, hp, stack, cause) => cause !== 'battle' }); sc(`${id}::서로의 턴`, sinGate); }
// EX6-057 서로의 턴 [턴에 1회]: 배틀 이외로 벗어날 때 Lv.5 이하 디지몬 1마리를 소멸시키는 것으로 벗어나지 않는다
{ const d = { tag: '서로의 턴', has: '벗어나지', preventLeave: (state, hp, holder, target, tp, cause) => {
  if (target !== holder || cause === 'battle' || cause == null) return false;
  const opl = state.players[opp(hp)], mpl = state.players[hp];
  const oppC = opl.battle.filter(s => isDig(s) && lvl(s.cardId) <= 5).sort((a, b) => S.effectiveDP(state, opp(hp), b) - S.effectiveDP(state, opp(hp), a));
  const ownC = mpl.battle.filter(s => s !== holder && isDig(s) && lvl(s.cardId) <= 5).sort((a, b) => S.effectiveDP(state, hp, a) - S.effectiveDP(state, hp, b));
  const victim = oppC[0] || ownC[0]; const vp = oppC[0] ? opp(hp) : hp;
  if (!victim || !S.hookUseOnce(holder, 'EX6-057', d)) return false;
  S.deleteStack(state, vp, victim.uid, 'trash', vp === hp ? 'ownEffect' : 'effect');
  return true;
} }; hk('EX6-057', d); }
// EX6-061 리바이어몬
hk('EX6-061', { tag: '서로의 턴', has: '등장했을 때', limit: 1, events: { play: (state, hp, holder, info) => isDig(info.stack) && (info.owner !== hp || traitAny(info.stack.cardId, ['7대마왕'])) } });
hk('EX6-061', { tag: '서로의 턴', has: '벗어날 때', onLeave: (state, hp, stack, cause) => cause !== 'battle' });
sc('EX6-061::서로의 턴@「대죄의 문」', sinGate);
sc('EX6-061::서로의 턴@진화원을 아래에서부터 3장', [fn(async (ctx) => {
  const i = await pickIdx(ctx, ctx.self, () => true, '파기할 패 1장 선택');
  if (i < 0) return;
  S.trashFromHand(ctx.state, ctx.self, i);
  const t = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && s.sources.length), '진화원을 덱 아래로 되돌릴 상대 디지몬 선택');
  if (t) { const ids = await S.orderPlacement(ctx.choose, ctx.self, t.sources.splice(0, 3), '덱 아래로 되돌릴 진화원 3장의 순서를 정하세요 (위쪽부터, 룰 3-1-3-4)'); PL(ctx, ctx.opp).deck.push(...ids); S.recomputeStackGrants(t); S.log(ctx.state, `${ctx.opp} ${C(t.cardId).nameKo} 진화원 ${ids.length}장 덱 아래로`); }
  if (boardCount(ctx, ctx.opp) <= boardCount(ctx, ctx.self)) {
    const d = await pickStack(ctx, ctx.opp, PL(ctx, ctx.opp).battle.filter(s => isDig(s) && !s.sources.length), '소멸시킬 진화원이 없는 상대 디지몬 선택', { fxKind: 'delete' });
    if (d) destroy(ctx, ctx.opp, d);
  }
})]);

// ------------------------------------------------------------------ remaining BT14
// BT14-046 (자신의 턴) [턴에 1회]: 패에서 그린 테이머가 등장할 때, 그린 디지몬 1마리를 레스트시키는 것으로 등장 코스트 -3
{ const d = { tag: '자신의 턴', has: '그린인 테이머', playDiscount: (state, hp, holder, cardId) => {
  if (C(cardId).category !== 'tamer' || !colorHas(cardId, 'green') || S.turnUsesRemaining(holder, S.onceLimitKey('BT14-046', [d.tag, d.has]), 1) <= 0) return null;
  const cands = state.players[hp].battle.filter(s => isDig(s) && !s.suspended && stackHasColor(s, 'green'));
  if (!cands.length) return null;
  return { label: '그린 디지몬 1마리를 레스트시켜 그린 테이머의 등장 코스트 -3?', apply: () => {
    const c = cands.sort((a, b) => S.effectiveDP(state, hp, a) - S.effectiveDP(state, hp, b))[0];
    S.restStack(state, hp, c.uid);
    if (!c.suspended || !S.hookUseOnce(holder, 'BT14-046', d)) return 0;
    return -3;
  } };
} }; hk('BT14-046', d); }
// BT14-048 어택 시: attacking a digimon with higher DP → evolve into a 레오몬 Lv.6 (ignore conditions, cost 6)
hk('BT14-048', { tag: '어택 시', has: '진화 코스트 6', skipTrigger: true, events: { attackOnDigimon: (state, hp, holder, info) => info.owner === hp && info.stack === holder && !!info.target && S.effectiveDP(state, opp(hp), info.target) > S.effectiveDP(state, hp, holder) } });
sc('BT14-048::어택 시', [fn((ctx) => evolveGeneric(ctx, { subject: 'this', ignoreCond: true, cost: { mode: 'fixed', n: 6 }, cardPred: (id) => C(id).nameKo.includes('레오몬') && lvl(id) === 6, cardPrompt: '진화할 「레오몬」 Lv.6 카드 선택' }))]);

// @@END
