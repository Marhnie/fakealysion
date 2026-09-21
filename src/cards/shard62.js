// Shard 62 — fixes found by the official card-specific Q&A scenarios (scripts/qa/qa-slice2-*.mjs, docs/qa-slice2-report.md). Q ids are cited per fix.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
OPS.s62_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's62_fn', fn: f }]; };

// BT9-080 라구엘몬 【등장 시】 (Q1873): with security <=1 the "대신 …등장시킬 수 있다" replacement is optional, so the printed purple/yellow DP<=6000 play stays available
// (declining the angel play, or no angel candidate in the trash, falls back to the base play).
sc('BT9-080::등장 시', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const base = () => R.runScript(R.compileToScript('자신의 트래시에서 퍼플 또는 옐로인 DP 6000 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.'), ctx);
  if (pl.security.length <= 1) {
    const angel = pl.trash.some(id => C(id).category === 'digimon' && (C(id).level || 0) <= 6 && (C(id).types || []).some(t => t === '천사형' || t === '타천사형'));
    if (angel && (await ctx.choose('confirmEffect', { player: ctx.self, prompt: '라구엘몬: 대신 트래시의 「천사형」/「타천사형」 Lv.6 이하 디지몬 카드 1장을 등장시킬까요? (아니오 = 퍼플/옐로 DP 6000 이하를 등장)' }))) {
      await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['천사형', '타천사형'], levelMax: 6 }, rested: false, noTriggers: false, optional: true }, ctx);
      return;
    }
  }
  await base();
});
