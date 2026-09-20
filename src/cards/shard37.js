// Shard 37 — batch 7 verification fixes (BT19 / BT20 / BT21 per-card scripts). See docs/verify-sets-BT19-21.md.
// SCRIPTS  triggered/main effects (one generic op s37_fn runs a JS function per card)
// HOOKS    continuous / replacement / event-driven abilities consumed by state.js
import * as S from '../state.js';
// effects.js imports cards/index.js, so nothing from effects.js may be CALLED at load time (FX_HELPERS only inside functions).
import { FX_HELPERS } from '../effects.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const findStack = (state, p, uid) => stacksOf(state, p).find(s => s.uid === uid) || null;
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const hasType = (c, ...ts) => ts.some(t => (c.types || []).includes(t));
const typeIncl = (c, ...ts) => ts.some(t => (c.types || []).some(x => x.includes(t)));
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);
OPS.s37_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's37_fn', fn: f }]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };

async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt, optional = false) {
  if (!stacks.length) return null;
  if (stacks.length === 1 && !optional) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
async function pickZone(ctx, who, zone, pred, prompt) {
  const pl = ctx.state.players[who];
  const idxs = pl[zone].map((id, i) => i).filter(i => pred(C(pl[zone][i]), pl[zone][i]));
  if (!idxs.length) return null;
  return ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
}
// a stack that appeared in `p`'s battle area since `before` (array of uids)
const newStack = (state, p, before) => state.players[p].battle.find(s => !before.includes(s.uid)) || null;
const uidsOf = (state, p) => state.players[p].battle.map(s => s.uid);
// trash a battle-area option card (sources + card) — same as shard5 BT19-062
function trashBattleOption(state, p, st) {
  const pl = state.players[p];
  pl.battle.splice(pl.battle.indexOf(st), 1);
  pl.trash.push(...st.sources, st.cardId);
  S.log(state, `${p} 배틀 에어리어의 ${C(st.cardId).nameKo} 파기`);
}

// ================================================================== BT19
// BT19-002 (inherited, 상대의 턴): 상대의 디지몬이 어택했을 때, 「수생」을 포함하는 이 디지몬을 덱 아래로 되돌리는 것으로, 되돌린 디지몬의 Lv. 이하의 상대의 디지몬 1마리를 패로.
sc('BT19-002::상대의 턴', async (ctx, R) => {
  const { state } = ctx, st = me(ctx); if (!st || !isDig(st)) return;
  const c = C(st.cardId);
  if (!typeIncl(c, '수생')) return;
  if (!(await ask(ctx, `${c.nameKo}을(를) 덱 아래로 되돌려 상대의 디지몬을 패로 되돌릴까요?`))) return;
  ctx._lastPickInfo = { level: c.level || 0, dp: S.effectiveDP(state, ctx.self, st), cost: c.cost || 0 };
  await R.runScript([{ op: 'returnToHandStripSources', thisStack: true, n: 1, filter: {}, requireSuspended: null, dest: 'deckBottom' }], ctx);
  if (state.players[ctx.self].battle.includes(st)) return; // it did not leave (replaced/prevented): no payment, no effect
  await R.runScript([{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { ref: 'pick', refStat: 'level' }, requireSuspended: null, dest: 'hand' }], ctx);
});

// BT19-031 (소멸 시): 테이머 아래의 「슈팅스타몬」을 무료 등장 → 그 후, 트래시의 「스타몬즈」와 「픽크몬즈」 1장씩을 그 디지몬의 진화원 아래에 놓는다
sc('BT19-031::소멸 시', async (ctx, R) => {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const before = uidsOf(state, who);
  await R.runScript([{ op: 'playFreeTamerUnder', who: 'self', zones: [], filter: { exactAny: ['슈팅스타몬'] }, n: 1, rested: false, noTriggers: false, optional: true }], ctx);
  const played = newStack(state, who, before);
  if (!played) return;
  for (const nm of ['스타몬즈', '픽크몬즈']) {
    const idx = await pickZone(ctx, who, 'trash', (c) => c.nameKo === nm, `트래시의 「${nm}」 1장을 ${C(played.cardId).nameKo}의 진화원 아래에 놓기`);
    if (idx == null) continue;
    const [id] = pl.trash.splice(idx, 1);
    played.sources.splice(S.fdCount(played), 0, id);
    S.recomputeStackGrants(played);
    S.log(state, `${who} 트래시의 ${C(id).nameKo}을(를) ${C(played.cardId).nameKo}의 진화원 아래에 놓음`);
  }
});

// BT19-064 (진화 시/어택 시, 턴에 1회): 배틀 에어리어의 옵션 카드 1장을 파기하는 것으로, 이 디지몬을 액티브로 한다.
for (const tag of ['진화 시', '어택 시']) sc(`BT19-064::${tag}`, async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self], st = me(ctx); if (!st) return;
  const opts = pl.battle.filter(s => C(s.cardId).category === 'option');
  if (!opts.length) return;
  const o = await pickStack(ctx, ctx.self, opts, '파기할 배틀 에어리어의 옵션 카드 선택 (이 디지몬을 액티브로 함)', true);
  if (!o) return;
  trashBattleOption(state, ctx.self, o);
  S.unsuspendStack(state, ctx.self, st.uid);
});

// BT19-086 이재익
sc('BT19-086::자신의 메인 페이즈 개시 시', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const idx = await pickZone(ctx, ctx.self, 'hand', (c) => c.category === 'option' && hasType(c, '디바이스'), '배틀 에어리어에 놓을 「디바이스」 옵션 선택 (취소=안 함)');
  if (idx == null) return;
  const [id] = pl.hand.splice(idx, 1);
  pl.trash.push(id);
  const placed = S.placeThisInBattle(state, ctx.self, id);
  if (!placed) { const i = pl.trash.lastIndexOf(id); if (i >= 0) pl.trash.splice(i, 1); pl.hand.push(id); return; }
  S.drawCards(state, ctx.self, 1);
});
sc('BT19-086::메인', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self], st = me(ctx); if (!st) return;
  const devs = pl.battle.filter(s => C(s.cardId).category === 'option' && hasType(C(s.cardId), '디바이스'));
  if (st.suspended || devs.length < 4) { S.log(state, '이재익: 비용을 지불할 수 없음 (액티브 테이머 + 배틀 에어리어의 「디바이스」 옵션 4장 필요)'); return; }
  if (!(await ask(ctx, '이 테이머를 레스트하고 「디바이스」 옵션 4장을 파기하겠습니까?'))) return;
  const chosen = [];
  for (let i = 0; i < 4; i++) {
    const left = devs.filter(d => !chosen.includes(d));
    const p = left.length === 4 - i ? left[0] : await pickStack(ctx, ctx.self, left, `파기할 「디바이스」 옵션 선택 (${i + 1}/4)`);
    if (!p) return;
    chosen.push(p);
  }
  S.restStack(state, ctx.self, st.uid);
  for (const d of chosen) trashBattleOption(state, ctx.self, d);
  await R.runScript([{ op: 'playFree', who: 'self', zone: 'any', filter: { exactAny: ['사이버드라몬'] }, rested: false, noTriggers: false, optional: true }], ctx);
});

// ------------------------------------------------------------------ sentence-sequence helper
// Several BT19-21 texts are "<sentence 1>. 그 후, <sentence 2>." where a condition/cost belongs to ONE sentence only, or the generic compiler mangles the
// whole segment.  A step is a plain sentence (compiled + run), [conditionText, sentence] (condition evaluated at run time), or a function(ctx, R).
async function condOK(ctx, text) { return !!(await FX_HELPERS.condTestFor(text)(ctx)); }
const seq = (key, steps) => sc(key, async (ctx, R) => {
  for (const s of steps) {
    if (typeof s === 'string') await R.runScript(R.compileToScript(s), ctx);
    else if (Array.isArray(s)) { if (await condOK(ctx, s[0])) await R.runScript(R.compileToScript(s[1]), ctx); }
    else await s(ctx, R);
  }
});
const lockOppPlay = (ctx) => S.addTimedLock(ctx.state, ctx.opp, 'effectPlay', oppTurnEnd(ctx.state, ctx.self));

// BT19-070 (등장 시/진화 시): 자신의 디지몬 1마리를 소멸시키는 것으로 (ONE cost), Lv.3과 Lv.4와 Lv.5의 상대의 디지몬 1마리씩을 소멸시킨다.
sc('BT19-070::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const mine = digs(state, ctx.self);
  if (!mine.length) return;
  if (!(await ask(ctx, '자신의 디지몬 1마리를 소멸시켜 Lv.3/4/5의 상대 디지몬을 1마리씩 소멸시킬까요?'))) return;
  const own = await pickStack(ctx, ctx.self, mine, '소멸시킬 자신의 디지몬 선택 (비용)');
  if (!own) return;
  S.deleteStack(state, ctx.self, own.uid, 'trash', 'ownEffect');
  for (const lv of [3, 4, 5]) {
    const t = await pickStack(ctx, o, digs(state, o).filter(s => (C(s.cardId).level || 0) === lv), `소멸시킬 Lv.${lv}의 상대 디지몬 선택`);
    if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
  }
});
SCRIPTS['BT19-070::진화 시'] = SCRIPTS['BT19-070::등장 시'];

// ================================================================== BT20
// BT20-019 (진화 시): 「제스몬」/「X항체」가 진화원에 있다면 → 자신의 디지몬 1마리는 상대의 효과를 받지 않는다 (턴 종료까지). 그 후, 자신의 디지몬 1마리로 어택할 수 있다 (separate, unconditional sentence).
seq('BT20-019::진화 시', [
  async (ctx, R) => { if (await condOK(ctx, '이 디지몬의 진화원에 「제스몬」/「X항체」가 있다면')) await R.runScript([{ op: 's4_shield', kinds: ['all'], dur: 'turn' }], ctx); },
  '자신의 디지몬 1마리로 어택할 수 있다.',
]);
// BT20-020 (진화 시): 상대의 턴 종료까지 상대는 디지몬과 테이머를 효과로 등장시킬 수 없다. 그 후, 진화원에 「황제드라몬: 드래곤 모드」가 있다면 상대의 시큐리티를 위에서부터 1장 파기.
seq('BT20-020::진화 시', [
  (ctx) => lockOppPlay(ctx),
  ['이 디지몬의 진화원에 「황제드라몬: 드래곤 모드」가 있다면', '상대의 시큐리티를 위에서부터 1장 파기한다.'],
]);
// BT20-021 (어택 시, 턴에 1회): 이 디지몬을 액티브로 한다. 그 후, 진화원의 「로얄 나이츠」 카드 2장마다 상대의 시큐리티를 위에서부터 1장 파기.
sc('BT20-021::어택 시', async (ctx, R) => {
  const { state } = ctx, st = me(ctx); if (!st) return;
  S.unsuspendStack(state, ctx.self, st.uid);
  const n = Math.floor(st.sources.filter(id => hasType(C(id), '로얄 나이츠')).length / 2);
  for (let i = 0; i < n; i++) await R.runScript([{ op: 'removeSecurity', who: 'opponent', position: 'top' }], ctx);
});
// BT20-028 (진화 시/어택 시, 턴에 1회): 진화원에 「메탈시드라몬」/「X항체」가 있는 이 디지몬의 진화원에서 Lv.5 이하의 디지몬 카드 1장을 무료 등장 (optional)
seq('BT20-028::진화 시', [
  ['이 디지몬의 진화원에 「메탈시드라몬」/「X항체」가 있다면', '이 디지몬의 진화원에서 Lv.5 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.'],
]);
// BT20-041 (등장 시/진화 시): 상대의 디지몬 1마리를 레스트시키고, 턴 종료까지 자신의 디지몬 1마리를 DP +3000. 그 후, 자신의 디지몬 1마리로 어택할 수 있다. (rest → DP → attack)
seq('BT20-041::등장 시', ['상대의 디지몬 1마리를 레스트시키고, 턴 종료까지 자신의 디지몬 1마리를 DP +3000.', '자신의 디지몬 1마리로 어택할 수 있다.']);
SCRIPTS['BT20-041::진화 시'] = SCRIPTS['BT20-041::등장 시'];
// BT20-043 (등장 시/진화 시): 상대의 디지몬 전부를 레스트시키고, 턴 종료까지 자신의 디지몬 1마리를 DP +3000. 그 후, 자신의 디지몬 1마리로 어택할 수 있다.
seq('BT20-043::등장 시', ['상대의 디지몬 전부를 레스트시키고, 턴 종료까지 자신의 디지몬 1마리를 DP +3000.', '자신의 디지몬 1마리로 어택할 수 있다.']);
SCRIPTS['BT20-043::진화 시'] = SCRIPTS['BT20-043::등장 시'];
// BT20-055 (등장 시/진화 시): 상대의 디지몬 1마리를 《퇴화 2》하고, 상대의 뒷면의 시큐리티를 위에서부터 1장 앞면으로 한다. 그 후, 진화원 매수가 1장 이하의 상대의 디지몬 1마리를 소멸시킨다.
sc('BT20-055::등장 시', async (ctx, R) => {
  await R.runScript([{ op: 'retreat', target: 'opponent', n: 2 }], ctx);
  S.secFlipTopFaceUp(ctx.state, opp(ctx.self));
  await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { srcMax: 1 } }], ctx);
});
SCRIPTS['BT20-055::진화 시'] = SCRIPTS['BT20-055::등장 시'];

// ================================================================== BT21
// BT21-004 (inherited, untagged): 옐로/레드인 자신의 테이머가 레스트했을 때, 《1 드로우》.
hk('BT21-004', { tag: '테이머 레스트', src: 'inheritedKo', text: '《1 드로우》', events: { rest: (state, hp, h, info) => info.owner === hp && !!info.stack && isTam(info.stack) && S.stackColors(info.stack).some(c => c === 'yellow' || c === 'red') } });
sc('BT21-004::테이머 레스트', async (ctx, R) => { await R.runScript([{ op: 'draw', who: 'self', n: 1 }], ctx); });
// BT21-055 (inherited, untagged): 이 카드가 특징 「광물형」/「암석형」을 가진 디지몬의 진화원에서 효과로 파기되었을 때, 등장 코스트 4 이하의 상대의 디지몬 1마리를 소멸시킨다. (acts from the trash: the card itself was the trashed source)
hk('BT21-055', { tag: '진화원에서 파기', src: 'inheritedKo', zone: 'trash', text: '등장 코스트 4 이하의 상대의 디지몬 1마리를 소멸시킨다.',
  events: { sourcesTrashed: (state, hp, h, info) => info.owner === hp && (info.cause === 'effect' || info.cause === 'ownEffect') && (info.ids || []).includes('BT21-055') && !!info.stack && typeIncl(C(info.stack.cardId), '광물형', '암석형') } });
sc('BT21-055::진화원에서 파기', async (ctx, R) => { await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 4 } }], ctx); });
// BT21-024 (등장 시/진화 시): 상대의 시큐리티가 5장 이하라면, 상대는 본인의 패 1장을 시큐리티 아래에 놓는다. 그 후, 상대의 시큐리티를 위에서부터 1장 파기한다.
sc('BT21-024::등장 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self), opl = state.players[o];
  if (opl.security.length <= 5 && opl.hand.length) {
    const r = await ctx.choose('pickFromHandIndexes', { player: o, eligibleIdxs: opl.hand.map((id, i) => i), n: 1, prompt: '시큐리티 아래에 놓을 패 1장 선택 (상대 효과)' });
    const idx = (Array.isArray(r) ? r[0] : r) ?? 0;
    const [id] = opl.hand.splice(idx, 1);
    S.addToSecurity(state, o, id, 'bottom');
    S.log(state, `${o} 패의 ${C(id).nameKo}을(를) 시큐리티 아래에 놓음`);
  }
  await R.runScript([{ op: 'removeSecurity', who: 'opponent', position: 'top' }], ctx);
});
SCRIPTS['BT21-024::진화 시'] = SCRIPTS['BT21-024::등장 시'];
// BT21-044 (등장 시/진화 시): 턴 종료까지 자신의 「최건우」 1명은 디지몬·DP 3000으로도 취급하고, 진화할 수 없으며, 《속공》과 《연계》를 얻는다. 그 후, 자신의 디지몬 1마리로 어택할 수 있다.
sc('BT21-044::등장 시', async (ctx, R) => {
  const { state } = ctx, p = ctx.self;
  const st = await pickStack(ctx, p, tams(state, p).filter(s => C(s.cardId).nameKo === '최건우'), '디지몬으로 취급할 「최건우」 선택');
  if (st) {
    st.s2AsDigimon = true; st.s2NoEvolve = true;
    (st.baseOv ||= []).push({ ts: S.stamp(), until: state.turnNumber, dp: 3000 }); S.refreshBaseInfo(state, st); // a Tamer has no DP: treat its DP as 3000 (modifyDP would be refused by 2-5-3)
    S.scheduleEndOfTurn(state, () => { st.s2AsDigimon = false; st.s2NoEvolve = false; }, { expire: true });
    S.grantKeyword(state, p, st.uid, '속공', undefined, 'turn');
    S.grantKeyword(state, p, st.uid, '연계', undefined, 'turn');
    S.log(state, `${p} ${C(st.cardId).nameKo}: 턴 종료까지 디지몬·DP 3000으로도 취급, 진화 불가, 《속공》《연계》`);
  }
  await R.runScript(R.compileToScript('자신의 디지몬 1마리로 어택할 수 있다.'), ctx);
});
SCRIPTS['BT21-044::진화 시'] = SCRIPTS['BT21-044::등장 시'];
// BT21-066 (소멸 시): 자신의 패/트래시에서 《세이브》가 기술되어 있거나 특징 「히어로」를 가진 디지몬 카드 1장을 자신의 테이머 아래에 놓을 수 있다. 그 후, 《세이브》.
sc('BT21-066::소멸 시', async (ctx, R) => {
  await R.runScript([{ op: 'placeUnderTamer', who: 'self', zones: ['hand', 'trash'], filter: { category: 'digimon', anyOf: [{ keywordText: '세이브' }, { traitAny: ['히어로'] }] }, n: 1 }, { op: 'saveUnderTamer' }], ctx);
});
// BT21-085 (메인): 이 테이머를 레스트시키고, 특징 「아머체」를 가진 자신의 디지몬 1마리에 겹쳐져 있는 카드를 위에서부터 1장 파기하는 것으로, 《1 드로우》, 메모리 +1.
sc('BT21-085::메인', async (ctx, R) => {
  const { state } = ctx, p = ctx.self, st = me(ctx); if (!st) return;
  const armor = digs(state, p).filter(s => hasType(C(s.cardId), '아머체') && s.sources.length > 0);
  if (st.suspended || !armor.length) { S.log(state, '최산해: 비용을 지불할 수 없음 (액티브 테이머 + 진화원이 있는 「아머체」 디지몬 필요)'); return; }
  if (!(await ask(ctx, '이 테이머를 레스트하고 「아머체」 디지몬의 진화원 맨 위 1장을 파기하겠습니까?'))) return;
  const t = await pickStack(ctx, p, armor, '진화원 맨 위 1장을 파기할 「아머체」 디지몬 선택');
  if (!t) return;
  S.restStack(state, p, st.uid);
  const removed = S.trashEvoSources(state, p, t.uid, 1, 'top');
  if (!removed.length) return;
  await R.runScript([{ op: 'draw', who: 'self', n: 1 }, { op: 'gainMemory', who: 'self', n: 1 }], ctx);
});

// ================================================================== watchers / hooks
// BT19-082 (자신의 턴): 특징 「수생」을 포함하는 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로 (cost paid by the watcher gate), 자신의 패에서 「수생」을 포함하는 Lv.5 이하의 디지몬 카드 1장을 그 디지몬의 진화원 아래에 놓을 수 있다.
sc('BT19-082::자신의 턴', async (ctx) => {
  const { state } = ctx, who = ctx.self, pl = state.players[who];
  const tgt = ctx.trigger?.evtStackUid ? findStack(state, who, ctx.trigger.evtStackUid) : null;
  if (!tgt) return;
  const idx = await pickZone(ctx, who, 'hand', (c) => c.category === 'digimon' && typeIncl(c, '수생') && (c.level || 0) <= 5, `${C(tgt.cardId).nameKo}의 진화원 아래에 놓을 「수생」 디지몬 선택 (취소=안 함)`);
  if (idx == null) return;
  const [id] = pl.hand.splice(idx, 1);
  tgt.sources.splice(S.fdCount(tgt), 0, id);
  S.recomputeStackGrants(tgt);
  S.log(state, `${who} 패의 ${C(id).nameKo}을(를) ${C(tgt.cardId).nameKo}의 진화원 아래에 놓음`);
});
// BT20-084 ([트래시]【서로의 턴】): 자신의 디지몬이 등장했을 때, 자신의 「시스터몬 시엘」 1마리를 이 카드(트래시)로 코스트를 지불하지 않고 진화시킬 수 있다.
hk('BT20-084', { tag: '서로의 턴', zone: 'trash', events: { play: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && state.players[hp].trash.includes('BT20-084') && digs(state, hp).some(s => C(s.cardId).nameKo === '시스터몬 시엘') } });
sc('BT20-084::서로의 턴', async (ctx) => {
  const { state, E } = ctx, who = ctx.self, pl = state.players[who];
  const ti = pl.trash.lastIndexOf('BT20-084'); if (ti < 0) return;
  const cands = digs(state, who).filter(s => C(s.cardId).nameKo === '시스터몬 시엘' && E.canEvolveAny(s.cardId, 'BT20-084', S.evoExtraArg(state, null, s), S.evolveTargetRestriction(state, who, s)).ok);
  const st = await pickStack(ctx, who, cands, '이 카드로 진화시킬 「시스터몬 시엘」 선택 (취소=안 함)', true);
  if (!st) return;
  const i2 = pl.trash.lastIndexOf('BT20-084'); if (i2 < 0) return;
  pl.trash.splice(i2, 1);
  if (!S.digivolve(state, who, st.uid, 'BT20-084', 0, 'trash')) pl.trash.push('BT20-084');
});
// BT21-029 (서로의 턴, 턴 1회): 상대의 디지몬이 소멸했을 때 또는 상대의 시큐리티가 줄어들었을 때, 상대는 「석화」 토큰 1마리를 등장시킨다. (generic watcher parsed the "또는" clause as the effect text and did nothing)
hk('BT21-029', { tag: '서로의 턴', has: '소멸했을 때 또는', limit: 1, events: {
  delete: (state, hp, h, info) => info.owner !== hp && isDig(info.stack),
  securityDecrease: (state, hp, h, info) => info.owner !== hp,
} });
// BT21-044 (서로의 턴, 턴 1회): 옐로/레드인 자신의 테이머가 소멸했을 때, 자신의 트래시에서 「최건우」 1장을 시큐리티 위에 놓을 수(는) 있다 / 놓는다.
const putChoiWoo = { op: 'placeSecurity', who: 'self', zones: ['trash'], filter: { exactAny: ['최건우'] }, position: 'top', faceUp: false, optional: true };
SCRIPTS['BT21-044::서로의 턴@놓을 수 있다'] = [putChoiWoo];
SCRIPTS['BT21-044::서로의 턴@놓는다.'] = [{ ...putChoiWoo, optional: false }];
// BT21-089 (서로의 턴): 자신의 디지몬이 등장/진화했을 때, 이 테이머를 레스트시키는 것으로(gate), 「길몬」/「그라우몬」/「듀크몬」/「메기드라몬」을 포함하거나 특징 「히어로」를 가진 자신의 디지몬 1마리는 상대의 턴 종료까지 《블로커》를 얻고, 서로의 트래시의 합계가 10장 이상이라면, DP +2000.
sc('BT21-089::서로의 턴', async (ctx) => {
  const { state } = ctx, who = ctx.self;
  const okC = (c) => ['길몬', '그라우몬', '듀크몬', '메기드라몬'].some(n => c.nameKo.includes(n)) || hasType(c, '히어로');
  const t = await pickStack(ctx, who, digs(state, who).filter(s => okC(C(s.cardId))), '《블로커》를 얻을 자신의 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, who, t.uid, '블로커', undefined, 'opponentTurn');
  if (state.players.p1.trash.length + state.players.p2.trash.length >= 10) S.modifyDP(state, who, t.uid, 2000, 'opponentTurn');
});

// ---- leave-the-battle-area triggers (descriptor.onLeave: the stack is already gone; pending.evt.sources lists its former evolution cards, now in the trash)
async function pickIdxOf(ctx, who, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[who];
  pl.s37tmp = ids;
  try { return await ctx.choose('pickFromZoneIndex', { player: who, zone: 's37tmp', eligibleIdxs: idxs, prompt }); } finally { delete pl.s37tmp; }
}
async function playLeftSource(ctx, pred, label) {
  const evt = ctx.trigger?.evt; if (!evt) return;
  const pl = ctx.state.players[ctx.self];
  const cand = (evt.sources || []).filter((id) => pl.trash.includes(id) && C(id).category === 'digimon' && pred(C(id)));
  if (!cand.length) return;
  const uniq = [...new Set(cand)];
  const k = await pickIdxOf(ctx, ctx.self, uniq, uniq.map((_, i) => i), `${label} 선택 (취소=안 함)`);
  if (k == null) return;
  const i = pl.trash.lastIndexOf(uniq[k]);
  if (i >= 0) S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true });
}
// BT19-041 (서로의 턴, 턴에 1회): 이 디지몬이 배틀 에어리어를 벗어날 때, 자신의 시큐리티가 2장 이하라면, 《리커버리 +1《덱》》.
hk('BT19-041', { tag: '서로의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', limit: 1, onLeave: () => true });
sc('BT19-041::서로의 턴', async (ctx, R) => { if (ctx.state.players[ctx.self].security.length <= 2) await R.runScript([{ op: 'recoverTop', who: 'self' }], ctx); });
// BT20-054 (상대의 턴): 이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 등장 코스트 4 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
hk('BT20-054', { tag: '상대의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', onLeave: () => true });
sc('BT20-054::상대의 턴', async (ctx) => { await playLeftSource(ctx, (c) => (c.cost ?? 99) <= 4, '등장시킬 진화원 카드 (등장 코스트 4 이하)'); });
// BT20-058 (서로의 턴): 이 디지몬이 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 특징으로 「머신형」/「사이보그형」을 가진 등장 코스트 11 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
hk('BT20-058', { tag: '서로의 턴', has: '이 디지몬이 배틀 에어리어를 벗어날 때', onLeave: () => true });
sc('BT20-058::서로의 턴', async (ctx) => { await playLeftSource(ctx, (c) => hasType(c, '머신형', '사이보그형') && (c.cost ?? 99) <= 11, '등장시킬 진화원 카드 (머신형/사이보그형, 등장 코스트 11 이하)'); });
// BT20-091 (상대의 턴, 턴에 1회): 특징으로 「로얄 나이츠」를 가진 자신의 디지몬이 배틀 에어리어를 벗어날 때, 자신의 패에서 「오메카몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
hk('BT20-091', { tag: '상대의 턴', has: '배틀 에어리어를 벗어날 때', limit: 1, events: { leaveBattle: (state, hp, h, info) => info.owner === hp && !!info.cardId && C(info.cardId).category === 'digimon' && hasType(C(info.cardId), '로얄 나이츠') } });
sc('BT20-091::상대의 턴', async (ctx, R) => { await R.runScript([{ op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: ['오메카몬'] }, rested: false, noTriggers: false, optional: true }], ctx); });

// ================================================================== continuous grants to OTHER Digimon (the generic "…전부는 《K》를 얻는다" parser only handles ONE effect per sentence)
const isDigStack = (t) => !!t && C(t.cardId).category === 'digimon';
const isGX = (h) => C(h.cardId).nameKo === '제스몬GX'; // "이 디지몬이 「제스몬GX」인 동안" (the holder's current top card)
const rkOrName = (names) => (c) => names.some(n => c.nameKo.includes(n)) || hasType(c, '로얄 나이츠');
// BT20-019 【자신의 턴】: 명칭에 「시스터몬」을 포함하거나 특징으로 「로얄 나이츠」를 가진 자신의 디지몬 전부는 《관통》을 얻고, 액티브 상태인 상대의 디지몬에게도 어택할 수 있다. (inherited: 이 디지몬이 「제스몬GX」인 동안, 자신의 디지몬 전부는 …)
hk('BT20-019', { tag: '자신의 턴', has: '《관통》을 얻고, 액티브 상태인',
  grantKw: (state, hp, h, t) => (isDigStack(t) && rkOrName(['시스터몬'])(C(t.cardId)) ? ['관통'] : []),
  attackAnyActiveFor: (state, hp, h, t) => isDigStack(t) && rkOrName(['시스터몬'])(C(t.cardId)) });
hk('BT20-019', { tag: '자신의 턴', src: 'inheritedKo', has: '《관통》을 얻고, 액티브 상태인',
  grantKw: (state, hp, h, t) => (isDigStack(t) && isGX(h) ? ['관통'] : []),
  attackAnyActiveFor: (state, hp, h, t) => isDigStack(t) && isGX(h) });
// BT20-059 【상대의 턴】: 명칭에 「시스터몬」/「헉몬」을 포함하거나 특징으로 「로얄 나이츠」를 가진 자신의 디지몬 전부는 《재기동》과 《블로커》를 얻는다. (inherited: 이 디지몬이 「제스몬GX」인 동안, 자신의 디지몬 전부는 …)
hk('BT20-059', { tag: '상대의 턴', has: '《재기동》과 《블로커》를 얻는다', grantKw: (state, hp, h, t) => (isDigStack(t) && rkOrName(['시스터몬', '헉몬'])(C(t.cardId)) ? ['재기동', '블로커'] : []) });
hk('BT20-059', { tag: '상대의 턴', src: 'inheritedKo', has: '《재기동》과 《블로커》를 얻는다', grantKw: (state, hp, h, t) => (isDigStack(t) && isGX(h) ? ['재기동', '블로커'] : []) });
// BT20-077 【서로의 턴】: 특징으로 「마룡형」/「사룡형」을 가진 자신의 디지몬 전부는 《속공》과 《블로커》를 얻고, DP +2000.
{ const dragon = (t) => isDigStack(t) && hasType(C(t.cardId), '마룡형', '사룡형');
  hk('BT20-077', { tag: '서로의 턴', has: '《속공》과 《블로커》를 얻고, DP +2000',
    grantKw: (state, hp, h, t) => (dragon(t) ? ['속공', '블로커'] : []),
    dp: (state, hp, h, t, tp) => (tp === hp && dragon(t) && state.players[hp].battle.includes(t) ? 2000 : 0) }); }

// ================================================================== hand play-cost reductions printed as "이 카드가 등장할 때, …지불하는 (등장) 코스트 -N"
// (handSelfPlayDiscount only parses the "패의 이 카드를 등장시킬 때," spelling)
// BT20-036 / BT20-043: 이 카드가 등장할 때, 특징으로 「액셀」을 가진 자신의 디지몬이 있다면, 지불하는 등장 코스트 -5.
for (const id of ['BT20-036', 'BT20-043']) hk(id, { tag: '__handPlay', selfPlayDiscount: (state, hp) => (digs(state, hp).some((s) => hasType(C(s.cardId), '액셀', '엑셀')) ? -5 : 0) });
// BT21-026: 이 카드가 등장할 때, 상대의 디지몬 1마리마다 지불하는 코스트 -2.
hk('BT21-026', { tag: '__handPlay', selfPlayDiscount: (state, hp) => -2 * digs(state, opp(hp)).length });
// BT21-020 (printed on the card being evolved INTO): 진화원에 「아그니몬」/「브리트라몬」이 있는 자신의 디지몬이 패의 이 카드로 진화할 때, 지불하는 코스트 -1.
hk('BT21-020', { tag: '__evoTarget', selfEvoDiscount: (state, p, stack) => ((stack.sources || []).slice(S.fdCount(stack)).some((id) => S.cardNames(id).some((n) => n === '아그니몬' || n === '브리트라몬')) ? -1 : 0) });

// ================================================================== fixes to earlier shards' scripts (later shard wins in cards/index.js)
// BT20-015 【등장 시】【진화 시】: 자신의 패에서 「도루몬」/「류우다몬」 1장을 비어 있는 자신의 육성 에어리어에 코스트를 지불하지 않고 등장시킬 수 있다. 그 후, 어택 중이라면, 상대의 턴 종료까지 자신의 디지몬 1마리는 《S 어택 +1》을 얻고, DP +5000.
// (shard13's version stopped after the raising-area play and dropped the second sentence)
sc('BT20-015::등장 시', async (ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  if (!pl.raising) {
    const idx = await pickZone(ctx, p, 'hand', (c) => c.category === 'digimon' && ['도루몬', '류우다몬'].includes(c.nameKo), '비어 있는 육성 에어리어에 등장시킬 「도루몬」/「류우다몬」 선택 (취소=안 함)');
    if (idx != null) {
      const [id] = pl.hand.splice(idx, 1);
      pl.raising = S._s4.makeStack(id, state.turnNumber); S.recomputeStackGrants(pl.raising);
      S.log(state, `${p} ${C(id).nameKo}을(를) 육성 에어리어에 코스트 없이 등장`);
    }
  }
  if (!state.attackCtx || state.attackCtx.attacker !== p) return; // 어택 중이라면
  const t = await pickStack(ctx, p, digs(state, p), '《S 어택 +1》과 DP +5000을 얻을 자신의 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, p, t.uid, '시큐리티어택', 1, 'opponentTurn');
  S.modifyDP(state, p, t.uid, 5000, 'opponentTurn');
});
// BT20-033 【등장 시】【진화 시】: 상대의 턴 종료까지 상대의 디지몬 1마리의 【진화 시】 효과는 발휘하지 않고, DP -3000. (shard5 used a 'turn' DP duration: the -3000 ended with the caster's own turn)
sc('BT20-033::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const t = await pickStack(ctx, o, digs(state, o), '【진화 시】 효과를 봉인하고 DP -3000할 상대 디지몬 선택');
  if (!t) return;
  t.noEvoTrigUntil = oppTurnEnd(state, ctx.self);
  S.modifyDP(state, o, t.uid, -3000, 'opponentTurn');
});
SCRIPTS['BT20-033::진화 시'] = SCRIPTS['BT20-033::등장 시'];
// BT20-005 (inherited, 자신의 턴): 이 디지몬이 앞면의 시큐리티를 체크했을 때, 턴 종료까지 이 디지몬은 《재밍》을 얻는다.
hk('BT20-005', { tag: '자신의 턴', src: 'inheritedKo', has: '앞면의 시큐리티를 체크했을 때', events: { faceUpChecked: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT20-005::자신의 턴', async (ctx) => { const st = me(ctx); if (st) S.grantKeyword(ctx.state, ctx.self, st.uid, '재밍', undefined, 'turn'); });

// ================================================================== more dead effects found by the audit
// BT20-015 / BT20-074 (inherited, 자신의 턴): 이 디지몬이 체크한 옵션 카드의 【시큐리티】 효과는 발휘하지 않는다. BT20-071: 특징 「SoC」/「시커즈」를 가진 이 디지몬이 체크한 …
for (const [id, needTrait] of [['BT20-015', null], ['BT20-074', null], ['BT20-071', ['SoC', '시커즈']]]) {
  hk(id, { tag: '자신의 턴', src: 'inheritedKo', has: '체크한 옵션 카드의 【시큐리티】', suppressSecurity: (state, hp, h, revealedId) => C(revealedId).category === 'option' && (!needTrait || hasType(C(h.cardId), ...needTrait)) });
}
// BT20-028 (서로의 턴, 턴에 1회): 진화원에서 자신의 디지몬이 등장했을 때, 상대의 디지몬 1마리를 《퇴화 2》.
hk('BT20-028', { tag: '서로의 턴', has: '진화원에서 자신의 디지몬이 등장했을 때', limit: 1, events: { play: (state, hp, h, info) => info.owner === hp && !!info.stack && !!info.stack.playedFromSources } });
sc('BT20-028::서로의 턴', async (ctx, R) => { await R.runScript([{ op: 'retreat', target: 'opponent', n: 2 }], ctx); });
// BT21-005 / BT21-009 / BT21-059: 이 디지몬이 링크했을 때 (event 'linked')
const onSelfLinked = (state, hp, h, info) => info.owner === hp && info.stack === h;
hk('BT21-005', { tag: '자신의 턴', src: 'inheritedKo', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
sc('BT21-005::자신의 턴', async (ctx, R) => { await R.runScript([{ op: 'draw', who: 'self', n: 1 }], ctx); });
hk('BT21-009', { tag: '자신의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
sc('BT21-009::자신의 턴', async (ctx, R) => {
  if (tams(ctx.state, ctx.self).length > 1) return;
  await R.runScript([{ op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: ['한바다'] }, rested: false, noTriggers: false, optional: true }], ctx);
});
hk('BT21-059', { tag: '자신의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
sc('BT21-059::자신의 턴', async (ctx, R) => { await R.runScript([{ op: 'retreat', target: 'opponent', n: 1 }], ctx); });
// BT21-025 (자신의 턴, 턴 1회): 특징 「파충류형」/「용인형」을 가진 자신의 디지몬의 어택의 대상이 변경되었을 때, 상대의 시큐리티를 위에서부터 1장 파기한다. (event 'redirect' = attack target changed; owner/stack = the attacker)
hk('BT21-025', { tag: '자신의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: (state, hp, h, info) => info.owner === hp && !!info.stack && hasType(C(info.stack.cardId), '파충류형', '용인형') } });
sc('BT21-025::자신의 턴', async (ctx, R) => { await R.runScript([{ op: 'removeSecurity', who: 'opponent', position: 'top' }], ctx); });
// BT21-035 (자신의 턴, 턴 1회): 이 디지몬의 어택의 대상이 변경되었을 때, 이 디지몬을 액티브로 한다.
hk('BT21-035', { tag: '자신의 턴', has: '어택의 대상이 변경되었을 때', limit: 1, events: { redirect: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('BT21-035::자신의 턴', async (ctx) => { const st = me(ctx); if (st) S.unsuspendStack(ctx.state, ctx.self, st.uid); });
