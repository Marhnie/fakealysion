// Shard 66 — fixes from the official card-specific Q&A audit, slice 6 (scripts/qa/qa-slice6-*.mjs; report docs/qa-slice6-report.md).
// Later shards win over earlier ones (Object.assign in index.js), so entries here override the same keys of older shards.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const digs = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const fn = (f) => ({ op: 's66_fn', fn: f });
OPS.s66_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
// give back the [턴 N회] use that the watcher queueing already booked (effect was not actually activated)
const refundOnce = (ctx) => { const tr = ctx.trigger; if (!tr || !tr.onceKey || !tr.stackUid) return; const st = findStack(ctx.state, tr.player, tr.stackUid); const u = st && st.turnEffectUses; if (u && u[tr.onceKey] > 0) u[tr.onceKey]--; };

// BT25-077 바쿠스몬 【서로의 턴】 (Q7?? official: G222) — when the digimon did NOT arrive by effect and the optional rest is not carried out, the [턴 1회] is not consumed.
sc('BT25-077::서로의 턴', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  const entries = [...digs(state, ctx.self), ...digs(state, o)].filter((s) => !s.suspended).map((s) => ({ player: S.ownerOfStack(state, s), uid: s.uid }));
  let rested = false;
  if (entries.length) {
    const picked = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 디지몬 선택 (자신/상대 무관, 취소 = 하지 않음)' });
    if (picked && picked.uid) { S.restStack(state, picked.player, picked.uid); rested = true; }
  }
  const c = ctx.trigger?.evtCause;
  const byEffect = c === 'effect' || c === 'ownEffect';
  if (byEffect) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { extreme: { stat: 'dp', dir: 'min' } } }, ctx);
  else if (!rested) refundOnce(ctx);
});

// AD1-024 황제드라몬 파이터모드 【서로의 턴】 (G109): once the opposing digimon is rested the digimon MUST be reactivated ("可能な限りアクティブにする") — the printed 「~할 수 있다」 is not an option.
import * as s7 from './shard7.js';
SCRIPTS['AD1-024::서로의 턴'] = [fn(async (ctx, R) => {
  const orig = ctx.choose;
  ctx.choose = (k, o) => (k === 'confirmEffect' && /액티브로 할까요/.test(String((o && o.prompt) || ''))) ? Promise.resolve(true) : orig.call(ctx, k, o);
  try { for (const ins of s7.SCRIPTS['AD1-024::서로의 턴']) await R.runOne(ins, ctx); } finally { ctx.choose = orig; }
})];

// BT26-059 플루토몬 "이 카드가 등장할 때, 자신의 패가 상대보다 적다면, 지불하는 코스트 -6": was not implemented as an automatic play discount at all.
// The card being declared is still in hand and counts (official Q7036: equal sizes -> no discount).
(HOOKS['BT26-059'] ||= []).push({ tag: '__handPlay', selfPlayDiscount: (state, hp) => (state.players[hp].hand.length < state.players[opp(hp)].hand.length ? -6 : 0) });
