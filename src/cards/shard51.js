// Shard 51 — pass-2 batch-4 verification fixes (docs/verify-pass2-b4.md).
import * as S from '../state.js';
import { compileToScript } from '../effects.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const fn = (f) => ({ op: 's51_fn', fn: f });
OPS.s51_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const oppTurnEnd = (state, self) => (state.activePlayer === opp(self) ? state.turnNumber : state.turnNumber + 1);
async function pickOne(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  if (stacks.length === 1) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map((s) => s.uid), prompt });
  return stacks.find((s) => s.uid === uid) || null;
}
const digs = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const tams = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');

// BT18-083 【서로의 턴】 이 디지몬의 DP 이하의 디지몬 전부는 《충돌》을 얻는다 (both sides' digimon; grantKwAny lets the hook grant across players).
hk('BT18-083', { tag: '서로의 턴', has: '《충돌》을 얻는다', grantKwAny: true, grantKw: (state, hp, holder, target) => {
  if (C(target.cardId).category !== 'digimon') return [];
  const to = S.ownerOfStack(state, target); if (!to) return [];
  return S.effectiveDP(state, to, target) <= S.effectiveDP(state, hp, holder) ? ['충돌'] : [];
} });

// BT18-085 황금무사몬: (a) evolve-into discount = number of colors among opponent's trash cards; (b) 【자신의 턴】 per 2 colors: 《S 어택 +1》 and DP +2000.
const oppTrashColors = (state, p) => new Set(state.players[opp(p)].trash.flatMap((id) => C(id).colors || [])).size;
hk('BT18-085', { tag: '__evo', selfEvoDiscount: (state, p) => -oppTrashColors(state, p) });
hk('BT18-085', { tag: '자신의 턴', has: '색 2색마다', dp: (state, hp, holder, target) => (target === holder ? 2000 * Math.floor(oppTrashColors(state, hp) / 2) : 0), sAtk: (state, hp, holder, aStack) => (aStack === holder ? Math.floor(oppTrashColors(state, hp) / 2) : 0) });

// BT18-101 【진화 시】 트래시의 「루체몬: 라르바」 1장을 (비어 있는) 육성 에어리어에 코스트 없이 등장시키는 것으로, 상대의 디지몬/테이머 1마리(명)를 소멸 (cost was left as manualCost -> never gated).
sc('BT18-101::진화 시', async (ctx, R) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const idx = pl.trash.findIndex((id) => C(id).nameKo === '루체몬: 라르바');
  if (pl.raising || idx === -1) { S.log(state, `${me} 육성 에어리어가 비어 있지 않거나 트래시에 「루체몬: 라르바」가 없어 효과를 발휘할 수 없음`); return; }
  if (!(await ctx.choose('confirmEffect', { player: me, prompt: '트래시의 「루체몬: 라르바」를 육성 에어리어에 등장시켜 상대의 디지몬/테이머 1마리(명)를 소멸시킬까요?' }))) return;
  const st = S.playFreeFromZone(state, me, 'trash', idx, { noTriggers: true });
  if (!st) return;
  state.players[me].battle.splice(state.players[me].battle.indexOf(st), 1); state.players[me].raising = st;
  S.log(state, `${me} ${C(st.cardId).nameKo} 육성 에어리어에 등장`);
  S.queueTriggersForStack(state, me, st, 'play');
  S.emitGameEvent(state, 'play', { owner: me, stack: st, cause: 'effect' });
  await R.runScript(compileToScript('상대의 디지몬/테이머 1마리(명)를 소멸시킨다.'), ctx);
});

// ST9-06 황제드라몬: 드래곤 모드 【진화 시】 이 디지몬의 진화원에서 Lv.4 이하의 블루와 그린의 디지몬 카드 1장씩을 코스트 없이 등장시킬 수 있다.
// (official Q&A: this is one all-or-nothing optional action — you may decline it entirely, but if BOTH a Lv.4-
// or-lower blue AND green source card are present you may not take only one of them. The generic compiler's
// moveEach(groups) instead offered each color as its own independently-skippable slot, letting a player take
// blue while declining an available green — fixed with a single up-front confirm + forced per-color fill.)
sc('ST9-06::진화 시', async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const st = findStack(state, me, ctx.sourceStackUid); if (!st) return;
  const cand = (color) => st.sources.map((id, i) => ({ id, i })).filter((x) => x.i >= S.fdCount(st) && C(x.id).category === 'digimon' && C(x.id).level <= 4 && (C(x.id).colors || []).includes(color));
  if (!cand('blue').length && !cand('green').length) return;
  if (!(await ctx.choose('confirmEffect', { player: me, prompt: '진화원의 Lv.4 이하 블루와 그린 디지몬을 1장씩 등장시킬까요?' }))) return;
  for (const color of ['blue', 'green']) {
    const cs = cand(color); if (!cs.length) continue;
    let pick = cs[0];
    if (cs.length > 1) { const k = await ctx.choose('pickFromZoneIndex', { player: me, zone: 'sources', eligibleIdxs: cs.map((x) => x.i), prompt: `등장시킬 ${color === 'blue' ? '블루' : '그린'} 카드 선택` }); pick = cs.find((x) => x.i === k) || cs[0]; }
    const i = st.sources.indexOf(pick.id); if (i < 0) continue;
    const [id] = st.sources.splice(i, 1); S.recomputeStackGrants(st);
    pl.trash.push(id);
    S.playFreeFromZone(state, me, 'trash', pl.trash.length - 1, { fromSources: true });
  }
});

// BT22-028 【진화 시】 이 디지몬의 진화원에서 특징으로 「수생」을 포함하는 Lv.3·Lv.4·Lv.5 디지몬 카드 1장씩을 코스트 없이 등장 (the generic compile only left a manual note)
sc('BT22-028::진화 시@진화원에서', async (ctx) => {
  const { state } = ctx, me = ctx.self, pl = state.players[me];
  const st = findStack(state, me, ctx.sourceStackUid); if (!st) return;
  const cand = (lv) => st.sources.map((id, i) => ({ id, i })).filter((x) => x.i >= S.fdCount(st) && C(x.id).category === 'digimon' && C(x.id).level === lv && (C(x.id).types || []).some((t) => t.includes('수생')));
  if (![3, 4, 5].some((lv) => cand(lv).length)) return;
  if (!(await ctx.choose('confirmEffect', { player: me, prompt: '진화원의 「수생」 Lv.3/Lv.4/Lv.5 디지몬을 1장씩 등장시킬까요?' }))) return;
  for (const lv of [3, 4, 5]) {
    const cs = cand(lv); if (!cs.length) continue;
    let pick = cs[0];
    if (cs.length > 1) { const k = await ctx.choose('pickFromZoneIndex', { player: me, zone: 'sources', eligibleIdxs: cs.map((x) => x.i), prompt: `등장시킬 Lv.${lv} 카드 선택` }); pick = cs.find((x) => x.i === k) || cs[0]; }
    const i = st.sources.indexOf(pick.id); if (i < 0) continue;
    const [id] = st.sources.splice(i, 1); S.recomputeStackGrants(st);
    pl.trash.push(id);
    S.playFreeFromZone(state, me, 'trash', pl.trash.length - 1, { fromSources: true });
  }
});

// BT23-085 【등장 시】 상대의 턴 종료까지, 특징 「후디에」를 가진 자신의 디지몬 1마리는 상대의 효과로 DP가 마이너스되지 않고, 《재기동》과 《블로커》를 얻는다.
// (generic compile dropped the "DP가 마이너스되지 않고" clause and the 「후디에」 filter)
sc('BT23-085::등장 시', async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const t = await pickOne(ctx, me, digs(state, me).filter((s) => (C(s.cardId).types || []).includes('후디에')), '효과를 받을 「후디에」 디지몬 선택');
  if (!t) return;
  S.grantShield(state, me, t.uid, { kinds: ['dpDown'], until: oppTurnEnd(state, me) });
  S.grantKeyword(state, me, t.uid, '재기동', true, 'opponentTurn');
  S.grantKeyword(state, me, t.uid, '블로커', true, 'opponentTurn');
});

// BT22-079 이터(원종형태) 상속 [육성]【자신의 턴】[턴 1회] 특징 「이터」를 가진 디지몬 카드가 등장할 때, 지불하는 코스트 -1 할 수 있다 (was not implemented)
hk('BT22-079', { src: 'inheritedKo', tag: '자신의 턴', has: '코스트 -1', playDiscount: (state, hp, holder, cardId) => {
  const c = C(cardId);
  if (c.category !== 'digimon' || !(c.types || []).includes('이터')) return null;
  const key = S.onceLimitKey('BT22-079', ['자신의 턴']);
  if (S.turnUsesRemaining(holder, key, 1) <= 0) return null;
  return { label: `${C(holder.cardId).nameKo}의 효과로 ${c.nameKo}의 등장 코스트 -1?`, apply: () => { S.markTurnEffectUsed(holder, key); return -1; } };
} });

// BT20-035 카즈치몬 상속 【서로의 턴】[턴에 1회] 자신의 시큐리티가 줄어들었을 때, 이 디지몬이 명칭에 「펜리루가몬」을 포함한다면, 《리커버리 +1《덱》》
// (conditional event watcher text is EW_UNSAFE -> never queued)
hk('BT20-035', { src: 'inheritedKo', tag: '서로의 턴', has: '줄어들었을 때', limit: 1, events: { securityDecrease: (state, hp, h, info) => info.owner === hp && C(h.cardId).nameKo.includes('펜리루가몬') } });
sc('BT20-035::서로의 턴@줄어들었을 때', async (ctx, R) => { await R.runScript(compileToScript('《리커버리 +1《덱》》'), ctx); });

// BT23-043 [시큐리티]【상대의 턴】 특징 「로얄 베이스」를 가진 자신의 디지몬 전부는 《블로커》를 얻는다 (while this card is a face-up security card; was not implemented)
hk('BT23-043', { tag: '상대의 턴', zone: 'security', has: '《블로커》를 얻는다', grantKw: (state, hp, holder, target) => (C(target.cardId).category === 'digimon' && (C(target.cardId).types || []).includes('로얄 베이스') ? ['블로커'] : []) });

// BT24-002 둥실몬 상속 【자신의 턴 종료 시】[턴에 1회] 1코스트를 지불하는 것으로, 특징 「TS」를 가진 블루인 이 디지몬을 액티브로 한다.
// (generic compile dropped the 「TS」·블루 requirement on "이 디지몬" and paid/unsuspended unconditionally)
sc('BT24-002::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx, me = ctx.self;
  const st = findStack(state, me, ctx.sourceStackUid); if (!st || !st.suspended) return;
  const info = S.effectiveInfo(state, st, me);
  const isTS = info.hasTrait ? info.hasTrait('TS') : (C(st.cardId).types || []).includes('TS');
  const blue = (S.stackColors(st) || []).includes('blue');
  if (!isTS || !blue) return;
  if (!(await ctx.choose('confirmEffect', { player: me, prompt: '1코스트를 지불하여 이 디지몬을 액티브로 할까요?' }))) return;
  S.spendMemory(state, 1);
  S.unsuspendStack(state, me, st.uid);
  S.log(state, `${me} ${C(st.cardId).nameKo} 액티브`);
});
