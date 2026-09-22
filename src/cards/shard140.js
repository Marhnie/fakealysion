// Shard 140 — DUAL cards: 《아츠 진화》 (룰 4-6 / 4-20, docs/dual-cards.md).
// state.queueTriggersFor(…'use') queues a '__아츠진화' pending right behind the used dual card's 【메인】 effect (before anything that effect triggered): this
// wildcard script resolves it. The dual card is parked in the trash while it "belongs to no zone" (9-1-4), so it is pulled back out by S.artsDigivolve.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null; };

// own cards in the area (battle + breeding) whose CURRENT top card may normally digivolve into `id` — the evolution CONDITION still applies, only the cost is waived.
export function artsTargets(ctx, p, id) {
  const { state, E } = ctx;
  const pl = state.players[p];
  const out = [];
  for (const st of [pl.raising, ...pl.battle]) {
    if (!st) continue;
    const cat = S.card(st.cardId).category;
    if (!['digimon', 'digitama'].includes(cat)) continue; // (Tamers evolve only through their own printed conditions — not modelled for Arts)
    let ok = false;
    try {
      const restr = S.evolveTargetRestriction(state, p, st), extra = S.evoExtraArg(state, p, st);
      const ms = E.evolutionMethods(st.cardId, id, extra, restr, { state, p, stack: st });
      ok = ms.some((m) => m.kind !== 'burst' && m.kind !== 'app') || (!ms.length && E.canEvolveAny(st.cardId, id, extra, restr).ok);
    } catch (e) { ok = false; }
    if (ok) out.push(st);
  }
  return out;
}

OPS.dual_arts = async (i, ctx) => {
  const { state } = ctx;
  const p = ctx.self;
  const id = ctx.trigger?.artsFor || ctx.sourceCardId;
  const pl = state.players[p];
  if ((pl.limbo || []).lastIndexOf(id) === -1) return; // the used card was moved by its own effect: no discard step is left to replace
  if (state.winner) return;
  const cands = artsTargets(ctx, p, id);
  if (!cands.length) { S.log(state, `${p} ${S.card(id).nameKo} 《아츠 진화》 가능한 대상 없음 (진화 조건 불일치) — 트래시로`); return; }
  const nm = S.card(id).nameKo;
  let uid = null;
  if (cands.length === 1) {
    const yes = await ctx.choose('confirmEffect', { player: p, prompt: `《아츠 진화》 — 사용 후 파기하는 대신 ${S.card(cands[0].cardId).nameKo}을(를) ${nm}(으)로 코스트 없이 진화시킬까요?`, cardId: id });
    if (yes) uid = cands[0].uid;
  } else {
    uid = await ctx.choose('pickStack', { player: p, uids: cands.map((s) => s.uid), prompt: `《아츠 진화》 — ${nm}(으)로 코스트 없이 진화시킬 카드 선택 (취소 = 그냥 파기)` });
    if (uid != null && !cands.some((s) => s.uid === uid)) uid = null;
  }
  if (uid == null || !findStack(state, p, uid)) { S.log(state, `${p} ${nm} 《아츠 진화》를 하지 않음 — 트래시로`); return; }
  S.artsDigivolve(state, p, id, uid);
};
SCRIPTS['*::__아츠진화'] = [{ op: 'dual_arts' }];
