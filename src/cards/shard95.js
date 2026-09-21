// Shard 95 — QA gaps pass (docs/qa-gaps-report.md): the remaining MANUAL "play from evolution sources" effects.
// scripts/scan-manual.mjs listed these as `noop` / "수동으로 처리하세요"; each gets a real script here (cost = none, targets, timing per printed text).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const hasType = (c, ...ts) => ts.some((t) => (c.types || []).includes(t));
OPS.s95_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's95_fn', fn: f }]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const stackOfUid = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null; };
async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
// one card out of an arbitrary id list (picker over a temporary zone); returns the index or null (cancel = the effect is "할 수 있다")
async function pickIdxOf(ctx, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = ctx.state.players[ctx.self];
  pl.s95tmp = ids;
  try { const r = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's95tmp', eligibleIdxs: idxs, prompt }); return r == null || !idxs.includes(r) ? null : r; } finally { delete pl.s95tmp; }
}
async function pickStackOf(ctx, stacks, prompt) {
  if (!stacks.length) return null;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids: stacks.map((s) => s.uid), prompt });
  return stacks.find((s) => s.uid === uid) || null;
}
// take one source card out of a stack (keeps the face-down block counter consistent)
function takeSource(host, i) {
  const fd = S.fdCount(host);
  const [id] = host.sources.splice(i, 1);
  if (i < fd) host.s5fd = fd - 1;
  S.recomputeStackGrants(host);
  return id;
}
// play (free, as a NEW digimon/tamer) source card #i of `host`. The card goes through the trash the way every other from-sources play does.
function playSource(ctx, host, i, opts = {}) {
  const { state, self } = ctx; const pl = state.players[self];
  const id = takeSource(host, i);
  pl.trash.push(id);
  const st = S.playFreeFromZone(state, self, 'trash', pl.trash.length - 1, { fromSources: true, ...opts });
  if (st) S.emitGameEvent(state, 'playFromSources', { owner: self, stack: st, cause: 'effect', level: C(st.cardId).level });
  return st;
}

// ---- BT3-030 두프트몬 【진화 시】 자신의 디지몬 1마리의 진화원인 Lv.4 이하의 디지몬 카드 1장을, 코스트를 지불하지 않고 다른 디지몬으로서 등장할 수 있다.
sc('BT3-030::진화 시', async (ctx) => {
  const { state, self } = ctx;
  const okId = (id) => C(id).category === 'digimon' && (C(id).level ?? 99) <= 4;
  const hosts = state.players[self].battle.filter((s) => isDig(s) && s.sources.some(okId));
  if (!hosts.length) { S.log(state, `${self} 진화원에 등장시킬 Lv.4 이하 디지몬 카드가 있는 디지몬이 없음`); return; }
  const host = await pickStackOf(ctx, hosts, '진화원 카드를 등장시킬 자신의 디지몬 선택 (취소=안 함)');
  if (!host) return;
  const idxs = host.sources.map((id, i) => i).filter((i) => okId(host.sources[i]));
  const k = await pickIdxOf(ctx, host.sources.slice(), idxs, '코스트 없이 등장시킬 진화원의 Lv.4 이하 디지몬 카드 선택 (취소=안 함)');
  if (k == null) return;
  playSource(ctx, host, k);
});

// ---- BT13-019 간쿠몬 【등장 시】【진화 시】 자신의 트래시에서 명칭에 「시스터몬」을 포함하는 디지몬 카드 1장 또는 육성 에어리어의 자신의 디지몬의 진화원에서
//      「오메가몬」과 「간쿠몬」 이외의 특징으로 「로얄 나이츠」를 가진 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
for (const tag of ['등장 시', '진화 시']) sc(`BT13-019::${tag}`, async (ctx) => {
  const { state, self } = ctx; const pl = state.players[self]; const ra = pl.raising;
  const pool = [];
  pl.trash.forEach((id, i) => { if (C(id).category === 'digimon' && C(id).nameKo.includes('시스터몬')) pool.push({ id, from: 'trash', i }); });
  if (ra && isDig(ra)) ra.sources.forEach((id, i) => { const c = C(id); if (c.category === 'digimon' && hasType(c, '로얄 나이츠') && c.nameKo !== '오메가몬' && c.nameKo !== '간쿠몬') pool.push({ id, from: 'src', i }); });
  if (!pool.length) { S.log(state, `${self} 등장시킬 수 있는 카드가 없음`); return; }
  const k = await pickIdxOf(ctx, pool.map((x) => x.id), pool.map((x, j) => j), '코스트 없이 등장시킬 카드 선택 (트래시의 「시스터몬」 / 육성 에어리어 진화원의 로얄 나이츠) (취소=안 함)');
  if (k == null) return;
  const e = pool[k];
  if (e.from === 'trash') S.playFreeFromZone(state, self, 'trash', e.i);
  else playSource(ctx, ra, e.i);
});

// ---- BT13-112 오메가몬 【등장 시】【진화 시】 상대의 디지몬 1마리를 소멸시키거나, 육성 에어리어의 자신의 디지몬의 진화원에서 특징으로 「로얄 나이츠」를 가지고, 명칭이 서로 다른 디지몬 카드 1장씩을
//      코스트를 지불하지 않고 등장시킬 수 있다. 이 효과로 등장했다면, 육성 에어리어의 자신의 디지몬을 파기하고, 턴 종료까지 자신의 디지몬 전부는 《속공》을 얻는다.
for (const tag of ['등장 시', '진화 시']) sc(`BT13-112::${tag}`, async (ctx, R) => {
  const { state, self } = ctx; const pl = state.players[self]; const ra = pl.raising;
  const cands = () => (ra && isDig(ra) && pl.raising === ra ? ra.sources.map((id, i) => i).filter((i) => C(ra.sources[i]).category === 'digimon' && hasType(C(ra.sources[i]), '로얄 나이츠')) : []);
  const canDestroy = state.players[opp(self)].battle.some((s) => isDig(s));
  const canPlay = cands().length > 0;
  if (!canDestroy && !canPlay) return;
  let destroy = false;
  if (canDestroy && canPlay) destroy = await ask(ctx, '상대의 디지몬 1마리를 소멸시킬까요? (아니오 = 육성 에어리어의 진화원에서 로얄 나이츠를 등장시킴)');
  else if (canDestroy) destroy = await ask(ctx, '상대의 디지몬 1마리를 소멸시킬까요?');
  if (destroy) { await R.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose' }], ctx); return; }
  if (!canPlay) return;
  const namesPlayed = new Set(); let played = 0;
  for (;;) { // 「명칭이 서로 다른 1장씩」: each pick must have a name not used yet
    const idxs = cands().filter((i) => !namesPlayed.has(C(ra.sources[i]).nameKo));
    if (!idxs.length) break;
    const k = await pickIdxOf(ctx, ra.sources.slice(), idxs, '코스트 없이 등장시킬 로얄 나이츠 디지몬 카드 선택 (명칭이 서로 다른 카드, 취소=끝)');
    if (k == null) break;
    namesPlayed.add(C(ra.sources[k]).nameKo);
    if (playSource(ctx, ra, k)) played++;
  }
  if (!played) return;
  // 이 효과로 등장했다면: 육성 에어리어의 자신의 디지몬을 파기하고, 턴 종료까지 자신의 디지몬 전부는 《속공》
  if (pl.raising === ra) { pl.trash.push(...ra.sources, ra.cardId); S.log(state, `${self} 육성 에어리어의 ${C(ra.cardId).nameKo}을(를) 파기`); pl.raising = null; }
  for (const s of pl.battle) if (isDig(s)) S.grantKeyword(state, self, s.uid, '속공', undefined, 'turn');
});

// ---- BT2-083 밀레니엄몬 【소멸 시】 이 디지몬이 진화원을 가지고 있었을 때, 자신의 트래시에서, 이 카드를 코스트를 지불하지 않고 등장할 수 있다.
sc('BT2-083::소멸 시', async (ctx) => {
  const { state, self } = ctx; const pl = state.players[self];
  const info = state.deletedInfo && state.deletedInfo[ctx.sourceStackUid];
  if (!info || !(info.sources || []).length) { S.log(state, `${self} 이 디지몬은 진화원을 가지고 있지 않았음`); return; }
  const i = pl.trash.lastIndexOf('BT2-083');
  if (i < 0) return;
  if (!(await ask(ctx, '트래시의 「밀레니엄몬」을 코스트를 지불하지 않고 등장시킬까요?'))) return;
  S.playFreeFromZone(state, self, 'trash', i);
});

// ---- BT7-080 네몬 【서로의 턴】〔턴에 1회〕 진화원에 테이머 카드를 갖는 자신의 디지몬이 소멸했을 때, 자신의 트래시에서 테이머 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
hk('BT7-080', { tag: '서로의 턴', has: '소멸했을 때', limit: 1, events: {
  delete: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && (info.stack.sources || []).some((id) => C(id).category === 'tamer'),
} });
sc('BT7-080::서로의 턴', async (ctx) => {
  const { state, self } = ctx; const pl = state.players[self];
  const idxs = pl.trash.map((id, i) => i).filter((i) => C(pl.trash[i]).category === 'tamer');
  if (!idxs.length) return;
  const k = await pickIdxOf(ctx, pl.trash.slice(), idxs, '코스트 없이 등장시킬 트래시의 테이머 카드 선택 (취소=안 함)');
  if (k == null) return;
  S.playFreeFromZone(state, self, 'trash', k);
});

// ---- BT15-057 워매몬 X항체 【서로의 턴】 진화원에 「워매몬」/「X항체」가 있는 이 디지몬은 「【소멸 시】 자신의 트래시에서 명칭에 「워매몬」을 포함하는 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.」의 효과를 얻는다.
const wormSrc = (stack) => (stack.sources || []).some((id) => S.cardNameIs(C(id), '워매몬') || S.cardNameIs(C(id), 'X항체'));
hk('BT15-057', { tag: '서로의 턴', has: '진화원에 「워매몬」', text: '【소멸 시】 자신의 트래시에서 명칭에 「워매몬」을 포함하는 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.',
  onLeave: (state, p, stack) => !!(state.deletedInfo && state.deletedInfo[stack.uid]) && wormSrc(stack) });
sc('BT15-057::서로의 턴', async (ctx) => {
  const { state, self } = ctx; const pl = state.players[self];
  const idxs = pl.trash.map((id, i) => i).filter((i) => C(pl.trash[i]).category === 'digimon' && C(pl.trash[i]).nameKo.includes('워매몬'));
  if (!idxs.length) return;
  const k = await pickIdxOf(ctx, pl.trash.slice(), idxs, '코스트 없이 등장시킬 「워매몬」 디지몬 카드 선택 (취소=안 함)');
  if (k == null) return;
  S.playFreeFromZone(state, self, 'trash', k);
});

// ---- BT19-100 디·리퍼=존 (디지몬 측) 【시큐리티】 자신의 패에서 특징으로 「디·리퍼」를 가지고, 등장 코스트가 자신의 「마더 디·리퍼」 1마리의 진화원 매수 이하의 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
sc('BT19-100::시큐리티@진화원 매수 이하의 카드 1장을', async (ctx) => {
  const { state, self } = ctx; const pl = state.players[self];
  const mothers = pl.battle.filter((s) => isDig(s) && S.cardNameIs(C(s.cardId), '마더 디·리퍼'));
  if (!mothers.length) return;
  const mother = mothers.length === 1 ? mothers[0] : await pickStackOf(ctx, mothers, '진화원 매수를 기준으로 할 「마더 디·리퍼」 선택');
  if (!mother) return;
  const n = mother.sources.length;
  const idxs = pl.hand.map((id, i) => i).filter((i) => { const c = C(pl.hand[i]); return ['digimon', 'tamer'].includes(c.category) && hasType(c, '디·리퍼') && (c.cost ?? 99) <= n; });
  if (!idxs.length) return;
  const k = await pickIdxOf(ctx, pl.hand.slice(), idxs, `코스트 없이 등장시킬 패의 「디·리퍼」 카드 선택 (등장 코스트 ${n} 이하, 취소=안 함)`);
  if (k == null) return;
  S.playFreeFromZone(state, self, 'hand', k);
});

// ---- BT24-062 마스터브링프몬 【어택 종료 시】【상대의 턴 종료 시】[턴에 1회] 이 디지몬의 진화원에서, 「머신형」/「사이보그형」/「TS」를 가진 등장 코스트 5 이하의 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
for (const tag of ['어택 종료 시', '상대의 턴 종료 시']) sc(`BT24-062::${tag}`, async (ctx) => {
  const { state } = ctx;
  const host = stackOfUid(state, ctx.self, ctx.sourceStackUid);
  if (!host) return;
  const ok = (id) => { const c = C(id); return ['digimon', 'tamer'].includes(c.category) && hasType(c, '머신형', '사이보그형', 'TS') && (c.cost ?? 99) <= 5; };
  const idxs = host.sources.map((id, i) => i).filter((i) => ok(host.sources[i]));
  if (!idxs.length) return;
  const k = await pickIdxOf(ctx, host.sources.slice(), idxs, '코스트 없이 등장시킬 진화원 카드 선택 (머신형/사이보그형/TS, 등장 코스트 5 이하, 취소=안 함)');
  if (k == null) return;
  playSource(ctx, host, k);
});

// ---- BT24-060 히샤류우몬 (진화원 효과) 【서로의 턴】[턴에 1회] 특징 「디지대」/「시커즈」를 가진 자신의 디지몬이 배틀 에어리어를 떠날 때, 이 디지몬의 진화원에서 특징 「디지대」/「시커즈」를 가진 테이머 카드 1장을
//      코스트를 지불하지 않고 등장시키는 것으로, 벗어나지 않는다.  (replacement: the leaving digimon stays; the holder's source tamer is played instead)
{
  const d = { tag: '서로의 턴', has: '벗어나지 않는다', src: 'inheritedKo' };
  const key = (id) => S.onceLimitKey(id, [d.tag, d.has]);
  d.preventLeaveOptions = (state, hp, holder, target, tp, cause, mode, id) => {
    if (hp !== tp || !isDig(target) || !hasType(C(target.cardId), '디지대', '시커즈')) return [];
    if (S.turnUsesRemaining(holder, key(id || 'BT24-060'), 1) <= 0) return [];
    const idxs = holder.sources.map((sid, i) => i).filter((i) => { const c = C(holder.sources[i]); return c.category === 'tamer' && hasType(c, '디지대', '시커즈'); });
    const seen = new Set();
    return idxs.filter((i) => !seen.has(holder.sources[i]) && seen.add(holder.sources[i])).map((i) => ({ apply() {
      const ctx = { state, self: hp };
      if (!S.hookUseOnce(holder, id || 'BT24-060', d)) return false;
      return !!playSource(ctx, holder, i);
    } }));
  };
  hk('BT24-060', d);
}
