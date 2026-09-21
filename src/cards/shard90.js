// Shard 90 — fixes from the official card-specific Q&A audit, slice 2 round 2 (scripts/qa/qa-slice2-r2-*.mjs; report docs/qa-slice2-report.md "Round 2").
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const fn = (f) => ({ op: 's90_fn', fn: f });
OPS.s90_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };

// BT9-067 라이덴몬 【어택 시】 (Q1855/1856): the colours of the Lv.6 cards among this digimon's SOURCES are unioned;
// 3+ colours -> DP+3000, 4+ colours -> retreat 1 (both when 4+). The generic compiler dropped both conditions (always fired).
sc('BT9-067::어택 시', async (ctx, R) => {
  const st = findStack(ctx.state, ctx.self, ctx.sourceStackUid);
  const cols = new Set();
  for (const id of st?.sources || []) { const c = C(id); if (c.level === 6) for (const col of c.colors || []) cols.add(col); }
  if (cols.size >= 3) await R.runOne({ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'nextOpponentTurn' }, ctx);
  if (cols.size >= 4) await R.runOne({ op: 'retreat', target: 'opponent', n: 1 }, ctx);
});
