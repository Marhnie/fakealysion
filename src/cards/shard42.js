// Shard 42 — batch-12 verification fixes (EX9-/EX10-/EX11-/EX12- cards). See docs/verify-sets-EX9-12.md.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's42_fn', fn: f });
OPS.s42_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const HK = (id, d) => { (HOOKS[id] ||= []).push(d); };
const hasT = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const isDig = (st) => S.isDigimonLike(st);
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const mention = (id, n) => S.cardMentions(id, n);
const hasSave = (id) => `${C(id).effectKo || ''}`.includes('《세이브》');
const T = (text) => ({ op: 's42_txt', text });
OPS.s42_txt = async (i, ctx, R) => { const sc0 = R.compileToScript(i.text); if (sc0.length) await R.runScript(sc0, ctx); };
async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  if (stacks.length === 1) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
// pick one card out of an arbitrary id list (the stock zone picker via a temp zone)
async function pickFromList(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s42tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's42tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s42tmp; }
}
function syncAsk(state, prompt) { if (state._s5auto !== undefined) return state._s5auto; return S.replAsk(prompt, true); }
const evtStackUid = (ctx) => ctx.trigger?.evt?.stackUid || ctx.trigger?.evtStackUid || null;
const onSelfLinked = (state, hp, h, info) => info.stack === h && info.owner === hp;
const onOwnLinkDiscard = (state, hp, h, info) => info.owner === hp && info.stack === h;

// ---- link-card discard watchers ("이 디지몬의 링크 카드가 효과로 파기되었을 때") — the generic watcher parser has no such subject
HK('EX10-001', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { linkDiscarded: onOwnLinkDiscard } });
HK('EX10-030', { tag: '서로의 턴', has: '링크 카드가 효과로 파기되었을 때', limit: 1, events: { linkDiscarded: onOwnLinkDiscard } });
HK('EX10-043', { tag: '서로의 턴', has: '링크 카드가 효과로 파기되었을 때', limit: 1, events: { linkDiscarded: onOwnLinkDiscard } });
HK('EX10-073', { tag: '서로의 턴', has: '링크 카드가 효과로 파기되었을 때', limit: 1, events: { linkDiscarded: onOwnLinkDiscard } });
// EX10-030 inherited: 【서로의 턴】[턴 1회] 이 디지몬이 배틀 에어리어를 벗어날 때, 링크 카드 1장을 파기하는 것으로, 벗어나지 않는다.
HK('EX10-030', { tag: '서로의 턴', src: 'inheritedKo', has: '벗어나지 않는다', preventLeave: (state, hp, h, target) => {
  if (target !== h || !(h.linkCards || []).length) return false;
  const key = S.onceLimitKey('EX10-030', ['서로의 턴', '벗어나지 않는다']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return false;
  if (!syncAsk(state, '이 디지몬의 링크 카드 1장을 파기하여 배틀 에어리어를 벗어나지 않을까요?')) return false;
  S.markTurnEffectUsed(h, key);
  const [lc] = h.linkCards.splice(h.linkCards.length - 1, 1);
  state.players[hp].trash.push(lc.cardId);
  S.recomputeStackGrants(h);
  S.log(state, `${hp} ${C(h.cardId).nameKo}: 링크 카드 ${C(lc.cardId).nameKo}를 파기하여 벗어나지 않음`);
  S.emitGameEvent(state, 'linkDiscarded', { owner: hp, stack: h, cause: 'effect', cardId: lc.cardId });
  return true;
} });

// EX10-004 inherited: 명칭에 「루체몬」을 포함하는 자신의 디지몬이 육성→배틀 이동했을 때, 패 1장 파기 → 《1 드로우》, 메모리 +1
HK('EX10-004', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { move: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && C(info.stack.cardId).nameKo.includes('루체몬') } });
SCRIPTS['EX10-004::자신의 턴'] = [T('자신의 패 1장을 파기하는 것으로, 《1 드로우》, 메모리 +1.')];

// EX10-017: 링크했을 때(자신의 테이머 1명 이하) / 상대의 디지몬이 레스트 했을 때(링크 카드 파기 → 드로우, 메모리)
HK('EX10-017', { tag: '자신의 턴', has: '링크했을 때', limit: 1, events: { linked: onSelfLinked } });
SCRIPTS['EX10-017::자신의 턴'] = [T('자신의 테이머가 1명 이하라면, 자신의 패에서, 특징 「리바이어던」을 가진 테이머 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.')];
HK('EX10-017', { tag: '서로의 턴', src: 'inheritedKo', has: '레스트 했을 때', events: { rest: (state, hp, h, info) => info.owner !== hp && !!info.stack && isDig(info.stack) } });

// EX10-063 (tamer): 광물형/광석형 자신의 디지몬의 진화원이 효과로 파기되었을 때, 이 테이머를 레스트 → 메모리 +1
HK('EX10-063', { tag: '서로의 턴', has: '진화원이 효과로 파기되었을 때', events: { sourcesTrashed: (state, hp, h, info) => isTam(h) && !h.suspended && info.owner === hp && info.cause === 'effect' && !!info.stack && isDig(info.stack) && hasT(C(info.stack.cardId), '광물형', '광석형') } });

// EX10-067 (tamer): 자신의 디지몬이 《세이브》가 기술된 디지몬으로 진화했을 때 — 이 테이머를 레스트시키고, 테이머 아래의 《세이브》 디지몬 카드 1장을 그 디지몬의 진화원 아래에 놓는 것으로, 턴 종료까지 《연계》
HK('EX10-067', { tag: '자신의 턴', has: '진화했을 때', events: { digivolve: (state, hp, h, info) => isTam(h) && !h.suspended && info.owner === hp && !!info.stack && isDig(info.stack) && hasSave(info.stack.cardId) } });
sc('EX10-067::자신의 턴', async (ctx) => {
  const { state } = ctx, t = me(ctx);
  const target = findStack(state, ctx.self, evtStackUid(ctx));
  if (!t || t.suspended || !target) return;
  const fd = S.fdCount(t);
  const idxs = t.sources.map((id, i) => i).filter(i => i >= fd && C(t.sources[i]).category === 'digimon' && hasSave(t.sources[i]));
  if (!idxs.length) { S.log(state, 'EX10-067: 테이머 아래에 《세이브》가 기술된 디지몬 카드가 없음'); return; }
  const k = await pickFromList(ctx, ctx.self, t.sources, idxs, '진화원 아래에 놓을 《세이브》 디지몬 카드 선택 (테이머 아래)');
  if (k == null) return;
  S.restStack(state, ctx.self, t.uid);
  const [id] = t.sources.splice(k, 1);
  S.recomputeStackGrants(t);
  target.sources.splice(S.fdCount(target), 0, id);
  S.recomputeStackGrants(target);
  S.log(state, `${ctx.self} ${C(t.cardId).nameKo}를 레스트, 아래의 ${C(id).nameKo}를 ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
  S.grantKeyword(state, ctx.self, target.uid, '연계', undefined, 'turn');
});

// EX11-003 / EX11-004 (digitama inherited): 앞면 시큐리티 이벤트
HK('EX11-003', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { faceUpSecurityAdded: (state, hp, h, info) => info.owner === hp && hasT(C(info.cardId), '로얄 베이스') } });
HK('EX11-004', { tag: '자신의 턴', src: 'inheritedKo', limit: 1, events: { faceUpSecurityAdded: (state, hp, h, info) => info.owner !== hp, faceUpSecurityFlipped: (state, hp, h, info) => info.owner !== hp } }); // Q5789: a face-down card turned face-up also increases their face-up security
// EX11-028 inherited: 이 디지몬이 배틀에서 승리했을 때, 메모리 +1
HK('EX11-028', { tag: '자신의 턴', src: 'inheritedKo', has: '배틀에서 승리했을 때', limit: 1, events: { battleWin: (state, hp, h, info) => info.owner === hp && info.stack === h } });
// EX11-042: 이 디지몬이 링크했을 때, 등장 코스트 5 이하의 상대 디지몬 1마리를 소멸
HK('EX11-042', { tag: '자신의 턴', has: '링크했을 때', limit: 1, events: { linked: onSelfLinked } });
// EX11-018: 이 디지몬의 진화원이 효과로 늘어났을 때, 진화원 매수가 이 디지몬 이하의 상대 디지몬 1마리를 덱 아래로
HK('EX11-018', { tag: '서로의 턴', has: '진화원이 효과로 늘어났을 때', limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.stack === h && info.owner === hp } });
sc('EX11-018::서로의 턴', async (ctx, R) => {
  const h = me(ctx);
  if (!h) return;
  await R.runScript([{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { category: 'digimon', srcMax: h.sources.length }, requireSuspended: null, dest: 'deckBottom' }], ctx);
});

// ---------------------------------------------------------------- shared helpers
// evolve `stack` into a hand card (evolution condition must hold); cost = printed + delta (or free)
async function evolveFromHand(ctx, stack, pred, delta, free, prompt) {
  const { state, E } = ctx, pl = state.players[ctx.self];
  if (!stack) return null;
  const restr = S.evolveTargetRestriction(state, ctx.self, stack);
  if (restr && restr.cannotEvolve) return null;
  const ok = (id) => C(id).category === 'digimon' && pred(C(id), id) && E.canEvolveAny(stack.cardId, id, S.evoExtraArg(state, null, stack), restr).ok;
  const idxs = pl.hand.map((id, i) => i).filter(i => ok(pl.hand[i]));
  if (!idxs.length) { S.log(state, `${ctx.self} 진화시킬 수 있는 패의 카드가 없음`); return null; }
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: prompt || '진화할 카드 선택' });
  if (idx == null) return null;
  const id = pl.hand[idx];
  const chk = E.canEvolveAny(stack.cardId, id, S.evoExtraArg(state, null, stack), restr);
  const printed = chk.ok ? chk.cost : (C(id).evoNormal?.cost ?? 0);
  const cost = free ? 0 : Math.max(0, printed + ((delta || 0) < 0 && S.isEvoCostLocked(state, ctx.self) ? 0 : (delta || 0))); // QA-S6 Q6869: cost-minus lock (BT5-021 …)
  return S.digivolve(state, ctx.self, stack.uid, id, cost, 'hand') || null;
}
const nameHas = (state, p, st, n) => { const c = C(st.cardId); if (c.nameKo.includes(n)) return true; try { const i = S.effectiveInfo(state, st, p); return i.names.some(x => x.includes(n)) || (i.inclNames || []).some(x => x.includes(n)); } catch { return false; } };

// ---------------------------------------------------------------- EX12
// EX12-019 【서로의 턴】[턴 1회] 시큐리티가 줄었을 때, 이 디지몬을 액티브로 할 수 있다.
HK('EX12-019', { tag: '서로의 턴', has: '시큐리티가 줄었을 때', limit: 1, events: { securityDecrease: () => true } });
SCRIPTS['EX12-019::서로의 턴@시큐리티가 줄었을 때'] = [{ op: 'unsuspend', target: 'thisStack', optional: true }];
// EX12-033 【서로의 턴】[턴 1회] 「젤리몬」이 기술되어 있거나 특징 「DS」를 가진 자신의 디지몬이 배틀 에어리어를 벗어날 때, 자신의 트래시 3장을 덱 아래로 되돌리는 것으로, 벗어나지 않는다.
HK('EX12-033', { tag: '서로의 턴', has: '벗어나지 않는다', preventLeave: (state, hp, h, target, tp) => {
  if (tp !== hp || !isDig(target)) return false;
  if (!(mention(target.cardId, '젤리몬') || hasT(C(target.cardId), 'DS'))) return false;
  const pl = state.players[hp];
  if (pl.trash.length < 3) return false;
  const key = S.onceLimitKey('EX12-033', ['서로의 턴', '벗어나지 않는다']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return false;
  if (!syncAsk(state, `트래시 3장을 덱 아래로 되돌려 ${C(target.cardId).nameKo}이(가) 배틀 에어리어를 벗어나지 않게 할까요?`)) return false;
  S.markTurnEffectUsed(h, key);
  const moved = pl.trash.splice(pl.trash.length - 3, 3);
  pl.deck.push(...moved);
  S.log(state, `${hp} 트래시 3장을 덱 아래로 되돌려 ${C(target.cardId).nameKo}이(가) 벗어나지 않음`);
  return true;
} });
// EX12-034 【서로의 턴】[턴 1회] 자신의 디지몬이 배틀 에어리어를 벗어날 때, 자신의 패나 이 디지몬의 진화원에서 특징 「SW」 Lv.5 이하 1장을 코스트 없이 등장
HK('EX12-034', { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', limit: 1, events: { leaveBattle: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && info.stack !== h } });
// EX12-002 (digitama inherited) 특징 「SW」를 가진 다른 자신의 디지몬이 등장했을 때, 이 디지몬을 패의 특징 「SW」 디지몬 카드로 코스트 -2 하여 진화
SCRIPTS['EX12-002::자신의 턴'] = [fn(async (ctx) => { await evolveFromHand(ctx, me(ctx), (c) => hasT(c, 'SW'), -2, false, '진화할 특징 「SW」 디지몬 카드 선택 (코스트 -2)'); })];
// EX12-064 【서로의 턴】[턴 1회] 특징 「머신형」/「사이보그형」/「ME」를 가진 자신의 디지몬이 등장했을 때, 이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다.
sc('EX12-064::서로의 턴@진화 시】 효과 1개', async (ctx, R) => {
  const h = me(ctx);
  if (!h || S.evoTrigSuppressed(ctx.state, ctx.self, h)) return; // QA-S6 Q6792: 【진화 시】 suppressed
  const segs = S.parseEffectSegments(C(h.cardId).effectKo).segments.filter(s => s.tags.some(t => t.includes('진화 시')));
  if (!segs.length) return;
  if (!(await ask(ctx, '이 디지몬의 【진화 시】 효과를 발휘할까요?'))) return;
  let seg = segs[0];
  if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(s => s.body.slice(0, 40)) }); seg = segs[k == null ? 0 : k]; }
  const text = seg.body.replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
  await R.runScript(R.lookupCardSpecific(h.cardId, seg.tags, text) || R.compileToScript(text), ctx);
});
// EX12-066/067/068 (tamers): 【자신의 턴】 <조건> 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로 (레스트는 워처가 이미 처리) 아래의 효과에서 1개
for (const [id, nm, tr] of [['EX12-066', '감마몬', 'VB'], ['EX12-067', '젤리몬', 'DS'], ['EX12-068', '앙고라몬', 'NSp']]) {
  const okCard = (c, cid) => mention(cid, nm) || hasT(c, tr);
  sc(`${id}::자신의 턴`, async (ctx, R) => {
    const { state } = ctx, pl = state.players[ctx.self];
    const atk = findStack(state, ctx.self, evtStackUid(ctx));
    const canEvo = !!atk && pl.hand.some(cid => C(cid).category === 'digimon' && (C(cid).level || 0) <= 6 && okCard(C(cid), cid));
    const canOpt = pl.hand.some(cid => C(cid).category === 'option' && okCard(C(cid), cid));
    if (!canEvo && !canOpt) { S.log(state, `${id}: 발휘할 수 있는 효과가 없음`); return; }
    let k = canEvo ? 0 : 1;
    if (canEvo && canOpt) { const r = await ctx.choose('multipleChoice', { prompt: '발휘할 효과 선택', options: [`어택한 디지몬을 패의 Lv.6 이하의 「${nm}」/특징 「${tr}」 카드로 코스트 -1 하여 진화`, `패의 「${nm}」/특징 「${tr}」 옵션 카드를 코스트 -2로 사용`] }); k = r == null ? 0 : r; }
    if (k === 0) await evolveFromHand(ctx, atk, (c, cid) => (c.level || 0) <= 6 && okCard(c, cid), -1, false, '진화할 카드 선택 (코스트 -1)');
    else await R.runScript([{ op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], pred: (cid) => okCard(C(cid), cid), delta: -2 }], ctx);
  });
}

// ---------------------------------------------------------------- EX11
// EX11-056 (tamer) 자신의 디지몬이 Lv.5+ 티라노몬/공룡형으로 진화했을 때, (레스트는 워처) 육성 에어리어를 부화할 수 있다. 그리고 육성 에어리어의 디지몬을 패의 티라노몬/파충류형/공룡형 카드로 코스트 없이 진화할 수 있다.
sc('EX11-056::서로의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  if (!pl.raising && pl.digitamaDeck.length && await ask(ctx, '육성 에어리어를 부화할까요?')) S.s7HatchByEffect(state, p);
  const r = pl.raising;
  if (!r || !['digimon', 'digitama'].includes(C(r.cardId).category)) return; // (a Lv.2 digitama-category card in the raising area is the 「디지몬」 the effect evolves)
  await evolveFromHand(ctx, r, (c) => c.nameKo.includes('티라노몬') || hasT(c, '파충류형', '공룡형'), 0, true, '육성 에어리어의 디지몬을 진화시킬 카드 선택 (코스트 없음)');
});
// EX11-059 (tamer) 특징 「NSo」 자신의 디지몬이 소멸했을 때, (레스트는 워처) 특징 「NSo」 디지몬 1장과 트래시의 특징 「NSo」 디지몬 카드 1장으로 패의 특징 「NSo」 디지몬 카드로 조그레스 진화할 수 있다.
sc('EX11-059::서로의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const nso = (id) => C(id).category === 'digimon' && hasT(C(id), 'NSo');
  const legal = (a, matId, hid) => { const j = S.parseJogress(hid); return !!j && (j.test(C(a.cardId), C(matId)) || j.test(C(matId), C(a.cardId))); };
  const stacks = digs(state, p).filter(s => nso(s.cardId));
  const hand = pl.hand.map((id, i) => i).filter(i => nso(pl.hand[i]) && S.parseJogress(pl.hand[i]));
  const tr = pl.trash.map((id, i) => i).filter(i => nso(pl.trash[i]));
  const combos = stacks.filter(a => tr.some(t => hand.some(h => legal(a, pl.trash[t], pl.hand[h]))));
  if (!combos.length) { S.log(state, 'EX11-059: 조그레스 진화할 수 있는 조합이 없음'); return; }
  const a = await pickStack(ctx, p, combos, '조그레스 진화할 자신의 「NSo」 디지몬 선택');
  if (!a) return;
  const tIdxs = tr.filter(t => hand.some(h => legal(a, pl.trash[t], pl.hand[h])));
  const ti = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: tIdxs, prompt: '재료로 사용할 트래시의 「NSo」 디지몬 카드 선택' });
  if (ti == null) return;
  const matId = pl.trash[ti];
  const hIdxs = hand.filter(h => legal(a, matId, pl.hand[h]));
  const hi = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'hand', eligibleIdxs: hIdxs, prompt: '조그레스 진화할 패의 카드 선택' });
  if (hi == null) return;
  const newId = pl.hand[hi], j = S.parseJogress(newId);
  const cost = j ? j.cost : 0;
  if (cost > 0 && !S.canPayCost(state, cost)) { S.log(state, 'EX11-059: 코스트를 지불할 수 없어 조그레스 불가'); return; }
  pl.trash.splice(ti, 1); pl.hand.splice(hi, 1);
  S._s4.discardLinkCardsOnNewCard(state, p, a);
  pl.battle.splice(pl.battle.indexOf(a), 1);
  const fused = S._s4.makeStack(newId, state.turnNumber);
  const aIsLeft = j ? (j.left(C(a.cardId)) && j.right(C(matId))) || !(j.left(C(matId)) && j.right(C(a.cardId))) : true;
  fused.sources = aIsLeft ? [matId, ...a.sources, a.cardId] : [...a.sources, a.cardId, matId];
  fused.suspended = false; fused.attackEligibleTurn = state.turnNumber; fused.viaFusion = true;
  pl.battle.push(fused);
  if (cost > 0) S.spendMemory(state, cost);
  S.log(state, `${p} 조그레스 진화: ${C(a.cardId).nameKo}+${C(matId).nameKo}(트래시) → ${C(newId).nameKo} (코스트${cost})`);
  S.drawCards(state, p, 1);
  S.recomputeStackGrants(fused);
  S._s4.ruleCheckDP(state, p, fused);
  S.queueTriggersForStack(state, p, fused, 'digivolve');
  S.emitGameEvent(state, 'digivolve', { owner: p, stack: fused, cause: 'effect' });
});

// ---------------------------------------------------------------- EX9
// EX9-012 / EX9-019 【자신의 턴】 (명칭 X 자신의 디지몬/테이머가 등장했을 때 또는 명칭 Y 디지몬으로 진화했을 때) 이 디지몬을 패의 명칭에 「Z」를 포함하는 디지몬 카드로 코스트 없이 진화시킬 수 있다.
for (const [id, playNames, evoName, intoName] of [['EX9-012', ['가루몬', '신태일'], '가루몬', '그레이몬'], ['EX9-019', ['그레이몬', '매튜'], '그레이몬', '가루몬']]) {
  HK(id, { tag: '자신의 턴', has: '또는', events: {
    play: (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack !== h && playNames.some(n => nameHas(state, hp, info.stack, n)),
    digivolve: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && nameHas(state, hp, info.stack, evoName),
  } });
  sc(`${id}::자신의 턴`, async (ctx) => { await evolveFromHand(ctx, me(ctx), (c) => c.nameKo.includes(intoName), 0, true, `진화할 명칭에 「${intoName}」를 포함하는 디지몬 카드 선택 (코스트 없음)`); });
}
// EX9-054 (inherited) 【서로의 턴】[턴 1회] 어택의 대상이 변경되었을 때, 이 디지몬이 명칭에 「아바도몬」을 포함한다면, 이 디지몬을 액티브로 한다.
HK('EX9-054', { tag: '서로의 턴', src: 'inheritedKo', limit: 1, events: { redirect: () => true } });
sc('EX9-054::서로의 턴', async (ctx) => {
  const h = me(ctx);
  if (!h || !nameHas(ctx.state, ctx.self, h, '아바도몬')) return;
  if (h.suspended) S.unsuspendStack(ctx.state, ctx.self, h.uid);
});
// EX9-067 (tamer) 자신의 디지몬이 「퍼펫형」 디지몬으로 진화했을 때, 이 테이머를 덱 아래로 되돌리는 것으로, 패의 「키노사키 아리사」 또는 특징 「퍼펫형」 디지몬 카드 1장을 코스트 -3 하여 등장
SCRIPTS['EX9-067::자신의 턴'] = [{ op: 'costGroup', cost: [{ op: 'returnToHandStripSources', thisStack: true, dest: 'deckBottom' }], then: [{ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer'], pred: (cid) => C(cid).nameKo === '키노사키 아리사' || (C(cid).category === 'digimon' && hasT(C(cid), '퍼펫형')), delta: -3 }] }];
// EX9-057 [육성]【상대의 턴】 상대의 디지몬이 어택했을 때, 자신의 트래시와 디지몬의 진화원에서 「네가몬」 합계 4장을 디지타마 덱 아래로 되돌리는 것으로, 이 디지몬을 배틀 에어리어로 이동
sc('EX9-057::상대의 턴', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p], h = me(ctx);
  if (!h || pl.raising !== h) return;
  const ents = [];
  pl.trash.forEach((id) => { if (C(id).nameKo === '네가몬') ents.push({ id, z: 'trash' }); });
  for (const st of pl.battle.filter(isDig)) st.sources.forEach((id, i) => { if (i >= S.fdCount(st) && C(id).nameKo === '네가몬') ents.push({ id, z: 'src', st, i }); });
  if (ents.length < 4) { S.log(state, 'EX9-057: 「네가몬」이 합계 4장 없음'); return; }
  if (!(await ask(ctx, '트래시/진화원의 「네가몬」 4장을 디지타마 덱 아래로 되돌려 이 디지몬을 배틀 에어리어로 이동시킬까요?'))) return;
  const picked = [];
  for (let n = 0; n < 4; n++) {
    const rest = ents.map((e, i) => i).filter(i => !picked.includes(i));
    const k = await pickFromList(ctx, p, ents.map(e => e.id), rest, `되돌릴 「네가몬」 선택 (${n + 1}/4)`);
    if (k == null) return;
    picked.push(k);
  }
  const bySrc = new Map();
  for (const k of picked.filter(k => ents[k].z === 'src')) { const e = ents[k]; if (!bySrc.has(e.st)) bySrc.set(e.st, []); bySrc.get(e.st).push(e.i); }
  for (const [st, idxs] of bySrc) { for (const i of idxs.sort((a, b) => b - a)) st.sources.splice(i, 1); S.recomputeStackGrants(st); }
  for (const k of picked.filter(k => ents[k].z === 'trash')) { const i = pl.trash.lastIndexOf(ents[k].id); if (i >= 0) pl.trash.splice(i, 1); }
  for (const k of picked) pl.digitamaDeck.push(ents[k].id);
  S.log(state, `${p} 「네가몬」 4장을 디지타마 덱 아래로 되돌림`);
  const saved = state.breedingActionTaken;
  state.breedingActionTaken = false; // an effect-move is not the once-per-breeding-phase action
  try { S.moveRaisingToBattle(state, p); } finally { state.breedingActionTaken = saved; }
});
// EX9-045 【서로의 턴】[턴 1회] 특징 「WG」 자신의 디지몬이 배틀 이외로 배틀 에어리어를 벗어날 때, 패의 「WG」 등장 코스트 7 이하 디지몬 카드 1장을 코스트 없이 등장
HK('EX9-045', { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', limit: 1, events: { leaveBattle: (state, hp, h, info) => info.owner === hp && info.cause !== 'battle' && !!info.stack && isDig(info.stack) && hasT(C(info.cardId), 'WG') } });

// ---------------------------------------------------------------- compile-gap fixes (per-card scripts where the generic compile drops a clause)
const both = (n) => [{ op: 'trashDeckTop', who: 'self', n }, { op: 'trashDeckTop', who: 'opponent', n }];
// EX12-015 / EX12-029: "…DP -4000 / 레스트할 수 없다. 그 후, 턴 종료까지 특징 「SW」 다른 자신의 디지몬 1마리는 《연계》를 얻고, 그 디지몬으로 어택할 수 있다."
const swAttack = T('그 후, 턴 종료까지, 특징 「SW」를 가진 다른 자신의 디지몬 1마리는 《연계》를 얻고, 그 디지몬으로 어택할 수 있다.');
for (const tag of ['등장 시', '진화 시']) {
  SCRIPTS[`EX12-015::${tag}`] = [T('상대의 턴 종료까지, 상대의 디지몬 1마리를 DP -4000.'), swAttack];
}
SCRIPTS['EX12-029::등장 시'] = [T('상대의 턴 종료까지, 상대의 디지몬/테이머 1마리는 레스트할 수 없다.'), swAttack];
SCRIPTS['EX12-029::진화 시'] = SCRIPTS['EX12-029::등장 시'];

// EX10-049 【진화 시】【소멸 시】 상대의 트래시가 10장 이하라면 서로의 덱 위 3장 파기. 그 후 Lv.3 이하의 상대 디지몬 1마리 소멸. 상대의 트래시가 10장 이상이라면 이 효과의 Lv. 상한 +2.
for (const tag of ['진화 시', '소멸 시']) {
  sc(`EX10-049::${tag}`, async (ctx, R) => {
    const o = ctx.state.players[opp(ctx.self)];
    if (o.trash.length <= 10) await R.runScript(both(3), ctx);
    const lv = 3 + (o.trash.length >= 10 ? 2 : 0);
    await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: lv } }], ctx);
  });
}

// EX11-050 【등장 시】【진화 시】 자신의 패 2장을 파기한다. 그 후, 특징 「마룡형」/「사룡형」을 가진 자신의 디지몬 1마리의 DP 이하인 상대 디지몬 1마리를 소멸시킨다.
for (const tag of ['등장 시', '진화 시']) {
  sc(`EX11-050::${tag}`, async (ctx, R) => {
    const { state } = ctx;
    await R.runScript([{ op: 'trashHand', who: 'self', n: 2 }], ctx);
    const own = digs(state, ctx.self).filter(s => hasT(C(s.cardId), '마룡형', '사룡형'));
    const a = await pickStack(ctx, ctx.self, own, 'DP 기준이 될 특징 「마룡형」/「사룡형」의 자신의 디지몬 선택');
    if (!a) return;
    await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: S.effectiveDP(state, ctx.self, a) } }], ctx);
  });
}

// EX12-047 【등장 시】【진화 시】 가장 DP가 낮은 상대의 디지몬 1마리를 소멸시킨다. 그 후, 상대의 트래시 2장을 덱 아래로 되돌리는 것으로, 턴 종료까지, 이 디지몬을 DP +6000하고, 상대의 디지몬 1마리를 되돌린 카드의 색 1색마다 DP -5000.
for (const tag of ['등장 시', '진화 시']) {
  sc(`EX12-047::${tag}`, async (ctx, R) => {
    const { state } = ctx, o = opp(ctx.self), ol = state.players[o];
    await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { extreme: { stat: 'dp', dir: 'min' } } }], ctx);
    if (ol.trash.length < 2) { S.log(state, 'EX12-047: 상대의 트래시가 2장 미만이라 비용을 지불할 수 없음'); return; }
    const picked = [];
    for (let n = 0; n < 2; n++) {
      const idxs = ol.trash.map((id, i) => i).filter(i => !picked.includes(i));
      const k = await pickFromList(ctx, ctx.self, ol.trash, idxs, `덱 아래로 되돌릴 상대의 트래시 카드 선택 (${n + 1}/2)`);
      if (k == null) return;
      picked.push(k);
    }
    const ids = picked.map(i => ol.trash[i]);
    for (const i of [...picked].sort((a, b) => b - a)) ol.trash.splice(i, 1);
    ol.deck.push(...ids);
    S.log(state, `${ctx.self} 상대의 트래시 2장(${ids.map(x => C(x).nameKo).join(', ')})을 덱 아래로 되돌림`);
    const colors = new Set(ids.flatMap(id => C(id).colors || [])).size;
    await R.runScript([{ op: 'modifyDP', target: 'self', thisStack: true, amount: 6000, duration: 'turn' }, ...(colors ? [{ op: 'modifyDP', target: 'opponent', amount: -5000 * colors, duration: 'turn' }] : [])], ctx);
  });
}

// EX10-068 【등장 시】 등장 코스트 5 이하의 상대 디지몬 1마리를 소멸. 그 후, 상대의 트래시에서 디지몬 카드 1장을 덱 아래로 되돌리는 것으로, 자신의 패/트래시에서 되돌린 카드와 같은 색의 Lv.4 이하 디지몬 카드 1장을 코스트 없이 등장시킬 수 있다.
sc('EX10-068::등장 시', async (ctx, R) => {
  const { state } = ctx, ol = state.players[opp(ctx.self)];
  await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 5 } }], ctx);
  const idxs = ol.trash.map((id, i) => i).filter(i => C(ol.trash[i]).category === 'digimon');
  if (!idxs.length) return;
  if (!(await ask(ctx, '상대의 트래시의 디지몬 카드 1장을 덱 아래로 되돌려 같은 색의 Lv.4 이하 디지몬을 등장시킬까요?'))) return;
  const k = await pickFromList(ctx, ctx.self, ol.trash, idxs, '덱 아래로 되돌릴 상대의 트래시의 디지몬 카드 선택');
  if (k == null) return;
  const [id] = ol.trash.splice(k, 1);
  ol.deck.push(id);
  const colors = C(id).colors || [];
  S.log(state, `${ctx.self} 상대의 트래시의 ${C(id).nameKo}을(를) 덱 아래로 되돌림 (색: ${colors.join('/')})`);
  await R.runScript([{ op: 'playFree', who: 'self', zone: 'any', filter: { category: 'digimon', levelMax: 4, colors }, rested: false, noTriggers: false, optional: true }], ctx);
});

// EX11-024 【진화 시】【어택 시】 턴 종료까지, 상대의 디지몬 1마리를 자신의 디지몬 1마리마다, DP -3000. (the shared 등장 시 script must not run for this segment)
sc('EX11-024::진화 시@자신의 디지몬 1마리마다', async (ctx, R) => {
  const n = digs(ctx.state, ctx.self).length;
  if (!n) return;
  await R.runScript([{ op: 'modifyDP', target: 'opponent', amount: -3000 * n, duration: 'turn' }], ctx);
});

// EX12-052 【진화 시】【어택 시】【카운터】[턴 1회] 상대의 턴 종료까지, 자신의 디지몬 1마리를 DP +3000하고, 그 디지몬과 상대의 디지몬 1마리로 배틀할 수 있다.
sc('EX12-052::진화 시@DP +3000하고', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const a = await pickStack(ctx, ctx.self, digs(state, ctx.self), 'DP +3000 할 자신의 디지몬 선택');
  if (!a) return;
  S.modifyDP(state, ctx.self, a.uid, 3000, 'opponentTurn');
  if (!digs(state, o).length) return; // slice6 G186 (official Q6836): after the DP bonus the battle cannot be declined (as far as possible)
  const t = await pickStack(ctx, o, digs(state, o), '배틀할 상대의 디지몬 선택');
  if (!t) return;
  const res = S.resolveDigimonBattle(state, ctx.self, a.uid, t.uid);
  // 16-7-3/16-7-4 (official Q&A): this scripted battle can also win with ≪관통≫ — capped at once per attack (S.consumePierceCheck, applied inside ctx.securityCheck).
  if (res && res.piercing && ctx.securityCheck) await ctx.securityCheck(ctx.self, a.uid, o);
});

// EX12-077 【등장 시】【진화 시】【어택 시】【카운터】[턴 1회] 자신의 디지몬의 진화원에서, 등장/사용 코스트 10 이하의, 「감마몬」이 기술되어 있거나 특징 「VB」를 가진 카드 1장을 코스트를 지불하지 않고 등장/사용할 수 있다.
sc('EX12-077::등장 시@자신의 디지몬의 진화원에서', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const ok = (id) => (mention(id, '감마몬') || hasT(C(id), 'VB')) && (C(id).cost || 0) <= 10 && ['digimon', 'tamer', 'option'].includes(C(id).category);
  const ents = [];
  for (const st of digs(state, p)) st.sources.forEach((id, i) => { if (i >= S.fdCount(st) && ok(id)) ents.push({ id, st }); });
  if (!ents.length) { S.log(state, 'EX12-077: 자신의 디지몬의 진화원에 등장/사용할 수 있는 카드가 없음'); return; }
  const k = await pickFromList(ctx, p, ents.map(e => e.id), ents.map((e, i) => i), '코스트 없이 등장/사용할 진화원의 카드 선택 (취소=안 함)');
  if (k == null) return;
  const { id, st } = ents[k];
  const j = st.sources.lastIndexOf(id);
  if (j < 0) return;
  if (C(id).category === 'option' && !S.optionColorOk(state, p, id)) { S.log(state, `${p} ${C(id).nameKo} 사용 불가: 색 조건 미충족`); return; }
  st.sources.splice(j, 1);
  S.recomputeStackGrants(st);
  pl.trash.push(id);
  if (C(id).category === 'option') {
    S.log(state, `${p} ${C(id).nameKo} 사용 (진화원에서, 코스트 없음)`);
    S.queueTriggersFor(state, p, id, 'use');
    S.emitGameEvent(state, 'optionUsed', { owner: p, stack: null, cause: 'effect', cardId: id, useCost: 0 });
  } else {
    S.playFreeFromZone(state, p, 'trash', pl.trash.length - 1, { fromSources: true });
  }
});

// ---------------------------------------------------------------- printed cost reductions on the card being played / evolved into
// EX9-018 / EX9-043 / EX9-064 "이 카드가 등장할 때, 자신의 패에서 특징 「사이보그형」/「Ver.N」을 가진 카드 1장을 파기하는 것으로, 지불하는 코스트 -2." (optional; confirmed by the UI)
for (const [id, ver] of [['EX9-018', 'Ver.2'], ['EX9-043', 'Ver.5'], ['EX9-064', 'Ver.4']]) {
  HK(id, { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
    const pl = state.players[p];
    const ok = (cid) => hasT(C(cid), '사이보그형', ver);
    let idxs = pl.hand.map((cid, i) => i).filter(i => ok(pl.hand[i]));
    if (ok(cardId)) { const own = idxs.find(i => pl.hand[i] === cardId); if (own != null) idxs = idxs.filter(i => i !== own); } // the card being played is not "in the hand"
    if (!idxs.length) return null;
    return { label: `${C(cardId).nameKo}: 패의 특징 「사이보그형」/「${ver}」 카드 1장을 파기하여 등장 코스트 -2?`, async apply(choose) {
      const i = await choose('pickFromZoneIndex', { player: p, zone: 'hand', eligibleIdxs: idxs, prompt: `파기할 특징 「사이보그형」/「${ver}」 카드 선택` });
      if (i == null) return 0;
      S.trashFromHand(state, p, i);
      return -2;
    } };
  } });
}
// EX10-048 묘티스몬 "이 카드가 등장할 때, 「묘티스몬」이 기술되어 있는 자신의 디지몬 1마리를 소멸시키는 것으로, 지불하는 코스트 -4." (optional)
HK('EX10-048', { tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const pl = state.players[p];
  const cands = () => digs(state, p).filter(s => mention(s.cardId, '묘티스몬'));
  if (!cands().length) return null;
  return { label: `${C(cardId).nameKo}: 「묘티스몬」이 기술되어 있는 자신의 디지몬 1마리를 소멸시켜 등장 코스트 -4?`, async apply(choose) {
    const cs = cands();
    const uid = cs.length === 1 ? cs[0].uid : await choose('pickStack', { player: p, uids: cs.map(s => s.uid), prompt: '소멸시킬 「묘티스몬」이 기술되어 있는 디지몬 선택' });
    if (!uid) return 0;
    S.deleteStack(state, p, uid, 'trash', 'ownEffect');
    return pl.battle.some(s => s.uid === uid) ? 0 : -4;
  } };
} });
// EX9-041 / EX9-063 "특징 「Ver.N」을 가진 자신의 디지몬이 이 카드로 진화할 때, 그 디지몬의 뒷면의 진화원 1장마다 지불하는 코스트 -1."
for (const [id, ver] of [['EX9-041', 'Ver.5'], ['EX9-063', 'Ver.4']]) {
  HK(id, { tag: '__selfEvo', selfEvoDiscount: (state, p, stack) => {
    if (!stack) return 0;
    let ok = hasT(C(stack.cardId), ver);
    try { ok = ok || S.effectiveInfo(state, stack, p).hasTrait(ver); } catch { /* keep printed */ }
    return ok ? -S.fdCount(stack) : 0;
  } });
}
