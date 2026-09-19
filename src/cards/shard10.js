// Shard 10 — per-card scripts for effect segments whose printed sentences the generic compiler silently dropped
// (docs/verify-dropped-1.md). Op names are prefixed s10_. Effects are composed from (a) sentences the generic compiler
// understands (compiled at run time), (b) hand-written steps using the state API, in PRINTED ORDER with their 그 후/조건 gates.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

// ------------------------------------------------------------------ helpers
let FXH = null;
const H = async () => (FXH ||= (await import('../effects.js')).FX_HELPERS);
const P = (ctx, p) => ctx.state.players[p || ctx.self];
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const digsOf = (ctx, p) => P(ctx, p).battle.filter(isDig);
const tamsOf = (ctx, p) => P(ctx, p).battle.filter(isTam);
const meStack = (ctx) => { const pl = P(ctx); return pl.battle.find(s => s.uid === ctx.sourceStackUid) || (pl.raising?.uid === ctx.sourceStackUid ? pl.raising : null); };
const fdOf = (st) => S.fdCount(st);
const mf = async (ctx, target, filter) => (await H()).matchesFilter(S, target, filter, ctx.state);
const nameIs = (ctx, st, n) => S.effectiveInfo(ctx.state, st).nameIs ? S.effectiveInfo(ctx.state, st).nameIs(n) : S.cardNames(st.cardId).includes(n);
const nameHas = (c, n) => (c.nameKo || '').includes(n);
async function confirm(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map(s => s.uid), prompt });
  return stacks.find(s => s.uid === uid) || null;
}
// pick index into pl[zone] among idxs (player `who`)
async function pickZoneIdx(ctx, who, zone, idxs, prompt) {
  if (!idxs.length) return null;
  const i = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return i == null ? null : i;
}
// the chosen-order placement of several cards (owner picks the order)
const order = (ctx, who, ids, prompt) => S.orderPlacement(ctx.choose, who, ids, prompt);
// run a printed sentence through the generic compiler at run time
async function T(ctx, R, text) { const { compileToScript } = await H(); await R.runScript(compileToScript(text), ctx); }
async function ops(ctx, R, list) { await R.runScript(list, ctx); }
// evaluate a printed condition ("옐로인 자신의 디지몬이 있을 때") with the generic condition parser
async function cond(ctx, text) { const { condTestFor } = await H(); return !!(await condTestFor(text)(ctx)); }

OPS.s10_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's10_fn', fn: f }]; };

// ------------------------------------------------------------------ segments
// digimon stack -> security (face-down) top/bottom: sources/links go to the trash (like a bounce)
function stackToSecurity(ctx, p, st, position) {
  const { state } = ctx, pl = state.players[p];
  if (!pl.battle.includes(st)) return false;
  const cause = p === ctx.self ? 'ownEffect' : 'effect';
  const go = () => {
    if (!pl.battle.includes(st)) return false;
    pl.battle.splice(pl.battle.indexOf(st), 1);
    pl.trash.push(...st.sources.filter(id => !C(id).isToken), ...(st.linkCards || []).map(l => l.cardId));
    if (!C(st.cardId).isToken) S.addToSecurity(state, p, st.cardId, position);
    return true;
  };
  if (S.effectBlocked(state, p, st, 'bounce')) return false;
  let deferred = false;
  if (S.leaveGate(state, p, st, cause, 'bounce', () => { go(); })) deferred = true;
  return deferred ? false : go();
}
async function trashChosenSources(ctx, p, st, n) { // owner of the effect chooses n evolution cards of `st` to discard
  const k = Math.min(n, st.sources.length);
  if (!k) return [];
  const idxs = await S.chooseSourceIdxs(ctx.state, ctx.self, st, k, ctx.choose, null, `${C(st.cardId).nameKo}의 진화원 ${k}장을 골라 파기`);
  return S.trashEvoSources(ctx.state, p, st.uid, k, 'bottom', idxs);
}
const dpMod = (ctx, p, st, amt, dur = 'turn') => S.modifyDP(ctx.state, p, st.uid, amt, dur);

// ST3-13 【시큐리티】 이 턴 동안, 자신의 디지몬과 시큐리티 디지몬 전부의 DP +5000. 그 후, 이 카드를 패에 추가한다.
SCRIPTS['ST3-13::시큐리티'] = [
  { op: 'modifyDPAll', target: 'self', amount: 5000, duration: 'turn' },
  { op: 'securityDPMod', target: 'self', amount: 5000, duration: 'turn' },
  { op: 'addSelfToHand' },
];

// ST10-14 【메인】 상대 디지몬 1마리를 상대의 시큐리티의 위 또는 아래에 뒤집어서 놓는다. 그렇게 했을 때, 상대의 시큐리티를 위에서부터 1장 파기한다.
async function st1014(ctx, R, optional) {
  const opp = ctx.opp;
  const st = await pickStack(ctx, opp, digsOf(ctx, opp), '시큐리티에 뒤집어서 놓을 상대 디지몬 선택');
  if (!st) return;
  const k = await ctx.choose('multipleChoice', { prompt: '상대 시큐리티의 어디에 놓을까요?', options: ['위', '아래'] });
  if (!stackToSecurity(ctx, opp, st, k === 1 ? 'bottom' : 'top')) return;
  if (!optional) await ops(ctx, R, [{ op: 'removeSecurity', who: 'opponent', position: 'top' }]);
}
sc('ST10-14::메인', (ctx, R) => st1014(ctx, R, false));
sc('ST10-14::시큐리티', async (ctx, R) => { // (printed 【시큐리티】: 놓을 수 있다 — no follow-up sentence)
  if (digsOf(ctx, ctx.opp).length && await confirm(ctx, '상대 디지몬 1마리를 상대 시큐리티에 뒤집어서 놓겠습니까?')) await st1014(ctx, R, true);
});

// BT2-038 【진화 시】 패에서 옐로인 테이머 카드 1장을 코스트 없이 등장시킬 수 있다. 이 효과로 등장한 테이머의 【등장 시】 효과는 발휘하지 않는다.
SCRIPTS['BT2-038::진화 시'] = [{ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'tamer', colors: ['yellow'] }, rested: false, noTriggers: true, optional: true }];

// BT1-084 【진화 시】 상대의 디지몬 1마리를 선택한다. 그 디지몬과 같은 명칭인 상대의 디지몬 전부를 소멸시킨다.
sc('BT1-084::진화 시', async (ctx) => {
  const opp = ctx.opp;
  const pick = await pickStack(ctx, opp, digsOf(ctx, opp), '선택할 상대 디지몬 (같은 명칭 전부 소멸)');
  if (!pick) return;
  const nm = S.effectiveInfo(ctx.state, pick).names;
  const same = digsOf(ctx, opp).filter(s => s === pick || S.effectiveInfo(ctx.state, s).names.some(n => nm.includes(n)));
  for (const s of same) S.deleteStack(ctx.state, opp, s.uid, 'trash', 'effect');
});

// P-024 【메인】 자신의 「신태일」이 있을 때, 자신의 「아구몬」 1마리를 덱 아래로 되돌리는 것으로, 《3드로우》. 그 디지몬의 진화원은 파기한다.
sc('P-024::메인', async (ctx, R) => {
  if (!(await cond(ctx, '자신의 「신태일」이 있다면'))) return;
  const cands = digsOf(ctx, ctx.self).filter(s => S.effectiveInfo(ctx.state, s).nameIs('아구몬'));
  if (!cands.length || !(await confirm(ctx, '자신의 「아구몬」 1마리를 덱 아래로 되돌려 3장 드로우하시겠습니까?'))) return;
  const before = P(ctx).battle.length;
  await ops(ctx, R, [{ op: 'returnToHandStripSources', target: 'self', n: 1, filter: { exactAny: ['아구몬'] }, dest: 'deckBottom' }]); // sources of the returned Digimon are discarded
  if (P(ctx).battle.length < before) await ops(ctx, R, [{ op: 'draw', who: 'self', n: 3 }]);
});

// BT3-107 【메인】 상대의 디지몬 1마리를 《퇴화 1》 한다. 그 후, 그 디지몬이 등장 코스트 4 이하일 때, 소멸시킨다.
sc('BT3-107::메인', async (ctx) => {
  const opp = ctx.opp;
  const st = await pickStack(ctx, opp, digsOf(ctx, opp), '《퇴화 1》 할 상대 디지몬 선택');
  if (!st) return;
  S.retreat(ctx.state, opp, st.uid, 1);
  if (P(ctx, opp).battle.includes(st) && (C(st.cardId).cost || 0) <= 4) S.deleteStack(ctx.state, opp, st.uid, 'trash', 'effect');
});

// BT2-041 【진화 시】 옐로인 자신의 테이머 전부를 레스트시킨다. 이 효과로 레스트시킨 옐로인 테이머 1명마다, 이 턴 동안 상대 디지몬 1마리의 DP를 -4000 한다.
sc('BT2-041::진화 시', async (ctx, R) => {
  let k = 0;
  for (const t of tamsOf(ctx, ctx.self)) {
    if (t.suspended || !S.stackColors(t).includes('yellow')) continue;
    S.restStack(ctx.state, ctx.self, t.uid);
    if (t.suspended) k++;
  }
  for (let i = 0; i < k; i++) await ops(ctx, R, [{ op: 'modifyDP', target: 'opponent', amount: -4000, duration: 'turn' }]);
});

// BT3-034 【등장 시】 자신의 시큐리티의 내용을 위에서부터 1장 확인한다. 그 카드를 패에 추가하는 것으로, 《1 드로우》.
sc('BT3-034::등장 시', async (ctx, R) => {
  const top = P(ctx).security[0];
  if (!top) return;
  if (!(await confirm(ctx, `시큐리티 맨 위 카드: ${C(top).nameKo} — 패에 추가하고 1장 드로우하시겠습니까?`))) return;
  await ops(ctx, R, [{ op: 'securityTopToHand', who: 'self', n: 1 }, { op: 'draw', who: 'self', n: 1 }]);
});

// BT2-094 【메인】 상대의 디지몬 1마리의 진화원을 골라 1장 파기한다. 그 후, 이 턴 동안 자신의 디지몬 1마리의 DP를 +2000 한다.
sc('BT2-094::메인', async (ctx, R) => {
  const opp = ctx.opp;
  const st = await pickStack(ctx, opp, digsOf(ctx, opp).filter(s => s.sources.length), '진화원을 파기할 상대 디지몬 선택');
  if (st) await trashChosenSources(ctx, opp, st, 1);
  await ops(ctx, R, [{ op: 'modifyDP', target: 'self', amount: 2000, duration: 'turn' }]);
});
