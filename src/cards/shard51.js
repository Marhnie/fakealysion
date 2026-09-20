// Shard 51 — pass-2 batch-4 verification fixes (docs/verify-pass2-b4.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const fn = (f) => ({ op: 's51_fn', fn: f });
OPS.s51_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const digs = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const tams = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');

// BT18-083 【서로의 턴】 이 디지몬의 DP 이하의 디지몬 전부는 《충돌》을 얻는다 (both sides' digimon; grantKwAny lets the hook grant across players).
hk('BT18-083', { tag: '서로의 턴', has: '《충돌》을 얻는다', grantKwAny: true, grantKw: (state, hp, holder, target) => {
  if (C(target.cardId).category !== 'digimon') return [];
  const to = S.ownerOfStack(state, target); if (!to) return [];
  return S.effectiveDP(state, to, target) <= S.effectiveDP(state, hp, holder) ? ['충돌'] : [];
} });
