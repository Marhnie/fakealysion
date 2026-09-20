// Shard 41 — batch-11 verification fixes (EX5-/EX6-/EX7-/EX8- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-EX5-8.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const digs = (state, p) => state.players[p].battle.filter(isDig);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const traitsOf = (id) => [...(C(id).types || []), ...(C(id).traits || [])];
const hasTr = (id, ...ts) => ts.some(t => traitsOf(id).includes(t));
const srcCards = (st) => st.sources.slice(S.fdCount(st));
const fn = (f) => ({ op: 's41_fn', fn: f });
OPS.s41_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
const totalSec = (state) => state.players.p1.security.length + state.players.p2.security.length;

// ---- continuous grants the generic parsers do not read ----
// EX7-045 쟈가몬 【상대의 턴】 특징으로 「NSp」를 가진 자신의 디지몬 전부는 《블로커》를 얻는다.
D('EX7-045', '상대의 턴', '전부는 《블로커》', { grantKw: (state, hp, h, target) => (isDig(target) && hasTr(target.cardId, 'NSp') ? ['블로커'] : []) });
// EX5-033 미타마몬 【서로의 턴】 옐로인 자신의 디지몬 전부는 《방벽》을 얻는다. / 【상대의 턴】 서로의 시큐리티 합계 이상의 Lv.의 상대의 디지몬 전부에게 《S 어택 -2》를 준다.
D('EX5-033', '서로의 턴', '《방벽》', { grantKw: (state, hp, h, target) => (isDig(target) && (C(target.cardId).colors || []).includes('yellow') ? ['방벽'] : []) });
D('EX5-033', '상대의 턴', 'S 어택 -2', { sAtkOpp: (state, hp, h, aStack, ap) => (isDig(aStack) && (C(aStack.cardId).level || 0) >= totalSec(state) ? -2 : 0) });
// EX7-057 라우드몬 (inherited) 【자신의 턴】 자신의 패가 4장 이하인 동안, 특징으로 「마룡형」/「사룡형」을 가진 자신의 디지몬 전부는 《S 어택 +1》을 얻는다.
D('EX7-057', '자신의 턴', '《S 어택 +1》', { sAtk: (state, hp, h, aStack) => (state.players[hp].hand.length <= 4 && isDig(aStack) && hasTr(aStack.cardId, '마룡형', '사룡형') ? 1 : 0) }, 'inheritedKo');
// EX6-043 디아블로몬 【서로의 턴】 명칭에 「디아블로몬」을 포함하는 다른 자신의 디지몬 전부는 《재밍》과 《블로커》를 얻는다.
D('EX6-043', '서로의 턴', '《재밍》', { grantKw: (state, hp, h, target) => (target !== h && isDig(target) && C(target.cardId).nameKo.includes('디아블로몬') ? ['재밍', '블로커'] : []) });
// EX5-014 아폴로몬 【자신의 턴】 이 디지몬의 진화원 3장마다 이 디지몬은 《S 어택 +1》을 얻는다.
D('EX5-014', '자신의 턴', '진화원 3장마다', { kwNum: (state, hp, h) => Math.floor(srcCards(h).length / 3) });
// EX8-045 칼리스몬 【자신의 턴】 진화원의 색 1색마다 DP +1000. 이 디지몬의 DP 이상의 상대의 디지몬이 없는 동안 《관통》과 《S 어택 +1》.
let g45 = false;
const noBigger45 = (state, hp, h) => { if (g45) return false; g45 = true; try { const my = S.effectiveDP(state, hp, h); return !digs(state, opp(hp)).some(s => S.effectiveDP(state, opp(hp), s) >= my); } finally { g45 = false; } };
D('EX8-045', '자신의 턴', '진화원의 색', { dp: (state, hp, h, target) => (target === h ? 1000 * new Set(srcCards(h).flatMap(id => C(id).colors || [])).size : 0),
  kw: (state, hp, h, name) => name === '관통' && noBigger45(state, hp, h), kwNum: (state, hp, h) => (noBigger45(state, hp, h) ? 1 : 0) });
// EX7-021 / EX8-023 (inherited) 【자신의 턴】 진화원을 가진 상대의 디지몬이 없는 동안, 특징으로 「빙설형」을 가진 이 디지몬은 《관통》과 《S 어택 +1》을 얻는다. (same wording as EX11-016 / shard7)
const noOppSrc = (state, hp, h) => hasTr(h.cardId, '빙설형') && !digs(state, opp(hp)).some(s => s.sources.length > 0);
for (const id of ['EX7-021', 'EX8-023']) D(id, '자신의 턴', '진화원을 가진 상대의 디지몬이 없는 동안', { kw: (state, hp, h, name) => name === '관통' && noOppSrc(state, hp, h), kwNum: (state, hp, h) => (noOppSrc(state, hp, h) ? 1 : 0) }, 'inheritedKo');

// ---- helpers for the trigger fixes below ----
const tokenOrTr = (st, ...ts) => S.isTokenId(st.cardId) || hasTr(st.cardId, ...ts);
// run one of `stack`'s own <tag> effects as that Digimon's effect ("이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다")
async function runTagOf(ctx, R, stack, tag) {
  const Fx = await import('../effects.js');
  const opts = [];
  const add = (id, src) => { for (const sg of S.parseEffectSegments(C(id)[src] || '').segments) if (sg.tags.some(t => t.includes(tag)) && !/^[≪《]\s*딜레이/.test(sg.body.trim())) opts.push({ id, sg }); };
  add(stack.cardId, 'effectKo');
  for (const id of stack.sources.slice(S.fdCount(stack))) add(id, 'inheritedKo');
  if (!opts.length) { S.log(ctx.state, `${C(stack.cardId).nameKo}: 발휘할 【${tag}】 효과가 없음`); return false; }
  let pick = opts[0];
  if (opts.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: `발휘할 【${tag}】 효과 선택`, options: opts.map(o => o.sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k == null) return false; pick = opts[k] || opts[0]; }
  const script = Fx.lookupCardSpecific(pick.id, pick.sg.tags, pick.sg.body) || Fx.compileToScript(pick.sg.body);
  if (!script || !script.length) return false;
  await R.runScript(script, { ...ctx, sourceCardId: pick.id, sourceStackUid: stack.uid, trigger: { ...(ctx.trigger || {}), text: pick.sg.body } });
  return true;
}
const memOf = (state, p) => (p === 'p1' ? state.memory : -state.memory);

// EX8-026 메탈시드라몬 【서로의 턴】 메모리가 1 이상인 동안, 상대의 디지몬 전부는 레스트할 수 없다.
D('EX8-026', '서로의 턴', '레스트할 수 없다', { restLock: (state, hp, h, target) => isDig(target) && memOf(state, hp) >= 1 });

// EX6-043 디아블로몬 / EX8-074 메디벌듀크몬 【서로의 턴】[턴에 1회] …등장했을 때, 이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다.
D('EX6-043', '서로의 턴', '【진화 시】 효과 1개', { limit: 1, events: { play: (state, hp, h, info) => info.owner !== hp && isDig(info.stack) } });
D('EX8-074', '서로의 턴', '【진화 시】 효과 1개', { limit: 1, events: { play: (state, hp, h, info) => isDig(info.stack) } });
for (const id of ['EX6-043', 'EX8-074']) sc(`${id}::서로의 턴@【진화 시】 효과 1개`, async (ctx, R) => {
  const t = me(ctx); if (!t) return;
  if (!(await ask(ctx, '이 디지몬의 【진화 시】 효과 1개를 발휘할까요?'))) return;
  await runTagOf(ctx, R, t, '진화 시');
});

// EX5-073 그레이스노바몬 【진화 시】【어택 시】 조그레스 진화하고 있었다면, 상대 디지몬의 진화원을 선택하여 8장 파기한다. 그 후, 진화원 매수가 이 디지몬 이하의 상대의 디지몬 1마리를 소멸시킨다.
sc('EX5-073::진화 시', async (ctx, R) => {
  const t = me(ctx); if (!t || !t.viaFusion) return;
  await R.runOne({ op: 'trashEvoSources', target: 'opponent', count: 8, choose: true }, ctx);
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { srcMaxSelf: true } }, ctx);
});
// combos of `n` distinct source indices satisfying `ok(idxs)` (capped) -> index lists, for descriptor.preventLeaveOptions
function sourceCombos(holder, n, ok) {
  const idx = holder.sources.map((id, i) => i).filter(i => i >= S.fdCount(holder));
  const out = [], seen = new Set();
  const rec = (start, acc) => {
    if (out.length >= 24) return;
    if (acc.length === n) { if (!ok(acc)) return; const key = acc.map(i => holder.sources[i]).sort().join(); if (!seen.has(key)) { seen.add(key); out.push(acc.slice()); } return; }
    for (let k = start; k < idx.length; k++) { acc.push(idx[k]); rec(k + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}
// EX5-073 【서로의 턴】 이 디지몬이 상대의 효과로 배틀 에어리어를 벗어날 때, 이 디지몬의 진화원에서 Lv.이 같은 카드 2장을 파기하는 것으로, 벗어나지 않는다.
D('EX5-073', '서로의 턴', '벗어나지 않는다', { preventLeaveOptions: (state, hp, h, target, tp, cause) => {
  if (target !== h || cause !== 'effect') return [];
  const lv = (i) => C(h.sources[i]).level;
  return sourceCombos(h, 2, ([a, b]) => lv(a) != null && lv(a) === lv(b)).map(c => ({ apply() {
    const removed = c.slice().sort((x, y) => y - x).map(i => h.sources.splice(i, 1)[0]);
    state.players[hp].trash.push(...removed); S.recomputeStackGrants(h); return true;
  } }));
} });
// EX5-018 가루몬 X항체 (inherited) 【서로의 턴】[턴에 1회] 명칭에 「가루몬」/「오메가몬」을 포함하는 이 디지몬이 배틀로 소멸할 때, 자신의 트래시에서 디지타마 카드 이외의 카드 2장을 덱 아래로 되돌리는 것으로, 소멸하지 않는다.
D('EX5-018', '서로의 턴', '소멸하지 않는다', { preventLeaveOptions: (state, hp, h, target, tp, cause, mode) => {
  if (target !== h || cause !== 'battle' || mode !== 'delete' || !(C(h.cardId).nameKo.includes('가루몬') || C(h.cardId).nameKo.includes('오메가몬'))) return [];
  const key = S.onceLimitKey('EX5-018', ['서로의 턴']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return [];
  const tr = state.players[hp].trash; const idx = tr.map((id, i) => i).filter(i => C(tr[i]).category !== 'digitama');
  const combos = [], seen = new Set();
  for (let a = 0; a < idx.length && combos.length < 24; a++) for (let b = a + 1; b < idx.length && combos.length < 24; b++) { const k = [tr[idx[a]], tr[idx[b]]].sort().join(); if (!seen.has(k)) { seen.add(k); combos.push([idx[a], idx[b]]); } }
  return combos.map(c => ({ apply() {
    const ids = c.map(i => tr[i]); for (const i of c.slice().sort((x, y) => y - x)) tr.splice(i, 1);
    state.players[hp].deck.push(...ids); S.markTurnEffectUsed(h, key); return true;
  } }));
} }, 'inheritedKo');
// EX6-030 도미니몬 【서로의 턴】 특징으로 「천사형」/「대천사형」/「3대천사」를 가진 자신의 디지몬이 자신의 효과와 배틀 이외로 배틀 에어리어를 벗어날 때, 자신의 시큐리티를 위에서부터 1장 파기하는 것으로, 벗어나지 않는다.
D('EX6-030', '서로의 턴', '벗어나지 않는다', { preventLeaveOptions: (state, hp, h, target, tp, cause) => {
  if (tp !== hp || !isDig(target) || cause !== 'effect' || !hasTr(target.cardId, '천사형', '대천사형', '3대천사') || !state.players[hp].security.length) return [];
  return [{ apply() { S.trashTopSecurityByEffect(state, hp); return true; } }];
} });
// EX7-027 샤프로몬 (inherited) 【서로의 턴】[턴에 1회] 이 디지몬이 자신의 효과 이외로 배틀 에어리어를 벗어날 때, 자신의 토큰 또는 특징으로 「퍼펫형」을 가진 다른 자신의 디지몬 1마리를 소멸시키는 것으로, 벗어나지 않는다.
D('EX7-027', '서로의 턴', '벗어나지 않는다', { preventLeaveOptions: (state, hp, h, target, tp, cause) => {
  if (target !== h || cause === 'ownEffect') return [];
  const key = S.onceLimitKey('EX7-027', ['서로의 턴']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return [];
  return state.players[hp].battle.filter(s => s !== h && isDig(s) && tokenOrTr(s, '퍼펫형')).map(s => ({ apply() { S.markTurnEffectUsed(h, key); S.deleteStack(state, hp, s.uid, 'trash', 'ownEffect'); return true; } }));
} }, 'inheritedKo');
// EX6-042 라이지루도몬 (inherited) 【서로의 턴】[턴에 1회] 이 디지몬이 자신의 효과 이외로 소멸할 때, 이 디지몬의 진화원에서 특징으로 「Legend-Arms」를 가진 카드 1장을 파기하는 것으로, 소멸하지 않는다.
D('EX6-042', '서로의 턴', '소멸하지 않는다', { preventLeaveOptions: (state, hp, h, target, tp, cause, mode) => {
  if (target !== h || cause === 'ownEffect' || mode !== 'delete') return [];
  const key = S.onceLimitKey('EX6-042', ['서로의 턴']);
  if (S.turnUsesRemaining(h, key, 1) <= 0) return [];
  return sourceCombos(h, 1, ([i]) => hasTr(h.sources[i], 'Legend-Arms')).map(c => ({ apply() {
    const [id] = h.sources.splice(c[0], 1); state.players[hp].trash.push(id); S.recomputeStackGrants(h); S.markTurnEffectUsed(h, key); return true;
  } }));
} }, 'inheritedKo');

// EX6-009 듀라몬 【자신의 턴】[턴에 1회] 이 디지몬의 진화원이 효과로 늘어났을 때, 턴 종료까지 《돌진》과 《관통》을 얻는다. (EX6-008 twin; shard3 registered the others but not this one)
D('EX6-009', '자신의 턴', '진화원이 효과로 늘어났을 때', { limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.owner === hp && info.stack === h && info.cause === 'effect' } });
sc('EX6-009::자신의 턴@진화원이 효과로 늘어났을 때', async (ctx) => { const t = me(ctx); if (!t) return; S.grantKeyword(ctx.state, ctx.self, t.uid, '돌진', undefined, 'turn'); S.grantKeyword(ctx.state, ctx.self, t.uid, '관통', undefined, 'turn'); });
// EX6-009 (inherited) 【자신의 턴】[턴에 1회] 이 디지몬의 어택의 대상이 변경되었을 때, 상대의 시큐리티를 위에서부터 1장 파기한다.
D('EX6-009', '자신의 턴', '대상이 변경되었을 때', { limit: 1, events: { redirect: (state, hp, h, info) => info.owner === hp && info.stack === h } }, 'inheritedKo');
sc('EX6-009::자신의 턴@대상이 변경되었을 때', async (ctx) => { S.trashTopSecurityByEffect(ctx.state, ctx.opp); });
// EX6-001 사쿳토몬 / EX7-005 카프리몬 (inherited) 【자신의 턴】[턴에 1회] 이 디지몬의 진화원에 특징으로 「…」를 가진 카드가 효과로 놓였을 때, 메모리 +1.
D('EX6-001', '자신의 턴', '진화원에 특징으로', { limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.owner === hp && info.stack === h && info.cause === 'effect' && (info.added || []).some(id => hasTr(id, 'Legend-Arms')) } }, 'inheritedKo');
D('EX7-005', '자신의 턴', '진화원에 특징으로', { limit: 1, events: { sourcesAdded: (state, hp, h, info) => info.owner === hp && info.stack === h && info.cause === 'effect' && (info.added || []).some(id => C(id).category === 'option' && hasTr(id, '3총사')) } }, 'inheritedKo');

// EX5-053 백호몬 【상대의 턴】[턴에 1회] 자신의 시큐리티가 체크되었을 때, 그 카드가 특징으로 「데바」를 가진 디지몬 카드라면, 배틀을 진행하지 않고, 그 카드를 코스트를 지불하지 않고 등장시킨다.
D('EX5-053', '상대의 턴', '체크되었을 때', { limit: 1, events: { securityChecked: (state, hp, h, info) => info.defenderP === hp && C(info.cardId).category === 'digimon' && hasTr(info.cardId, '데바') } });
sc('EX5-053::상대의 턴@체크되었을 때', async (ctx) => { const id = ctx.trigger?.evt?.cardId; if (id) S.playThisFreeFromTrash(ctx.state, ctx.self, id); });

// EX5-041 현무몬 【등장 시】【진화 시】 특징으로 「데바」/「4성수」를 가진 자신의 디지몬 1마리마다 상대의 디지몬 1마리를 레스트시킨다. 그 후, 다음 상대의 액티브 페이즈에서는, 상대의 디지몬 전부는 액티브가 되지 않는다.
sc('EX5-041::등장 시', async (ctx, R) => {
  const { state } = ctx;
  const n = digs(state, ctx.self).filter(s => hasTr(s.cardId, '데바', '4성수')).length;
  for (let i = 0; i < n; i++) await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
  for (const s of digs(state, ctx.opp)) S.setSkipNextUnsuspend(state, ctx.opp, s.uid);
});

// EX6-027 오파니몬 【서로의 턴】[턴에 1회] 자신의 시큐리티가 줄어들었을 때, 자신의 턴이라면, 턴 종료까지 이 디지몬은 《S 어택 +1》을 얻고, 이 디지몬으로 어택할 수 있다. 상대의 턴이라면, 《리커버리 +1《덱》》.
D('EX6-027', '서로의 턴', '시큐리티가 줄어들었을 때', { limit: 1, events: { securityDecrease: (state, hp, h, info) => info.owner === hp } });
sc('EX6-027::서로의 턴@시큐리티가 줄어들었을 때', async (ctx) => {
  const { state } = ctx; const t = me(ctx); if (!t) return;
  if (state.activePlayer === ctx.self) {
    S.grantKeyword(state, ctx.self, t.uid, '시큐리티어택', 1, 'turn');
    if (!t.suspended && await ask(ctx, '이 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, t.uid);
  } else S.recoverTopOfDeckToSecurity(state, ctx.self);
});

// EX8-004 모티몬 (inherited) 【자신의 턴】[턴에 1회] 특징으로 「NSp」를 가진 다른 자신의 디지몬이 등장했을 때, 이 디지몬이 특징으로 「NSp」를 가진다면, 이 디지몬으로 어택할 수 있다.
D('EX8-004', '자신의 턴', '이 디지몬으로 어택할 수 있다', { limit: 1, events: { play: (state, hp, h, info) => info.owner === hp && info.stack !== h && isDig(info.stack) && hasTr(info.stack.cardId, 'NSp') && hasTr(h.cardId, 'NSp') } }, 'inheritedKo');
sc('EX8-004::자신의 턴@이 디지몬으로 어택할 수 있다', async (ctx) => { const t = me(ctx); if (t && !t.suspended && await ask(ctx, '이 디지몬으로 어택할까요?')) ctx.startAttack(ctx.self, t.uid); });

// EX8-063 발바몬 X항체 【서로의 턴】[턴에 1회] 상대의 패가 파기되었을 때, 이 디지몬의 진화원에 「발바몬」/「X항체」가 있다면, 상대의 시큐리티를 위에서부터 1장 파기한다.
D('EX8-063', '서로의 턴', '상대의 패가 파기되었을 때', { limit: 1, events: { discard: (state, hp, h, info) => info.owner !== hp && srcCards(h).some(id => C(id).nameKo.includes('발바몬') || hasTr(id, 'X항체')) } });
sc('EX8-063::서로의 턴@상대의 패가 파기되었을 때', async (ctx) => { S.trashTopSecurityByEffect(ctx.state, ctx.opp); });

// EX7-063 키노사키 아리사 【서로의 턴】 자신의 토큰 또는 특징으로 「퍼펫형」을 가진 자신의 디지몬이 소멸했을 때, 이 테이머를 레스트시키는 것으로, 자신의 패에서 특징으로 「퍼펫형」을 가진 Lv.3의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
D('EX7-063', '서로의 턴', '소멸했을 때', { events: { delete: (state, hp, h, info) => info.owner === hp && !!info.stack && isDig(info.stack) && tokenOrTr(info.stack, '퍼펫형') && !h.suspended } });

// ---- play / evolve cost reductions printed on the card itself ----
// EX5-012 / EX5-020 "이 카드가 등장할 때 또는 이 카드로 진화할 때, 진화원이 3장 이상 있는 특징으로 「…」를 가진 자신의 디지몬이 있다면, 지불하는 등장/진화 코스트 -2."
const src3 = (traits) => (state, p) => digs(state, p).some(s => srcCards(s).length >= 3 && hasTr(s.cardId, ...traits));
for (const id of ['EX5-012', 'EX5-020']) {
  const ok = src3(['라이트 팽', '나이트 클로', '은하형']);
  (HOOKS[id] ||= []).push({ tag: '__handPlay', selfPlayDiscount: (state, hp) => (ok(state, hp) ? -2 : 0), selfEvoDiscount: (state, hp) => (ok(state, hp) ? -2 : 0) });
}
// EX5-034 반쵸레오몬 "패의 이 카드가 등장할 때, 서로의 시큐리티 합계가 6장 이하라면, 지불하는 등장 코스트 -5."
(HOOKS['EX5-034'] ||= []).push({ tag: '__handPlay', selfPlayDiscount: (state) => (totalSec(state) <= 6 ? -5 : 0) });
// EX6-039 크리사리몬 "패의 이 카드가 등장할 때, 특징으로 「종족불명」을 가진 자신의 디지몬 1마리를 소멸시키는 것으로, 지불하는 등장 코스트 -3."
(HOOKS['EX6-039'] ||= []).push({ tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const cands = () => digs(state, p).filter(s => hasTr(s.cardId, '종족불명'));
  if (!cands().length) return null;
  return { label: `${C(cardId).nameKo}: 특징 「종족불명」을 가진 자신의 디지몬 1마리를 소멸시켜 등장 코스트 -3?`, async apply(choose) {
    const uid = await choose('pickStack', { player: p, uids: cands().map(s => s.uid), prompt: '소멸시킬 자신의 「종족불명」 디지몬 선택' });
    if (!uid) return 0;
    S.deleteStack(state, p, uid, 'trash', 'ownEffect');
    return -3;
  } };
} });
// EX8-074 메디벌듀크몬 "이 카드가 등장할 때, 디지몬 2마리를 레스트시키는 것으로, 지불하는 등장 코스트 -4."
(HOOKS['EX8-074'] ||= []).push({ tag: '__handPlay', handPlayOption: (state, p, cardId) => {
  const entries = () => ['p1', 'p2'].flatMap(q => digs(state, q).filter(s => !s.suspended && S.canRestByRule(state, q, s)).map(s => ({ player: q, uid: s.uid })));
  if (entries().length < 2) return null;
  return { label: `${C(cardId).nameKo}: 디지몬 2마리를 레스트시켜 등장 코스트 -4?`, async apply(choose) {
    const picked = [];
    for (let k = 0; k < 2; k++) {
      const es = entries().filter(e => !picked.some(x => x.uid === e.uid));
      const e = await choose('pickStackAnySide', { player: p, entries: es, prompt: `레스트시킬 디지몬 선택 (${k + 1}/2)` });
      if (!e) break;
      picked.push(e);
    }
    if (picked.length < 2) return 0;
    for (const e of picked) S.restStack(state, e.player, e.uid);
    return -4;
  } };
} });

// EX5-064 코우＆사요 【등장 시】【메인】 이 테이머를 레스트시키고, 특징으로 「라이트 팽」/「나이트 클로」를 가진 자신의 디지몬에 겹쳐져 있는 카드를 위에서부터 1장 그 디지몬의 진화원 아래에 놓는 것으로, 자신의 디지몬 1마리를 패의 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
// "이 디지몬에 겹쳐져 있는 카드" = the cards under the Digimon (진화원; BT13-058/BT9-044/BT16-056 use the same phrase for the sources) — same reading as shard20 rotateSource (EX5-007/016).
// shard3's version moved the TOP (Digimon) card itself under its sources; that contradicts the printed phrase and EX5-007/016. Both events are emitted so EX5-001 (topPlaced) and BT22-006 (sourceRotated) keep working.
sc('EX5-064::등장 시', async (ctx, R) => {
  const { state, self } = ctx; const t = me(ctx);
  if (!t || C(t.cardId).category !== 'tamer' || t.suspended) return;
  const cands = digs(state, self).filter(s => srcCards(s).length >= 1 && hasTr(s.cardId, '라이트 팽', '나이트 클로'));
  if (!cands.length) return;
  if (!(await ask(ctx, '이 테이머를 레스트시키고 디지몬에 겹쳐진 카드 1장을 진화원 아래로 옮겨 무료 진화할까요?'))) return;
  const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: self, uids: cands.map(s => s.uid), prompt: '겹쳐진 카드를 진화원 아래로 옮길 디지몬 선택' });
  const d = cands.find(s => s.uid === uid); if (!d) return;
  S.restStack(state, self, t.uid);
  if (!t.suspended) return;
  const fd = S.fdCount(d);
  const moved = d.sources.splice(d.sources.length - 1, 1);
  d.sources.splice(fd, 0, ...moved);
  S.recomputeStackGrants(d);
  S.log(state, `${self} ${C(d.cardId).nameKo}에 겹쳐진 카드 ${C(moved[0]).nameKo}을(를) 진화원 아래로 이동`);
  S.emitGameEvent(state, 'sourceRotated', { owner: self, stack: d, cause: 'effect', moved });
  S.emitGameEvent(state, 'topPlaced', { owner: self, stack: d, cause: 'effect' });
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: false, other: false, desc: null, name: null }, zone: 'hand', cardFilter: { category: 'digimon' }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }, ctx);
});

// EX7-013 매그너키드몬 【자신의 턴 종료 시】[턴에 1회] 이 디지몬의 진화원에서 옵션 카드 1장을 파기하는 것으로, 턴 종료까지 특징으로 「3총사」를 가진 자신의 디지몬 1마리는 《S 어택 +1》을 얻고, 그 디지몬으로 어택한다.
// (the compiled script granted 《S 어택 +1》 but dropped "그 디지몬으로 어택한다")
SCRIPTS['EX7-013::자신의 턴 종료 시'] = [{ op: 'costGroup', cost: [{ op: 'moveEach', who: 'self', from: ['sources'], groups: [{ filter: { category: 'option' }, max: 1, label: '옵션 카드' }], dest: 'trash', ordered: false, required: true }],
  then: [fn(async (ctx) => {
    const cands = digs(ctx.state, ctx.self).filter(s => hasTr(s.cardId, '3총사'));
    if (!cands.length) return;
    const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: '《S 어택 +1》을 얻고 어택할 「3총사」 디지몬 선택' });
    const t = cands.find(s => s.uid === uid); if (!t) return;
    S.grantKeyword(ctx.state, ctx.self, t.uid, '시큐리티어택', 1, 'turn');
    ctx.startAttack(ctx.self, t.uid);
  })] }];

// EX7-037 틀랄록몬 【진화 시】 자신의 패에서 특징으로 「NSp」를 가진 등장 코스트 7 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다. 조그레스 진화하고 있었다면, 대신 자신의 패에서 특징으로 「NSp」를 가진 색이 서로 다른 등장 코스트 7 이하의 디지몬 카드 2장까지를 코스트를 지불하지 않고 등장시킬 수 있다.
// (the compiled version dropped the "색이 서로 다른" restriction: two same-colored cards could be played)
sc('EX7-037::진화 시@색이 서로 다른', async (ctx) => {
  const { state, self } = ctx; const t = me(ctx); if (!t) return;
  const pl = state.players[self];
  const fused = !!t.viaFusion;
  const ok = (id, chosen) => C(id).category === 'digimon' && hasTr(id, 'NSp') && (C(id).cost || 0) <= 7 && !chosen.some(c => (C(c).colors || []).some(col => (C(id).colors || []).includes(col)));
  const chosen = [];
  for (let k = 0; k < (fused ? 2 : 1); k++) {
    const idxs = pl.hand.map((id, i) => i).filter(i => ok(pl.hand[i], chosen));
    if (!idxs.length) break;
    const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'hand', eligibleIdxs: idxs, prompt: fused ? `코스트 없이 등장시킬 「NSp」 디지몬 선택 (${k + 1}/2, 서로 다른 색)` : '코스트 없이 등장시킬 「NSp」 디지몬 선택' });
    if (i == null) break;
    const id = pl.hand[i];
    if (S.playFreeFromZone(state, self, 'hand', i)) chosen.push(id);
    else break;
  }
});

// (EX8-005/047/048/051 "이 카드가 특징으로 「광물형」/「광석형」을 가진 디지몬의 진화원에서 효과로 파기되었을 때": handled generically by state.js queueOwnDiscardTriggers)

// EX8-015 메가로그라우몬 X항체 【진화 시】 상대의 턴 종료까지 이 디지몬은 패/덱으로 되돌아가지 않고, DP +3000. 그 후, 이 디지몬의 진화원에 「메가로그라우몬」/「X항체」가 있다면, DP 10000 이하의 상대의 디지몬 1마리를 소멸시킨다.
// (compiled version dropped the protection + DP+3000 and only ran the conditional destroy)
const oppTurnEnd = (state, p) => (state.activePlayer === p ? state.turnNumber + 1 : state.turnNumber);
sc('EX8-015::진화 시', async (ctx, R) => {
  const t = me(ctx); if (!t) return;
  S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['bounce'], until: oppTurnEnd(ctx.state, ctx.self) });
  await R.runOne({ op: 'modifyDP', target: 'self', thisStack: true, amount: 3000, duration: 'opponentTurn' }, ctx);
  if (srcCards(t).some(id => S.cardNames(id).some(n => n === '메가로그라우몬' || n === 'X항체'))) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 10000 } }, ctx);
});
// EX8-043 메탈티라노몬 【등장 시】【진화 시】 디지몬 1마리를 레스트시킬 수 있다. 그 후, 이 디지몬이 레스트 상태라면, 상대의 디지몬 1마리를 《퇴화 1》하고, 상대의 턴 종료까지 이 디지몬은 상대의 효과로 패/덱으로 되돌아가지 않고, 《퇴화》의 효과를 받지 않는다.
sc('EX8-043::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'rest', target: 'either' }, ctx);
  const t = me(ctx); if (!t || !t.suspended) return;
  await R.runOne({ op: 'retreat', target: 'opponent', n: 1 }, ctx);
  S.grantShield(ctx.state, ctx.self, t.uid, { kinds: ['bounce', 'retreat'], until: oppTurnEnd(ctx.state, ctx.self) });
});

// EX8-065 류타로우 윌리엄스 【자신의 턴】 명칭에 「티라노몬」을 포함하는 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 그 디지몬을 패의 명칭에 「티라노몬」을 포함하거나 특징으로 「공룡형」을 가진 디지몬 카드로 지불하는 진화 코스트 -1 하여 진화시킬 수 있다.
// (the tamer rest is paid by the generic watcher; the remaining sentence was a manual noop)
sc('EX8-065::자신의 턴', async (ctx, R) => {
  const uid = ctx.trigger?.evtStackUid; if (!uid || !findStack(ctx.state, ctx.self, uid)) return;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', anyOf: [{ nameAny: ['티라노몬'] }, { traitAny: ['공룡형'] }] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: false }, { ...ctx, sourceStackUid: uid });
});
// EX8-067 클로즈 【자신의 턴】 자신의 디지몬이 특징으로 「광물형」/「광석형」을 가진 디지몬으로 진화했을 때, 이 테이머를 레스트시키는 것으로, 자신의 트래시에서 특징으로 「광물형」/「광석형」을 가진 카드 2장까지를 그 디지몬의 진화원 아래에 놓는다.
sc('EX8-067::자신의 턴', async (ctx) => {
  const { state, self } = ctx; const uid = ctx.trigger?.evtStackUid; const t = uid && findStack(state, self, uid); if (!t) return;
  const pl = state.players[self];
  for (let k = 0; k < 2; k++) {
    const idxs = pl.trash.map((id, i) => i).filter(i => hasTr(pl.trash[i], '광물형', '광석형'));
    if (!idxs.length) break;
    const i = await ctx.choose('pickFromZoneIndex', { player: self, zone: 'trash', eligibleIdxs: idxs, prompt: `그 디지몬의 진화원 아래에 놓을 카드 선택 (${k + 1}/2, 취소=종료)` });
    if (i == null) break;
    const [id] = pl.trash.splice(i, 1);
    t.sources.splice(S.fdCount(t), 0, id);
    S.recomputeStackGrants(t);
    S.log(state, `${self} ${C(id).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
    S.emitGameEvent(state, 'sourcesAdded', { owner: self, stack: t, cause: 'effect', added: [id], srcPlayer: self });
  }
});
