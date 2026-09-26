// Shard 74 — fixes from the official card Q&A conformance run, slice 1 round 2 (scripts/qa/qa-slice1-r2-*.mjs). Q ids refer to data/rulings/slice1.json (gitignored).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

OPS.c74_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const digs = (state, p) => state.players[p].battle.filter(s => S.isDigimonLike(s));

// BT2-049 피노키몬 【등장 시】 상대의 디지몬 1마리를 레스트시킨다. 다음 상대의 액티브 페이즈에서는, 상대의 디지몬 전부는 액티브가 되지 않는다.
// (Q1019: not only the digimon rested by this effect; Q1020: digimon that were active are not rested by it; Q1021: tamers are unaffected.)
// The generic compiler only attached the one-time skip to the single rested digimon.
SCRIPTS['BT2-049::등장 시'] = [
  { op: 'rest', target: 'opponent', n: 1, digimonOnly: true },
  { op: 'c74_fn', fn: async (ctx) => { for (const s of digs(ctx.state, ctx.opp)) S.setSkipNextUnsuspend(ctx.state, ctx.opp, s.uid); } },
];

// BT3-051 【등장 시】 덱 위에서부터 3장 오픈한다. 그 중 Lv.5와 Lv.6의 디지몬 카드 1장씩을 패에 추가한다. 남은 카드는 파기한다.
// (Q1085: if only one of the two levels is among the opened cards, that one is still added.) The generic compiler read "Lv.5와 Lv.6 … 1장씩" as a single Lv.5 pick and never offered Lv.6.
SCRIPTS['BT3-051::등장 시'] = [{ op: 'revealPick', who: 'self', n: 3, optReveal: false, steps: [{ groups: [{ filter: { category: 'digimon', level: 5 }, max: 1, label: 'Lv.5 디지몬' }, { filter: { category: 'digimon', level: 6 }, max: 1, label: 'Lv.6 디지몬' }], optional: false, dests: [{ k: 'hand' }] }], restTo: 'trash' }];
