// Shard 39 — batch-10 verification fixes (EX1-/EX2-/EX3-/EX4- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-EX1-4.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's39_fn', fn: f });
OPS.s39_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };

// EX1-031 세라피몬 【상대의 턴】 이 디지몬이 레스트 상태인 동안, 자신의 시큐리티 디지몬 전부의 DP +5000 — checked when a security Digimon battles (s1securityDP)
HOOKS['EX1-031'] = [{ tag: '상대의 턴', has: '시큐리티 디지몬', src: 'effectKo', s1securityDP: (state, hp, holder, info) => (info.p === hp && holder.suspended ? 5000 : 0) }];
const isDigimon = (st) => !!st && C(st.cardId).category === 'digimon';
const srcCards = (st) => st.sources.slice(S.fdCount(st)); // face-down source cards are not "cards in the sources" for conditions
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }

// EX1-020 플레시오몬 【자신의 턴】〔턴에 1회〕 상대 디지몬의 진화원이 파기되었을 때 《2 드로우》 (generic parser has no "진화원이 파기되었을 때" phrasing)
D('EX1-020', '자신의 턴', '진화원이 파기', { limit: 1, events: { sourcesTrashed: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) } });

// EX1-022 황제드라몬: 드래곤 모드 【진화 시】 진화원에 「프리」 디지몬 카드가 있을 때 → 이 디지몬을 액티브로 하고 + 상대 디지몬 1마리 레스트 (the gate was dropped)
sc('EX1-022::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  if (!srcCards(st).some(id => C(id).category === 'digimon' && (C(id).types || []).includes('프리'))) return;
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
  await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
});
// EX1-022 【자신의 턴】 이 디지몬의 진화원의 색 1개마다 DP +1000 (distinct colors among the source cards; was never applied continuously)
D('EX1-022', '자신의 턴', '진화원의 색', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * new Set(srcCards(holder).flatMap(id => C(id).colors || [])).size : 0) });

// EX1-035 캅테리몬 / EX1-040 아트라캅테리몬 【어택 시】 코스트를 지불하고 「곤충형」(/「고대곤충형」) 패의 디지몬 카드로 진화할 수 있다 (was a noop note)
SCRIPTS['EX1-035::어택 시'] = [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', traitAny: ['곤충형'] }, cost: { mode: 'normal' }, ignoreCond: false, ignoreLevel: false }];
SCRIPTS['EX1-040::어택 시'] = [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', traitAny: ['곤충형', '고대곤충형'] }, cost: { mode: 'normal' }, ignoreCond: false, ignoreLevel: false }];

// EX1-043 헤라클레스캅테리몬 【자신의 턴】〔턴에 1회〕 곤충형/고대곤충형 자신의 디지몬이 배틀에서 상대의 디지몬만을 소멸시켰을 때 이 디지몬을 액티브로 할 수 있다
// (the old script only granted a UI keyword; it also swallowed the DP line's key). 
sc('EX1-043::자신의 턴', async (ctx) => {
  const st = me(ctx); if (!st || !st.suspended) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 디지몬을 액티브로 할까요?' }))) return;
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
});
// EX1-043 【자신의 턴】 진화원의 「곤충형」 디지몬 카드 1장마다 DP +1000
D('EX1-043', '자신의 턴', '진화원에 특징으로', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * srcCards(holder).filter(id => C(id).category === 'digimon' && (C(id).types || []).includes('곤충형')).length : 0) });

// EX1-041 다이노몬 【진화 시】 진화원에 「프리」 디지몬 카드가 있을 때 DP 5000 이하 상대 디지몬 1마리 레스트 (the gate was dropped)
sc('EX1-041::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  if (!srcCards(st).some(id => C(id).category === 'digimon' && (C(id).types || []).includes('프리'))) return;
  await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true, filter: { dpMax: 5000 } }, ctx);
});
// EX1-042 로제몬 【자신의 턴】 레스트 상태의 상대 디지몬 1마리마다 DP +1000 (continuous; only existed as a one-shot op)
D('EX1-042', '자신의 턴', '1마리마다', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * state.players[opp(hp)].battle.filter(s => isDigimon(s) && s.suspended).length : 0) });

const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const sameNameOthers = (state, hp, holder) => state.players[hp].battle.filter(s => s !== holder && isDigimon(s) && C(s.cardId).nameKo === C(holder.cardId).nameKo);
// EX1-044 케라몬 (진화원) 【자신의 턴】 이 디지몬과 같은 명칭의 다른 자신의 디지몬 1마리마다 DP +1000 (continuous; had no implementation)
DI('EX1-044', '자신의 턴', '같은 명칭', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * sameNameOthers(state, hp, holder).length : 0) });
// EX1-046 크리사리몬 (진화원) 【자신의 턴】〔턴에 1회〕 같은 명칭의 다른 자신의 디지몬 1마리가 소멸했을 때 이 디지몬을 액티브로 한다
DI('EX1-046', '자신의 턴', '같은 명칭', { limit: 1, events: { delete: (state, hp, holder, info) => info.owner === hp && info.stack !== holder && isDigimon(info.stack) && C(info.stack.cardId).nameKo === C(holder.cardId).nameKo } });
// EX1-051 인펠몬 (진화원) 【서로의 턴】 이 디지몬과 같은 명칭의 다른 자신의 디지몬 전부 DP +2000
DI('EX1-051', '서로의 턴', '같은 명칭', { dp: (state, hp, holder, target, tp) => (tp === hp && target !== holder && isDigimon(target) && C(target.cardId).nameKo === C(holder.cardId).nameKo ? 2000 : 0) });
// EX1-053 메탈에테몬 【상대의 턴】 자신의 트래시의 「에테몬」을 명칭에 포함하는 디지몬 카드 1장마다 DP +1000
D('EX1-053', '상대의 턴', '1장마다', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * state.players[hp].trash.filter(id => C(id).category === 'digimon' && C(id).nameKo.includes('에테몬')).length : 0) });
// EX1-056 피코데블몬 【자신의 턴】 명칭에 「묘티스몬」을 포함하는 자신의 디지몬이 없는 동안 상대의 디지몬에게 어택할 수 없다 (the old script only worked through a one-shot dynamicRestrictions flag that nothing set)
D('EX1-056', '자신의 턴', '묘티스몬', { noAttackDigimon: (state, hp, holder) => !state.players[hp].battle.some(s => isDigimon(s) && C(s.cardId).nameKo.includes('묘티스몬')) });
// EX1-057 위자몬 (진화원) 【자신의 턴】 《길동무》를 가진 자신의 디지몬 전부는 《속공》을 얻는다 (the compiled op granted only this digimon + 길동무)
DI('EX1-057', '자신의 턴', '《길동무》', { grantKw: (state, hp, holder, target) => (isDigimon(target) && S.hasKeyword(target, '길동무') ? ['속공'] : []) });

// EX1-047 가드로몬 / EX2-045 동글몬 【자신의 턴】 이 디지몬은 어택할 수 없다 (no generic handling existed for the bare sentence)
D('EX1-047', '자신의 턴', '어택할 수 없다', { noAttack: () => true });
D('EX2-045', '자신의 턴', '어택할 수 없다', { noAttack: () => true });

// EX1-060 레이디데블몬 (진화원) 【자신의 턴】〔턴에 1회〕 자신의 트래시에서 디지몬이 등장했을 때 메모리 +1 (play event now carries fromZone)
DI('EX1-060', '자신의 턴', '트래시에서', { limit: 1, events: { play: (state, hp, holder, info) => info.owner === hp && info.fromZone === 'trash' && isDigimon(info.stack) } });
// EX1-065 디아블로몬 【상대의 턴】 자신의 「디아블로몬」 전부는 《블로커》를 얻는다 (compiled as a self-only one-shot)
D('EX1-065', '상대의 턴', '디아블로몬', { grantKw: (state, hp, holder, target) => (isDigimon(target) && S.effectiveInfo(state, target, hp).nameIs('디아블로몬') ? ['블로커'] : []) });

// ---- EX1-073 파워드라몬 ----
// 【등장 시】 패/트래시에서 「사이보그형」을 가진 레드/블랙 서로 다른 카드 번호의 Lv.5 카드 5장까지를 이 디지몬의 진화원에 놓고, 놓은 1장마다 메모리 +1 (was an unresolved manual cost)
sc('EX1-073::등장 시', async (ctx) => {
  const st = me(ctx); if (!st) return; const pl = ctx.state.players[ctx.self];
  const placed = new Set();
  const ok = (id) => { const c = C(id); return c.category === 'digimon' && c.level === 5 && (c.types || []).includes('사이보그형') && (c.colors || []).some(x => x === 'red' || x === 'black') && !placed.has(c.cardId || id); };
  for (let i = 0; i < 5; i++) {
    const zs = ['hand', 'trash'].filter(z => pl[z].some(ok));
    if (!zs.length) break;
    let z = zs[0];
    if (zs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '카드를 가져올 위치', options: zs.map(x => (x === 'hand' ? '패' : '트래시')) }); if (k == null) break; z = zs[k] || zs[0]; }
    const ix = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: z, eligibleIdxs: pl[z].map((id, k) => k).filter(k => ok(pl[z][k])), prompt: '진화원에 놓을 카드 선택 (서로 다른 카드 번호)' });
    if (ix == null) break;
    const [id] = pl[z].splice(ix, 1);
    placed.add(C(id).cardId || id);
    st.sources.splice(S.fdCount(st), 0, id);
    S.log(ctx.state, `${ctx.self} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
    S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
  }
  S.recomputeStackGrants(st);
});
// 【서로의 턴】 이 디지몬의 DP는 마이너스되지 않는다 (= DP 감소 효과 무효; the compiled one-shot keyword grant never ran for a static line)
D('EX1-073', '서로의 턴', '마이너스되지', { kw: (state, hp, holder, name) => name === 'DP감소무효' });
// 【서로의 턴】 이 디지몬이 소멸할 때, 진화원의 Lv.5 디지몬 카드 2장을 파기하는 것으로 소멸하지 않는다 (was a noop note) — every distinct pair of Lv.5 sources is a candidate
D('EX1-073', '서로의 턴', '소멸할 때', { preventLeaveOptions: (state, hp, holder, target, tp, cause, mode) => {
  if (target !== holder || mode !== 'delete') return [];
  const elig = holder.sources.map((id, i) => i).filter(i => i >= S.fdCount(holder) && C(holder.sources[i]).category === 'digimon' && C(holder.sources[i]).level === 5);
  const combos = [], seen = new Set();
  for (let a = 0; a < elig.length; a++) for (let b = a + 1; b < elig.length && combos.length < 24; b++) { const key = [holder.sources[elig[a]], holder.sources[elig[b]]].sort().join(); if (!seen.has(key)) { seen.add(key); combos.push([elig[a], elig[b]]); } }
  return combos.map(c => ({ apply() {
    const removed = c.slice().sort((x, y) => y - x).map(i => holder.sources.splice(i, 1)[0]);
    state.players[hp].trash.push(...removed);
    S.recomputeStackGrants(holder);
    return true;
  } }));
} });

// ---- EX2 ----
// EX2-012 메기드라몬 【진화 시】 DP 10000 이하 상대 디지몬 1마리 소멸. 이 효과로 소멸하지 않았을 때 **서로의** 덱 위에서 5장 파기 (was: only own deck, condition unverified)
sc('EX2-012::진화 시', async (ctx, R) => {
  const opl = ctx.state.players[ctx.opp];
  const before = new Set(opl.battle.map(s => s.uid));
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { dpMax: 10000 } }, ctx);
  const destroyed = [...before].some(uid => !opl.battle.some(s => s.uid === uid));
  if (destroyed) return;
  S.trashTopOfDeck(ctx.state, ctx.self, 5);
  S.trashTopOfDeck(ctx.state, ctx.opp, 5);
});
// EX2-020 로프몬 【등장 시】 자신의 시큐리티가 3장 이하일 때, 자신의 「곽소희」가 있다면 리커버리 +1 (the 곽소희 gate was dropped)
sc('EX2-020::등장 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  if (pl.security.length > 3) return;
  if (!pl.battle.some(s => S.effectiveInfo(ctx.state, s, ctx.self).nameIs('곽소희'))) return;
  await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
});
// EX2-024 샤크라몬 【진화 시】 자신의 디지몬 1마리를 액티브로 하고, 자신의 테이머 1명마다 트래시의 「플러그인」을 명칭에 포함하는 옵션 카드 1장을 패로 되돌린다 (compiled as exactly one card, even with 0 tamers)
sc('EX2-024::진화 시', async (ctx, R) => {
  await R.runOne({ op: 'unsuspend', target: 'self', digimonOnly: true }, ctx);
  const n = ctx.state.players[ctx.self].battle.filter(s => C(s.cardId).category === 'tamer').length;
  for (let i = 0; i < n; i++) {
    if (!ctx.state.players[ctx.self].trash.some(id => C(id).category === 'option' && C(id).nameKo.includes('플러그인'))) break;
    await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { category: 'option', nameAny: ['플러그인'] } }, ctx);
  }
});
// EX2-038 저스티몬: 블리츠 암 【진화 시】 이하의 효과에서 1개를 골라 발휘한다 (the compiler ran ALL THREE bullets; 【어택 시】 in shard1 already used a choice)
SCRIPTS['EX2-038::진화 시'] = [{ op: 'choice', prompt: '이하의 효과에서 1개를 골라 발휘한다', options: [
  { label: '이 턴 동안 이 디지몬을 DP+2000', then: [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 2000, duration: 'turn' }] },
  { label: '이 디지몬을 액티브로 한다', then: [{ op: 'unsuspend', target: 'thisStack' }] },
  { label: '등장 코스트 5 이하의 상대 디지몬 1마리를 소멸', then: [{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 5 } }] },
] }];
// EX2-036 그랜드로코몬 【서로의 턴】 자신의 트래시의 「사이보그형」/「머신형」 특징 카드 1장마다 DP +1000 (continuous; only existed as a one-shot op)
D('EX2-036', '서로의 턴', '1장마다', { dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * state.players[hp].trash.filter(id => (C(id).types || []).some(t => t === '사이보그형' || t === '머신형')).length : 0) });
// EX2-043 가르프몬 【자신의 턴】〔턴에 1회〕 자신의 효과로 자신의 패를 파기했을 때 자신의 디지몬 1마리를 액티브로 할 수 있다 (no generic phrase for "패를 파기했을 때")
D('EX2-043', '자신의 턴', '패를 파기', { limit: 1, events: { discard: (state, hp, holder, info) => info.owner === hp && !!state._fxSrc && state._fxSrc.player === hp } });
// EX2-054 ADR-09=게이트 키퍼 【상대의 턴】 진화원을 6장 이상 가진 자신의 「마더 디·리퍼」가 있는 동안 상대 디지몬 전부는 《S 어택 -1》 (compiled as a one-shot permanent grant that never ran)
D('EX2-054', '상대의 턴', '마더 디·리퍼', { sAtkOpp: (state, hp, holder, aStack) => (state.players[hp].battle.some(s => C(s.cardId).nameKo === '마더 디·리퍼' && s.sources.length >= 6) ? -1 : 0) });
// EX2-056 오유민 【자신의 턴】 자신의 디지몬이 명칭에 「듀크몬」/「그라우몬」을 포함하는 디지몬으로 진화할 때, 이 턴 동안 그 디지몬은 「【진화 시】《진격》」을 얻는다
// — "진화할 때" is prospective tense = 즉시형 (15-8-5-1, docs/effect-classification-rules.md): the grant must land BEFORE this SAME
// digivolve's own 【진화 시】 triggers are queued, so it now lives in src/cards/shard2.js's beforeDigivolve (called at the exact digivolve
// call site right before queueTriggersForStack), not a post-hoc events.digivolve hook (which only ran after that queueing already
// happened, always missing the current digivolve's own trigger window). This empty descriptor (no .events) exists only so the coverage
// audit's hookDescriptorFor exception still matches this segment — same convention used for BT14-018's beforeDigivolve half.
D('EX2-056', '자신의 턴', '듀크몬', {});
// EX2-064 앨리스 맥코이 【자신의 턴】〔턴에 1회〕 Lv.5인 자신의 디지몬이 Lv.6으로 진화할 때, 자신의 디지몬 1마리를 소멸시키는 것으로 지불하는 진화 코스트 -3 (was a manual noop)
D('EX2-064', '자신의 턴', 'Lv.6으로', { s1evoOption: (state, hp, holder, info) => {
  if (info.p !== hp || state.activePlayer !== hp || !isDigimon(info.stack) || C(info.stack.cardId).level !== 5 || C(info.targetId).category !== 'digimon' || C(info.targetId).level !== 6) return null;
  const key = S.onceLimitKey('EX2-064', ['자신의 턴']);
  if (S.turnUsesRemaining(holder, key, 1) <= 0) return null;
  const others = state.players[hp].battle.filter(s => isDigimon(s) && s !== info.stack);
  if (!others.length) return null;
  return { label: '앨리스 맥코이 — 자신의 디지몬 1마리를 소멸시켜 진화 코스트 -3?', async apply(choose) {
    let uid = others[0].uid;
    if (others.length > 1 && typeof choose === 'function') uid = await choose('pickStack', { player: hp, uids: others.map(s => s.uid), prompt: '소멸시킬 자신의 디지몬 선택 (진화 코스트 -3)' });
    if (!uid) return 0;
    S.markTurnEffectUsed(holder, key);
    S.deleteStack(state, hp, uid, 'trash', 'ownEffect');
    return -3;
  } };
} });
// EX2-055 리퍼 「이 디지몬이 등장할 때, 자신의 「마더 디·리퍼」 1마리의 진화원을 아래에서부터 7장 이상 파기하는 것으로, 지불하는 등장 코스트를 0으로 한다」 — hand-play option (was not implemented at all)
D('EX2-055', '__handPlay', '', { handPlayOption: (state, p, cardId) => {
  const moms = state.players[p].battle.filter(s => C(s.cardId).nameKo === '마더 디·리퍼' && s.sources.length >= 7);
  if (!moms.length) return null;
  return { label: `${C(cardId).nameKo}: 「마더 디·리퍼」의 진화원을 아래에서부터 7장 파기하여 등장 코스트를 0으로 할까요?`, async apply(choose) {
    let uid = moms[0].uid;
    if (moms.length > 1 && typeof choose === 'function') uid = await choose('pickStack', { player: p, uids: moms.map(s => s.uid), prompt: '진화원을 파기할 「마더 디·리퍼」 선택' });
    if (!uid) return 0;
    if (S.trashEvoSources(state, p, uid, 7, 'bottom').length < 7) return 0;
    return -(C(cardId).cost || 0);
  } };
} });
// EX2-074 베르제브몬: 블래스트 모드 【자신의 턴】 자신의 트래시 10장마다 이 디지몬은 《S 어택 +1》을 얻는다 (continuous count; the compiled grant was a one-shot)
D('EX2-074', '자신의 턴', '10장마다', { kwNum: (state, hp, holder) => Math.floor(state.players[hp].trash.length / 10) });

// ---- EX3 ----
// EX3-001 베이비드몬 (진화원) 【서로의 턴】[턴에 1회] 명칭에 「드라몬」/「엑자몬」을 포함하는 이 디지몬이 액티브가 되었을 때, 턴 종료까지 이 디지몬을 DP +1000 (the generic "액티브가 되었을 때" parser has no name-qualified subject)
DI('EX3-001', '서로의 턴', '액티브가', { limit: 1, events: {
  active: (state, hp, holder, info) => info.stack === holder && info.owner === hp && /드라몬|엑자몬/.test(C(holder.cardId).nameKo),
  unsuspend: (state, hp, holder, info) => info.stack === holder && info.owner === hp && /드라몬|엑자몬/.test(C(holder.cardId).nameKo),
} });

// ---- 「4대용의 시련」 (EX3-069) family ----
const is4dragon = (id) => (C(id).types || []).includes('4대용');
const isTrial = (st) => !!st && C(st.cardId).nameKo === '4대용의 시련';
// EX3-069 《딜레이》 bullet: 패의 「4대용」 디지몬 1장을 코스트 없이 등장. 이 효과로 등장한 디지몬은 Lv.7로 진화할 수 없고, 다음 상대의 턴 종료 시에 소멸한다
// (the compiler dropped the whole second sentence: no Lv.7 ban, no end-of-turn deletion, and no "「4대용의 시련」의 효과로 등장" marker for EX3-025/036/064)
const trialDelay = [fn(async (ctx) => {
  const state = ctx.state, pl = state.players[ctx.self];
  const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).category === 'digimon' && is4dragon(pl.hand[i]));
  if (!idxs.length) { S.log(state, `${ctx.self} 등장시킬 「4대용」 디지몬이 패에 없음`); return; }
  const ix = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: '코스트를 지불하지 않고 등장시킬 「4대용」 디지몬 선택' });
  if (ix == null) return;
  const stk = S.playFreeFromZone(state, ctx.self, 'hand', ix, {});
  if (!stk) return;
  stk.byTrial = true; stk.s39MaxEvoLevel = 6; // "「4대용의 시련」의 효과로 등장하고 있었다면" / Lv.7로 진화할 수 없다
  const owner = ctx.self, uid = stk.uid;
  (state.endOfTurnEffects ||= []).push({ turnNumber: state.turnNumber + 1, player: owner, cardId: 'EX3-069', label: '「4대용의 시련」으로 등장한 디지몬 소멸 (다음 상대의 턴 종료 시)', fn: () => { const cur = state.players[owner].battle.find(s => s.uid === uid); if (cur) S.deleteStack(state, owner, uid, 'trash', 'effect'); } });
})];
SCRIPTS['EX3-069::딜레이'] = trialDelay; // event/turn-triggered path (main.js delayBulletPlan)
SCRIPTS['EX3-069::메인@「4대용」을 가진 디지몬'] = trialDelay; // the 🗑딜레이 button path (pending tagged 메인 carrying the bullet text)
// EX3-025 청룡몬 【등장 시】《2 드로우》. 그 후, 「4대용의 시련」의 효과로 등장하고 있었다면 메모리 +2
sc('EX3-025::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'draw', who: 'self', n: 2 }, ctx);
  if (me(ctx)?.byTrial) await R.runOne({ op: 'gainMemory', who: 'self', n: 2 }, ctx);
});
// EX3-036 홀리드라몬 【등장 시】 상대의 디지몬 전부에게 《S 어택 -1》 (상대의 턴 종료까지). 「4대용의 시련」의 효과로 등장하고 있었다면 대신 《S 어택 -2》
sc('EX3-036::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'grantKeyword', target: 'opponent', all: true, keyword: '시큐리티어택', value: me(ctx)?.byTrial ? -2 : -1, duration: 'opponentTurn' }, ctx);
});
// EX3-064 메기드라몬 【등장 시】 Lv.5 이하 상대 디지몬 1마리 소멸. 「4대용의 시련」의 효과로 등장하고 있었다면 이 Lv. 상한 +1
sc('EX3-064::등장 시', async (ctx, R) => {
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: me(ctx)?.byTrial ? 6 : 5 } }, ctx);
});
// EX3-027 아구몬 (진화원) / EX3-034 엔젤우몬: 【자신의 턴】[턴에 1회] 「4대용」 특징의 자신의 디지몬이 등장했을 때 또는 자신의 「4대용의 시련」이 배틀 에어리어에 놓였을 때 (the "또는" of two different events was not parsed)
const trialEvents = { play: (state, hp, holder, info) => info.owner === hp && isDigimon(info.stack) && is4dragon(info.stack.cardId), optionPlaced: (state, hp, holder, info) => info.owner === hp && isTrial(info.stack) };
DI('EX3-027', '자신의 턴', '4대용', { limit: 1, events: trialEvents });
D('EX3-034', '자신의 턴', '4대용', { limit: 1, events: trialEvents });
DI('EX3-034', '자신의 턴', '4대용', { limit: 1, events: trialEvents });
// EX3-026 이지스드라몬 【상대의 턴】[턴에 1회] 상대의 디지몬이 등장했을 때 이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다 (was not implemented)
D('EX3-026', '상대의 턴', '진화 시】 효과', { limit: 1, events: { play: (state, hp, holder, info) => info.owner !== hp && isDigimon(info.stack) } });
sc('EX3-026::상대의 턴', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  const seg = S.parseEffectSegments(C('EX3-026').effectKo).segments.find(sg => sg.tags.includes('진화 시'));
  if (!seg) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 디지몬의 【진화 시】 효과를 발휘할까요?' }))) return;
  const Fx = await import('../effects.js');
  const script = Fx.lookupCardSpecific('EX3-026', seg.tags, seg.body) || Fx.compileToScript(seg.body);
  await R.runScript(script, ctx);
});
// EX3-062 메가로그라우몬 【진화 시】 서로의 덱 위에서 3장 파기. 그 후, 자신의 트래시가 5장 이상이면 패에서 「길몬」 / 상대의 트래시가 5장 이상이면 자신의 트래시에서 「오유민」 1장을 코스트 없이 등장시킬 수 있다
// (자신/상대 ↔ 패/트래시 correspond one-to-one; the compiled script merged both names into one optional play from either zone regardless of the counts)
sc('EX3-062::진화 시', async (ctx, R) => {
  S.trashTopOfDeck(ctx.state, ctx.self, 3);
  S.trashTopOfDeck(ctx.state, ctx.opp, 3);
  const st = ctx.state;
  if (st.players[ctx.self].trash.length >= 5) await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { exactAny: ['길몬'] }, rested: false, noTriggers: false, optional: true }, ctx);
  if (st.players[ctx.opp].trash.length >= 5) await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { exactAny: ['오유민'] }, rested: false, noTriggers: false, optional: true }, ctx);
});
// EX3-065 쿠리하라 히나 【자신의 턴】 자신의 디지몬이 「암룡형」/「지룡형」/「기룡형」/「천룡형」 특징의 디지몬으로 진화했을 때, 이 테이머를 레스트시키는 것으로 그 디지몬의 【등장 시】 효과 1개를 발휘시킨다 (was a manual noop)
D('EX3-065', '자신의 턴', '암룡형', { events: { digivolve: (state, hp, holder, info) => {
  if (info.owner !== hp || !info.stack || !isDigimon(info.stack) || holder.suspended || C(holder.cardId).category !== 'tamer') return false;
  if (!(C(info.stack.cardId).types || []).some(t => ['암룡형', '지룡형', '기룡형', '천룡형'].includes(t))) return false;
  const seg = S.parseEffectSegments(C(info.stack.cardId).effectKo).segments.find(sg => sg.tags.includes('등장 시'));
  if (!seg) return false;
  S.restStack(state, hp, holder.uid);
  if (!holder.suspended) return false;
  S.queuePending(state, { player: hp, cardId: info.stack.cardId, stackUid: info.stack.uid, tags: ['등장 시'], text: seg.body, topId: info.stack.cardId, evt: { kind: 'digivolve' } });
  S.log(state, `${hp} 쿠리하라 히나를 레스트시켜 ${C(info.stack.cardId).nameKo}의 【등장 시】 효과를 발휘시킴`);
  return false;
} }, skipTrigger: true });

// ---- EX4 ----
// EX4-011 카오스듀크몬 [트래시]【자신의 턴 종료 시】 진화원을 가진 「듀크몬」 포함 자신의 디지몬 1마리를 소멸시키는 것으로, 이 카드(트래시)를 코스트 없이 등장 (compiled as playing "a card from hand")
sc('EX4-011::자신의 턴 종료 시', async (ctx) => {
  const state = ctx.state, pl = state.players[ctx.self];
  if (!pl.trash.includes('EX4-011')) return;
  const cands = pl.battle.filter(s => isDigimon(s) && C(s.cardId).nameKo.includes('듀크몬') && s.sources.length > 0);
  if (!cands.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '「듀크몬」을 포함하는 디지몬 1마리를 소멸시켜 트래시의 카오스듀크몬을 등장시킬까요?' }))) return;
  const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: '소멸시킬 디지몬 선택' });
  if (!uid) return;
  S.deleteStack(state, ctx.self, uid, 'trash', 'ownEffect');
  const ix = pl.trash.indexOf('EX4-011');
  if (ix >= 0) S.playFreeFromZone(state, ctx.self, 'trash', ix, {});
});
// EX4-048 가이오몬 【자신의 턴 종료 시】 자신의 테이머가 있다면 이 디지몬을 패의 「가이오몬」 포함 등장 코스트 13 이상 카드 1장으로 진화 조건 무시·코스트 없이 진화 (the compiled script ALSO played a second card from hand)
SCRIPTS['EX4-048::자신의 턴 종료 시'] = [{ op: 'condition', if: { hasTamer: true }, then: [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { nameAny: ['가이오몬'], costMin: 13, category: 'digimon' }, cost: { mode: 'free' }, ignoreCond: true, ignoreLevel: false }], else: [] }];
// EX4-049 크레스가루몬 【진화 시】 1개: ·등장 코스트 합계 6까지 상대 디지몬을 덱 아래로 ·다른 디지몬을 그레이몬으로 무료 진화 ·조그레스 (option 1 was an empty "manual" branch)
SCRIPTS['EX4-049::진화 시'] = [{ op: 'choice', prompt: '이하의 효과에서 1개를 골라 발휘한다', options: [
  { label: '등장 코스트 합계 6까지 상대의 디지몬을 덱 아래로 되돌린다', then: [fn(async (ctx, R) => {
    const opl = ctx.state.players[ctx.opp]; let left = 6, first = true;
    for (;;) {
      if (!opl.battle.some(s => isDigimon(s) && (C(s.cardId).cost || 0) <= left)) break;
      if (!first && !(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `등장 코스트 합계 남은 ${left}: 상대 디지몬을 더 덱 아래로 되돌릴까요?` }))) break;
      const before = new Map(opl.battle.map(s => [s.uid, C(s.cardId).cost || 0]));
      await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { costMax: left }, requireSuspended: null, dest: 'deckBottom' }, ctx);
      const gone = [...before.keys()].filter(u => !opl.battle.some(s => s.uid === u));
      if (!gone.length) break;
      left -= before.get(gone[0]); first = false;
    }
  })] },
  { label: '다른 자신의 디지몬 1마리를 패의 「그레이몬」 포함 Lv.6 이하 디지몬으로 코스트 없이 진화', then: [{ op: 'evolveEffect', who: 'self', subject: { thisStack: false, other: true, desc: null, name: null }, zone: 'hand', cardFilter: { category: 'digimon', nameAny: ['그레이몬'], levelMax: 6 }, cost: { mode: 'free' }, ignoreCond: false, ignoreLevel: false }] },
  { label: '이 디지몬과 다른 자신의 디지몬으로 조그레스 진화', then: [{ op: 'jogressEffect', who: 'self', partnerName: null, cardName: null }] },
] }];
// EX4-052 가짜 아구몬 박사 【자신의 턴】[턴에 1회] 상대의 디지몬이 소멸했을 때 패의 소멸한 디지몬과 같은 Lv.의 카드 1장을 파기하는 것으로 《2 드로우》 (was a manual cost + unconditional draw)
D('EX4-052', '자신의 턴', '소멸했을 때', { limit: 1, events: { delete: (state, hp, holder, info) => { if (info.owner === hp || !isDigimon(info.stack)) return false; holder.s39DelLv = C(info.stack.cardId).level; return true; } } });
sc('EX4-052::자신의 턴', async (ctx, R) => {
  const st = me(ctx); if (!st) return; const pl = ctx.state.players[ctx.self];
  const lv = st.s39DelLv; const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).level != null && C(pl.hand[i]).level === lv);
  if (!idxs.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `패의 Lv.${lv} 카드 1장을 파기하고 《2 드로우》할까요?` }))) return;
  const ix = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: `파기할 Lv.${lv} 카드 선택` });
  if (ix == null) return;
  S.trashFromHand(ctx.state, ctx.self, ix);
  await R.runOne({ op: 'draw', who: 'self', n: 2 }, ctx);
});
// EX4-023 아구몬 박사 【상대의 턴】[턴에 1회] 상대의 디지몬이 등장했을 때 패의 그 디지몬과 같은 Lv.의 카드 1장을 오픈하는 것으로 그 카드를 시큐리티 위에 놓는다 (was a manual cost + manual noop)
D('EX4-023', '상대의 턴', '오픈', { limit: 1, events: { play: (state, hp, holder, info) => { if (info.owner === hp || !isDigimon(info.stack)) return false; holder.s39PlayLv = C(info.stack.cardId).level; return true; } } });
sc('EX4-023::상대의 턴', async (ctx) => {
  const st = me(ctx); if (!st) return; const pl = ctx.state.players[ctx.self];
  const lv = st.s39PlayLv; const idxs = pl.hand.map((id, i) => i).filter(i => C(pl.hand[i]).level != null && C(pl.hand[i]).level === lv);
  if (!idxs.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `패의 Lv.${lv} 카드 1장을 오픈하여 시큐리티 위에 놓을까요?` }))) return;
  const ix = idxs.length === 1 ? idxs[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: idxs, prompt: `오픈해서 시큐리티 위에 놓을 Lv.${lv} 카드 선택` });
  if (ix == null) return;
  const [id] = pl.hand.splice(ix, 1);
  S.log(ctx.state, `${ctx.self} 패의 ${C(id).nameKo}을(를) 오픈`);
  S.addToSecurity(ctx.state, ctx.self, id, 'top');
});
// EX4-058 레이브몬 【어택 종료 시】 진화원에 「조」/「새」/「병아리」 특징의 카드가 있는 이 디지몬을 소멸시키는 것으로, 다음 상대의 턴 종료 시 트래시의 「레이브몬」 1장을 코스트 없이 등장 (compiled: paid nothing and played immediately)
sc('EX4-058::어택 종료 시', async (ctx) => {
  const st = me(ctx), state = ctx.state; if (!st) return;
  if (!srcCards(st).some(id => (C(id).types || []).some(t => ['조', '새', '병아리'].some(k => t.includes(k))))) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '이 디지몬을 소멸시키고 다음 상대의 턴 종료 시 트래시의 「레이브몬」을 등장시킬까요?' }))) return;
  const owner = ctx.self, uid = st.uid;
  S.deleteStack(state, owner, uid, 'trash', 'ownEffect');
  if (state.players[owner].battle.some(s => s.uid === uid)) return; // the deletion was prevented
  (state.endOfTurnEffects ||= []).push({ turnNumber: state.turnNumber + 1, player: owner, cardId: 'EX4-058', label: '트래시의 「레이브몬」 1장을 코스트 없이 등장', fn: () => {
    const pl = state.players[owner]; const ix = pl.trash.findIndex(id => C(id).nameKo === '레이브몬');
    if (ix >= 0) S.playFreeFromZone(state, owner, 'trash', ix, {});
  } });
});
// EX4-064 한지호 【서로의 턴】 (테이머를 레스트한 뒤) 《1 드로우》. 그 디지몬이 효과로 소멸하고 있었다면 메모리 +1 (the memory was unconditional)
sc('EX4-064::서로의 턴', async (ctx, R) => {
  await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
  const cause = ctx.trigger && ctx.trigger.evtCause;
  if (cause === 'effect' || cause === 'ownEffect') await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
});
// EX4-073 오메가몬 Alter-B 【어택 시】 진화원의 Lv.6 이상 카드 3장까지를 파기하는 것으로, 파기한 1장마다 [가장 등장 코스트가 낮은 상대 디지몬/테이머 1마리(명) 소멸]. 그 후 3장 파기했다면 상대 시큐리티 2장 파기 (was: one destroy + 2 security regardless of the count)
sc('EX4-073::어택 시', async (ctx, R) => {
  const st = me(ctx), state = ctx.state; if (!st) return;
  const pred = (id) => (C(id).level || 0) >= 6;
  const elig = st.sources.map((id, i) => i).filter(i => i >= S.fdCount(st) && pred(st.sources[i]));
  const maxN = Math.min(3, elig.length); if (!maxN) return;
  const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '진화원의 Lv.6 이상 카드를 몇 장 파기할까요? (0 = 발휘하지 않음)', options: ['0장', ...Array.from({ length: maxN }, (_, i) => `${i + 1}장`)] });
  const n = k == null ? 0 : Math.min(maxN, k);
  if (!n) return;
  const idxs = await S.chooseSourceIdxs(state, ctx.self, st, n, ctx.choose, (id, i) => i >= S.fdCount(st) && pred(id));
  const removed = S.trashEvoSources(state, ctx.self, st.uid, n, 'bottom', idxs);
  for (let i = 0; i < removed.length; i++) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', anyKind: true, filter: { extreme: { stat: 'cost', dir: 'min' } } }, ctx);
  if (removed.length >= 3) { await R.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx); await R.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx); }
});
// EX4-014 가오스몬 【자신의 턴】[턴에 1회] 「블루 플레어」 특징의 카드가 등장했을 때 《1 드로우》. 「트와일라잇」 특징의 카드가 등장했을 때 트래시의 디지크로스 조건 디지몬 1장을 패로 (two independent events were compiled into one script running both)
D('EX4-014', '자신의 턴', '블루 플레어', { limit: 1, events: { play: (state, hp, holder, info) => info.owner === hp && !!info.stack && ((C(info.stack.cardId).types || []).includes('블루 플레어') || (C(info.stack.cardId).types || []).includes('트와일라잇')) } });
sc('EX4-014::자신의 턴', async (ctx, R) => {
  const uid = ctx.trigger && ctx.trigger.evt && ctx.trigger.evt.stackUid;
  const st = uid && ctx.state.players[ctx.self].battle.find(s => s.uid === uid);
  const types = st ? (C(st.cardId).types || []) : [];
  if (types.includes('블루 플레어')) await R.runOne({ op: 'draw', who: 'self', n: 1 }, ctx);
  if (types.includes('트와일라잇')) await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { category: 'digimon', hasXros: true } }, ctx);
});
// EX4-061 매튜＆신태일 【자신의 턴】[턴에 1회] 자신의 디지몬이 진화했을 때 자신의 디지몬이 1마리 이하이고 그 디지몬이 「그레이몬」 포함 → 「파피몬」 / 「가루몬」 포함 → 「아구몬」 1장을 패/트래시에서 코스트 없이 등장 (unnamed/unconditional play)
SCRIPTS['EX4-061::자신의 턴@1마리 이하'] = [fn(async (ctx, R) => {
  const state = ctx.state, pl = state.players[ctx.self];
  const digs = pl.battle.filter(s => isDigimon(s));
  if (digs.length > 1 || !digs.length) return;
  const nmz = C(digs[0].cardId).nameKo;
  const want = nmz.includes('그레이몬') ? '파피몬' : nmz.includes('가루몬') ? '아구몬' : null;
  if (!want) return;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'any', filter: { exactAny: [want] }, rested: false, noTriggers: false, optional: true }, ctx);
})];
