// Shard 65 — fixes from the official card Q&A conformance run (slice 5; scripts/qa/qa-slice5-*.mjs).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
OPS.c65_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 'c65_fn', fn: f }]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const findStack = (state, p, uid) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean).find(s => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);

// BT23-024 포세이도몬 【서로의 턴】[턴 1회] 이 디지몬이 링크했을 때, 이 디지몬을 액티브로 하는 것으로, 상대의 턴 종료까지, 가장 등장 코스트가 높은 상대의 디지몬 이외의 상대의 디지몬 전부는 레스트할 수 없다.
// (official Q&A 5247-5252, 6025-6026: the exempt set is re-evaluated continuously — see the 'restExceptTop' timed lock in state.js canRestByRule)
hk('BT23-024', { tag: '서로의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT23-024::서로의 턴', async (ctx) => {
  const st = me(ctx); if (!st) return;
  if (!st.suspended) return; // 「액티브로 하는 것으로」: the cost cannot be paid by an already-active digimon
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 디지몬을 액티브로 하고, 상대의 레스트를 봉쇄할까요?' }))) return;
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
  (ctx.state.timedLocks ||= []).push({ player: opp(ctx.self), kind: 'restExceptTop', until: oppTurnEnd(ctx.state, ctx.self) });
  S.log(ctx.state, `${opp(ctx.self)}: 상대의 턴 종료까지 가장 등장 코스트가 높은 디지몬 이외는 레스트할 수 없음`);
});

// ---- "배틀 에어리어의 옵션 카드 1장을 파기하는 것으로" cost (P-203 Q5197/5198, BT23-059 Q5314-5323): the option may be EITHER player's battle-area option; with none available the cost cannot be paid -> the rest does not happen.
async function discardBattleOption(ctx, scope = 'any') {
  const { state } = ctx; const entries = [];
  for (const p of ['p1', 'p2']) { if (scope === 'opp' && p === ctx.self) continue; if (scope === 'own' && p !== ctx.self) continue; for (const s of state.players[p].battle) if (C(s.cardId).category === 'option') entries.push({ player: p, uid: s.uid }); }
  if (!entries.length) { S.log(state, `${ctx.self}: 배틀 에어리어에 파기할 옵션 카드가 없음`); return false; }
  const pk = entries.length === 1 ? entries[0] : await ctx.choose('pickStackAnySide', { entries, prompt: '파기할 배틀 에어리어의 옵션 카드 선택' });
  const hit = pk && entries.find(e => e.uid === pk.uid) ; if (!hit) return false;
  S.deleteStack(state, hit.player, hit.uid, 'trash', 'effect');
  return true;
}
SCRIPTS['P-203::등장 시'] = [{ op: 'c65_fn', fn: async (ctx, R) => {
  await R.runScript([{ op: 'retreat', target: 'opponent', n: 1 }], ctx);
  const st = me(ctx); if (!st) return;
  if (!(await discardBattleOption(ctx, 'any'))) return;
  S.grantKeyword(ctx.state, ctx.self, st.uid, '관통', undefined, 'turn'); S.grantKeyword(ctx.state, ctx.self, st.uid, '시큐리티어택', 1, 'turn');
} }];
SCRIPTS['BT23-059::등장 시'] = [{ op: 'c65_fn', fn: async (ctx, R) => {
  if (!(await discardBattleOption(ctx, 'any'))) return;
  const { FX_HELPERS } = await import('../effects.js');
  await R.runScript(FX_HELPERS.compileToScript('가장 등장 코스트가 낮은 상대의 디지몬 1마리를 소멸시킨다.'), ctx);
} }];

// BT23-083 페이 【서로의 턴】 자신의 시큐리티에 앞면의 카드가 놓였을 때, 그 카드가 특징 「잭슨」/「로얄 베이스」를 가진다면, 이 테이머를 레스트시키는 것으로, 메모리 +1. 또한, 자신의 패가 7장 이하라면, 《1 드로우》.
// (Q5356: the "또한" part needs the rest cost to be paid)
const hasTypeP = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
hk('BT23-083', { tag: '서로의 턴', has: '앞면의 카드가 놓였을 때', events: { faceUpSecurityAdded: (state, hp, h, info) => info.owner === hp && !h.suspended && hasTypeP(C(info.cardId), '잭슨', '로얄 베이스') } });
sc('BT23-083::서로의 턴', async (ctx, R) => {
  const st = me(ctx); if (!st || st.suspended) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 테이머를 레스트시키고 메모리 +1 (+ 패 7장 이하면 1드로우)?' }))) return;
  S.restStack(ctx.state, ctx.self, st.uid);
  await R.runScript([{ op: 'gainMemory', who: 'self', n: 1 }], ctx);
  if (ctx.state.players[ctx.self].hand.length <= 7) await R.runScript([{ op: 'draw', who: 'self', n: 1 }], ctx);
});

// EX10-061 아포카리몬 【등장 시】【진화 시】 이 디지몬의 진화원에서, 명칭이 서로 다른 특징 「어둠의 4천왕」을 가진 카드 1장씩을 코스트를 지불하지 않고 등장시킬 수 있다. 그 후, 턴 종료까지, 특징 「어둠의 4천왕」을 가진 자신의 디지몬 전부는 《속공》을 얻는다. 턴 종료 시, 이 효과로 등장한 디지몬을 소멸시킨다.
// (Q5785/5786: one card of EACH distinct name, as many as possible - no partial pick; the whole play is optional. A "1 each" list with a single qualifying name plays that one.)
SCRIPTS['EX10-061::등장 시'] = [{ op: 'c65_fn', fn: async (ctx) => {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const st = me(ctx); if (!st) return;
  const ok = (id) => C(id).category === 'digimon' && (C(id).types || []).includes('어둠의 4천왕');
  const byName = new Map(); st.sources.forEach((id, i) => { if (ok(id) && !byName.has(C(id).nameKo)) byName.set(C(id).nameKo, i); });
  const played = [];
  if (byName.size && await ctx.choose('confirmEffect', { player: who, prompt: `진화원의 「어둠의 4천왕」 ${byName.size}종(명칭이 서로 다른 것 1장씩)을 등장시킬까요?` })) {
    const idxs = [...byName.values()].sort((a, b) => b - a);
    const taken = idxs.map(i => st.sources[i]);
    for (const i of idxs) st.sources.splice(i, 1);
    S.recomputeStackGrants(st);
    for (const id of taken) { pl.trash.push(id); const ns = S.playFreeFromZone(state, who, 'trash', pl.trash.length - 1, { fromSources: true }); if (ns) played.push(ns.uid); }
  }
  for (const s of pl.battle) if (C(s.cardId).category === 'digimon' && (C(s.cardId).types || []).includes('어둠의 4천왕')) S.grantKeyword(state, who, s.uid, '속공', undefined, 'turn');
  if (played.length) S.scheduleEndOfTurn(state, () => { for (const uid of played) if (state.players[who].battle.some(x => x.uid === uid)) S.deleteStack(state, who, uid, 'trash', 'ownEffect'); }, { player: who, cardId: 'EX10-061', label: '이 효과로 등장한 디지몬을 소멸시킨다 (EX10-061)' });
} }];

// BT24-037 실피드몬 【서로의 턴】[턴에 1회] 이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서, Lv.4 이하의, 특징으로 「TS」를 가졌거나, 옐로/레드 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다. (own text + inherited copy; Q5618/5619: which cards may be played)
{
  const pred = (x) => C(x).category === 'digimon' && (C(x).level ?? 99) <= 4 && ((C(x).types || []).includes('TS') || (C(x).colors || []).some((c) => ['yellow', 'red'].includes(c)));
  for (const src of ['effectKo', 'inheritedKo']) hk('BT24-037', { tag: '서로의 턴', src, has: '자신의 효과 이외로 배틀 에어리어를 벗어날 때', limit: 1, onLeave: (state, hp, stack, cause) => cause !== 'ownEffect', noAuto: true });
  sc('BT24-037::서로의 턴@벗어날 때', async (ctx) => {
    const evt = ctx.trigger?.evt; if (!evt) return;
    const pl = ctx.state.players[ctx.self];
    const uniq = [...new Set((evt.sources || []).filter((id) => pl.trash.includes(id) && pred(id)))];
    if (!uniq.length) return;
    let pick = uniq[0];
    if (uniq.length > 1) { pl.s65tmp = uniq; try { const k = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's65tmp', eligibleIdxs: uniq.map((_, i) => i), prompt: '등장시킬 진화원 카드 선택 (취소=안 함)' }); pick = k == null ? null : uniq[k]; } finally { delete pl.s65tmp; } }
    else if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `${C(uniq[0]).nameKo}을(를) 코스트를 지불하지 않고 등장시킬까요?` }))) pick = null;
    if (!pick) return;
    const i = pl.trash.lastIndexOf(pick); if (i >= 0) S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true });
  });
}
