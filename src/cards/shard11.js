// Shard 11 — bespoke scripts for effect segments whose sentences the generic compiler silently dropped
// (batch 2 of the "dropped sentence" audit: BT11-086 … ST17-08, see docs/verify-dropped-2.md).
//   SCRIPTS  triggered/main effects (one generic op s11_fn runs a JS function per card)
//   HOOKS    continuous / event-driven abilities consumed by state.js (grantKw, dp, events, …)
// NOTE: like every shard this must NOT import effects.js statically (index.js is evaluated while effects.js loads);
// use `await import('../effects.js')` inside functions when the compiler is needed.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const stackOf = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => stackOf(ctx.state, ctx.self, ctx.sourceStackUid);
const oppEnd = (state, self) => (state.activePlayer === self ? state.turnNumber + 1 : state.turnNumber); // "상대의 턴 종료까지" as the last turn number that still counts
const hasTrait = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const hasTraitIncl = (c, ...ts) => ts.some(t => (c.types || []).some(x => x.includes(t)));
const BEAST_EXCL = ['수장룡형', '수생형', '수생포유류형', '정보수집 타입', '정보수집 유형'];
const beastTrait = (c) => (c.types || []).some(ty => !BEAST_EXCL.includes(ty) && ['조', '새', '병아리', '수', '짐승'].some(t => ty.includes(t))); // 「조」/「새」/「병아리」/「수」/「짐승」을 포함(…은 제외)
const nameHas = (c, n) => S.cardNameHas(c, n);
const nameIs = (c, n) => S.cardNameIs(c, n);
const hasColor = (st, col) => S.stackColors(st).includes(col);
const fn = (f) => ({ op: 's11_fn', fn: f });
OPS.s11_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const js = (key, ops) => { SCRIPTS[key] = ops; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const NOOP_CONT = [{ op: 'noop', note: '지속 효과 — 별도의 HOOKS로 처리됩니다.' }];

async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt, fxKind) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt, ...(fxKind ? { fxKind } : {}) });
  return stacks.find(s => s.uid === uid) || null;
}
async function pickIdx(ctx, who, zone, pred, prompt) { // index into state.players[who][zone] or null
  const pl = ctx.state.players[who];
  const idxs = pl[zone].map((id, i) => i).filter(i => pred(C(pl[zone][i]), pl[zone][i]));
  if (!idxs.length) return null;
  const r = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return r == null || !idxs.includes(r) ? null : r;
}
// pick one entry of an arbitrary id list through the stock zone picker (temp zone)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s11tmp = ids;
  try { const r = await ctx.choose('pickFromZoneIndex', { player: who, zone: 's11tmp', eligibleIdxs: idxs, prompt }); return r == null || !idxs.includes(r) ? null : r; } finally { delete pl.s11tmp; }
}
const takeFrom = (arr, i) => arr.splice(i, 1)[0];
const del = (ctx, p, st) => S.deleteStack(ctx.state, p, st.uid, 'trash', p === ctx.self ? 'ownEffect' : 'effect');
const lvOf = (id) => C(id).level ?? 0;
async function destroyOppWhere(ctx, pred, prompt) { // one opponent Digimon (optional cancel through the picker) -> true when it was deleted
  const pl = ctx.state.players[ctx.opp];
  const t = await pickStack(ctx, ctx.opp, digs(ctx.state, ctx.opp).filter(pred), prompt || '소멸시킬 상대 디지몬 선택', 'delete');
  if (!t) return false;
  const before = pl.battle.length;
  del(ctx, ctx.opp, t);
  return pl.battle.length < before;
}
// a DP-scaled debuff on ONE chosen opponent Digimon ("… 1마리를 <수량> 1장마다 DP -N")
async function dpPerCount(ctx, amount, count, duration = 'turn') {
  const k = count;
  if (k <= 0) { S.log(ctx.state, `${ctx.self} DP 감소 대상 수가 0이라 효과 없음`); return; }
  const t = await pickStack(ctx, ctx.opp, digs(ctx.state, ctx.opp), `DP ${amount * k} 받을 상대 디지몬 선택`, 'dpDown');
  if (t) S.modifyDP(ctx.state, ctx.opp, t.uid, amount * k, duration);
}
// "이 디지몬의 진화원 아래/에 놓는다": cards leave their zone and go to the BOTTOM (unshift) or the top (push) of the sources
function putSource(state, stack, id, bottom) { if (bottom) stack.sources.splice(S.fdCount(stack), 0, id); else stack.sources.push(id); S.recomputeStackGrants(stack); } // (face-down sources always stay the very bottom block)
// place up to `max` cards from a zone of `who` onto `stack`'s sources; optional pick each time (cancel stops). returns the placed ids
async function placeSources(ctx, who, zone, pred, max, stack, bottom, prompt) {
  const placed = [];
  const pl = ctx.state.players[who];
  for (let i = 0; i < max; i++) {
    const idx = await pickIdx(ctx, who, zone, pred, prompt);
    if (idx == null) break;
    const id = takeFrom(pl[zone], idx);
    putSource(ctx.state, stack, id, bottom);
    placed.push(id);
    S.log(ctx.state, `${who} ${C(id).nameKo}을(를) ${C(stack.cardId).nameKo}의 진화원${bottom ? ' 아래' : ''}에 놓음`);
  }
  return placed;
}
// reveal the top n cards of `deckOwner`'s deck; the acting player picks up to `max` matching cards. The revealed cards are removed from the deck
// (caller puts them somewhere). returns { revealed, chosen: ids picked, rest: ids not picked }
async function revealPick(ctx, deckOwner, n, pred, max, prompt) {
  const pl = ctx.state.players[deckOwner];
  const revealed = pl.deck.slice(0, n);
  const eligible = revealed.map((id, i) => ({ id, i })).filter(x => pred(C(x.id)));
  const sel = eligible.length && max > 0 ? await ctx.choose('pickFromRevealed', { player: ctx.self, revealed, eligible, min: 0, max, prompt: prompt || '공개된 카드 중 선택' }) : [];
  const idxs = (sel || []).filter(i => eligible.some(e => e.i === i)).slice(0, max);
  pl.deck.splice(0, revealed.length);
  S.log(ctx.state, `${deckOwner} 덱 위 ${revealed.length}장 공개: ${revealed.map(id => C(id).nameKo).join(', ')}`);
  return { revealed, chosen: idxs.map(i => revealed[i]), rest: revealed.filter((id, i) => !idxs.includes(i)) };
}
// cards (already off the deck) go back to the top/bottom of `owner`'s deck; the acting player decides top/bottom per card ("덱 위 또는 아래로만") and the order
async function returnTopOrBottom(ctx, owner, ids) {
  const pl = ctx.state.players[owner];
  const top = [], bottom = [];
  for (const id of ids) {
    const r = await ctx.choose('multipleChoice', { prompt: `${C(id).nameKo}: 덱 위 / 덱 아래`, options: ['덱 위', '덱 아래'] });
    (r === 1 ? bottom : top).push(id);
  }
  const t = await S.orderPlacement(ctx.choose, ctx.self, top, '덱 위에 놓을 카드의 순서 (위쪽부터)');
  const b = await S.orderPlacement(ctx.choose, ctx.self, bottom, '덱 아래에 놓을 카드의 순서 (위쪽부터)');
  pl.deck.unshift(...t); pl.deck.push(...b);
}
// effect-driven evolution with a picked stack + a picked card from hand / trash / security. Returns the evolved stack or null.
async function evolveInto(ctx, { stacks, zone = 'hand', pred, cost = { mode: 'normal' }, ignoreCond = false, prompt }) {
  const { state, E } = ctx; const who = ctx.self; const pl = state.players[who];
  if (!E || !E.canEvolveAny) return null;
  const arr = zone === 'security' ? pl.security : zone === 'trash' ? pl.trash : pl.hand;
  const evoOk = (stack, id) => (ignoreCond && E.evoRestrictionCheck(id, S.evolveTargetRestriction(state, who, stack)).ok) || E.canEvolveAny(stack.cardId, id, S.evoExtraArg(state, who, stack), S.evolveTargetRestriction(state, who, stack)).ok;
  const cardsFor = (stack) => arr.map((id, i) => i).filter(i => C(arr[i]).category === 'digimon' && pred(C(arr[i])) && evoOk(stack, arr[i]));
  const cands = stacks.filter(s => cardsFor(s).length);
  if (!cands.length) { S.log(state, `${who} 진화시킬 수 있는 조합이 없음`); return null; }
  const src = cands.length === 1 ? cands[0] : await pickStack(ctx, who, cands, '진화시킬 디지몬 선택');
  if (!src) return null;
  const idxs = cardsFor(src);
  const idx = zone === 'security' ? await pickFromList(ctx, who, pl.security.slice(), idxs, prompt || '시큐리티에서 진화할 카드 선택')
    : await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt: prompt || '진화할 카드 선택' });
  if (idx == null || !idxs.includes(idx)) return null;
  const cardId = arr[idx];
  const chk = E.canEvolveAny(src.cardId, cardId, S.evoExtraArg(state, null, src), null);
  const printed = chk.ok ? chk.cost : (C(cardId).evoNormal?.cost ?? 0);
  const base = cost.mode === 'free' ? 0 : cost.mode === 'discount' ? Math.max(0, printed - cost.n) : printed;
  const adj = cost.mode === 'free' ? 0 : S.continuousEvoCostDiscount(state, who, src, cardId) + S.hookEvoCostDiscount(state, who, src, cardId);
  if (zone !== 'hand') { takeFrom(arr, idx); if (zone === 'security') S.secFaceUpTake(pl, cardId); }
  const r = S.digivolve(state, who, src.uid, cardId, Math.max(0, base + adj), zone === 'hand' ? 'hand' : zone);
  if (!r && zone !== 'hand') arr.splice(idx, 0, cardId);
  return r;
}
// run one of `stack`'s own <tag> effects (top card's, plus inherited ones from its sources) as that Digimon's effect ("【소멸 시】 효과 1개를 발휘한다")
async function runTagOf(ctx, R, stack, tag, owner = ctx.self) {
  const Fx = await import('../effects.js');
  const opts = [];
  const add = (id, src) => { for (const sg of S.parseEffectSegments(C(id)[src] || '').segments) if (sg.tags.some(t => t.includes(tag)) && !/^[≪《]\s*딜레이/.test(sg.body.trim())) opts.push({ id, sg }); };
  add(stack.cardId, 'effectKo');
  for (const id of stack.sources) add(id, 'inheritedKo');
  if (!opts.length) { S.log(ctx.state, `${C(stack.cardId).nameKo}: 발휘할 【${tag}】 효과가 없음`); return false; }
  let pick = opts[0];
  if (opts.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: `발휘할 【${tag}】 효과 선택`, options: opts.map(o => o.sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k == null) return false; pick = opts[k] || opts[0]; }
  const script = Fx.lookupCardSpecific(pick.id, pick.sg.tags, pick.sg.body) || Fx.compileToScript(pick.sg.body);
  if (!script || !script.length) { S.log(ctx.state, `${C(pick.id).nameKo} 【${tag}】 효과를 자동 처리할 수 없음: ${pick.sg.body}`); return false; }
  await R.runScript(script, { ...ctx, self: owner, opp: opp(owner), sourceCardId: pick.id, sourceStackUid: stack.uid, trigger: { ...(ctx.trigger || {}), text: pick.sg.body } });
  return true;
}
const srcNamed = (stack, ...names) => stack.sources.some(id => names.some(n => nameIs(C(id), n) || (n === 'X항체' && hasTrait(C(id), 'X항체'))));
// the opponent's redirect target for the attack that is being declared (main.js: sel.pendingAttack)
function redirectAttackTo(ctx, uid) {
  const pa = ctx.attack ? ctx.attack() : null;
  if (!pa || pa.attacker === ctx.self) return false;
  pa.s1ForcedTarget = uid;
  if (pa.targetKind) { pa.targetKind = 'digimon'; pa.targetUid = uid; }
  S.log(ctx.state, `${ctx.self} 어택의 대상을 변경`);
  return true;
}
// rest an opponent Digimon/Tamer chosen by the effect's owner; skip = "다음 액티브 페이즈에 액티브가 되지 않는다"
async function restOpp(ctx, pred, prompt, skip) {
  const cands = ctx.state.players[ctx.opp].battle.filter(s => (isDig(s) || isTam(s)) && pred(s));
  const t = await pickStack(ctx, ctx.opp, cands, prompt || '레스트시킬 상대 디지몬/테이머 선택', 'rest');
  if (!t) return null;
  S.restStack(ctx.state, ctx.opp, t.uid);
  if (skip) S.setSkipNextUnsuspend(ctx.state, ctx.opp, t.uid);
  return t;
}
function moveStackUnder(state, p, mv, target) { // an own stack (with all its cards) goes under another own stack's sources
  const pl = state.players[p];
  const idx = pl.battle.indexOf(mv);
  if (idx === -1 || !target || target === mv) return false;
  pl.battle.splice(idx, 1);
  pl.trash.push(...(mv.linkCards || []).map(l => l.cardId));
  target.sources.unshift(...[...mv.sources, mv.cardId].filter(id => !C(id).isToken));
  S.recomputeStackGrants(target);
  S.log(state, `${p} ${C(mv.cardId).nameKo}을(를) ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
  return true;
}
const optionInTrash = (ctx) => ctx.state.players[ctx.self].trash.lastIndexOf(ctx.sourceCardId);

// ================================================================== BT11-086 메르바몬 (서로의 턴 continuous grant)
// 「특징으로 「크로스 하트」를 가지거나 《길동무》를 가진 자신의 디지몬 전부는 《속공》과 《블로커》를 얻는다」
hk('BT11-086', { tag: '서로의 턴', has: '《길동무》를 가진', grantKw: (state, hp, h, t) => (isDig(t) && S.ownerOfStack(state, t) === hp && (hasTrait(C(t.cardId), '크로스 하트') || `${C(t.cardId).effectKo || ''}\n${C(t.cardId).inheritedKo || ''}`.includes('《길동무')) ? ['속공', '블로커'] : []) });
SCRIPTS['BT11-086::서로의 턴'] = NOOP_CONT;

// ================================================================== BT11-087 (등장 시)
js('BT11-087::등장 시', [
  { op: 'trashDeckTop', who: 'self', n: 4 },
  { op: 'returnFromTrash', who: 'self', filter: { traitIncludes: ['바그라군'] } },
  { op: 'returnFromTrash', who: 'self', filter: { traitIncludes: ['바그라군'] } },
  { op: 'placeUnderTamer', who: 'self', zones: ['trash'], filter: { category: 'digimon', traitAny: ['바그라군'] }, n: 2 },
]);

// ================================================================== BT11-089 린도 아키호 (자신의 턴)
hk('BT11-089', { tag: '자신의 턴', has: '이하의 조건을 만족하는 레드인', events: { play: (state, hp, h, info) => info.owner === hp && (info.cause === 'effect' || info.cause === 'ownEffect') && isTam(h) && !h.suspended && isDig(info.stack) && hasColor(info.stack, 'red') && beastTrait(C(info.stack.cardId)) } });
sc('BT11-089::자신의 턴', async (ctx) => {
  const { state } = ctx, h = me(ctx);
  const uid = ctx.trigger?.evt?.stackUid ?? h?.hookEvt?.stackUid;
  if (!h || h.suspended || !uid || !stackOf(state, ctx.self, uid)) return;
  if (!(await ask(ctx, '이 테이머를 레스트시켜 그 디지몬에게 턴 종료까지 《속공》을 줄까요?'))) return;
  S.restStack(state, ctx.self, h.uid);
  S.grantKeyword(state, ctx.self, uid, '속공', undefined, 'turn');
});

// ================================================================== BT11-093 쿠가 유야 (자신의 턴)
hk('BT11-093', { tag: '자신의 턴', has: '「그레이몬」을 포함하는 디지몬으로 진화했을 때', events: { digivolve: (state, hp, h, info) => {
  if (!(info.owner === hp && isTam(h) && !h.suspended && isDig(info.stack) && nameHas(C(info.stack.cardId), '그레이몬'))) return false;
  const prev = info.stack.sources[info.stack.sources.length - 1];
  info.sameLv = prev != null && lvOf(prev) === lvOf(info.stack.cardId); // 같은 Lv.로 진화하고 있었다면
  return true;
} } });
sc('BT11-093::자신의 턴', async (ctx) => {
  const { state } = ctx, h = me(ctx);
  const evt = ctx.trigger?.evt || h?.hookEvt || {};
  const uid = evt.stackUid;
  if (!h || h.suspended || !uid || !stackOf(state, ctx.self, uid)) return;
  if (!(await ask(ctx, '이 테이머를 레스트시켜 그 디지몬을 DP +2000 할까요?'))) return;
  S.restStack(state, ctx.self, h.uid);
  S.modifyDP(state, ctx.self, uid, 2000, 'opponentTurn');
  if (evt.sameLv) S.grantShield(state, ctx.self, uid, { kinds: ['all'], until: oppEnd(state, ctx.self), fromCategory: 'option' });
});

// ================================================================== BT11-097 (메인 옵션)
js('BT11-097::메인', [
  { op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 8000 } },
  fn(async (ctx, R) => {
    const { state } = ctx;
    if (!tams(state, ctx.self).some(t => hasColor(t, 'red'))) return;
    const st = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => hasColor(s, 'red') && hasTrait(C(s.cardId), '백신종')), '【소멸 시】 효과를 발휘시킬 「백신종」 레드 디지몬 선택');
    if (st) await runTagOf(ctx, R, st, '소멸 시');
  }),
]);

// ================================================================== BT11-102 (메인 옵션)
sc('BT11-102::메인', async (ctx) => {
  const { state } = ctx;
  const mine = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => hasTraitIncl(C(s.cardId), '곤충형')), 'DP 기준이 될 「곤충형」 자신의 디지몬 선택');
  if (!mine) return;
  const dp = S.effectiveDP(state, ctx.self, mine);
  const done = [];
  for (let i = 0; i < 2; i++) {
    const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => !done.includes(s.uid) && S.effectiveDP(state, ctx.opp, s) <= dp), `레스트시킬 상대 디지몬 선택 (DP ${dp} 이하, ${i + 1}/2)`, 'rest');
    if (!t) break;
    S.restStack(state, ctx.opp, t.uid); done.push(t.uid);
  }
  const t2 = await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => s.suspended), '다음 액티브 페이즈에 액티브가 되지 않을 레스트 상태의 상대 디지몬 선택', 'other');
  if (t2) S.setSkipNextUnsuspend(state, ctx.opp, t2.uid);
});

// ================================================================== BT12-041 (진화 시): 이 디지몬의 진화원 2장마다 이하의 효과
sc('BT12-041::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  const k = Math.floor(st.sources.length / 2);
  for (let i = 0; i < k; i++) {
    const t = await pickStack(ctx, ctx.opp, digs(ctx.state, ctx.opp), `DP -3000 받을 상대 디지몬 선택 (${i + 1}/${k})`, 'dpDown');
    if (t) S.modifyDP(ctx.state, ctx.opp, t.uid, -3000, 'turn');
  }
});

// ================================================================== BT12-057 (진화 시)
sc('BT12-057::진화 시', async (ctx) => {
  const { state } = ctx;
  for (const p of ['p1', 'p2']) for (const s of [...state.players[p].battle]) {
    if (isTam(s) || (isDig(s) && s.uid !== ctx.sourceStackUid)) S.restStack(state, p, s.uid);
  }
  const n = ['p1', 'p2'].reduce((a, p) => a + state.players[p].battle.filter(s => (isDig(s) || isTam(s)) && s.suspended).length, 0);
  const m = Math.floor(n / 2);
  if (m > 0) S.grantMemory(state, ctx.self, m, ctx.sourceCardId);
});

// ================================================================== BT12-064 (진화 시)
sc('BT12-064::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const cap = 5 + Math.floor((st ? st.sources.length : 0) / 2);
  const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => lvOf(s.cardId) <= cap), `《퇴화 1》할 Lv.${cap} 이하의 상대 디지몬 선택`, 'retreat');
  if (t) S.retreat(state, ctx.opp, t.uid, 1);
});

// ================================================================== BT12-111 (등장 시 / 진화 시)
js('BT12-111::등장 시', [
  { op: 'destroy', target: 'opponent', mode: 'choose' },
  fn(async (ctx) => {
    const st = me(ctx); if (!st) return;
    await placeSources(ctx, ctx.self, 'trash', (c) => c.category === 'digimon' && hasTrait(c, '바그라군'), 5, st, false, '이 디지몬의 진화원에 놓을 「바그라군」 디지몬 카드 선택 (취소 = 종료)');
  }),
]);

// ================================================================== BT12-100 (메인 옵션)
js('BT12-100::메인', [
  { op: 'destroy', target: 'opponent', mode: 'choose' },
  fn(async (ctx) => {
    const { state } = ctx;
    const t = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => nameIs(C(s.cardId), '샤우트몬X7: 슈페리올 모드')), '액티브로 하고 어택할 「샤우트몬X7: 슈페리올 모드」 선택');
    if (!t) return;
    S.unsuspendStack(state, ctx.self, t.uid);
    if (await ask(ctx, `${C(t.cardId).nameKo}(으)로 플레이어에게 어택할까요?`) && ctx.startAttack) ctx.startAttack(ctx.self, t.uid, 'PLAYER');
  }),
]);

// ================================================================== BT12-104 (메인 옵션)
js('BT12-104::메인', [
  { op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: ['최건우'] }, rested: false, noTriggers: false, optional: true },
  fn(async (ctx) => {
    const { state } = ctx;
    const k = tams(state, ctx.self).filter(s => hasColor(s, 'yellow') || hasColor(s, 'red')).length;
    if (k <= 0) return;
    const done = [];
    for (let i = 0; i < 3; i++) {
      const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => !done.includes(s.uid)), `DP ${-2000 * k} 받을 상대 디지몬 선택 (${i + 1}/3)`, 'dpDown');
      if (!t) break;
      done.push(t.uid); S.modifyDP(state, ctx.opp, t.uid, -2000 * k, 'turn');
    }
  }),
]);

// ================================================================== EX4-010 (진화 시)
const bothTrash = (state) => state.players.p1.trash.length + state.players.p2.trash.length;
js('EX4-010::진화 시', [
  { op: 'trashDeckTop', who: 'self', n: 3 },
  { op: 'trashDeckTop', who: 'opponent', n: 3 },
  fn(async (ctx, R) => { await R.runOne({ op: 'destroySum', stat: 'dp', limit: 3000 + 2000 * Math.floor(bothTrash(ctx.state) / 10) }, ctx); }),
]);
// EX4-011 (등장 시)
sc('EX4-011::등장 시', async (ctx, R) => { await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 7000 + 2000 * Math.floor(bothTrash(ctx.state) / 10) } }, ctx); });

// ================================================================== EX4-050 (소멸 시) / BT14-037 (등장 시·진화 시): 시큐리티 1장마다 DP -N
js('EX4-050::소멸 시', [
  { op: 'recoverTop', who: 'self' },
  fn(async (ctx) => { await dpPerCount(ctx, -4000, ctx.state.players[ctx.self].security.length); }),
]);
js('BT14-037::등장 시', [
  { op: 'condition', if: { securityLE: 5 }, then: [{ op: 'recoverTop', who: 'self' }], else: [] },
  fn(async (ctx) => { await dpPerCount(ctx, -1000, ctx.state.players[ctx.self].security.length); }),
]);

// ================================================================== EX4-058 (소멸 시)
sc('EX4-058::소멸 시', async (ctx, R) => {
  const { state } = ctx, o = ctx.opp, ol = state.players[o];
  if (ol.hand.length >= 8) {
    const idxs = await ctx.choose('pickFromHandIndexes', { player: o, eligibleIdxs: ol.hand.map((id, i) => i), n: 1, prompt: '파기할 패 1장 선택' });
    for (const i of [...(idxs || [])].sort((a, b) => b - a)) S.trashFromHand(state, o, i);
  }
  if (ol.hand.length <= 7) await R.runOne({ op: 'securityTopToHand', who: 'opponent', n: 1 }, ctx);
});

// ================================================================== EX4-074 (어택 종료 시)
js('EX4-074::어택 종료 시', [
  { op: 'destroy', target: 'self', mode: 'thisStack' },
  { op: 'destroy', target: 'opponent', mode: 'choose' },
  { op: 'recoverTop', who: 'self' },
  { op: 'condition', if: { hasTamer: true }, then: [{ op: 'hatch', who: 'self' }], else: [] },
]);

// ================================================================== EX4-068 (메인 옵션): 자신의 디지몬의 색 1색마다 발휘하는 횟수 +1
sc('EX4-068::메인', async (ctx) => {
  const colors = new Set(digs(ctx.state, ctx.self).flatMap(s => S.stackColors(s)));
  const times = 1 + colors.size;
  for (let i = 0; i < times; i++) {
    const t = await pickStack(ctx, ctx.opp, digs(ctx.state, ctx.opp), `DP -6000 받을 상대 디지몬 선택 (${i + 1}/${times})`, 'dpDown');
    if (t) S.modifyDP(ctx.state, ctx.opp, t.uid, -6000, 'turn');
  }
});

// ================================================================== BT13-035 / BT13-064 (소멸 시): 체스몬 Lv.3 이하 무료 등장 (트래시에 체스몬 8장 이상이면 Lv. 상한 +2)
const chessPlay = (ownTurn) => async (ctx, R) => {
  const { state } = ctx;
  if ((state.activePlayer === ctx.self) !== ownTurn) return;
  const n = state.players[ctx.self].trash.filter(id => C(id).category === 'digimon' && nameHas(C(id), '체스몬')).length;
  const cap = 3 + (n >= 8 ? 2 : 0);
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', nameAny: ['체스몬'], levelMax: cap }, rested: false, noTriggers: false, optional: true }, ctx);
};
sc('BT13-035::소멸 시', chessPlay(true));
sc('BT13-064::소멸 시', chessPlay(false));

// ================================================================== BT13-046 (등장 시 / 진화 시)
sc('BT13-046::등장 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (state.players.p1.security.length + state.players.p2.security.length > 6) return;
  S.grantMemory(state, ctx.self, 3, ctx.sourceCardId);
  if (!pl.hand.length) return;
  const idxs = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: pl.hand.map((id, i) => i), n: 1, prompt: '오픈할 패 1장 선택' });
  const i = (idxs || [])[0];
  if (i == null) return;
  const id = pl.hand[i];
  S.log(state, `${ctx.self} 패의 ${C(id).nameKo} 오픈`);
  if ((C(id).colors || []).includes('yellow')) { pl.hand.splice(i, 1); S.addToSecurity(state, ctx.self, id, 'top'); }
  // 옐로인 카드 이외라면 패로 되돌린다: (it never left the hand)
});
SCRIPTS['BT13-046::진화 시'] = SCRIPTS['BT13-046::등장 시'];

// ================================================================== BT13-048 / BT13-051 (상속 · 자신의 턴): 조건을 만족하거나 「로얄 나이츠」를 가진 이 디지몬 DP +2000
for (const id of ['BT13-048', 'BT13-051']) {
  hk(id, { tag: '자신의 턴', src: 'inheritedKo', has: '「로얄 나이츠」를 가진 이 디지몬', dp: (state, hp, h, t, tp) => (t === h && tp === hp && (beastTrait(C(t.cardId)) || hasTrait(C(t.cardId), '로얄 나이츠')) ? 2000 : 0) });
  SCRIPTS[`${id}::자신의 턴`] = NOOP_CONT;
}

// ================================================================== BT13-072 (진화 시)
sc('BT13-072::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  const r = await revealPick(ctx, ctx.self, 3, (c) => hasTrait(c, 'X항체'), 1, '이 디지몬의 진화원 아래에 놓을 「X항체」 카드 선택');
  for (const id of r.chosen) putSource(state, st, id, true);
  state.players[ctx.self].trash.push(...r.rest);
  if (r.chosen.length) { (st.s1 ||= {}).noNegDP = oppEnd(state, ctx.self); S.log(state, `${C(st.cardId).nameKo}: 상대의 턴 종료까지 DP가 마이너스되지 않음`); }
});

// ================================================================== BT13-107 (메인 옵션)
sc('BT13-107::메인', async (ctx, R) => {
  const { state } = ctx;
  const mine = await pickStack(ctx, ctx.self, digs(state, ctx.self), 'DP 기준이 될 자신의 디지몬 선택');
  if (mine) {
    const dp = S.effectiveDP(state, ctx.self, mine);
    await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { suspended: true, dpMax: dp } }, ctx);
  }
  const dup = digs(state, ctx.self).filter(s => nameIs(C(s.cardId), '두프트몬: 레오파드 모드') && s.sources.length);
  const d = await pickStack(ctx, ctx.self, dup, '겹쳐진 카드를 위에서부터 1장 패로 되돌릴 「두프트몬: 레오파드 모드」 선택 (취소 = 안 함)');
  if (!d) return;
  const id = d.sources.pop(); state.players[ctx.self].hand.push(id); S.recomputeStackGrants(d);
  S.log(state, `${ctx.self} ${C(d.cardId).nameKo}의 진화원 ${C(id).nameKo}을(를) 패로`);
  for (const s of digs(state, ctx.self)) S.unsuspendStack(state, ctx.self, s.uid);
});

// ================================================================== BT13-109 (메인 옵션)
js('BT13-109::메인', [
  { op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMin: 6 } },
  fn(async (ctx) => { await evolveInto(ctx, { stacks: digs(ctx.state, ctx.self), zone: 'trash', pred: (c) => nameIs(c, '벨페몬: 슬립 모드'), cost: { mode: 'free' }, prompt: '진화할 트래시의 「벨페몬: 슬립 모드」 선택' }); }),
]);

// ================================================================== BT13-110 (메인 옵션)
js('BT13-110::메인', [
  { op: 'draw', who: 'self', n: 1 },
  fn(async (ctx) => {
    const { state } = ctx, pl = state.players[ctx.self];
    const r = pl.raising;
    if (r && nameIs(C(r.cardId), '위그드라실_7D6')) await placeSources(ctx, ctx.self, 'hand', (c) => c.category === 'digimon', 1, r, true, '육성 에어리어 「위그드라실_7D6」의 진화원 아래에 놓을 패의 디지몬 카드 선택 (취소 = 안 함)');
  }),
  { op: 'placeThisInBattle' },
]);

// ================================================================== RB1-014 (진화 시)
sc('RB1-014::진화 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  let k = 0;
  for (let i = 0; i < 2; i++) {
    const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => (c.colors || []).includes('blue'), `파기할 블루 카드 선택 (${i + 1}/2, 취소 = 종료)`);
    if (idx == null) break;
    S.trashFromHand(state, ctx.self, idx); k++;
  }
  for (let i = 0; i < k; i++) {
    const t = await pickStack(ctx, ctx.opp, [...digs(state, ctx.opp), ...tams(state, ctx.opp)].filter(s => s.sources.length), '아래 카드를 1장 파기할 상대 디지몬/테이머 선택 (취소 = 안 함)', 'other');
    if (!t) break;
    const [j] = await S.chooseSourceIdxs(state, ctx.opp, t, 1, ctx.choose, null, '파기할 아래의 카드 선택');
    if (j != null) S.trashEvoSources(state, ctx.opp, t.uid, 1, 'bottom', [j]);
  }
  const t2 = await pickStack(ctx, ctx.opp, [...digs(state, ctx.opp), ...tams(state, ctx.opp)].filter(s => !s.sources.length), '레스트할 수 없게 될 아래에 카드가 없는 상대 디지몬/테이머 선택', 'other');
  if (t2) S.preventRest(state, ctx.opp, t2.uid, oppEnd(state, ctx.self));
});

// ================================================================== ST15-15 (메인 옵션)
js('ST15-15::메인', [
  { op: 'unsuspend', target: 'self', digimonOnly: true },
  fn(async (ctx) => {
    const t = await pickStack(ctx, ctx.self, digs(ctx.state, ctx.self).filter(s => nameHas(C(s.cardId), '그레이몬')), '상대의 디지몬의 효과를 받지 않게 될 「그레이몬」 포함 자신의 디지몬 선택');
    if (t) S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['all'], until: oppEnd(ctx.state, ctx.self), fromCategory: 'digimon' });
  }),
]);

// ================================================================== BT14-020 (자신의 메인 페이즈 개시 시)
js('BT14-020::자신의 메인 페이즈 개시 시', [
  { op: 'trashEvoSources', target: 'opponent', stacks: 1, count: 1, from: 'bottom' },
  fn(async (ctx) => { const st = me(ctx); if (st) (st.s1 ||= {}).unblockable = ctx.state.turnNumber; }),
]);

// ================================================================== BT14-032 (등장 시)
js('BT14-032::등장 시', [
  { op: 'securityTopToHand', who: 'self', n: 1 },
  fn(async (ctx) => {
    const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => nameHas(c, '스카몬'), '시큐리티 위에 놓을 「스카몬」 포함 카드 선택 (취소 = 안 함)');
    if (idx == null) return;
    S.addToSecurity(ctx.state, ctx.self, takeFrom(ctx.state.players[ctx.self].hand, idx), 'top');
  }),
]);

// ================================================================== BT14-033 / BT14-093 / BT16-024 / BT15-092: 시큐리티를 전부 확인하고 그중에서 진화/등장
const shuffleSec = (state, p) => { const sec = state.players[p].security; for (let i = sec.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sec[i], sec[j]] = [sec[j], sec[i]]; } if (state.players[p].secUp) state.players[p].secUp = {}; };
const lookSec = (ctx) => S.log(ctx.state, `${ctx.self} 시큐리티 확인: ${ctx.state.players[ctx.self].security.map(id => C(id).nameKo).join(', ') || '(없음)'}`);
const shuffleSecOp = { op: 'shuffleSecurity', who: 'self' };
sc('BT14-033::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  lookSec(ctx);
  let evolved = null;
  if (st && isDig(st) && await ask(ctx, '시큐리티에서 「백신종」 옐로 디지몬 카드로 코스트 없이 진화할까요?')) evolved = await evolveInto(ctx, { stacks: [st], zone: 'security', pred: (c) => hasTrait(c, '백신종') && (c.colors || []).includes('yellow'), cost: { mode: 'free' } });
  shuffleSec(state, ctx.self);
  if (evolved) {
    const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => hasTrait(c, '백신종') && (c.colors || []).includes('yellow'), '시큐리티 아래에 놓을 「백신종」 옐로 카드 선택 (취소 = 안 함)');
    if (idx != null) S.addToSecurity(state, ctx.self, takeFrom(state.players[ctx.self].hand, idx), 'bottom');
  }
});
sc('BT14-093::메인', async (ctx) => {
  const { state } = ctx;
  lookSec(ctx);
  const evolved = await evolveInto(ctx, { stacks: digs(state, ctx.self), zone: 'security', pred: (c) => hasTrait(c, '백신종') && (c.colors || []).includes('yellow') && lvOf(c.id) <= 6, cost: { mode: 'free' } });
  shuffleSec(state, ctx.self);
  if (evolved && tams(state, ctx.self).some(t => nameHas(C(t.cardId), '리키'))) S.recoverTopOfDeckToSecurity(state, ctx.self);
});
sc('BT16-024::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (state.activePlayer !== ctx.self) return;
  lookSec(ctx);
  let evolved = null;
  if (st && isDig(st) && await ask(ctx, '시큐리티에서 「천사형」/「3대천사」 디지몬 카드로 진화 코스트 -2 하여 진화할까요?')) evolved = await evolveInto(ctx, { stacks: [st], zone: 'security', pred: (c) => hasTrait(c, '천사형', '3대천사'), cost: { mode: 'discount', n: 2 } });
  shuffleSec(state, ctx.self);
  if (evolved) {
    const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => c.category === 'digimon' && hasTrait(c, '천사형', '대천사형', '3대천사'), '시큐리티 아래에 놓을 「천사형」/「대천사형」/「3대천사」 디지몬 카드 선택 (취소 = 안 함)');
    if (idx != null) S.addToSecurity(state, ctx.self, takeFrom(state.players[ctx.self].hand, idx), 'bottom');
  }
});
SCRIPTS['BT16-024::진화 시'] = SCRIPTS['BT16-024::등장 시'];
sc('BT15-092::메인', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  lookSec(ctx);
  const idxs = pl.security.map((id, i) => i).filter(i => C(pl.security[i]).category === 'digimon' && (C(pl.security[i]).colors || []).includes('yellow') && lvOf(pl.security[i]) <= 4);
  const idx = await pickFromList(ctx, ctx.self, pl.security.slice(), idxs, '코스트 없이 등장시킬 시큐리티의 옐로 Lv.4 이하 디지몬 카드 선택 (취소 = 안 함)');
  if (idx != null) {
    const id = takeFrom(pl.security, idx); S.secFaceUpTake(pl, id);
    pl.hand.push(id);
    const st = S.playFreeFromZone(state, ctx.self, 'hand', pl.hand.length - 1, {});
    if (!st) { pl.hand.pop(); pl.security.splice(idx, 0, id); }
  }
  shuffleSec(state, ctx.self);
  if (tams(state, ctx.self).some(t => nameHas(C(t.cardId), '신나리'))) {
    const ti = optionInTrash(ctx);
    if (ti !== -1) { takeFrom(pl.trash, ti); S.addToSecurity(state, ctx.self, ctx.sourceCardId, 'top'); }
  }
});

// ================================================================== BT14-065 (등장 시 / 진화 시)
sc('BT14-065::등장 시', async (ctx) => {
  const { state } = ctx;
  const ol = state.players[ctx.opp];
  const revealed = ol.deck.splice(0, 3);
  S.log(state, `${ctx.opp} 덱 위 ${revealed.length}장 공개: ${revealed.map(id => C(id).nameKo).join(', ')}`);
  const k = revealed.filter(id => C(id).category === 'digimon').length;
  if (k > 0) {
    const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp), `《퇴화 ${k}》할 상대 디지몬 선택`, 'retreat');
    if (t) S.retreat(state, ctx.opp, t.uid, k);
  }
  await returnTopOrBottom(ctx, ctx.opp, revealed);
});
SCRIPTS['BT14-065::진화 시'] = SCRIPTS['BT14-065::등장 시'];

// ================================================================== BT14-078 (소멸 시)
sc('BT14-078::소멸 시', async (ctx) => {
  const { state } = ctx;
  let k = 0;
  for (let i = 0; i < 3; i++) {
    const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => hasTrait(c, '마수형', 'SoC'), `파기할 「마수형」/「SoC」 카드 선택 (${i + 1}/3, 취소 = 종료)`);
    if (idx == null) break;
    S.trashFromHand(state, ctx.self, idx); k++;
  }
  const cap = 3 + k;
  await destroyOppWhere(ctx, (s) => lvOf(s.cardId) <= cap, `소멸시킬 Lv.${cap} 이하의 상대 디지몬 선택`);
});

// ================================================================== BT14-079 / BT14-081 (진화 시) / BT14-081 (어택 시)
const hasEiji = (st) => srcNamed(st, '나가스미 에이지');
sc('BT14-079::진화 시', async (ctx, R) => {
  const st = me(ctx);
  const cap = 3 + (st && hasEiji(st) ? 1 : 0);
  await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['마수형', 'SoC'], levelMax: cap }, rested: false, noTriggers: false, optional: true }, ctx);
});
sc('BT14-081::진화 시', async (ctx, R) => {
  const st = me(ctx);
  const n = 1 + (st && hasEiji(st) ? 2 : 0);
  for (let i = 0; i < n; i++) await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['마수형', 'SoC'], levelMax: 4 }, rested: false, noTriggers: false, optional: true }, ctx);
});
sc('BT14-081::어택 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const cap = 3 + digs(state, ctx.self).length;
  const cands = digs(state, ctx.opp).filter(s => lvOf(s.cardId) <= cap);
  if (!cands.length || !(await ask(ctx, `Lv.${cap} 이하의 상대 디지몬 1마리를 소멸시켜 이 디지몬을 액티브로 할까요?`))) return;
  if (await destroyOppWhere(ctx, (s) => lvOf(s.cardId) <= cap, `소멸시킬 Lv.${cap} 이하의 상대 디지몬 선택`) && st) S.unsuspendStack(state, ctx.self, st.uid);
});

// ================================================================== BT14-091 (메인 옵션)
js('BT14-091::메인', [
  { op: 'trashEvoSources', target: 'opponent', count: 2 },
  fn(async (ctx) => {
    const { state } = ctx;
    if (!tams(state, ctx.self).some(t => nameHas(C(t.cardId), '정석'))) return;
    const d = await pickStack(ctx, ctx.self, digs(state, ctx.self), '선택할 자신의 디지몬');
    if (!d) return;
    if (!digs(state, ctx.opp).some(s => s.sources.length >= d.sources.length)) S.unsuspendStack(state, ctx.self, d.uid);
  }),
]);

// ================================================================== P-114 (서로의 턴): 다른 디지몬이 효과로 등장했을 때 …
sc('P-114::서로의 턴', async (ctx) => {
  const { state } = ctx;
  const cap = 3 + 2 * digs(state, ctx.self).filter(s => nameIs(C(s.cardId), '디아블로몬')).length;
  const cands = digs(state, ctx.opp).filter(s => (C(s.cardId).cost || 0) <= cap);
  if (!cands.length || !(await ask(ctx, `등장 코스트 ${cap} 이하의 상대 디지몬 1마리를 소멸시킬까요?`))) return;
  await destroyOppWhere(ctx, (s) => (C(s.cardId).cost || 0) <= cap, `소멸시킬 등장 코스트 ${cap} 이하의 상대 디지몬 선택`);
});

// ================================================================== EX5-025 (진화 시 / 어택 시)
sc('EX5-025::진화 시', async (ctx) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  const k = st.sources.length;
  const t = k ? await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => s.sources.length), '진화원을 파기할 상대 디지몬 선택', 'other') : null;
  if (t) {
    const n = Math.min(k, t.sources.length);
    const idxs = await S.chooseSourceIdxs(state, ctx.opp, t, n, ctx.choose, null, `파기할 진화원 ${n}장 선택`);
    S.trashEvoSources(state, ctx.opp, t.uid, n, 'bottom', idxs);
  }
  for (const s of digs(state, ctx.opp).filter(x => !x.sources.length)) S.preventRest(state, ctx.opp, s.uid, oppEnd(state, ctx.self));
});
SCRIPTS['EX5-025::어택 시'] = SCRIPTS['EX5-025::진화 시'];

// ================================================================== EX5-059 / EX5-061 (진화 시)
const loot = (pred) => async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
  await R.runOne({ op: 'trashHand', who: 'self', n: 1 }, ctx);
  if (st && pred(st)) await runTagOf(ctx, R, st, '등장 시');
};
sc('EX5-059::진화 시', loot((st) => srcNamed(st, '도베르몬', 'X항체')));
sc('EX5-061::진화 시', loot((st) => st.sources.some(id => C(id).category === 'digimon' && nameHas(C(id), '케르베로스몬')) || srcNamed(st, 'X항체')));

// ================================================================== EX5-069 / BT15-098 (서로의 턴 옵션의 《딜레이》)
const delayEvent = (id, tagText, eventPred, then) => {
  hk(id, { tag: '서로의 턴', has: tagText, events: eventPred });
  sc(`${id}::서로의 턴`, async (ctx) => {
    const { state } = ctx, pl = state.players[ctx.self];
    const st = me(ctx);
    if (!st || C(st.cardId).category !== 'option' || !pl.battle.includes(st)) return;
    if (!(await ask(ctx, `${C(st.cardId).nameKo}: 《딜레이》 — 이 카드를 파기하고 효과를 발휘할까요?`))) return;
    S.discardForDelay(state, ctx.self, st.uid);
    await then(ctx);
  });
};
delayEvent('EX5-069', '상대의 디지몬이 효과로 등장했을 때', { play: (state, hp, h, info) => info.owner !== hp && (info.cause === 'effect' || info.cause === 'ownEffect') && isDig(info.stack) && isOptionHolder(h) }, async (ctx) => {
  await (await import('../effects.js')).runScript([{ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['리바이어몬'] }, rested: false, noTriggers: false, optional: true }], ctx);
});
delayEvent('BT15-098', '자신의 「묘티스몬」이 소멸했을 때', { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && nameIs(C(info.stack.cardId), '묘티스몬') && isOptionHolder(h) }, async (ctx) => {
  await (await import('../effects.js')).runScript([{ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['베놈묘티스몬'] }, rested: false, noTriggers: false, optional: true }], ctx);
});
function isOptionHolder(h) { return !!h && C(h.cardId).category === 'option'; }

// ================================================================== EX5-070 (메인 옵션)
sc('EX5-070::메인', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const r = await evolveInto(ctx, { stacks: digs(state, ctx.self).filter(s => !srcNamed(s, 'X항체')), zone: 'hand', pred: (c) => hasTrait(c, 'X항체'), cost: { mode: 'discount', n: 1 }, prompt: '진화할 패의 「X항체」 디지몬 카드 선택' });
  if (!r) return;
  const ti = optionInTrash(ctx);
  if (ti !== -1) { putSource(state, r, takeFrom(pl.trash, ti), true); S.log(state, `${ctx.self} ${C(ctx.sourceCardId).nameKo}을(를) ${C(r.cardId).nameKo}의 진화원 아래에 놓음`); }
});

// ================================================================== P-097 (등장 시)
sc('P-097::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (!st) return;
  const target = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => s.uid !== st.uid), '이 디지몬을 진화원 아래에 놓을 다른 자신의 디지몬 선택 (취소 = 안 함)');
  if (!target || !moveStackUnder(state, ctx.self, st, target)) return;
  const pl = state.players[ctx.self];
  const revealed = pl.deck.splice(0, 3);
  S.log(state, `${ctx.self} 덱 위 ${revealed.length}장 공개: ${revealed.map(id => C(id).nameKo).join(', ')}`);
  await returnTopOrBottom(ctx, ctx.self, revealed);
  if (digs(state, ctx.self).some(s => hasTrait(C(s.cardId), 'Legend-Arms'))) S.grantMemory(state, ctx.self, 2, ctx.sourceCardId);
});

// ================================================================== P-123 / BT16-082 웃코몬 (자신의 턴): 육성 에어리어에서 배틀 에어리어로 이동했을 때
const onOwnMove = { move: (state, hp, h, info) => info.owner === hp && isDig(info.stack) };
hk('P-123', { tag: '자신의 턴', has: '육성 에어리어에서 배틀 에어리어로', limit: 1, events: onOwnMove });
sc('P-123::자신의 턴', async (ctx) => {
  const { state } = ctx;
  if (!state.players[ctx.self].raising && state.players[ctx.self].digitamaDeck.length && await ask(ctx, '자신의 육성 에어리어에 부화시킬까요?')) S.s7HatchByEffect(state, ctx.self);
  S.grantMemory(state, ctx.self, 1, ctx.sourceCardId);
});
hk('BT16-082', { tag: '자신의 턴', has: '육성 에어리어에서 배틀 에어리어로', limit: 1, events: onOwnMove });
sc('BT16-082::자신의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const r = await revealPick(ctx, ctx.self, 3, (c) => c.category === 'digimon' || c.category === 'tamer', 1, '패에 추가할 디지몬/테이머 카드 선택');
  pl.hand.push(...r.chosen); pl.deck.push(...r.rest);
  if (!pl.raising && pl.digitamaDeck.length && await ask(ctx, '자신의 육성 에어리어에 부화시킬까요?')) S.s7HatchByEffect(state, ctx.self);
});

// ================================================================== BT15-024 (진화 시)
sc('BT15-024::진화 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const hasM = () => tams(state, ctx.self).some(t => nameHas(C(t.cardId), '매튜'));
  if (hasM()) S.drawCards(state, ctx.self, 1);
  if (hasM()) return;
  const idx = await pickIdx(ctx, ctx.self, 'hand', (c) => c.category === 'tamer' && nameHas(c, '매튜') && S.canPayCost(state, Math.max(0, (c.cost || 0) - 3)), '등장 코스트 -3 하여 등장시킬 「매튜」 포함 테이머 카드 선택 (취소 = 안 함)');
  if (idx == null) return;
  const cost = Math.max(0, (C(pl.hand[idx]).cost || 0) - 3);
  if (cost > 0) S.spendMemory(state, cost);
  S.playDigimonFresh(state, ctx.self, idx, { byEffect: true });
});

// ================================================================== BT15-041 (상대의 턴 종료 시)
sc('BT15-041::상대의 턴 종료 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  if (!st || !(await ask(ctx, '이 디지몬을 소멸시켜 패에서 「로제몬」/「할배몬」 1장을 코스트 없이 등장시킬까요?'))) return;
  const pl = state.players[ctx.self];
  if (!pl.hand.some(id => nameIs(C(id), '로제몬') || nameIs(C(id), '할배몬'))) { S.log(state, `${ctx.self} 등장시킬 「로제몬」/「할배몬」이 패에 없음`); return; }
  del(ctx, ctx.self, st);
  ctx._lastPick = null;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: ['로제몬', '할배몬'] }, rested: false, noTriggers: false, optional: true }, ctx);
  const played = ctx._lastPick ? stackOf(state, ctx.self, ctx._lastPick.uid) : null;
  if (played) await runTagOf(ctx, R, played, '진화 시');
});

// ================================================================== BT15-049 (등장 시 / 진화 시)
sc('BT15-049::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), 'DP +3000 받을 자신의 디지몬 선택');
  if (t) S.modifyDP(state, ctx.self, t.uid, 3000, 'opponentTurn');
  const pa = ctx.attack ? ctx.attack() : null;
  if (st && pa && pa.attacker !== ctx.self && await ask(ctx, '어택의 대상을 이 디지몬으로 변경할까요?')) redirectAttackTo(ctx, st.uid);
});
SCRIPTS['BT15-049::진화 시'] = SCRIPTS['BT15-049::등장 시'];

// ================================================================== BT15-078 (어택 시)
sc('BT15-078::어택 시', async (ctx) => {
  const { state } = ctx, o = ctx.opp, ol = state.players[o];
  const idx = await pickIdx(ctx, o, 'trash', (c) => c.category === 'digimon' && lvOf(c.id) <= 4, '코스트 없이 레스트 상태로 등장시킬 트래시의 Lv.4 이하 디지몬 카드 선택');
  if (idx == null) return;
  const st = S.playFreeFromZone(state, o, 'trash', idx, { rested: true, noTriggers: true });
  if (st && await ask(ctx, '어택의 대상을 그 디지몬으로 변경할까요?')) redirectAttackTo(ctx, st.uid);
});

// ================================================================== BT15-082 한소라 (서로의 턴): 자신의 트래시에서 레드인 디지몬 카드가 패로 되돌아갔을 때
hk('BT15-082', { tag: '서로의 턴', has: '패로 되돌아갔을 때', events: { trashToHand: (state, hp, h, info) => info.owner === hp && isTam(h) && !!info.cardId && C(info.cardId).category === 'digimon' && (C(info.cardId).colors || []).includes('red') } });
sc('BT15-082::서로의 턴', async (ctx, R) => {
  const { state } = ctx, st = me(ctx);
  if (!st || !isTam(st)) return;
  const cap = 13000 - 2000 * state.players[ctx.opp].security.length;
  const pl = state.players[ctx.self];
  const has = pl.hand.some(id => C(id).category === 'digimon' && (C(id).colors || []).includes('red') && (C(id).dp || 0) <= cap && beastTrait(C(id)));
  if (!has || !(await ask(ctx, `이 테이머를 패로 되돌려 패에서 DP ${cap} 이하의 레드 「조」/「새」/「병아리」/「수」/「짐승」 디지몬 1장을 코스트 없이 등장시킬까요?`))) return;
  const idx = pl.battle.indexOf(st);
  if (idx === -1) return;
  pl.battle.splice(idx, 1); pl.hand.push(st.cardId); pl.trash.push(...st.sources);
  S.log(state, `${ctx.self} ${C(st.cardId).nameKo}을(를) 패로 되돌림`);
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', colors: ['red'], dpMax: cap, traitIncludes: ['조', '새', '병아리', '수', '짐승'] }, rested: false, noTriggers: false, optional: true }, ctx);
});

// ================================================================== BT15-094 (메인 옵션)
sc('BT15-094::메인', async (ctx) => {
  const { state } = ctx;
  const all = [...digs(state, ctx.self).map(s => ({ p: ctx.self, s })), ...digs(state, ctx.opp).map(s => ({ p: ctx.opp, s }))].filter(x => lvOf(x.s.cardId) <= 6);
  if (all.length) {
    const r = await ctx.choose('pickStackAnySide', { entries: all.map(x => ({ player: x.p, uid: x.s.uid })), prompt: '레스트시킬 Lv.6 이하의 디지몬 선택' });
    if (r) S.restStack(state, r.player, r.uid);
  }
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self).filter(s => hasTrait(C(s.cardId), '곤충형')), 'DP +3000 받을 「곤충형」 자신의 디지몬 선택');
  if (t) S.modifyDP(state, ctx.self, t.uid, 3000, 'opponentTurn');
});

// ================================================================== LM-001 / LM-017 (등장 시 / 진화 시): 「감마몬」이 기술되어 있는 카드를 진화원 아래에
sc('LM-001::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (st) await placeSources(ctx, ctx.self, 'hand', (c) => S.cardMentions(c, '감마몬'), 1, st, true, '이 디지몬의 진화원 아래에 놓을 「감마몬」이 기술된 카드 선택 (취소 = 안 함)');
  const colors = new Set(st ? st.sources.flatMap(id => C(id).colors || []) : []);
  const cap = 8000 + 1000 * colors.size;
  await destroyOppWhere(ctx, (s) => S.effectiveDP(state, ctx.opp, s) <= cap, `소멸시킬 DP ${cap} 이하의 상대 디지몬 선택`);
});
SCRIPTS['LM-001::진화 시'] = SCRIPTS['LM-001::등장 시'];
js('LM-017::등장 시', [
  { op: 'trashHand', who: 'self', n: 1 },
  fn(async (ctx) => { const st = me(ctx); if (st) await placeSources(ctx, ctx.self, 'trash', (c) => S.cardMentions(c, '감마몬'), 1, st, true, '이 디지몬의 진화원 아래에 놓을 트래시의 「감마몬」이 기술된 카드 선택 (취소 = 안 함)'); }),
]);
SCRIPTS['LM-017::진화 시'] = SCRIPTS['LM-017::등장 시'];

// ================================================================== LM-020 (상대의 턴 개시 시)
sc('LM-020::상대의 턴 개시 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const cats = ['digimon', 'tamer', 'option'], labels = ['디지몬', '테이머', '옵션'];
  const k = await ctx.choose('multipleChoice', { prompt: '카드 카테고리 1개를 선언', options: labels });
  const cat = cats[k ?? 0] || 'digimon';
  const ol = state.players[ctx.opp];
  const top = ol.deck[0];
  if (top == null) return;
  S.log(state, `${ctx.self} 카테고리 「${labels[cats.indexOf(cat)]}」 선언 — 상대 덱 위 카드 오픈: ${C(top).nameKo}`);
  if (C(top).category === cat && st) S.grantShield(state, ctx.self, st.uid, { kinds: ['all'], until: state.turnNumber, fromCategory: cat });
  const r = await ctx.choose('multipleChoice', { prompt: `${C(top).nameKo}: 상대의 덱 위 / 덱 아래로 되돌린다`, options: ['덱 위', '덱 아래'] });
  if (r === 1) { ol.deck.shift(); ol.deck.push(top); }
});

// ================================================================== P-078 (등장 시)
sc('P-078::등장 시', async (ctx) => {
  const { state } = ctx, ol = state.players[ctx.opp];
  const top = ol.security[0];
  if (top == null) return;
  S.log(state, `${ctx.self} 상대의 시큐리티 위에서 1장 오픈: ${C(top).nameKo}`);
  if (C(top).category === 'digimon') S.drawCards(state, ctx.self, 1);
});

// ================================================================== BT16-044 (등장 시 / 진화 시)
sc('BT16-044::등장 시', async (ctx, R) => {
  const { state } = ctx;
  if (state.players[ctx.self].security.length >= 3) await restOpp(ctx, (s) => isDig(s), '레스트시킬 상대 디지몬 선택 (다음 액티브 페이즈에 액티브가 되지 않음)', true);
  if (state.players[ctx.self].security.length <= 3) S.grantMemory(state, ctx.self, 2, ctx.sourceCardId);
});
SCRIPTS['BT16-044::진화 시'] = SCRIPTS['BT16-044::등장 시'];

// ================================================================== BT16-046 (등장 시 / 진화 시)
sc('BT16-046::등장 시', async (ctx) => {
  const { state } = ctx;
  const done = [];
  for (let i = 0; i < 2; i++) {
    const t = await restOpp(ctx, (s) => !done.includes(s.uid), `레스트시킬 상대 디지몬/테이머 선택 (${i + 1}/2)`, true);
    if (!t) break;
    done.push(t.uid);
  }
  const tm = await pickStack(ctx, ctx.opp, tams(state, ctx.opp).filter(s => s.suspended), '소멸시킬 레스트 상태의 상대 테이머 선택', 'delete');
  if (tm) del(ctx, ctx.opp, tm);
});
SCRIPTS['BT16-046::진화 시'] = SCRIPTS['BT16-046::등장 시'];

// ================================================================== BT16-062 (등장 시 / 진화 시)
sc('BT16-062::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const dp = st ? S.effectiveDP(state, ctx.self, st) : 0;
  const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp).filter(s => S.effectiveDP(state, ctx.opp, s) <= dp), '《퇴화 1》할 DP 이하의 상대 디지몬 선택', 'retreat');
  if (t) S.retreat(state, ctx.opp, t.uid, 1);
  const all = [...digs(state, ctx.self).map(s => ({ p: ctx.self, s })), ...digs(state, ctx.opp).map(s => ({ p: ctx.opp, s }))].filter(x => (C(x.s.cardId).cost || 0) <= 3);
  if (!all.length) return;
  const r = await ctx.choose('pickStackAnySide', { entries: all.map(x => ({ player: x.p, uid: x.s.uid })), prompt: '소멸시킬 등장 코스트 3 이하의 디지몬 선택' });
  if (r) S.deleteStack(state, r.player, r.uid, 'trash', r.player === ctx.self ? 'ownEffect' : 'effect');
});
SCRIPTS['BT16-062::진화 시'] = SCRIPTS['BT16-062::등장 시'];

// ================================================================== BT16-072 / BT16-073 (소멸 시)
const mytisTamer = async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const own = new Set(tams(state, ctx.self).map(s => C(s.cardId).nameKo));
  const idx = await pickIdx(ctx, ctx.self, 'trash', (c) => c.category === 'tamer' && S.cardMentions(c, '묘티스몬') && !own.has(c.nameKo), '코스트 없이 등장시킬 「묘티스몬」이 기술된 테이머 카드 선택 (자신의 테이머와 같은 명칭 불가, 취소 = 안 함)');
  if (idx != null) S.playFreeFromZone(state, ctx.self, 'trash', idx, {});
};
sc('BT16-072::소멸 시', mytisTamer);
sc('BT16-073::소멸 시', mytisTamer);

// ================================================================== BT16-079 (자신의 턴 종료 시)
sc('BT16-079::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  if (!st || !srcNamed(st, '케루비몬', 'X항체')) return;
  const cap = 4 + digs(state, ctx.self).filter(s => s.uid !== st.uid).length;
  if (!digs(state, ctx.opp).some(s => lvOf(s.cardId) <= cap)) return;
  if (!(await ask(ctx, `Lv.${cap} 이하의 상대 디지몬 1마리를 소멸시킬까요?`))) return;
  await destroyOppWhere(ctx, (s) => lvOf(s.cardId) <= cap, `소멸시킬 Lv.${cap} 이하의 상대 디지몬 선택`);
});

// ================================================================== BT16-081 (진화 시 / 어택 시)
sc('BT16-081::진화 시', async (ctx) => {
  const { state } = ctx;
  const own = [...digs(state, ctx.self), ...tams(state, ctx.self)];
  if (!own.length || !digs(state, ctx.opp).some(s => !s.suspended)) return;
  if (!(await ask(ctx, '자신의 디지몬/테이머 1마리(명)를 소멸시켜 액티브 상태인 상대 디지몬 1마리를 소멸시킬까요?'))) return;
  const c = await pickStack(ctx, ctx.self, own, '소멸시킬 자신의 디지몬/테이머 선택');
  if (!c) return;
  del(ctx, ctx.self, c);
  const ol = state.players[ctx.opp];
  const before = ol.battle.length;
  await destroyOppWhere(ctx, (s) => !s.suspended, '소멸시킬 액티브 상태의 상대 디지몬 선택');
  if (ol.battle.length < before) return; // 이 효과로 상대의 디지몬이 소멸했다
  const tm = await pickStack(ctx, ctx.opp, tams(state, ctx.opp), '소멸시킬 상대 테이머 선택', 'delete');
  if (tm) del(ctx, ctx.opp, tm);
});
SCRIPTS['BT16-081::어택 시'] = SCRIPTS['BT16-081::진화 시'];

// ================================================================== BT16-083 (소멸 시)
js('BT16-083::소멸 시', [
  { op: 'returnToHandStripSources', target: 'self', all: true, filter: { category: 'tamer' } },
  { op: 'returnToHandStripSources', target: 'opponent', all: true, filter: { category: 'tamer' } },
  { op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'tamer' }, rested: false, noTriggers: false, optional: true },
  { op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['웃코몬'] }, rested: false, noTriggers: false, optional: true },
]);

// ================================================================== BT16-091 / BT16-092 / BT16-097 (메인 옵션): 무료 등장 후 조그레스 진화
async function jogressAny(ctx) { // "자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할 수 있다" -> the fused stack or null
  const { state } = ctx, pl = state.players[ctx.self];
  const ds = digs(state, ctx.self);
  const combos = [];
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) for (let h = 0; h < pl.hand.length; h++) {
    const id = pl.hand[h];
    if (C(id).category !== 'digimon') continue;
    const jg = S.parseJogress(id);
    if (jg && S.canJogress(ds[i], ds[j], id).ok && S.canPayCost(state, jg.cost || 0)) combos.push({ a: ds[i], b: ds[j], id });
  }
  if (!combos.length) { S.log(state, `${ctx.self} 조그레스 진화 가능한 조합이 없음`); return null; }
  const a = await pickStack(ctx, ctx.self, [...new Map(combos.flatMap(c => [c.a, c.b]).map(s => [s.uid, s])).values()], '조그레스 진화시킬 디지몬 1 선택 (취소 = 안 함)');
  if (!a) return null;
  const partners = [...new Map(combos.filter(c => c.a === a || c.b === a).map(c => { const o = c.a === a ? c.b : c.a; return [o.uid, o]; })).values()];
  const b = await pickStack(ctx, ctx.self, partners, '조그레스 진화시킬 디지몬 2 선택');
  if (!b) return null;
  const idxs = pl.hand.map((id, i) => i).filter(i => combos.some(c => c.id === pl.hand[i] && ((c.a === a && c.b === b) || (c.a === b && c.b === a))));
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: '조그레스 진화할 패의 디지몬 카드 선택' });
  if (idx == null || !idxs.includes(idx)) return null;
  const cardId = pl.hand[idx];
  const jg = S.parseJogress(cardId);
  const snap = S.snapshotEvoCostMods(state, ctx.self);
  let cost = jg ? jg.cost : 0;
  if (jg) cost = Math.max(0, cost + S.consumeEvoCostMod(state, ctx.self, cardId) + S.continuousEvoCostDiscount(state, ctx.self, a, cardId) + S.hookEvoCostDiscount(state, ctx.self, a, cardId));
  const fused = S.fuseStacks(state, ctx.self, a.uid, b.uid, cardId, cost, 'hand');
  if (!fused) S.restoreEvoCostMods(snap);
  return fused || null;
}
const freePlayThenJogress = (names, after) => async (ctx, R) => {
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: names }, rested: false, noTriggers: false, optional: true }, ctx);
  if (!(await ask(ctx, '자신의 디지몬 2마리로 패의 디지몬 카드로 조그레스 진화할까요?'))) return;
  const fused = await jogressAny(ctx);
  if (fused) await after(ctx, fused);
};
sc('BT16-091::메인', freePlayThenJogress(['아큐라몬', '가트몬'], async (ctx, f) => {
  S.grantKeyword(ctx.state, ctx.self, f.uid, '시큐리티어택', 1, 'turn');
  if (ctx.startAttack && await ask(ctx, `${C(f.cardId).nameKo}(으)로 플레이어에게 어택할까요?`)) ctx.startAttack(ctx.self, f.uid, 'PLAYER');
}));
sc('BT16-092::메인', freePlayThenJogress(['엑스브이몬', '스팅몬'], async (ctx, f) => {
  S.grantKeyword(ctx.state, ctx.self, f.uid, '블로커', undefined, 'opponentTurn');
  S.grantBattleImmunity(ctx.state, ctx.self, f.uid);
  f.battleImmuneUntilTurn = oppEnd(ctx.state, ctx.self);
}));
sc('BT16-097::메인', freePlayThenJogress(['황금아르마몬', '엔젤몬'], async (ctx) => { S.recoverTopOfDeckToSecurity(ctx.state, ctx.self); }));

// ================================================================== BT16-093 (메인 옵션)
sc('BT16-093::메인', async (ctx) => {
  const { state } = ctx;
  const r = await evolveInto(ctx, { stacks: digs(state, ctx.self).filter(s => nameHas(C(s.cardId), '가르고몬') || nameHas(C(s.cardId), '래피드몬')), zone: 'hand', pred: (c) => nameHas(c, '래피드몬'), cost: { mode: 'free' }, ignoreCond: true, prompt: '진화할 패의 「래피드몬」 포함 카드 선택' });
  if (r) (r.s1 ||= {}).noNegDP = oppEnd(state, ctx.self);
});

// ================================================================== BT16-100 (메인 옵션)
js('BT16-100::메인', [
  { op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: 5 } },
  { op: 'condition', if: { securityLE: 2 }, then: [{ op: 'placeThisAtSecurityBottom' }], else: [] },
]);

// ================================================================== ST17-07 (등장 시 / 진화 시)
sc('ST17-07::등장 시', async (ctx) => {
  const { state } = ctx, st = me(ctx);
  const t = await pickStack(ctx, ctx.opp, digs(state, ctx.opp), '《퇴화 1》할 상대 디지몬 선택', 'retreat');
  if (t) S.retreat(state, ctx.opp, t.uid, 1);
  if (st && tams(state, ctx.self).some(x => hasColor(x, 'green'))) S.grantShield(state, ctx.self, st.uid, { kinds: ['delete', 'bounce'], until: oppEnd(state, ctx.self), fromCategory: undefined });
});
SCRIPTS['ST17-07::진화 시'] = SCRIPTS['ST17-07::등장 시'];

// ================================================================== ST17-08 (진화 시)
sc('ST17-08::진화 시', async (ctx) => {
  const { state } = ctx;
  const done = [];
  for (let i = 0; i < 2; i++) { const t = await restOpp(ctx, (s) => !done.includes(s.uid), `레스트시킬 상대 디지몬/테이머 선택 (${i + 1}/2)`, false); if (!t) break; done.push(t.uid); }
  const done2 = [];
  for (let i = 0; i < 2; i++) {
    const t = await pickStack(ctx, ctx.opp, [...digs(state, ctx.opp), ...tams(state, ctx.opp)].filter(s => !done2.includes(s.uid)), `액티브가 되지 않고 진화할 수 없게 될 상대 디지몬/테이머 선택 (${i + 1}/2)`, 'other');
    if (!t) break;
    done2.push(t.uid);
    S.setSkipNextUnsuspend(state, ctx.opp, t.uid);
    t.cannotEvolveUntil = oppEnd(state, ctx.self);
  }
});
