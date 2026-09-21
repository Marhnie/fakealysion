// Shard 83 — slice 3 round 2 official Q&A conformance fixes (per-card overrides; registered LAST in index.js so they win over earlier shards).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
const C = (id) => S.card(id);
const PL = (ctx, p) => ctx.state.players[p];
const fn = (f) => ({ op: 's83_fn', fn: f });
OPS.s83_fn = async (instr, ctx) => { await instr.fn(ctx); };
const sc = (key, script) => { SCRIPTS[key] = script; };

// EX6-023/024/025/026 【서로의 턴】 (Q3724/3730/3736/3742): the card also leaves the battle area when it is placed under a new card by DigiXros; its
// sources then travel with it (they are under the new stack, not in the trash), so the yellow Digimon card is taken from wherever it now is.
for (const id of ['EX6-023', 'EX6-024', 'EX6-025', 'EX6-026']) {
  sc(`${id}::서로의 턴`, [fn(async (ctx) => {
    const evt = ctx.trigger?.evt; if (!evt) return;
    const pl = PL(ctx, ctx.self);
    const holder = (x) => (pl.trash.includes(x) ? { kind: 'trash' } : evt.cause === 'xros' ? (pl.battle.slice().reverse().find(s => (s.sources || []).includes(x)) ? { kind: 'stack', s: pl.battle.slice().reverse().find(s => (s.sources || []).includes(x)) } : null) : null);
    const cand = evt.sources.filter(x => C(x).category === 'digimon' && (C(x).colors || []).includes('yellow') && holder(x));
    if (!cand.length) return;
    const a = cand.length === 1 ? 0 : await ctx.choose('multipleChoice', { prompt: '패로 되돌릴 옐로 디지몬 카드', options: cand.map(x => C(x).nameKo) });
    const pick = cand[a || 0], h = holder(pick);
    if (h.kind === 'trash') pl.trash.splice(pl.trash.lastIndexOf(pick), 1); else { h.s.sources.splice(h.s.sources.lastIndexOf(pick), 1); S.recomputeStackGrants(h.s); }
    pl.hand.push(pick);
  })]);
}

// EX6-056/058/060/061 【서로의 턴】 (Q3792/3798/3802/3805): "이 디지몬이 배틀 이외로 배틀 에어리어를 벗어날 때, 자신의 트래시에서 특징 「7대마왕」 카드 1장을 육성 에어리어의 「대죄의 문」 진화원 아래에 놓는다"
// — the leaving digimon itself has not reached the trash yet when the effect is chosen, so its own (top) card is not a legal pick (the engine has already moved it to the trash by then).
const sinGate83 = [fn(async (ctx) => {
  const pl = PL(ctx, ctx.self);
  const gate = pl.raising && C(pl.raising.cardId).nameKo === '대죄의 문' ? pl.raising : null;
  if (!gate) return;
  const evt = ctx.trigger?.evt; const selfIdx = evt && evt.cardId ? pl.trash.lastIndexOf(evt.cardId) : -1;
  const idxs = pl.trash.map((id, i) => i).filter(i => i !== selfIdx && (C(pl.trash[i]).types || []).includes('7대마왕'));
  if (!idxs.length) return;
  const idx = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: '「대죄의 문」 아래에 놓을 7대마왕 카드 선택' });
  if (idx == null) return;
  const [id] = pl.trash.splice(idx, 1);
  gate.sources.unshift(id); S.recomputeStackGrants(gate); S.log(ctx.state, `${ctx.self} ${C(id).nameKo} → ${C(gate.cardId).nameKo} 진화원 아래`);
})];
for (const id of ['EX6-056', 'EX6-058', 'EX6-060']) sc(`${id}::서로의 턴`, sinGate83);
sc('EX6-061::서로의 턴@「대죄의 문」', sinGate83);
