// Shard 97 — unresolved-b: former "manualCost" effects now scripted (EX11-038, EX5-013, EX8-028, BT8-040). docs/audit-2026-09-unresolved-b.md
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const isDig = (st) => S.isDigimonLike(st);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's97_fn', fn: f });
OPS.s97_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const traitAny = (id, ...ts) => (C(id).types || []).some(t => ts.includes(t));
async function pickFromList(ctx, who, ids, idxs, prompt) { // stock picker over an arbitrary id list (temp zone trick, same as shard35)
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s97tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's97tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s97tmp; }
}

// ---- EX11-038 샌드리자몬 【이동 시】【등장 시】 자신의 패 또는 디지몬의 진화원에서, 특징 「광물형」/「광석형」을 가진 카드 1장을 파기하는 것으로, 《1 드로우》.
// (was a generic manualCost). Q5865: another own digimon's sources are legal too. The discard is the cost; without a legal card nothing happens.
const MINERAL = ['광물형', '광석형'];
sc('EX11-038::등장 시', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const handIdx = pl.hand.map((id, i) => i).filter(i => traitAny(pl.hand[i], ...MINERAL));
  const srcStacks = pl.battle.filter(s => isDig(s) && s.sources.some(id => traitAny(id, ...MINERAL)));
  if (!handIdx.length && !srcStacks.length) { S.log(state, `${ctx.self} 파기할 「광물형」/「광석형」 카드가 없어 효과를 발휘하지 않음`); return; }
  let where = handIdx.length ? 'hand' : 'src';
  if (handIdx.length && srcStacks.length) { const r = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '파기할 카드를 어디에서 고를까요?', options: ['패에서', '디지몬의 진화원에서', '취소'] }); if (r == null || r === 2) return; where = r === 1 ? 'src' : 'hand'; }
  if (where === 'hand') {
    const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: handIdx, n: 1, prompt: '파기할 「광물형」/「광석형」 카드 1장 선택' });
    if (!chosen || chosen.length < 1) return;
    S.trashFromHand(state, ctx.self, chosen[0]);
  } else {
    let st = srcStacks[0];
    if (srcStacks.length > 1) { const uid = await ctx.choose('pickStack', { player: ctx.self, uids: srcStacks.map(s => s.uid), prompt: '진화원의 카드를 파기할 디지몬 선택' }); st = srcStacks.find(s => s.uid === uid); if (!st) return; }
    const elig = st.sources.map((id, k) => k).filter(k => traitAny(st.sources[k], ...MINERAL));
    const k = elig.length === 1 ? elig[0] : await pickFromList(ctx, ctx.self, st.sources, elig, '파기할 진화원의 「광물형」/「광석형」 카드 선택');
    if (k == null) return;
    if (S.trashEvoSources(state, ctx.self, st.uid, 1, 'bottom', [k]).length !== 1) return; // cost not paid
  }
  await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
});
SCRIPTS['EX11-038::이동 시'] = SCRIPTS['EX11-038::등장 시'];

// ---- EX5-013 주작몬ACE 【진화 시】【어택 시】[턴에 1회] DP 6000 이하의 디지몬 1마리 또는 특징 「데바」를 가진 디지몬 1마리를 소멸시키는 것으로, 턴 종료까지 이 디지몬은 《S 어택 +1》을 얻는다.
// (was a generic manualCost). Q3550: the destroyed digimon may be either side's (cost). The grant only follows when the digimon was actually destroyed.
sc('EX5-013::진화 시', async (ctx, R) => {
  const { state } = ctx, entries = [];
  for (const p of [ctx.self, ctx.opp]) for (const s of state.players[p].battle) {
    if (!isDig(s)) continue;
    if (!(S.effectiveDP(state, p, s) <= 6000 || traitAny(s.cardId, '데바'))) continue;
    if (p !== ctx.self && S.effectBlocked(state, p, s, 'destroy')) continue;
    entries.push({ player: p, uid: s.uid });
  }
  if (!entries.length) { S.log(state, `${ctx.self} 소멸시킬 수 있는 디지몬이 없어 효과를 발휘하지 않음`); return; }
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '소멸시킬 디지몬 선택 (DP 6000 이하 또는 특징 「데바」 — 자신/상대 무관, 취소 = 비용을 지불하지 않음)' });
  if (!pick) return;
  if (!S.deleteStack(state, pick.player, pick.uid, 'trash', pick.player === ctx.self ? 'ownEffect' : 'effect')) return; // survived / immune: cost not paid
  await R.runOne({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '시큐리티어택', value: 1, duration: 'turn' }, ctx);
});
SCRIPTS['EX5-013::어택 시'] = SCRIPTS['EX5-013::진화 시'];

// ---- EX8-028 스카디몬 【진화 시】【어택 시】[턴에 1회] 진화원을 갖지 않은 디지몬 1마리를 시큐리티 아래에 놓는 것으로, 이 디지몬을 액티브로 한다.
// (was a generic manualCost). Q3897: either side's digimon; it goes under its OWNER's security (face-down), links are trashed. Two 【진화 시】 segments -> '@' key.
const secBottomCost = async (ctx) => {
  const { state } = ctx, entries = [];
  for (const p of [ctx.self, ctx.opp]) for (const s of state.players[p].battle) {
    if (!isDig(s) || s.sources.length) continue;
    if (p !== ctx.self && S.effectBlocked(state, p, s, 'bounce')) continue;
    entries.push({ player: p, uid: s.uid });
  }
  if (!entries.length) { S.log(state, `${ctx.self} 진화원을 갖지 않은 디지몬이 없어 효과를 발휘하지 않음`); return false; }
  const pick = await ctx.choose('pickStackAnySide', { entries, prompt: '시큐리티 아래에 놓을 진화원 없는 디지몬 선택 (취소 = 비용을 지불하지 않음)' });
  if (!pick) return false;
  const stack = findStack(state, pick.player, pick.uid), pl = state.players[pick.player];
  if (!stack || !pl.battle.includes(stack)) return false;
  const cause = pick.player === ctx.self ? 'ownEffect' : 'effect';
  if (S.effectBlocked(state, pick.player, stack, 'bounce') || S.leaveGate(state, pick.player, stack, cause, 'bounce', null)) return false;
  pl.battle.splice(pl.battle.indexOf(stack), 1);
  const leavePlays = S.extractLeaveSourcePlays(state, pick.player, stack, cause);
  const linkIds = (stack.linkCards || []).map(l => l.cardId);
  pl.security.push(stack.cardId);
  pl.trash.push(...stack.sources, ...linkIds);
  S.playExtractedSources(state, pick.player, leavePlays);
  S.log(state, `${pick.player} ${C(stack.cardId).nameKo}을(를) 시큐리티 아래에 놓음`);
  S.applyOverflowBatch(state, pick.player, [...stack.sources, stack.cardId]);
  S.hookLeaveTriggers(state, pick.player, stack, cause);
  S.emitGameEvent(state, 'securityIncrease', { owner: pick.player, stack: null, cause: 'effect' });
  return true;
};
const EX8028_NEEDLE = '진화원을 갖지 않은 디지몬 1마리를 시큐리티';
const ex8028 = [fn(async (ctx) => {
  if (!(await secBottomCost(ctx))) return;
  const st = me(ctx); if (st) S.unsuspendStack(ctx.state, ctx.self, st.uid);
})];
SCRIPTS[`EX8-028::진화 시@${EX8028_NEEDLE}`] = ex8028; // (the other 【진화 시】 segment of this card — the free play — stays generic)
SCRIPTS[`EX8-028::어택 시@${EX8028_NEEDLE}`] = ex8028;

// ---- BT8-040 베츠몬 【진화 시】 자신의 패를 1장 파기하는 것으로, 이 턴 동안 이 디지몬의 색은 파기한 카드의 색으로도 취급한다. 그 후, 이 디지몬이 2색 이상이라면 《2 드로우》.
// (was costGroup + a manual noop for the colour). Q1728/1729: colours are additive (yellow + red = 2 colours -> draw; a 2-colour discard = 3 colours).
sc('BT8-040::진화 시', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self], st = me(ctx);
  if (!pl.hand.length) { S.log(state, `${ctx.self} 파기할 패가 없어 효과를 발휘하지 않음`); return; }
  const chosen = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs: pl.hand.map((id, i) => i), n: 1, prompt: '파기할 패 1장 선택 (이 디지몬은 그 카드의 색으로도 취급됨)' });
  if (!chosen || chosen.length < 1) return;
  const id = pl.hand[chosen[0]];
  S.trashFromHand(state, ctx.self, chosen[0]);
  if (!st || !findStack(state, ctx.self, st.uid)) return;
  const cols = (C(id).colors || []).slice();
  (st.baseOv ||= []).push({ ts: S.stamp(), until: state.turnNumber, addColors: cols });
  S.refreshBaseInfo(state, st);
  S.recomputeStackGrants(st);
  S.log(state, `${ctx.self} ${C(st.cardId).nameKo}: 이 턴 동안 ${cols.join('/')} 색으로도 취급`);
  if (S.stackColors(st).length >= 2) await R.runOne({ op: 'draw', who: 'self', n: 2 }, ctx);
});
