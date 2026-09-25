export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};
// Shard 16 (verify-reveal-2) — "덱 위 N장 오픈" cards that do not fit the generic `revealPick` op compiled in effects.js
// (n depends on a count, opponent's deck, digitama deck, follow-up that needs the revealed cards, …).
// state.js is only used inside functions (it imports cards/index.js).
import * as S from '../state.js';

const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const meStack = (ctx) => stacksOf(ctx.state, ctx.self).find((s) => s.uid === ctx.sourceStackUid) || null;
const hasT = (id, ...ts) => (C(id).types || []).some((t) => ts.includes(t));

// An own stack (with all its cards) goes under another own stack's sources (battle or breeding area).
function moveStackUnder(state, p, mv, target) {
  const pl = state.players[p];
  if (!target || target === mv) return false;
  const bi = pl.battle.indexOf(mv);
  if (bi !== -1) pl.battle.splice(bi, 1); else if (pl.raising === mv) pl.raising = null; else return false;
  pl.trash.push(...(mv.linkCards || []).map((l) => l.cardId));
  target.sources.splice(S.fdCount(target), 0, ...[mv.cardId, ...mv.sources].filter((id) => !C(id).isToken));
  S.recomputeStackGrants(target);
  S.log(state, `${p} ${C(mv.cardId).nameKo}을(를) ${C(target.cardId).nameKo}의 진화원 아래에 놓음`);
  return true;
}

// Put the (still deck-top) revealed cards back: 'top' | 'bottom' | 'topOrBottom' (player splits) | 'trash'. `ids` are the first ids.length cards of pl.deck.
async function returnRevealed(ctx, deckOwner, ids, mode) {
  const { state } = ctx, pl = state.players[deckOwner];
  pl.deck.splice(0, ids.length);
  if (mode === 'trash') { pl.trash.push(...ids); S.log(state, `${deckOwner} 오픈한 카드 ${ids.length}장 파기`); return; }
  let top = [], bottom = [];
  if (mode === 'top') top = ids; else if (mode === 'bottom') bottom = ids;
  else {
    const r = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 0, max: ids.length, dest: '덱 위로 되돌리기', prompt: '덱 위에 되돌릴 카드 선택 (선택하지 않은 카드는 덱 아래로)' });
    const set = new Set((r || []).filter((x) => Number.isInteger(x) && x >= 0 && x < ids.length));
    ids.forEach((id, i) => (set.has(i) ? top : bottom).push(id));
  }
  top = await S.orderPlacement(ctx.choose, ctx.self, top, '덱 위에 되돌릴 카드의 순서를 정하세요 (위쪽부터)');
  bottom = await S.orderPlacement(ctx.choose, ctx.self, bottom, '덱 아래로 되돌릴 카드의 순서를 정하세요 (위쪽부터)');
  pl.deck.unshift(...top); pl.deck.push(...bottom);
  S.log(state, `${deckOwner} 오픈한 카드를 덱 ${top.length ? `위 ${top.length}장` : ''}${top.length && bottom.length ? ' / ' : ''}${bottom.length ? `아래 ${bottom.length}장` : ''}으로 되돌림`);
}
const oneOf = async (ctx, ids, pred, prompt, dest) => { // the effect's player must pick one matching revealed card (undefined when none match)
  const eligible = ids.map((id, i) => ({ id, i })).filter((e) => pred(e.id));
  const r = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible, min: eligible.length ? 1 : 0, max: eligible.length ? 1 : 0, dest, prompt: eligible.length ? prompt : '조건에 맞는 카드가 없습니다' });
  const i = (r || []).find((x) => eligible.some((e) => e.i === x));
  return i == null ? null : ids[i];
};

// ---- BT11-056 어택 시: "[턴에 1회] 그린/블랙인 자신의 테이머 1명마다 덱 위에서 1장 오픈. 그중 그린/블랙 디지몬 카드를 등장 코스트 합계 10까지 코스트 없이 등장. 나머지 덱 아래"
OPS.s16_revealPerTamer = async (instr, ctx, R) => {
  const n = ctx.state.players[ctx.self].battle.filter((s) => C(s.cardId).category === 'tamer' && S.stackColors(s).some((c) => instr.colors.includes(c))).length;
  if (!n) { S.log(ctx.state, `${ctx.self} 그린/블랙인 자신의 테이머가 없어 오픈하지 않음`); return; }
  await R.runRevealPick({ ...instr.instr, n }, ctx);
};
SCRIPTS['BT11-056::어택 시'] = [{ op: 's16_revealPerTamer', colors: ['green', 'black'], instr: { op: 'revealPick', who: 'self', n: 1, steps: [{ groups: [{ filter: { category: 'digimon', colors: ['green', 'black'] }, max: 99, noCount: true }], costSum: 10, optional: true, dests: [{ k: 'play' }] }], restTo: 'bottom' } }];

// ---- EX5-042 등장 시/진화 시: 1장 오픈. 《불굴》 Lv.5 이하 디지몬 카드라면 코스트 없이 등장(강제). 나머지는 패에 추가
SCRIPTS['EX5-042::등장 시'] = [{ op: 'revealPick', who: 'self', n: 1, steps: [{ groups: [{ filter: { category: 'digimon', keywordText: '불굴', levelMax: 5 }, max: 1, label: '《불굴》을 가진 Lv.5 이하의 디지몬 카드' }], optional: false, dests: [{ k: 'play' }] }], restTo: 'hand' }];

// ---- P-112 등장 시: 3장 오픈, 「에오스몬」/「메노아 벨루치」 1장씩 패에 추가, 나머지 덱 아래. 그 후 이 디지몬을 자신의 「에오스몬」의 진화원 아래에 놓는 것으로 패의 「메노아 벨루치」를 코스트 없이 등장(수 있다)
OPS.s16_p112 = async (instr, ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const st = meStack(ctx);
  const hi = pl.hand.findIndex((id) => C(id).nameKo === '메노아 벨루치' && C(id).category !== 'option');
  const eos = stacksOf(state, ctx.self).filter((s) => s !== st && C(s.cardId).nameKo === '에오스몬');
  if (!st || hi === -1 || !eos.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 디지몬을 「에오스몬」의 진화원 아래에 놓고, 패의 「메노아 벨루치」를 코스트 없이 등장시킬까요?' }))) return;
  const uid = eos.length === 1 ? eos[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: eos.map((s) => s.uid), prompt: '이 디지몬을 진화원 아래에 놓을 「에오스몬」 선택' });
  const tgt = eos.find((s) => s.uid === uid) || eos[0];
  if (!moveStackUnder(state, ctx.self, st, tgt)) return;
  const hi2 = pl.hand.findIndex((id) => C(id).nameKo === '메노아 벨루치' && C(id).category !== 'option');
  if (hi2 !== -1) S.playFreeFromZone(state, ctx.self, 'hand', hi2, {});
};
SCRIPTS['P-112::등장 시'] = [{ op: 'revealPick', who: 'self', n: 3, steps: [{ groups: [{ filter: { exactAny: ['에오스몬'] }, max: 1, label: '「에오스몬」' }, { filter: { exactAny: ['메노아 벨루치'] }, max: 1, label: '「메노아 벨루치」' }], optional: false, dests: [{ k: 'hand' }] }], restTo: 'bottom' }, { op: 's16_p112' }];

// ---- BT14-067 등장 시/진화 시: 상대의 덱 위 3장 오픈. 그중 디지몬 카드 1장을 선택, 그 등장 코스트 합계까지 상대의 디지몬을 소멸. 오픈한 카드는 덱 위 또는 아래로만
OPS.s16_bt14067 = async (instr, ctx, R) => {
  const { state } = ctx, o = state.players[ctx.opp];
  const ids = o.deck.slice(0, 3);
  if (!ids.length) { S.log(state, '상대의 덱에 카드가 없음'); return; }
  S.log(state, `${ctx.self} 상대의 덱 위 ${ids.length}장 오픈: ${ids.map((id) => C(id).nameKo).join(', ')}`);
  const pick = await oneOf(ctx, ids, (id) => C(id).category === 'digimon', '선택할 디지몬 카드 (그 등장 코스트 합계까지 상대의 디지몬을 소멸)', '선택');
  if (pick != null) { S.log(state, `${ctx.self} 선택: ${C(pick).nameKo} (등장 코스트 ${C(pick).cost || 0})`); await R.runOne({ op: 'destroySum', limit: C(pick).cost || 0, stat: 'cost' }, ctx); }
  await returnRevealed(ctx, ctx.opp, o.deck.slice(0, ids.length), 'topOrBottom');
};
SCRIPTS['BT14-067::등장 시'] = [{ op: 's16_bt14067' }];

// ---- BT16-060 등장 시/진화 시: 3장 오픈. 「D-브리가드」/「디지대」 카드 1장마다 턴 종료까지 상대의 디지몬 전부를 등장 코스트 -1. 오픈한 카드는 덱 위 또는 아래로만. 그 후 등장 코스트 4 이하(수정 후)의 상대 디지몬 1마리 소멸
OPS.s16_bt16060 = async (instr, ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const ids = pl.deck.slice(0, 3);
  S.log(state, `${ctx.self} 덱 위 ${ids.length}장 오픈: ${ids.map((id) => C(id).nameKo).join(', ')}`);
  const k = ids.filter((id) => hasT(id, 'D-브리가드', '디지대')).length;
  if (ids.length) {
    if (k) { for (const s of state.players[ctx.opp].battle) { if (C(s.cardId).category === 'digimon') { S.addCostMod(state, s, -k, state.turnNumber); } } S.log(state, `${ctx.self} 상대의 디지몬 전부의 등장 코스트 -${k} (턴 종료까지)`); }
    await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })).filter((e) => hasT(e.id, 'D-브리가드', '디지대')), min: 0, max: 0, dest: `상대 디지몬 전부 등장 코스트 -${k}`, prompt: `「D-브리가드」/「디지대」 카드 ${k}장 — 상대의 디지몬 전부 등장 코스트 -${k}` });
    await returnRevealed(ctx, ctx.self, ids, 'topOrBottom');
  }
  const eff = (s) => S.effectiveCost(state, s);
  const cands = state.players[ctx.opp].battle.filter((s) => C(s.cardId).category === 'digimon' && eff(s) <= 4);
  if (!cands.length) { S.log(state, `${ctx.self} 등장 코스트 4 이하의 상대 디지몬이 없음`); return; }
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: cands.map((s) => s.uid), prompt: '소멸시킬 상대 디지몬 선택 (등장 코스트 4 이하)' });
  if (uid) S.deleteStack(state, ctx.opp, uid, 'trash', 'effect');
};
SCRIPTS['BT16-060::등장 시'] = [{ op: 's16_bt16060' }];

// ---- BT16-065 (hand play cost, Q2654/2655): 특징 「반쵸」를 가진 디지몬이 있다면(자신/상대 불문) -6.
//      추가로 자신의 트래시에서 특징 「D-브리가드」를 가진 카드 6장을 덱 위로 되돌리는 것으로 추가 -6 (합계 -12 가능) — 둘 다 훅이 없어 전혀 적용되지 않고 있었음
(HOOKS['BT16-065'] ||= []).push({ tag: '__handPlay', selfPlayDiscount: (state, hp) => ([...state.players[hp].battle, ...state.players[opp(hp)].battle].some((s) => hasT(s.cardId, '반쵸')) ? -6 : 0) });
(HOOKS['BT16-065'] ||= []).push({ tag: '__handPlay', handPlayOption: (state, p) => {
  const pl = state.players[p];
  if (pl.trash.filter((id) => hasT(id, 'D-브리가드')).length < 6) return null;
  return { label: '자신의 트래시에서 특징 「D-브리가드」를 가진 카드 6장을 덱 위로 되돌려 등장 코스트 -6?', apply: () => {
    let n = 0;
    for (let i = pl.trash.length - 1; i >= 0 && n < 6; i--) if (hasT(pl.trash[i], 'D-브리가드')) { pl.deck.unshift(pl.trash.splice(i, 1)[0]); n++; }
    S.log(state, `${p} 트래시의 「D-브리가드」 카드 6장을 덱 위로 되돌림 (등장 코스트 -6)`);
    return -6;
  } };
} });
// ---- BT16-065 등장 시/진화 시: 3장 오픈. 그중 디지몬 카드 1장의 등장 코스트 이하의 상대 디지몬 1마리를 소멸. 오픈한 카드는 파기
OPS.s16_bt16065 = async (instr, ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const ids = pl.deck.slice(0, 3);
  if (!ids.length) { S.log(state, `${ctx.self} 덱에 카드가 없음`); return; }
  S.log(state, `${ctx.self} 덱 위 ${ids.length}장 오픈: ${ids.map((id) => C(id).nameKo).join(', ')}`);
  const pick = await oneOf(ctx, ids, (id) => C(id).category === 'digimon', '선택할 디지몬 카드 (그 등장 코스트 이하의 상대 디지몬 1마리를 소멸)', '선택');
  if (pick != null) {
    const lim = C(pick).cost || 0;
    const cands = state.players[ctx.opp].battle.filter((s) => C(s.cardId).category === 'digimon' && (C(s.cardId).cost || 0) <= lim);
    if (cands.length) { const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: cands.map((s) => s.uid), prompt: `소멸시킬 상대 디지몬 선택 (등장 코스트 ${lim} 이하)` }); if (uid) S.deleteStack(state, ctx.opp, uid, 'trash', 'effect'); }
    else S.log(state, `${ctx.self} 등장 코스트 ${lim} 이하의 상대 디지몬이 없음`);
  }
  await returnRevealed(ctx, ctx.self, pl.deck.slice(0, ids.length), 'trash');
};
SCRIPTS['BT16-065::등장 시'] = [{ op: 's16_bt16065' }];

// ---- BT13-007 자신의 메인 페이즈 개시 시: 디지타마 덱 위 1장 오픈, 그 카드와 특징 「로얄 나이츠」를 가진 자신의 디지몬 전부를 이 디지몬의 진화원 아래에 놓는다
OPS.s16_bt13007 = async (instr, ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const st = meStack(ctx);
  if (!st) return;
  if (pl.digitamaDeck.length) {
    const id = pl.digitamaDeck.shift();
    S.log(state, `${ctx.self} 디지타마 덱 위 1장 오픈: ${C(id).nameKo}`);
    st.sources.splice(S.fdCount(st), 0, id); S.recomputeStackGrants(st);
    S.log(state, `${ctx.self} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
  } else S.log(state, `${ctx.self} 디지타마 덱에 카드가 없음`);
  for (const s of stacksOf(state, ctx.self).filter((x) => x !== st && C(x.cardId).category === 'digimon' && hasT(x.cardId, '로얄 나이츠'))) moveStackUnder(state, ctx.self, s, st);
};
SCRIPTS['BT13-007::자신의 메인 페이즈 개시 시'] = [{ op: 's16_bt13007' }];

// ---- overrides of earlier shards' hand-written versions whose pick was optional / rest unordered though the printed text is mandatory (min 1) / player-ordered ----
// BT13-072 진화 시: 3장 오픈. 「X항체」 카드 1장을 이 디지몬의 진화원 아래에 놓는다. 나머지 파기. 이 효과로 놓았다면 상대의 턴 종료까지 이 디지몬은 DP가 마이너스되지 않는다
OPS.s16_bt13072 = async (instr, ctx) => {
  const st = meStack(ctx);
  if (!(ctx._lastPlacedSource > 0) || !st) return;
  (st.s1 ||= {}).noNegDP = ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber; // "상대의 턴 종료까지" (same encoding as shard11 oppEnd)
  S.log(ctx.state, `${C(st.cardId).nameKo}: 상대의 턴 종료까지 DP가 마이너스되지 않음`);
};
SCRIPTS['BT13-072::진화 시'] = [{ op: 'revealPick', who: 'self', n: 3, steps: [{ groups: [{ filter: { traitAny: ['X항체'] }, max: 1, label: '특징으로 「X항체」를 가진 카드' }], optional: false, dests: [{ k: 'srcThis' }] }], restTo: 'trash' }, { op: 's16_bt13072' }];

// BT16-082 (자신의 턴, 육성→배틀 이동 시): 3장 오픈. 디지몬 카드/테이머 카드 1장을 패에 추가. 나머지 덱 아래(순서 선택). 그 후 육성 에어리어에 부화시킬 수 있다
OPS.s16_hatchOpt = async (instr, ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (!pl.raising && pl.digitamaDeck.length && await ctx.choose('confirmEffect', { player: ctx.self, prompt: '자신의 육성 에어리어에 부화시킬까요?' })) S.s7HatchByEffect(state, ctx.self);
};
SCRIPTS['BT16-082::자신의 턴'] = [{ op: 'revealPick', who: 'self', n: 3, steps: [{ groups: [{ filter: { anyOf: [{ category: 'digimon' }, { category: 'tamer' }] }, max: 1, label: '디지몬 카드/테이머 카드' }], optional: false, dests: [{ k: 'hand' }] }], restTo: 'bottom' }, { op: 's16_hatchOpt' }];

// BT17-056 (서로의 턴, 어택의 대상이 변경되었을 때): 3장 오픈. 「패러사이몬」 또는 블랙인 Lv.5 이하의 디지몬 카드 1장을 이 디지몬의 진화원 아래에 놓는다(강제). 나머지 파기
SCRIPTS['BT17-056::서로의 턴@어택의 대상이 변경되었을 때'] = [{ op: 'revealPick', who: 'self', n: 3, steps: [{ groups: [{ filter: { anyOf: [{ category: 'digimon', exactAny: ['패러사이몬'] }, { category: 'digimon', colors: ['black'], levelMax: 5 }] }, max: 1, label: '「패러사이몬」 또는 블랙인 Lv.5 이하의 디지몬 카드' }], optional: false, dests: [{ k: 'srcThis' }] }], restTo: 'trash' }];

// EX7-044 등장 시/진화 시: 4장 오픈. 특징 「3총사」 옵션 카드 1장을 이 디지몬의 진화원 아래에 놓는다(강제). 나머지 덱 위 또는 아래로만. 이 효과로 놓았다면 등장 코스트 3 이하의 상대의 디지몬/테이머 1마리(명) 소멸
OPS.s16_ex7044 = async (instr, ctx) => {
  const { state } = ctx;
  if (!(ctx._lastPlacedSource > 0)) return;
  const cands = state.players[ctx.opp].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category) && (C(s.cardId).cost || 0) <= 3);
  if (!cands.length) { S.log(state, `${ctx.self} 등장 코스트 3 이하의 상대의 디지몬/테이머가 없음`); return; }
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids: cands.map((s) => s.uid), prompt: '소멸시킬 등장 코스트 3 이하의 상대의 디지몬/테이머 선택' });
  if (uid) S.deleteStack(state, ctx.opp, uid, 'trash', 'effect');
};
SCRIPTS['EX7-044::등장 시'] = [{ op: 'revealPick', who: 'self', n: 4, steps: [{ groups: [{ filter: { category: 'option', traitAny: ['3총사'] }, max: 1, label: '특징으로 「3총사」를 가진 옵션 카드' }], optional: false, dests: [{ k: 'srcThis' }] }], restTo: 'topOrBottom' }, { op: 's16_ex7044' }];
