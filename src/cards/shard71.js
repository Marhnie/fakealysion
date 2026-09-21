// Shard 71 — fixes from the official card Q&A conformance run (slice 1; scripts/qa/qa-slice1-*.mjs).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
OPS.c71_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };

// "이 디지몬의 진화원인 <조건> 카드 1장을, 코스트를 지불하지 않고 다른 디지몬으로서 등장시킨다" — this digimon's OWN sources (the generic compiler had no "this stack" form and left a manual prompt)
async function playOwnSource(ctx, pred, prompt) {
  const { state } = ctx; const who = ctx.self; const pl = state.players[who];
  const st = [pl.raising, ...pl.battle].filter(Boolean).find(x => x.uid === ctx.sourceStackUid);
  if (!st) return;
  const ok = (id) => C(id).category === 'digimon' && pred(C(id)); // Digitama / tamer cards are not "디지몬 카드"
  if (!st.sources.some(ok)) { S.log(state, `${who} 진화원에 등장시킬 수 있는 디지몬 카드가 없음`); return; }
  const idx = await S.chooseSourceIdxs(state, who, st, 1, ctx.choose, ok, prompt);
  if (!idx.length) return;
  const taken = idx.map(i => st.sources[i]);
  for (const i of [...idx].sort((a, b) => b - a)) st.sources.splice(i, 1);
  S.recomputeStackGrants(st);
  for (const id of taken) { pl.trash.push(id); S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { fromSources: true }); }
}
// BT1-044 메탈가루몬 【어택 시】 이 디지몬의 진화원인 Lv.4 이하의 디지몬 카드 1장을, 코스트를 지불하지 않고 다른 디지몬으로서 등장시킨다. (official Q&A 900-906)
SCRIPTS['BT1-044::어택 시'] = [{ op: 'c71_fn', fn: (ctx) => playOwnSource(ctx, (c) => (c.level ?? 99) <= 4, '메탈가루몬의 진화원에서 등장시킬 Lv.4 이하 디지몬 카드 선택') }];

// BT3-106 수랑대회전 【메인】 이 턴 동안, 《블로커》 또는 《재기동》을 가진 자신의 디지몬 전부는 《시큐리티 어택 +1》을 얻는다. (Q&A 1143/1144: both keywords => +1 only; a digimon that loses both loses the bonus)
// (the generic compiler gave Blocker + Reboot + S-Attack to ONE chosen digimon)
SCRIPTS['BT3-106::메인'] = [{ op: 'c71_fn', fn: async (ctx) => {
  const { state } = ctx; const until = state.turnNumber;
  for (const st of state.players[ctx.self].battle) {
    if (C(st.cardId).category !== 'digimon') continue;
    if (!(S.hasKeyword(st, '블로커') || S.hasKeyword(st, '재기동'))) continue;
    st.s71SAtkIf = { until, kws: ['블로커', '재기동'] };
    S.log(state, `${ctx.self} ${C(st.cardId).nameKo}는 《시큐리티 어택 +1》을 얻음 (이 턴 동안)`);
  }
} }];
