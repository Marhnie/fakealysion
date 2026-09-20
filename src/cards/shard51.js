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
