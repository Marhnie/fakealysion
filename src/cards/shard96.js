// Shard 96 — attack-declaration keyword triggers (docs/fix-attack-timing.md).
// ≪돌진≫ (16-23) and ≪연계≫ (16-24) are TRIGGERED keyword effects "이 디지몬이 어택했을 때" (16-23-2 / 16-24-2): they trigger at the same moment as 【어택 시】
// (state.queueAttackDeclarationTriggers queues them as pseudo-tag '__돌진' / '__연계' pending items) and resolve in the normal pending queue, so the turn player
// orders them with their other triggers (4-3-2 / 15-8-3). Both are optional (16-23-3 / 16-24-3): a prompt at resolution, cancel = not used.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};
OPS.s96_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's96_fn', fn: f }]; };
const C = (id) => S.card(id);
const stackOfUid = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null; };

// the attack this trigger belongs to: still running, same attacker (a trigger of an attack that already ended / of another attack does nothing)
function liveAttack(ctx) {
  const pa = ctx.attack && ctx.attack();
  if (!pa || pa.ended || pa.attacker !== ctx.self || pa.uid !== ctx.sourceStackUid) return null;
  return stackOfUid(ctx.state, ctx.self, pa.uid) ? pa : null;
}

// 16-23-4: the highest-DP ACTIVE opposing Digimon (the player picks among ties); 16-23-3 optional; 11-2-7-3: not the current target.
sc('*::__돌진', async (ctx) => {
  const { state } = ctx; const pa = liveAttack(ctx); if (!pa) return;
  const targets = S.chargeRedirectTargets(state, ctx.self, pa.uid).filter((u) => !(pa.targetKind === 'digimon' && u === pa.targetUid));
  if (!targets.length) { S.log(state, `${ctx.self} ${C(state.players[ctx.self].battle.find((s) => s.uid === pa.uid).cardId).nameKo} 《돌진》 — 변경할 수 있는 대상이 없음`); return; }
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: targets, prompt: '《돌진》 — 어택의 대상을 가장 DP가 높은 액티브 상태의 상대 디지몬으로 변경할 수 있습니다 (취소=변경하지 않음)', chargeKw: true, optional: true });
  if (uid == null || !targets.includes(uid)) return;
  if (pa.ended || !liveAttack(ctx)) return;
  const aSt = stackOfUid(state, ctx.self, pa.uid);
  pa.targetKind = 'digimon'; pa.targetUid = uid; pa.chargeTarget = null; pa.chargeTargets = []; pa.redirectOptions = [];
  S.log(state, `${ctx.self} ${C(aSt.cardId).nameKo} 《돌진》 — 어택 대상을 ${C(state.players[S.opponentOf(ctx.self)].battle.find((s) => s.uid === uid).cardId).nameKo}(으)로 변경`);
  S.emitGameEvent(state, 'redirect', { owner: ctx.self, stack: aSt, cause: null, targetUid: uid });
});

// 16-24-3: the rest of another own Digimon is an optional cost; only when it is paid do the DP bonus (its DP at the moment it was rested, 16-24-4) and 《S 어택 +1》 follow
// (both until the end of the attack, 16-24-1 -> state.useChain / revertAtkEndBuffs).
sc('*::__연계', async (ctx) => {
  const { state } = ctx; const pa = liveAttack(ctx); if (!pa) return;
  const cands = S.chainOptions(state, ctx.self, pa.uid);
  if (!cands.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: cands, prompt: '《연계》 — 레스트시킬 다른 자신의 디지몬 1마리를 선택하면 그 DP를 더하고 《S 어택 +1》을 얻습니다 (취소=사용하지 않음)', chainKw: true, optional: true });
  if (uid == null || !cands.includes(uid)) return;
  if (!liveAttack(ctx)) return;
  if (S.useChain(state, ctx.self, pa.uid, uid)) { const a = stackOfUid(state, ctx.self, pa.uid); if (a) pa.dp = S.effectiveDP(state, ctx.self, a); }
});

// BT4-101 (granted "진화원을 갖지 않은 상대 디지몬에게 어택했을 때, 그 디지몬을 소멸시킨다", state.s1AttackTargeted): the digimon attacked at declaration, if it still has no evolution sources
sc('*::__어택소멸', async (ctx) => {
  const { state } = ctx; const uid = ctx.trigger && ctx.trigger.evtTargetUid; if (!uid) return;
  const oppP = S.opponentOf(ctx.self); const t = state.players[oppP].battle.find((s) => s.uid === uid);
  if (!t || t.sources.length > 0) return;
  S.log(state, `${ctx.self} ${C(state.players[ctx.self].battle.find((s) => s.uid === ctx.sourceStackUid)?.cardId || ctx.sourceCardId).nameKo} 효과: 진화원이 없는 ${C(t.cardId).nameKo} 소멸`);
  S.deleteStack(state, oppP, t.uid, 'trash', 'effect');
});
