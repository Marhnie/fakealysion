// Shard 48 — pass-2 batch-1 verification fixes (BT10-/BT11-/AD1- cards; docs/verify-pass2-b1.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const digs = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'digimon');
const fn = (f) => ({ op: 's48_fn', fn: f });
OPS.s48_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
async function ask(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }

// ------------------------------------------------------------------ BT10-027 【어택 시】 opp has a digimon with no evolution sources -> play one Lv.3 and one Lv.4 digimon card from THIS digimon's sources free ("1장씩")
sc('BT10-027::어택 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  if (!digs(state, o).some(s => s.sources.length === 0)) return;
  const st = me(ctx); if (!st) return;
  const isLv = (lv) => (id) => C(id).category === 'digimon' && C(id).level === lv;
  if (!st.sources.some(isLv(3)) && !st.sources.some(isLv(4))) return;
  if (!(await ask(ctx, '이 디지몬의 진화원에서 Lv.3과 Lv.4의 디지몬 카드 1장씩을 코스트 없이 등장시킬까요?'))) return;
  for (const lv of [3, 4]) {
    const pred = isLv(lv);
    if (!st.sources.some(pred)) continue;
    const [i] = await S.chooseSourceIdxs(state, ctx.self, st, 1, ctx.choose, pred, `진화원에서 코스트 없이 등장시킬 Lv.${lv} 디지몬 카드 선택`);
    if (i == null) continue;
    const id = st.sources.splice(i, 1)[0];
    S.recomputeStackGrants(st);
    const pl = state.players[ctx.self]; pl.trash.push(id);
    S.playFreeFromZone(state, ctx.self, 'trash', pl.trash.length - 1, { fromSources: true });
  }
});

// ------------------------------------------------------------------ BT10-066 【서로의 턴】 when THIS digimon is deleted: return 1 black Lv.4- digimon card of its evolution cards to hand (cost) -> play 「스컬나이트몬」/「데들리액스몬」 (1) of its evolution cards free
// (the evolution cards are already in the trash when the leave trigger resolves; evt.sources lists them)
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
hk('BT10-066', { tag: '서로의 턴', has: '이 디지몬이 소멸할 때', onLeave: (state, p, stack, cause) => !!state.deletedInfo?.[stack.uid] && cause !== 'xros' && cause !== 'link' });
sc('BT10-066::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const evt = ctx.trigger?.evt || {};
  const srcs = (evt.sources || []).slice();
  if (!srcs.length) return;
  const idxIn = (pred, exclude = -1) => { const pool = srcs.slice(); const out = []; pl.trash.forEach((id, i) => { if (i === exclude) return; const k = pool.findIndex(x => x === id); if (k >= 0 && pred(id)) out.push(i); if (k >= 0) pool.splice(k, 1); }); return out; };
  const isBlkLow = (id) => C(id).category === 'digimon' && C(id).level <= 4 && (C(id).colors || []).includes('black');
  const isKnight = (id) => ['스컬나이트몬', '데들리액스몬'].some(n => S.cardNameIs(C(id), n));
  const costIdx = idxIn(isBlkLow).filter(i => idxIn(isKnight, i).length > 0);
  if (!costIdx.length) return;
  if (!(await ask(ctx, '진화원의 블랙 Lv.4 이하 디지몬 카드 1장을 패로 되돌리고, 「스컬나이트몬」/「데들리액스몬」 1장을 코스트 없이 등장시킬까요?'))) return;
  const ci = costIdx.length === 1 ? costIdx[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: costIdx, prompt: '패로 되돌릴 블랙 Lv.4 이하 디지몬 카드 선택' });
  if (ci == null || !costIdx.includes(ci)) return;
  const costId = pl.trash.splice(ci, 1)[0]; pl.hand.push(costId);
  S.log(state, `${ctx.self} ${C(costId).nameKo}을(를) 패로 되돌림`);
  srcs.splice(srcs.indexOf(costId), 1);
  const ti = idxIn(isKnight);
  if (!ti.length) return;
  const pi = ti.length === 1 ? ti[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: ti, prompt: '등장시킬 「스컬나이트몬」/「데들리액스몬」 선택' });
  if (pi == null || !ti.includes(pi)) return;
  S.playFreeFromZone(state, ctx.self, 'trash', pi, { fromSources: true });
});

// ------------------------------------------------------------------ AD1-006 【서로의 턴】 leaves the battle area other than by DigiXros: put up to 4 evolution cards with 「크로스 하트」/「블루 플레어」 under one of your Tamers, then play 1 of them free
// (the evolution cards are already in the trash when the leave trigger resolves; evt.sources lists them)
hk('AD1-006', { tag: '서로의 턴', has: '디지크로스 이외로', onLeave: (state, p, stack, cause) => cause !== 'xros' });
sc('AD1-006::서로의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const evt = ctx.trigger?.evt || {};
  const pool = (evt.sources || []).slice();
  const isT = (id) => ['크로스 하트', '블루 플레어'].some(t => (C(id).types || []).includes(t));
  const idxs = () => { const rest = pool.slice(); const out = []; pl.trash.forEach((id, i) => { const k = rest.indexOf(id); if (k >= 0) { rest.splice(k, 1); if (isT(id)) out.push(i); } }); return out; };
  if (!idxs().length) return;
  const tamers = state.players[ctx.self].battle.filter(s => C(s.cardId).category === 'tamer');
  if (!tamers.length) return;
  if (!(await ask(ctx, '진화원의 「크로스 하트」/「블루 플레어」 카드를 최대 4장 테이머 아래에 놓고, 1장을 코스트 없이 등장시킬까요?'))) return;
  const tm = tamers.length === 1 ? tamers[0] : findStack(state, ctx.self, await ctx.choose('pickStack', { player: ctx.self, uids: tamers.map(s => s.uid), prompt: '카드를 아래에 놓을 테이머 선택' }));
  if (!tm) return;
  const placed = [];
  for (let n = 0; n < 4; n++) {
    const el = idxs();
    if (!el.length) break;
    const i = el.length === 1 && n === 0 ? el[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'trash', eligibleIdxs: el, prompt: `테이머 아래에 놓을 카드 선택 (${n + 1}/4, 선택 안 함 = 종료)`, ...(n === 0 ? { required: true } : {}) }); // Q6062: 발동한 이상 최소 1장은 반드시 놓아야 한다(고르는 카드만 임의) — 2번째부터는 "4장까지" 선택
    if (i == null || !el.includes(i)) break;
    const id = pl.trash[i];
    pool.splice(pool.indexOf(id), 1);
    if (S.saveCardUnderTamer(state, ctx.self, id, tm.uid)) placed.push(id);
  }
  const cand = placed.filter(id => C(id).category === 'digimon');
  if (!cand.length) return;
  if (!(await ask(ctx, '테이머 아래에 놓은 카드 중 1장을 코스트 없이 등장시킬까요?'))) return;
  const pid = cand.length === 1 ? cand[0] : cand[await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's48tmp', eligibleIdxs: cand.map((_, i) => i), prompt: '등장시킬 카드 선택' }) ?? 0];
  const k = tm.sources.indexOf(pid);
  if (k < 0) return;
  tm.sources.splice(k, 1); pl.trash.push(pid);
  S.playFreeFromZone(state, ctx.self, 'trash', pl.trash.length - 1, {});
});
