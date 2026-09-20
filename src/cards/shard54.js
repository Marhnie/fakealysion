// Shard 54 — pass-2 batch-7 verification fixes (EX12-/EX2-/EX3-/EX4- cards; docs/verify-pass2-b7.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const H = (id, d) => { (HOOKS[id] ||= []).push(d); };
const mentionsName = (id, n) => C(id).nameKo.includes(n) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`);
const hasType = (id, t) => (C(id).types || []).includes(t);

// EX12-048 【서로의 턴】 이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 Lv.5의, 「손오공몬」이 기술되어 있거나 특징 「SW」를 가진 카드 2장을 코스트를 지불하지 않고 등장시킬 수 있다.
H('EX12-048', { tag: '서로의 턴', has: '배틀 에어리어를 벗어날 때', onLeave: (state, p, stack, cause) => cause !== 'ownEffect' });
SCRIPTS['EX12-048::서로의 턴'] = [{ op: 'p2b7_fn', fn: async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const srcs = (ctx.trigger?.evt?.sources || []).slice();
  const ok = (id) => C(id).category === 'digimon' && C(id).level === 5 && (mentionsName(id, '손오공몬') || hasType(id, 'SW'));
  const used = [];
  for (let n = 0; n < 2; n++) {
    const idxs = pl.trash.map((id, i) => (srcs.includes(id) && ok(id) && !used.includes(i) ? i : -1)).filter(i => i >= 0);
    if (!idxs.length) break;
    const i = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: idxs, prompt: '코스트 없이 등장시킬 진화원의 카드 선택 (안 해도 됨)' });
    if (i == null || !idxs.includes(i)) break;
    const id = pl.trash[i];
    S.playFreeFromZone(state, ctx.self, 'trash', i, { fromSources: true });
    srcs.splice(srcs.indexOf(id), 1);
  }
} }];
OPS.p2b7_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };

// EX2-046 ADR-02=서쳐: "자신의 다른 「ADR-02=서쳐」가 없는 동안, 패의 이 카드를 등장시킬 때, 지불하는 등장 코스트 -2."
H('EX2-046', { tag: '__handPlay', selfPlayDiscount: (state, p) => (state.players[p].battle.some((s) => C(s.cardId).category === 'digimon' && C(s.cardId).nameKo === 'ADR-02=서쳐') ? 0 : -2) });

// EX12-051 [상속] 【서로의 턴】[턴 1회] 「앙고라몬」이 기술되어 있거나 특징 「NSp」를 가진 이 디지몬이 배틀에서 이겼을 때, 상대의 시큐리티를 위에서부터 1장 파기한다.
H('EX12-051', { tag: '서로의 턴', src: 'inheritedKo', has: '배틀에서 이겼을 때', limit: 1, events: { battleWin: (state, hp, holder, info) => info.owner === hp && info.stack === holder && (mentionsName(holder.cardId, '앙고라몬') || hasType(holder.cardId, 'NSp')) } });
