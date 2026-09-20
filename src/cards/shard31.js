// Shard 31 — batch-3 verification fixes (BT7-/BT8-/BT9- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-BT7-9.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's31_fn', fn: f });
OPS.s31_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };

// BT7-018 쉬라몬 【등장 시】 진화원에서 등장했을 때 《2 드로우》 — only when played out of an evolution-source pile
SCRIPTS['BT7-018::등장 시'] = [{ op: 'condition', if: { test: (ctx) => !!me(ctx)?.playedFromSources }, then: [{ op: 'draw', who: 'self', n: 2 }], else: [] }];
