// Shard 75 — fixes from the official card-specific Q&A audit, slice 5 round 2 (scripts/qa/qa-slice5-r2-*.mjs; report docs/qa-slice5-report.md, "Round 2").
// Later shards win over earlier ones (Object.assign in index.js), so entries here override the same keys of older shards.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const fn = (f) => ({ op: 's75_fn', fn: f });
OPS.s75_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const tamers = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const untilOppTurnEnd = (state, self) => (state.activePlayer === self ? state.turnNumber + 1 : state.turnNumber);
// 「이 테이머는 디지몬·DP N으로도 취급하며 …」 (BT12-092 family, Q5978-5986): still a tamer AND a digimon; the DP is written as a later "base" override; cannot evolve.
function asDigimon(ctx, st, dp, until) {
  const { state } = ctx;
  st.s2AsDigimon = true; st.s2NoEvolve = true;
  (st.baseOv ||= []).push({ ts: S.stamp(), until, dp }); S.refreshBaseInfo(state, st);
  (state.endOfTurnEffects ||= []).push({ turnNumber: until, expire: true, fn: () => { st.s2AsDigimon = false; st.s2NoEvolve = false; } });
  S.log(state, `${C(st.cardId).nameKo}: 디지몬·DP ${dp}으로도 취급, 진화할 수 없음`);
}
const pickOne = async (ctx, list, prompt) => {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: list.map(s => s.uid), prompt });
  return list.find(s => s.uid === uid) || null;
};

// BT17-087 【등장 시】 (Q5986 family): the old script granted 《블로커》 + DP to the tamer without ever treating it as a digimon (a tamer has no DP -> nothing applied).
sc('BT17-087::등장 시', async (ctx) => {
  const { state } = ctx;
  const t = await pickOne(ctx, tamers(state, ctx.self).filter(s => S.cardNameIs(s.cardId, '최건우')), '디지몬으로 취급할 자신의 「최건우」 선택');
  if (!t) return;
  asDigimon(ctx, t, 3000, untilOppTurnEnd(state, ctx.self));
  S.grantKeyword(state, ctx.self, t.uid, '블로커', undefined, 'opponentTurn');
});
// AD1-021 【자신의 턴 종료 시】[턴에 1회] 명칭에 「아구몬」/「그레이몬」을 포함하는 옐로의 자신의 디지몬이 있다면, 턴 종료까지 「최건우」 1장은 디지몬·DP 6000으로 취급, 《속공》, 진화 불가. 그 후 자신의 디지몬 1장으로 어택할 수 있다.
sc('AD1-021::자신의 턴 종료 시', async (ctx, R) => {
  const { state } = ctx;
  const ok = state.players[ctx.self].battle.some(s => C(s.cardId).category === 'digimon' && /아구몬|그레이몬/.test(C(s.cardId).nameKo) && (C(s.cardId).colors || []).includes('yellow'));
  if (!ok) return;
  const t = await pickOne(ctx, tamers(state, ctx.self).filter(s => S.cardNameIs(s.cardId, '최건우')), '디지몬으로 취급할 자신의 「최건우」 선택');
  if (t) { asDigimon(ctx, t, 6000, state.turnNumber); S.grantKeyword(state, ctx.self, t.uid, '속공', undefined, 'turn'); }
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: false }, ctx);
});
