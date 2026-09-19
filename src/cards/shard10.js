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

// ------------------------------------------------------------------ more helpers
const oppTurnEnd = (ctx) => (ctx.state.activePlayer === ctx.opp ? ctx.state.turnNumber : ctx.state.turnNumber + 1);
const namesOf = (id) => S.cardNames(id);
const putSourceTop = (st, id) => { st.sources.push(id); S.recomputeStackGrants(st); };
// stack -> owner deck bottom (sources/links trashed), respecting immunity / leave replacements like a bounce
function toDeckBottom(ctx, p, st) {
  const { state } = ctx, pl = state.players[p];
  if (!pl.battle.includes(st)) return;
  const cause = p === ctx.self ? 'ownEffect' : 'effect';
  const go = () => {
    if (!pl.battle.includes(st)) return;
    pl.battle.splice(pl.battle.indexOf(st), 1);
    const leavePlays = S.extractLeaveSourcePlays(state, p, st, cause);
    const linkIds = (st.linkCards || []).map(l => l.cardId);
    pl.deck.push(st.cardId);
    pl.trash.push(...st.sources, ...linkIds);
    S.playExtractedSources(state, p, leavePlays);
    S.applyOverflowBatch(state, p, [...st.sources, st.cardId]);
  };
  if (S.effectBlocked(state, p, st, 'bounce')) return;
  if (S.leaveGate(state, p, st, cause, 'bounce', () => go())) return;
  go();
}
async function bounceToDeckBottomOrdered(ctx, p, stacks) {
  if (!stacks.length) return;
  const ordIds = await order(ctx, ctx.self, stacks.map(s => s.cardId), '덱 아래로 되돌릴 순서를 정하세요');
  const pool = [...stacks];
  for (const id of ordIds) { const i = pool.findIndex(s => s.cardId === id); if (i >= 0) toDeckBottom(ctx, p, pool.splice(i, 1)[0]); }
}
// pick up to n cards from a list of {zone, idx, id} entries through the stock picker (temp zone); returns picked entries
async function pickEntries(ctx, who, entries, n, prompt) {
  const chosen = [];
  const pl = ctx.state.players[who];
  for (let k = 0; k < n; k++) {
    const left = entries.filter(e => !chosen.includes(e));
    if (!left.length) break;
    pl.s10tmp = left.map(e => e.id);
    let i;
    try { i = await ctx.choose('pickFromZoneIndex', { player: who, zone: 's10tmp', eligibleIdxs: left.map((e, j) => j), prompt }); } finally { delete pl.s10tmp; }
    if (i == null) break;
    chosen.push(left[i]);
  }
  return chosen;
}
// "자신의 시큐리티 내용을 모두 확인하여 그중 <조건> 카드 1장을 오픈해 패에 추가할 수 있다. 추가했을 때 리커버리+1. 그 후 시큐리티를 셔플한다."
async function secCheckAdd(ctx, R, pred, prompt) {
  const pl = P(ctx);
  const idxs = pl.security.map((id, i) => i).filter(i => pred(C(pl.security[i])));
  let added = false;
  if (idxs.length) {
    const i = await pickZoneIdx(ctx, ctx.self, 'security', idxs, prompt);
    if (i != null) {
      const [id] = pl.security.splice(i, 1);
      pl.hand.push(id);
      S.log(ctx.state, `${ctx.self} 시큐리티에서 ${C(id).nameKo} 오픈, 패에 추가`);
      S.emitGameEvent(ctx.state, 'securityDecrease', { owner: ctx.self, stack: null, cause: 'effect' });
      added = true;
    }
  }
  if (added) await ops(ctx, R, [{ op: 'recoverTop', who: 'self' }]);
  await ops(ctx, R, [{ op: 'shuffleSecurity', who: 'self' }]);
}
const hasTrait = (c, ...ts) => (c.types || []).some(t => ts.includes(t));

// BT4-062 《디지버스트 4》: DP 5000 이하의 상대 디지몬 전부 레스트. 그 후, 레스트 상태인 상대 디지몬 전부를 원하는 순서대로 덱 아래로.
SCRIPTS['BT4-062::진화 시'] = [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 4, digiburst: true }], then: [
  { op: 'restAll', target: 'opponent', filter: { dpMax: 5000, category: 'digimon' } },
  { op: 's10_fn', fn: (ctx) => bounceToDeckBottomOrdered(ctx, ctx.opp, digsOf(ctx, ctx.opp).filter(s => s.suspended)) },
] }];

// BT4-090 이 디지몬을 액티브로 한다. 그 후, 이 디지몬은 상대의 디지몬에게 어택할 수 있다(액티브 상태에게도).
sc('BT4-090::진화 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  await ops(ctx, R, [{ op: 'unsuspend', target: 'thisStack' }]);
  if (st.suspended || !(await confirm(ctx, '이 디지몬으로 상대의 디지몬에게 어택하시겠습니까? (액티브 상태의 디지몬에게도 가능)'))) return;
  S.grantKeyword(ctx.state, ctx.self, st.uid, '액티브공격', true, 'turn');
  const legal = S.legalDigimonTargets(ctx.state, ctx.self, st.uid);
  const t = await pickStack(ctx, ctx.opp, P(ctx, ctx.opp).battle.filter(s => legal.includes(s.uid)), '어택할 상대 디지몬 선택');
  if (t && ctx.startAttack) ctx.startAttack(ctx.self, st.uid, t.uid);
});

// BT5-019 패의 레드 디지몬 1장을 진화원 가장 위에 둘 수 있다. 그 후, 진화원의 「오메가샤우트몬」/「지크그레이몬」 1장마다 DP 5000 이하 상대 디지몬 1마리 소멸.
sc('BT5-019::진화 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  const pl = P(ctx);
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && (C(pl.hand[i]).colors || []).includes('red'));
  const i = await pickZoneIdx(ctx, ctx.self, 'hand', idxs, '진화원 가장 위쪽에 둘 레드 디지몬 카드 (선택 안 함 가능)');
  if (i != null) { const [id] = pl.hand.splice(i, 1); putSourceTop(st, id); }
  const k = st.sources.filter(id => namesOf(id).some(n => n === '오메가샤우트몬' || n === '지크그레이몬')).length;
  for (let j = 0; j < k; j++) await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 5000 } }]);
});

// BT5-037 / BT7-088 시큐리티를 모두 확인 -> 조건 카드 1장 오픈해 패에 추가할 수 있다 / 추가했을 때 리커버리 +1 / 그 후 시큐리티 셔플
sc('BT5-037::등장 시', (ctx, R) => secCheckAdd(ctx, R, (c) => c.category === 'digimon' && hasTrait(c, '전사형', '성기사형'), '시큐리티에서 패에 추가할 「전사형」/「성기사형」 디지몬 카드 (선택 안 함 가능)'));
sc('BT7-088::등장 시', (ctx, R) => secCheckAdd(ctx, R, (c) => hasTrait(c, '하이브리드체', '10투사'), '시큐리티에서 패에 추가할 「하이브리드체」/「10투사」 카드 (선택 안 함 가능)'));

// BT9-034 시큐리티 맨 위 1장 확인, 패에 추가할 수 있다. 추가했을 때 리커버리 +1.
sc('BT9-034::진화 시', async (ctx, R) => {
  const top = P(ctx).security[0];
  if (!top || !(await confirm(ctx, `시큐리티 맨 위 카드: ${C(top).nameKo} — 패에 추가하시겠습니까? (추가하면 리커버리 +1)`))) return;
  await ops(ctx, R, [{ op: 'securityTopToHand', who: 'self', n: 1 }, { op: 'recoverTop', who: 'self' }]);
});

// BT6-083 화이트 등장 코스트 4 이하 테이머를 무료 등장 -> 그 후 상대도 패의 테이머 1장을 무료 등장시킬 수 있다.
SCRIPTS['BT6-083::등장 시'] = [
  { op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'tamer', colors: ['white'], costMax: 4 }, rested: false, noTriggers: false, optional: true },
  { op: 'playFree', who: 'opponent', zone: 'hand', filter: { category: 'tamer' }, rested: false, noTriggers: false, optional: true },
];

// BT6-086 자신과 상대의 테이머 1명당, 트래시의 Lv.5 이하 「에오스몬」 1장을 진화원 위에 놓을 수 있다. 2장 이상 놓았을 때 상대 디지몬 1마리 소멸.
sc('BT6-086::진화 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  const pl = P(ctx);
  const n = tamsOf(ctx, ctx.self).length + tamsOf(ctx, ctx.opp).length;
  let placed = 0;
  for (let k = 0; k < n; k++) {
    const idxs = pl.trash.map((id, i) => i).filter(i => (C(pl.trash[i]).level || 0) <= 5 && C(pl.trash[i]).category === 'digimon' && namesOf(pl.trash[i]).includes('에오스몬'));
    const i = await pickZoneIdx(ctx, ctx.self, 'trash', idxs, '진화원 위에 놓을 「에오스몬」 (선택 안 함 가능)');
    if (i == null) break;
    const [id] = pl.trash.splice(i, 1); putSourceTop(st, id); placed++;
  }
  if (placed >= 2) await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose' }]);
});

// BT6-087 / BT6-088 〔턴에 1회〕 자신의 「A」 1마리를 Lv.무시·진화 코스트를 지불하여 패의 「A -…-」로 진화. 그렇게 했을 때 시큐리티 위에서 2장 파기. 그 후 시큐리티 1장 이상이면 이 턴 종료 시 그 디지몬 소멸.
function bondScript(baseName, evoName) {
  return [
    { op: 's10_fn', fn: (ctx) => { ctx._s10ev = null; } },
    { op: 's2_evolve', subject: { pred: (s, ctx) => S.effectiveInfo(ctx.state, s).nameIs(baseName) }, zone: 'hand', ignoreLevel: true, mandatory: true, cardPred: (c) => c.nameKo === evoName, after: (ctx, st) => { ctx._s10ev = st; } },
    { op: 's10_fn', fn: async (ctx, R) => {
      const st = ctx._s10ev; if (!st) return;
      await ops(ctx, R, [{ op: 'removeSecurity', who: 'self', position: 'top' }, { op: 'removeSecurity', who: 'self', position: 'top' }]);
      if (P(ctx).security.length >= 1) { ctx._lastPick = { player: ctx.self, uid: st.uid }; await ops(ctx, R, [{ op: 'atTurnEnd', when: 'this', then: [{ op: 'destroy', target: 'self', mode: 'last' }] }]); }
    } },
  ];
}
SCRIPTS['BT6-087::메인@진화 코스트를 지불하여'] = bondScript('아구몬', '아구몬 -용기의 유대-');
SCRIPTS['BT6-088::메인@진화 코스트를 지불하여'] = bondScript('파피몬', '파피몬 -우정의 유대-');

// BT6-107 트래시의 퍼플 디지몬 1장을 패로. 그 후 이 카드를 배틀 에어리어에 둔다.
SCRIPTS['BT6-107::메인@패로 되돌린다'] = [{ op: 'returnFromTrash', who: 'self', filter: { category: 'digimon', colors: ['purple'] } }, { op: 'placeThisInBattle' }];
// BT6-100 덱 위 2장 오픈, 1장을 시큐리티 위에 뒷면으로, 나머지는 패로. 그 후 이 카드를 배틀 에어리어에 둔다.
SCRIPTS['BT6-100::메인@덱 위에서부터 2장'] = [{ op: 's10_fn', fn: async (ctx, R) => {
  const pl = P(ctx), n = Math.min(2, pl.deck.length);
  if (n) {
    const revealed = pl.deck.slice(0, n);
    const sel = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed, eligible: revealed.map((id, i) => ({ id, i })), min: 1, max: 1, required: true, prompt: '시큐리티 위에 뒷면으로 둘 카드 1장 (남은 카드는 패에)' });
    const pick = sel && sel.length ? sel[0] : 0;
    pl.deck.splice(0, n);
    S.addToSecurity(ctx.state, ctx.self, revealed[pick], 'top');
    revealed.forEach((id, i) => { if (i !== pick) pl.hand.push(id); });
  }
  await ops(ctx, R, [{ op: 'placeThisInBattle' }]);
} }];

// EX1-066 이 테이머를 레스트시킬 수 있다. 그렇게 했을 때 메모리 +1, 비어 있는 육성 에어리어에 디지타마 부화.
SCRIPTS['EX1-066::서로의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'gainMemory', who: 'self', n: 1 }, { op: 'hatch', who: 'self' }] }];

// EX1-072 상대는 옵션 카드를 사용할 수 없다 (메인: 다음 상대 턴 종료까지 / 시큐리티: 이 턴 동안 + 이 카드를 패에 추가)
sc('EX1-072::메인', async (ctx) => { S.addTimedLock(ctx.state, ctx.opp, 'option', oppTurnEnd(ctx)); });
sc('EX1-072::시큐리티', async (ctx, R) => { S.addTimedLock(ctx.state, ctx.opp, 'option', ctx.state.turnNumber); await ops(ctx, R, [{ op: 'addSelfToHand' }]); });

// BT7-015 서로의 트래시의 옵션 카드와 「3총사」 카드 전부를 주인의 덱 아래로. 합계 7장 이상이면 「3총사」이거나 DP 8000 이하의 상대 디지몬 1마리 소멸.
sc('BT7-015::등장 시', async (ctx, R) => {
  let total = 0;
  for (const p of [ctx.self, ctx.opp]) {
    const pl = P(ctx, p);
    const isT = (id) => C(id).category === 'option' || hasTrait(C(id), '3총사');
    const ids = pl.trash.filter(isT);
    if (!ids.length) continue;
    const ord = p === ctx.self ? await order(ctx, p, ids, '덱 아래로 되돌릴 순서') : ids;
    pl.trash = pl.trash.filter(id => !isT(id));
    pl.deck.push(...ord); total += ord.length;
  }
  if (total >= 7) await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { anyOf: [{ traitAny: ['3총사'] }, { dpMax: 8000 }] } }]);
});

// ------------------------------------------------------------------ chunk B
const stackByUid = (ctx, uid) => [ctx.state.players.p1, ctx.state.players.p2].flatMap(pl => [pl.raising, ...pl.battle]).filter(Boolean).find(s => s.uid === uid);
const atkUid = (ctx) => ctx.trigger?.evtStackUid || ctx.state.attackCtx?.uid || null;
// put a card from the hand / from under the own tamers at the BOTTOM of `st` sources (optional)
async function placeUnderBottomFromHandOrTamer(ctx, st, pred, prompt) {
  const pl = P(ctx);
  const entries = [];
  pl.hand.forEach((id, i) => { if (C(id).category === 'digimon' && pred(C(id))) entries.push({ zone: 'hand', idx: i, id }); });
  for (const t of tamsOf(ctx, ctx.self)) t.sources.forEach((id, i) => { if (C(id).category === 'digimon' && pred(C(id))) entries.push({ zone: 'tamer', idx: i, id, tamer: t }); });
  const [e] = await pickEntries(ctx, ctx.self, entries, 1, prompt);
  if (!e) return false;
  if (e.zone === 'hand') pl.hand.splice(e.idx, 1); else { e.tamer.sources.splice(e.idx, 1); S.recomputeStackGrants(e.tamer); }
  st.sources.splice(S.fdCount(st), 0, e.id);
  S.recomputeStackGrants(st);
  return true;
}
const srcHasName = (st, ...ns) => st.sources.some(id => namesOf(id).some(n => ns.includes(n)));
// reveal the top n cards (removed from the deck); returns the list
const revealN = (ctx, n) => P(ctx).deck.splice(0, n);
// evolve one of my digimon into a revealed card (free); returns the used card index or -1
async function evolveFromRevealed(ctx, revealed, pred, prompt) {
  const { state, E } = ctx;
  const cands = [];
  revealed.forEach((id, i) => {
    if (C(id).category !== 'digimon' || !pred(C(id))) return;
    const stacks = digsOf(ctx, ctx.self).filter(s => { const restr = S.evolveTargetRestriction(state, ctx.self, s); return !(restr && restr.cannotEvolve) && E.canEvolveAny(s.cardId, id, S.evoExtraArg(state, null, s), restr).ok; });
    if (stacks.length) cands.push({ i, id, stacks });
  });
  if (!cands.length) return -1;
  const sel = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed, eligible: cands.map(c => ({ id: c.id, i: c.i })), min: 0, max: 1, prompt });
  if (!sel || !sel.length) return -1;
  const c = cands.find(x => x.i === sel[0]);
  const st = c.stacks.length === 1 ? c.stacks[0] : await pickStack(ctx, ctx.self, c.stacks, `${C(c.id).nameKo}(으)로 진화시킬 디지몬 선택`);
  if (!st) return -1;
  S.digivolve(state, ctx.self, st.uid, c.id, 0, 'free');
  return c.i;
}
// 「X항체」 card in the trash under (the bottom of) one of my 「X항체」 digimon
async function xPlaceUnder(ctx) {
  const pl = P(ctx);
  const isX = (c) => hasTrait(c, 'X항체');
  const idxs = pl.trash.map((id, i) => i).filter(i => isX(C(pl.trash[i])));
  const targets = digsOf(ctx, ctx.self).filter(s => isX(S.effectiveInfo(ctx.state, s) ? { types: S.effectiveInfo(ctx.state, s).traits } : C(s.cardId)));
  if (!idxs.length || !targets.length) return;
  const i = await pickZoneIdx(ctx, ctx.self, 'trash', idxs, '진화원 아래에 놓을 「X항체」 카드 선택');
  if (i == null) return;
  const st = targets.length === 1 ? targets[0] : await pickStack(ctx, ctx.self, targets, '「X항체」 디지몬 선택 (진화원 아래에 놓기)');
  if (!st) return;
  const [id] = pl.trash.splice(i, 1);
  st.sources.splice(S.fdCount(st), 0, id);
  S.recomputeStackGrants(st);
}

// BT8-019 상대는 상대 디지몬 1마리를 고른다. 이 디지몬과 고른 디지몬 이외의 서로의 디지몬 전부 소멸. 소멸한 1마리마다 메모리+1.
sc('BT8-019::진화 시', async (ctx) => {
  const me = meStack(ctx);
  const kept = await pickStack(ctx, ctx.opp, digsOf(ctx, ctx.opp), '소멸하지 않을 자신의 디지몬 1마리를 고르세요 (상대의 효과)');
  const victims = [...digsOf(ctx, ctx.self), ...digsOf(ctx, ctx.opp)].filter(s => s !== me && s !== kept);
  let n = 0;
  for (const s of victims) {
    const p = ctx.state.players.p1.battle.includes(s) ? 'p1' : 'p2';
    S.deleteStack(ctx.state, p, s.uid, 'trash', p === ctx.self ? 'ownEffect' : 'effect');
    if (!ctx.state.players[p].battle.includes(s)) n++;
  }
  if (n) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
});

// BT8-065 패/트래시의 「콩알몬」 디지몬 4장까지를 원하는 순서대로 덱 위로. 3장 이상 되돌렸을 때 상대 디지몬 1마리 《퇴화 1》.
sc('BT8-065::진화 시', async (ctx, R) => {
  const pl = P(ctx);
  const entries = [];
  for (const z of ['hand', 'trash']) pl[z].forEach((id, i) => { if (C(id).category === 'digimon' && C(id).nameKo.includes('콩알몬')) entries.push({ zone: z, idx: i, id }); });
  const picked = await pickEntries(ctx, ctx.self, entries, 4, '덱 위로 되돌릴 「콩알몬」 카드 (먼저 고른 카드가 위쪽)');
  for (const e of picked) { const j = pl[e.zone].indexOf(e.id); if (j >= 0) pl[e.zone].splice(j, 1); }
  pl.deck.unshift(...picked.map(e => e.id));
  if (picked.length >= 3) await ops(ctx, R, [{ op: 'retreat', target: 'opponent', n: 1 }]);
});

// BT8-097 DP 6000 이하의 상대 디지몬 전부 소멸. 다음 상대의 턴 종료 시까지 상대는 효과로 디지몬을 등장시킬 수 없다.
sc('BT8-097::메인', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'all', filter: { dpMax: 6000 } }]);
  S.addTimedLock(ctx.state, ctx.opp, 'effectPlay', oppTurnEnd(ctx));
});

// BT8-099 상대 디지몬 1마리를 레스트. 그 후 레스트 상태의 상대 디지몬 10마리까지를 원하는 순서대로 덱 아래로.
sc('BT8-099::메인', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }]);
  const chosen = [];
  for (let k = 0; k < 10; k++) {
    const left = digsOf(ctx, ctx.opp).filter(s => s.suspended && !chosen.includes(s));
    const s = await pickStack(ctx, ctx.opp, left, '덱 아래로 되돌릴 레스트 상태의 상대 디지몬 (먼저 고른 것부터)');
    if (!s) break;
    chosen.push(s);
  }
  for (const s of chosen) toDeckBottom(ctx, ctx.opp, s);
});

// EX2-018 진화원을 갖지 않은 상대 디지몬 1마리마다 리커버리 +1. 이 효과로 시큐리티는 6장 이상이 되지 않는다.
sc('EX2-018::등장 시', async (ctx, R) => {
  const k = digsOf(ctx, ctx.opp).filter(s => !s.sources.length).length;
  const n = Math.max(0, Math.min(k, 5 - P(ctx).security.length));
  for (let i = 0; i < n; i++) await ops(ctx, R, [{ op: 'recoverTop', who: 'self' }]);
});

// EX2-065 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로 덱 위 1장 파기. 그 후 어택 중인 것이 「베르제브몬」이라면 진화 코스트 3을 지불하여 트래시의 「베르제브몬: 블래스트 모드」로 진화시킬 수 있다.
SCRIPTS['EX2-065::자신의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [
  { op: 'trashDeckTop', who: 'self', n: 1 },
  { op: 's10_fn', fn: async (ctx, R) => {
    const uid = atkUid(ctx), st = uid && stackByUid(ctx, uid);
    if (!st || !S.effectiveInfo(ctx.state, st).nameIs('베르제브몬')) return;
    await ops(ctx, R, [{ op: 's2_evolve', subject: { pred: (s) => s.uid === uid }, zone: 'trash', cost: { mode: 'fixed', n: 3 }, cardPred: (c) => c.nameKo === '베르제브몬: 블래스트 모드' }]);
  } },
] }];

// EX2-072 덱 위 5장 오픈. 자신의 디지몬 1마리는 그중 화이트 이외의 디지몬 카드 1장으로 코스트 없이 진화할 수 있다. 그렇게 하지 않았을 때, 그중 디지몬 카드 1장을 패에 추가. 남은 카드는 원하는 순서대로 덱 아래로.
sc('EX2-072::메인', async (ctx) => {
  const pl = P(ctx);
  const revealed = revealN(ctx, 5);
  if (!revealed.length) return;
  const used = await evolveFromRevealed(ctx, revealed, (c) => !(c.colors || []).includes('white'), '진화에 사용할 화이트 이외의 디지몬 카드 (선택 안 함 = 진화하지 않음)');
  const rest = revealed.filter((id, i) => i !== used);
  if (used < 0) {
    const el = rest.map((id, i) => ({ id, i })).filter(x => C(x.id).category === 'digimon');
    if (el.length) {
      const sel = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed: rest, eligible: el, min: 1, max: 1, required: true, prompt: '패에 추가할 디지몬 카드 1장' });
      const k = sel && sel.length ? sel[0] : el[0].i;
      pl.hand.push(rest.splice(k, 1)[0]);
    }
  }
  const ord = await order(ctx, ctx.self, rest, '덱 아래로 되돌릴 순서');
  pl.deck.push(...ord);
});

// EX2-073 상대 시큐리티 위에서 1장 파기. 상대의 트래시 10장마다 파기하는 매수 +1 (처리 시작 시점의 트래시 매수).
sc('EX2-073::어택 시', async (ctx, R) => {
  const n = 1 + Math.floor(P(ctx, ctx.opp).trash.length / 10);
  for (let i = 0; i < n; i++) await ops(ctx, R, [{ op: 'removeSecurity', who: 'opponent', position: 'top' }]);
});

// BT9-014 다음 상대의 턴 종료까지 상대 디지몬 2마리에게 「【소멸 시】 메모리-1.」. 그 후 진화원에 「메가로그라우몬」/「X항체」가 있을 때, DP 합계 6000 이하가 되도록 상대 디지몬을 골라 전부 소멸시킬 수 있다.
sc('BT9-014::진화 시', async (ctx, R) => {
  await T(ctx, R, '다음 상대의 턴 종료까지 상대의 디지몬 2마리에게 「【소멸 시】 메모리-1.」의 효과를 준다.');
  const st = meStack(ctx);
  if (st && srcHasName(st, '메가로그라우몬', 'X항체')) await ops(ctx, R, [{ op: 'destroySum', limit: 6000, stat: 'dp' }]);
});

// BT9-041 / BT9-099 옐로/레드 테이머 무료 등장 → (그 후 [조건]) 상대 디지몬 1마리를 자신의 옐로/레드 테이머 1명마다 DP-N
const ownYR = (ctx) => tamsOf(ctx, ctx.self).filter(t => S.stackColors(t).some(c => c === 'yellow' || c === 'red')).length;
async function dpPerYR(ctx, per) {
  const k = ownYR(ctx);
  if (!k) return;
  const t = await pickStack(ctx, ctx.opp, digsOf(ctx, ctx.opp), `DP -${per * k} 받을 상대 디지몬 선택`);
  if (t) S.modifyDP(ctx.state, ctx.opp, t.uid, -per * k, 'turn');
}
const playYRTamer = { op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'tamer', colors: ['yellow', 'red'] }, rested: false, noTriggers: false, optional: true };
SCRIPTS['BT9-041::진화 시'] = [playYRTamer, { op: 's10_fn', fn: async (ctx) => { const st = meStack(ctx); if (st && srcHasName(st, '라이즈그레이몬', 'X항체')) await dpPerYR(ctx, 2000); } }];
SCRIPTS['BT9-099::메인'] = [playYRTamer, { op: 's10_fn', fn: (ctx) => dpPerYR(ctx, 3000) }];

// BT9-052 / BT9-055 이 디지몬이 어택 중이라면, 어택의 대상을 레스트 상태인 상대 디지몬 1마리로 변경할 수 있다.
async function redirectToRested(ctx) {
  const pa = ctx.state.attackCtx, st = meStack(ctx);
  if (!pa || !st || pa.uid !== st.uid) return;
  const legal = S.legalDigimonTargets(ctx.state, ctx.self, st.uid);
  const cands = digsOf(ctx, ctx.opp).filter(s => s.suspended && legal.includes(s.uid));
  if (!cands.length || !(await confirm(ctx, '어택의 대상을 레스트 상태인 상대 디지몬으로 변경하시겠습니까?'))) return;
  const t = await pickStack(ctx, ctx.opp, cands, '새 어택 대상 (레스트 상태인 상대 디지몬)');
  if (t) { pa.targetKind = 'digimon'; pa.targetUid = t.uid; S.log(ctx.state, `${ctx.self} 어택의 대상을 ${C(t.cardId).nameKo}(으)로 변경`); }
}
sc('BT9-052::진화 시', async (ctx, R) => {
  const st = meStack(ctx);
  if (st && srcHasName(st, '왕쿠가몬', 'X항체')) await ops(ctx, R, [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }]);
  await redirectToRested(ctx);
});
sc('BT9-055::진화 시', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }]);
  await redirectToRested(ctx);
});

// BT9-069 디지몬과 테이머 2장까지를 액티브로 한다. 그 후 액티브 상태의 상대 디지몬과 테이머 1장마다 메모리+1.
sc('BT9-069::진화 시', async (ctx) => {
  for (let i = 0; i < 2; i++) {
    const cands = P(ctx).battle.filter(s => s.suspended && (isDig(s) || isTam(s)));
    const s = await pickStack(ctx, ctx.self, cands, '액티브로 할 디지몬/테이머 (선택 안 함 가능)');
    if (!s) break;
    S.unsuspendStack(ctx.state, ctx.self, s.uid);
  }
  const k = P(ctx, ctx.opp).battle.filter(s => !s.suspended && (isDig(s) || isTam(s))).length;
  if (k) S.grantMemory(ctx.state, ctx.self, k, ctx.sourceCardId);
});

// BT9-083 진화 시: 진화원의 「궁극체」 1장마다 상대 디지몬 1마리 소멸. 그 후 상대 트래시의 카드 10장을 원하는 순서대로 덱 아래로.
sc('BT9-083::진화 시', async (ctx, R) => {
  await T(ctx, R, '이 디지몬의 진화원의 특징으로 「궁극체」를 가진 카드 1장마다, 상대의 디지몬 1마리를 소멸시킨다.');
  const opl = P(ctx, ctx.opp);
  const entries = opl.trash.map((id, i) => ({ zone: 'trash', idx: i, id }));
  const picked = await pickEntries(ctx, ctx.self, entries, 10, '덱 아래로 되돌릴 상대 트래시의 카드 (먼저 고른 카드가 위쪽)');
  for (const e of picked) { const j = opl.trash.indexOf(e.id); if (j >= 0) opl.trash.splice(j, 1); }
  opl.deck.push(...picked.map(e => e.id));
});
// BT9-083 자신의 턴 개시 시: 이 디지몬에 겹쳐진 카드를 위에서부터 1장 파기한다. 그렇게 했을 때 상대 시큐리티 위에서 1장 파기.
sc('BT9-083::자신의 턴 개시 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  const removed = S.trashEvoSources(ctx.state, ctx.self, st.uid, 1, 'top');
  if (removed && removed.length) await ops(ctx, R, [{ op: 'removeSecurity', who: 'opponent', position: 'top' }]);
});

// BT9-095 DP 13000 이하의 상대 디지몬 1마리 소멸. 그 후 명칭에 「그레이몬」을 포함하는 자신의 디지몬 1마리로 플레이어에게 어택할 수 있다.
sc('BT9-095::메인', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 13000 } }]);
  const cands = digsOf(ctx, ctx.self).filter(s => !s.suspended && S.effectiveInfo(ctx.state, s).names.some(n => n.includes('그레이몬')) && S.canAttackPlayer(ctx.state, ctx.self, s.uid));
  if (!cands.length || !(await confirm(ctx, '명칭에 「그레이몬」을 포함하는 디지몬으로 플레이어에게 어택하시겠습니까?'))) return;
  const a = await pickStack(ctx, ctx.self, cands, '플레이어에게 어택할 디지몬 선택');
  if (a && ctx.startAttack) ctx.startAttack(ctx.self, a.uid, 'PLAYER');
});

// BT9-098 「아머체」 디지몬 1마리를 패의 명칭에 「매그너몬」을 포함하는 디지몬 카드로 진화 조건 무시·코스트 없이 진화할 수 있다. 다음 상대의 턴 종료까지 그 디지몬은 상대의 효과로 DP가 마이너스되지 않는다.
SCRIPTS['BT9-098::메인'] = [{ op: 's2_evolve', subject: { pred: (s, ctx) => S.effectiveInfo(ctx.state, s).traits.includes('아머체') }, zone: 'hand', ignoreCond: true, cost: { mode: 'free' }, cardPred: (c) => c.nameKo.includes('매그너몬'),
  after: (ctx, st) => { S.grantKeyword(ctx.state, ctx.self, st.uid, 'DP감소무효', true, 'opponentTurn'); } }];

// BT9-104 덱 위 3장 오픈. 그중 「X항체」 카드 1장으로 자신의 디지몬 1마리를 코스트 없이 진화할 수 있다. 나머지는 파기. 그 후 트래시의 「X항체」 카드 1장을 「X항체」 디지몬의 진화원 아래에 놓는다.
sc('BT9-104::메인', async (ctx) => {
  const pl = P(ctx);
  const revealed = revealN(ctx, 3);
  const used = revealed.length ? await evolveFromRevealed(ctx, revealed, (c) => hasTrait(c, 'X항체'), '진화에 사용할 「X항체」 카드 (선택 안 함 = 진화하지 않음)') : -1;
  pl.trash.push(...revealed.filter((id, i) => i !== used));
  await xPlaceUnder(ctx);
});
// BT9-105 덱 위 3장 오픈. 그중 「X항체」 디지몬 카드 1장의 등장 코스트 이하의 상대 디지몬 1마리 소멸. 오픈한 카드는 파기. 그 후 트래시의 「X항체」 카드를 「X항체」 디지몬의 진화원 아래에.
sc('BT9-105::메인', async (ctx, R) => {
  const pl = P(ctx);
  const revealed = revealN(ctx, 3);
  const el = revealed.map((id, i) => ({ id, i })).filter(x => C(x.id).category === 'digimon' && hasTrait(C(x.id), 'X항체'));
  let cost = null;
  if (el.length) {
    const sel = await ctx.choose('pickFromRevealed', { player: ctx.self, revealed, eligible: el, min: 1, max: 1, required: true, prompt: '기준으로 삼을 「X항체」 디지몬 카드 (등장 코스트 이하의 상대 디지몬 소멸)' });
    cost = C(revealed[sel && sel.length ? sel[0] : el[0].i]).cost || 0;
  }
  if (cost != null) await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: cost } }]);
  pl.trash.push(...revealed);
  await xPlaceUnder(ctx);
});

// BT9-107 자신의 패를 3장까지 파기한다. 상대 디지몬 1마리를 이 효과로 파기한 카드 1장마다 《퇴화 1》. 그 후 Lv.4 이하의 상대 디지몬 1마리 소멸.
sc('BT9-107::메인', async (ctx, R) => {
  const pl = P(ctx);
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const i = await pickZoneIdx(ctx, ctx.self, 'hand', pl.hand.map((id, j) => j), '파기할 패의 카드 (3장까지, 선택 안 함 가능)');
    if (i == null) break;
    S.trashFromHand(ctx.state, ctx.self, i); n++;
  }
  for (let k = 0; k < n; k++) await ops(ctx, R, [{ op: 'retreat', target: 'opponent', n: 1 }]);
  await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: 4 } }]);
});

// BT10-016 패/트래시의 「시스터몬」 디지몬을 무료 등장. 그 후 진화원에 「제스몬」이 있거나 명칭에 「시스터몬」을 포함하는 자신의 디지몬이 있을 때, 다음 상대의 턴 종료까지 자신의 디지몬 전부는 액티브 상태의 디지몬에게도 어택할 수 있고 DP+2000.
sc('BT10-016::진화 시', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'playFree', who: 'self', zone: 'any', filter: { category: 'digimon', nameAny: ['시스터몬'] }, rested: false, noTriggers: false, optional: true }]);
  const st = meStack(ctx);
  const ok = (st && srcHasName(st, '제스몬')) || digsOf(ctx, ctx.self).some(s => S.effectiveInfo(ctx.state, s).names.some(n => n.includes('시스터몬')) || (S.effectiveInfo(ctx.state, s).inclNames || []).some(n => n.includes('시스터몬')));
  if (!ok) return;
  await ops(ctx, R, [{ op: 'grantKeyword', target: 'self', all: true, keyword: '액티브공격', duration: 'opponentTurn' }, { op: 'modifyDPAll', target: 'self', amount: 2000, duration: 'opponentTurn' }]);
});

// BT10-026 / BT11-030 패 또는 테이머 아래의 「블루플레어」 디지몬 1장을 진화원 아래에 놓을 수 있다. 그 후 진화원의 「…」 조건 효과.
const BP = (c) => hasTrait(c, '블루플레어', '블루 플레어');
sc('BT10-026::등장 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  await placeUnderBottomFromHandOrTamer(ctx, st, BP, '진화원 아래에 놓을 「블루플레어」 디지몬 카드 (선택 안 함 가능)');
  if (srcHasName(st, '데커드라몬')) await ops(ctx, R, [{ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: 'opponentTurn' }]);
});
sc('BT11-030::등장 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  await placeUnderBottomFromHandOrTamer(ctx, st, BP, '진화원 아래에 놓을 「블루 플레어」 디지몬 카드 (선택 안 함 가능)');
  await ops(ctx, R, [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { level: 3 }, requireSuspended: null, dest: 'deckBottom' }]);
  if (srcHasName(st, '사이버드라몬')) await ops(ctx, R, [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: 4 }, requireSuspended: null, dest: 'deckBottom' }]);
});

// BT10-040 〔턴에 1회〕 시큐리티 3장 이상일 때 DP-5000 / 3장 이하일 때 메모리+2 (정확히 3장이면 둘 다)
sc('BT10-040::어택 시', async (ctx, R) => {
  if (P(ctx).security.length >= 3) await ops(ctx, R, [{ op: 'modifyDP', target: 'opponent', amount: -5000, duration: 'turn' }]);
  if (P(ctx).security.length <= 3) await ops(ctx, R, [{ op: 'gainMemory', who: 'self', n: 2 }]);
});
// BT10-101 시큐리티 3장 이상일 때 DP-12000 / 3장 이하일 때 상대 디지몬 1마리를 상대 시큐리티 위에 뒷면으로
sc('BT10-101::메인', async (ctx, R) => {
  if (P(ctx).security.length >= 3) await ops(ctx, R, [{ op: 'modifyDP', target: 'opponent', amount: -12000, duration: 'turn' }]);
  if (P(ctx).security.length <= 3) {
    const t = await pickStack(ctx, ctx.opp, digsOf(ctx, ctx.opp), '상대 시큐리티 위에 뒷면으로 놓을 상대 디지몬');
    if (t) stackToSecurity(ctx, ctx.opp, t, 'top');
  }
});

// BT10-099 다음 상대의 턴 종료 시까지 상대 디지몬 1마리에게 《시큐리티 어택 -1》. 자신의 「베누스몬」이 있을 때 대신 상대 디지몬 3마리에게.
sc('BT10-099::메인', async (ctx) => {
  const n = digsOf(ctx, ctx.self).some(s => S.effectiveInfo(ctx.state, s).nameIs('베누스몬')) ? 3 : 1;
  const chosen = [];
  for (let i = 0; i < n; i++) {
    const t = await pickStack(ctx, ctx.opp, digsOf(ctx, ctx.opp).filter(s => !chosen.includes(s)), '《시큐리티 어택 -1》을 줄 상대 디지몬');
    if (!t) break;
    chosen.push(t);
    S.grantKeyword(ctx.state, ctx.opp, t.uid, '시큐리티어택', -1, 'opponentTurn');
  }
});

// BT10-104 덱 위 3장 파기. 그 후 트래시의 「다크나이트몬」 1장을 코스트를 지불하여 등장시킬 수 있다(디지크로스 재료로 트래시의 카드도 사용 가능).
sc('BT10-104::메인', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'trashDeckTop', who: 'self', n: 3 }]);
  const pl = P(ctx);
  const idxs = pl.trash.map((id, i) => i).filter(i => namesOf(pl.trash[i]).includes('다크나이트몬') && C(pl.trash[i]).category === 'digimon');
  if (!idxs.length) return;
  const cost = Math.min(...idxs.map(i => C(pl.trash[i]).cost || 0));
  if (!S.canPayCost(ctx.state, cost) || !(await confirm(ctx, `트래시의 「다크나이트몬」을 코스트 ${cost}을(를) 지불하여 등장시키겠습니까?`))) return;
  const before = pl.battle.length;
  await ops(ctx, R, [{ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['다크나이트몬'], category: 'digimon' }, rested: false, noTriggers: false, optional: true }]);
  if (pl.battle.length > before && cost > 0) S.spendMemory(ctx.state, cost);
});

// BT10-110 자신의 디지몬 1마리를 액티브로 한다. 그 후 그 디지몬이 「제스몬GX」라면 그 디지몬의 【진화 시】 효과 1개를 발휘한다.
sc('BT10-110::메인', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'unsuspend', target: 'self', digimonOnly: true }]);
  const lp = ctx._lastPick && ctx._lastPick.player === ctx.self ? stackByUid(ctx, ctx._lastPick.uid) : null;
  if (!lp || !S.effectiveInfo(ctx.state, lp).nameIs('제스몬GX')) return;
  const segs = S.parseEffectSegments(C(lp.cardId).effectKo || '').segments.filter(x => x.tags.some(t => t.includes('진화 시')));
  if (!segs.length) return;
  let seg = segs[0];
  if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(x => x.body.slice(0, 40)) }); seg = segs[k || 0] || segs[0]; }
  const fx = await import('../effects.js');
  const script = fx.lookupCardSpecific(lp.cardId, seg.tags, seg.body) || fx.FX_HELPERS.compileToScript(seg.body);
  await R.runScript(script, { ...ctx, sourceCardId: lp.cardId, sourceStackUid: lp.uid });
});

// EX3-012 가장 DP가 낮은 상대 디지몬 전부 소멸. 이 효과로 소멸하지 않았다면 상대의 턴 종료까지 상대는 DP 5000 이하의 디지몬을 등장시킬 수 없다.
sc('EX3-012::등장 시', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'all', filter: { extreme: { stat: 'dp', dir: 'min' } } }]);
  if (ctx._lastDestroyed === false) S.addPlayRestriction(ctx.state, ctx.opp, 5000, oppTurnEnd(ctx));
});
// EX3-053 상대 디지몬 전부 《퇴화 1》. 그 후 등장 코스트 5 이하 상대 디지몬 1마리 소멸. 이 효과로 소멸하지 않았다면 상대의 턴 종료까지 액티브 상태의 상대 디지몬 전부는 진화할 수 없다.
sc('EX3-053::등장 시', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'retreat', target: 'opponent', n: 1, all: true }, { op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 5 } }]);
  if (ctx._lastDestroyed === false) S.addEvolveLock(ctx.state, ctx.opp, 99, oppTurnEnd(ctx), true);
});

// BT11-031 《세이브》. 그 후 트래시의 블루인 「그레이몬」과 「메일버드라몬」 1장씩을 「제너럴」 테이머 1명의 아래에 놓는다.
sc('BT11-031::소멸 시', async (ctx, R) => {
  await ops(ctx, R, [{ op: 'saveUnderTamer' }]);
  const pl = P(ctx);
  const tamers = tamsOf(ctx, ctx.self).filter(t => S.effectiveInfo(ctx.state, t).traits.includes('제너럴'));
  if (!tamers.length) return;
  const found = [];
  for (const nm of ['그레이몬', '메일버드라몬']) { const i = pl.trash.findIndex(id => C(id).category === 'digimon' && (C(id).colors || []).includes('blue') && namesOf(id).includes(nm)); if (i >= 0) found.push(i); }
  if (!found.length) return;
  const t = tamers.length === 1 ? tamers[0] : await pickStack(ctx, ctx.self, tamers, '카드를 아래에 놓을 「제너럴」 테이머');
  if (!t) return;
  const ids = found.sort((a, b) => b - a).map(i => pl.trash.splice(i, 1)[0]);
  t.sources.splice(S.fdCount(t), 0, ...ids);
  S.recomputeStackGrants(t);
});

// BT11-033 Lv.5 이하의 상대 디지몬 1마리를 패로. 이 효과로 되돌아가지 않았다면 상대는 본인의 시큐리티를 위에서부터 1장 패에 추가한다.
sc('BT11-033::진화 시', async (ctx, R) => {
  const before = P(ctx, ctx.opp).battle.length;
  await ops(ctx, R, [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { levelMax: 5 }, requireSuspended: null, dest: 'hand' }]);
  if (P(ctx, ctx.opp).battle.length >= before) await ops(ctx, R, [{ op: 'securityTopToHand', who: 'opponent', n: 1 }]);
});

// BT11-083 자신의 패 1장을 파기할 수 있다. 그랬다면 트래시의 「미카구라 미레이」 또는 「천사형」/「대천사형」/「타천사형」 카드 1장을 패로 되돌릴 수 있다.
sc('BT11-083::진화 시', async (ctx, R) => {
  const pl = P(ctx);
  const i = await pickZoneIdx(ctx, ctx.self, 'hand', pl.hand.map((id, j) => j), '파기할 패의 카드 (선택 안 함 가능)');
  if (i == null) return;
  S.trashFromHand(ctx.state, ctx.self, i);
  await ops(ctx, R, [{ op: 'returnFromTrash', who: 'self', filter: { anyOf: [{ exactAny: ['미카구라 미레이'] }, { traitAny: ['천사형', '대천사형', '타천사형'] }] } }]);
});

// ------------------------------------------------------------------ chunk C (segments that were no longer flagged after generic fixes but still lost a filter/condition)
// BT6-112 트래시의 사용 코스트 7의 옵션 카드 1장을 패로. 그 후 패에서 사용 코스트 7의 옵션 카드 1장을 코스트 없이 사용한다.
SCRIPTS['BT6-112::등장 시'] = [
  { op: 'returnFromTrash', who: 'self', filter: { category: 'option', costEq: 7 } },
  { op: 'useOptionFree', who: 'self', filter: { category: 'option', costEq: 7 }, optional: false },
];
// BT10-061 덱 위 3장 오픈, 그중 명칭에 「나이트몬」을 포함하는 카드/「데들리액스몬」/「노유라」 1장을 패에. 나머지 파기. 그 후 2장 디지크로스하고 있었을 때 등장 코스트 4 이하 상대 디지몬 1마리 소멸.
SCRIPTS['BT10-061::등장 시'] = [
  { op: 'revealTop', who: 'self', n: 3, pick: { min: 0, max: 1, filter: { anyOf: [{ nameAny: ['나이트몬'] }, { exactAny: ['데들리액스몬', '노유라'] }] } }, restTo: 'trash' },
  { op: 's10_fn', fn: async (ctx, R) => { const st = meStack(ctx); if (st && (st.xrosCount || 0) >= 2) await ops(ctx, R, [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 4 } }]); } },
];
// BT10-024 이 턴 동안 《속공》. 그 후 디지크로스하고 있었을 때, 다음 상대의 턴 종료까지 진화원의 매수가 이 디지몬의 진화원의 매수 이하의 상대 디지몬 3마리는 어택과 블록을 할 수 없다.
sc('BT10-024::등장 시', async (ctx, R) => {
  const st = meStack(ctx); if (!st) return;
  await ops(ctx, R, [{ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '속공', duration: 'turn' }]);
  if ((st.xrosCount || 0) < 1) return;
  const n = st.sources.length;
  for (let i = 0; i < 3; i++) await ops(ctx, R, [{ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: 'opponentTurn', filter: { srcMax: n } }]);
});
