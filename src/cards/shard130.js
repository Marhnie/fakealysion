// Shard 130 — EX13 (CHIVALROUS XIII) new-card effects the generic compiler / watcher pipeline cannot express (docs/ex13-new-cards.md).
// Keys: 'CARD-ID::firstTag' or 'CARD-ID::firstTag@needle' (needle must appear in the pending text). Watcher-generated pendings carry only the effect
// sentence (after the "~했을 때," clause), so their needle must come from that sentence. S is used at RUNTIME only.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const PL = (ctx, p) => ctx.state.players[p];
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find((s) => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const digs = (state, p) => state.players[p].battle.filter(isDig);
const fn = (f) => ({ op: 's130_fn', fn: f });
OPS.s130_fn = async (instr, ctx, R) => { /* confirm: every script asks for its own optional steps (the generic optionalGate must not prompt a second time) */ await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const D = (id, tag, has, d, src = 'effectKo') => { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); };
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const untilOppTurnEnd = (ctx) => (ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber);
const mentions = (id, ...ns) => ns.some((n) => S.cardMentions(id, n));
const hasTrait = (c, ...ts) => (c.types || []).some((t) => ts.includes(t)) || ts.includes(c.attribute) || ts.includes(c.form);
async function ask(ctx, prompt, who) { return !!(await ctx.choose('confirmEffect', { player: who || ctx.self, prompt })); }
async function pickStack(ctx, who, stacks, prompt, extra = {}) {
  if (!stacks.length) return null;
  if (stacks.length === 1 && extra.auto) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map((s) => s.uid), prompt, ...extra });
  return stacks.find((s) => s.uid === uid) || null;
}
// index into pl[zone] of a card chosen among those matching pred(id) (-1 none/cancelled)
async function pickIdx(ctx, who, zone, pred, prompt) {
  const arr = PL(ctx, who)[zone];
  const idxs = arr.map((id, i) => i).filter((i) => pred(arr[i], i));
  if (!idxs.length) return -1;
  const idx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs: idxs, prompt });
  return idx == null ? -1 : idx;
}
function log(ctx, msg) { S.log(ctx.state, msg); }

// ------------------------------------------------------------------ evolution / play effects
// EX13-003 캬로몬 [inherited] 【자신의 턴】[턴 1회] 자신의 시큐리티가 줄어들었을 때, 이 디지몬을 패의 명칭에 「슬레이프몬」을 포함하거나 특징 「성수형」을 가진 디지몬 카드로 지불하는 코스트 -1 하여 진화시킬 수 있다.
DI('EX13-003', '자신의 턴', '줄어들었을', { ewTrusted: true });
SCRIPTS['EX13-003::자신의 턴'] = [{ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', anyOf: [{ nameAny: ['슬레이프몬'] }, { traitAny: ['성수형'] }] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: false }];

// EX13-004 푸치메라몬 [inherited] 【어택 시】[턴 1회] 이 디지몬을 패의 「윗체르니」가 기술되어 있는 디지몬 카드로 지불하는 코스트 -1 하여 진화시킬 수 있다. 이 효과로 진화했다면, 자신의 시큐리티를 위에서부터 1장 파기한다.
sc('EX13-004::어택 시', async (ctx, R) => {
  ctx._evolvedByEffect = false;
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'hand', cardFilter: { category: 'digimon', mentionAny: ['윗체르니'] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: false }, ctx);
  if (ctx._evolvedByEffect) S.trashTopSecurityByEffect(ctx.state, ctx.self);
});

// EX13-014 제스몬 / EX13-061 간쿠몬: 자신의 패 또는 이 디지몬의 진화원에서 「헉몬」이 기술되어 있는 사용 코스트 5 이하의 옵션 카드 1장을 코스트를 지불하지 않고 사용할 수 있다.
const huckOption = (id) => C(id).category === 'option' && (C(id).cost || 0) <= 5 && mentions(id, '헉몬');
const useHuckOption = async (ctx, R) => { await R.runOne({ op: 's8_playOrUse', zones: ['hand', 'sources'], kinds: ['option'], free: true, pred: huckOption }, ctx); };
sc('EX13-014::진화 시', useHuckOption);
sc('EX13-061::서로의 턴', useHuckOption);

// EX13-021 윙드라몬 / EX13-041 그라운드라몬: 「엑자몬」의 조그레스 진화에서 「슬레이어드라몬」/「브레이크드라몬」·Lv.6으로도 취급한다.
const alias = (name, lv) => ({ jogressAlias: (target) => (C(target).nameKo === '엑자몬' ? [{ nameKo: name, level: lv }] : []) });
D('EX13-021', '서로의 턴', '조그레스', alias('슬레이어드라몬', 6));
D('EX13-041', '서로의 턴', '조그레스', alias('브레이크드라몬', 6));

// EX13-043 두프트몬 【진화 시】【어택 시】[턴 1회] 자신의 패에서 특징 「포유류형」/「짐승형」/「수인형」/「로얄 나이츠」를 가진 카드 1장을 지불하는 코스트 -4 하여 등장/사용할 수 있다. 레스트 상태인 디지몬 1마리마다 이 효과로 지불하는 코스트 -1.
sc('EX13-043::진화 시', async (ctx, R) => {
  const rested = () => ['p1', 'p2'].reduce((n, p) => n + digs(ctx.state, p).filter((s) => s.suspended).length, 0);
  await R.runOne({ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer', 'option'], delta: () => -(4 + rested()), pred: (id) => hasTrait(C(id), '포유류형', '짐승형', '수인형', '로얄 나이츠') }, ctx);
});

// ------------------------------------------------------------------ small helpers for the multi-step effects below
async function runText(ctx, R, text) { const sc0 = R.compileToScript(text); if (sc0.length) await R.runScript(sc0, ctx); }
const decline = (ctx) => { ctx._declined = true; };
const oppEnd = (ctx) => untilOppTurnEnd(ctx);
// pick one entry among either side's Digimon (and optionally Tamers) -> { player, stack } | null
async function pickAnySide(ctx, prompt, pred = () => true, { tamers = false } = {}) {
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of ctx.state.players[p].battle) if ((isDig(s) || (tamers && isTam(s))) && pred(s, p)) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return null;
  const r = await ctx.choose('pickStackAnySide', { entries, prompt });
  if (!r) return null;
  const stack = findStack(ctx.state, r.player, r.uid);
  return stack ? { player: r.player, stack } : null;
}
// choose an index of `ids` (temp zone trick so the stock picker works) -> index | null
async function pickFromList(ctx, ids, idxs, prompt) {
  if (!idxs.length) return null;
  const pl = PL(ctx, ctx.self);
  pl.s130tmp = ids;
  try { const r = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 's130tmp', eligibleIdxs: idxs, prompt }); return r == null ? null : r; } finally { delete pl.s130tmp; }
}
// a stack leaves the battle area for the top of its owner's security (digimon only)
function stackToSecurityTop(ctx, p, st) {
  const pl = PL(ctx, p); const i = pl.battle.indexOf(st); if (i < 0) return false;
  if (S.effectBlocked(ctx.state, p, st, 'bounce') || S.leaveGate(ctx.state, p, st, p === ctx.self ? 'ownEffect' : 'effect', 'bounce', () => stackToSecurityTop(ctx, p, st))) return false;
  pl.battle.splice(i, 1);
  const linkIds = (st.linkCards || []).map((l) => l.cardId);
  pl.trash.push(...st.sources, ...linkIds); pl.security.unshift(st.cardId);
  S.log(ctx.state, `${p} ${C(st.cardId).nameKo} → 시큐리티 맨 위 (진화원 ${st.sources.length}장 파기)`);
  S.applyOverflowBatch(ctx.state, p, [...st.sources, st.cardId]);
  S.hookLeaveTriggers(ctx.state, p, st, p === ctx.self ? 'ownEffect' : 'effect');
  S.emitGameEvent(ctx.state, 'securityIncrease', { owner: p, stack: null, cause: 'effect' });
  return true;
}
// remove every evolution source of `t` to the bottom of its owner's deck (076)
function sourcesToDeckBottom(ctx, p, t) {
  if (S.effectBlocked(ctx.state, p, t, 'other') || S.effectBlocked(ctx.state, p, t, 'srcTrash')) { log(ctx, `${p} ${C(t.cardId).nameKo}는 상대의 효과를 받지 않아 진화원이 되돌아가지 않음`); return []; }
  const ids = t.sources.splice(0); t.s5fd = 0; S.recomputeStackGrants(t);
  PL(ctx, p).deck.push(...ids);
  log(ctx, `${p} ${C(t.cardId).nameKo}의 진화원 ${ids.length}장 → 덱 아래`);
  if (ids.length) S.emitGameEvent(ctx.state, 'b4SourceToDeckBottom', { owner: p, stack: t, cause: 'effect', ids });
  return ids;
}
const distinctColors = (stacks) => { const set = new Set(); for (const s of stacks) for (const c of S.stackColors(s)) set.add(c); return set; };

// ------------------------------------------------------------------ 각 카드
// EX13-002 꼬마몬 [inherited] 명칭에 「브이드라몬」을 포함하는 이 디지몬을 액티브로 할 수 있다 (the name condition names the holder's top card)
sc('EX13-002::자신의 턴', async (ctx) => {
  const st = me(ctx); if (!st || !st.suspended) return;
  if (!S.cardNameHas(st.cardId, '브이드라몬') && !S.effectiveInfo(ctx.state, st, ctx.self).names.some((n) => n.includes('브이드라몬'))) { log(ctx, `${ctx.self} ${C(st.cardId).nameKo}: 명칭에 「브이드라몬」이 없어 액티브로 할 수 없음`); return; }
  if (!(await ask(ctx, `${C(st.cardId).nameKo}을(를) 액티브로 할까요?`))) { decline(ctx); return; }
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
});

// EX13-020 매그너몬 【등장 시】【진화 시】【어택 시】[턴 1회] 상대의 턴 종료까지 트래시의 카드의 색 1색마다 이 디지몬을 DP +1000. 그 후, 상대의 턴 종료까지 상대의 디지몬 1마리를 이 디지몬의 DP 5000마다 DP -4000.
sc('EX13-020::등장 시', async (ctx) => {
  const { state } = ctx; const st = me(ctx); if (!st) return;
  const cols = new Set(); for (const id of PL(ctx, ctx.self).trash) for (const c of C(id).colors || []) cols.add(c);
  if (cols.size) S.modifyDP(state, ctx.self, st.uid, 1000 * cols.size, 'opponentTurn');
  const times = Math.floor(S.effectiveDP(state, ctx.self, st) / 5000);
  if (!times) return;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.opp), `DP -${4000 * times}할 상대의 디지몬 선택`);
  if (t) S.modifyDP(state, ctx.opp, t.uid, -4000 * times, 'opponentTurn');
});

// EX13-023 알포스브이드라몬
// 【등장 시】【진화 시】【어택 시】[턴 1회] 자신의 디지몬 1마리의 표시 형식을 변경할 수 있다. (표시 형식 = 액티브/레스트: 룰 4-13 — 액티브 <-> 레스트 전환)
sc('EX13-023::등장 시@표시 형식', async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), '표시 형식을 변경할 자신의 디지몬 선택 (취소=변경하지 않음)', { optional: true });
  if (!t) { decline(ctx); return; }
  if (t.suspended) S.unsuspendStack(state, ctx.self, t.uid); else S.restStack(state, ctx.self, t.uid, 'ownEffect');
});
const returnFewestSources = async (ctx, R) => {
  if (!digs(ctx.state, ctx.opp).length) return;
  if (!(await ask(ctx, '진화원이 가장 적은 상대의 디지몬 전부를 덱 아래로 되돌립니까?'))) return;
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', all: true, filter: { extreme: { stat: 'sources', dir: 'min' } }, requireSuspended: null, dest: 'deckBottom' }, ctx);
};
sc('EX13-023::등장 시@진화원이 가장 적은', returnFewestSources);

// EX13-024 슬레이어드라몬 【등장 시】【진화 시】 이 디지몬의 진화원 1장마다, 상대의 디지몬의 진화원을 고르고 1장 파기한다. 그 후, 진화원이 가장 적은 상대의 디지몬 전부를 덱 아래로 되돌릴 수 있다.
sc('EX13-024::등장 시', async (ctx, R) => {
  const { state } = ctx; const st = me(ctx); const n = st ? st.sources.length : 0;
  for (let k = 0; k < n; k++) {
    const cands = digs(state, ctx.opp).filter((s) => s.sources.length);
    if (!cands.length) break;
    const t = await pickStack(ctx, ctx.self, cands, `진화원을 파기할 상대의 디지몬 선택 (${k + 1}/${n})`);
    if (!t) break;
    const i = await pickFromList(ctx, t.sources.slice(), t.sources.map((id, i) => i), `${C(t.cardId).nameKo}의 파기할 진화원 선택 (${k + 1}/${n})`);
    if (i == null) break;
    S.trashEvoSources(state, ctx.opp, t.uid, 1, 'bottom', [i]);
  }
  await returnFewestSources(ctx, R);
});

// EX13-031 스카몬 대왕 【등장 시】【진화 시】【소멸 시】 자신의 패 또는 디지몬의 진화원에서 명칭에 「츄몬」/「스카몬」을 포함하는 카드 1장을 파기하는 것으로, 상대의 턴 종료까지 상대의 디지몬 1마리를 원래 명칭 「스카몬」·화이트·DP 3000으로 변경할 수 있다.
sc('EX13-031::등장 시', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const match = (id) => C(id).nameKo.includes('츄몬') || C(id).nameKo.includes('스카몬');
  const entries = [];
  pl.hand.forEach((id, i) => { if (match(id)) entries.push({ id, zone: 'hand', i }); });
  for (const s of digs(state, ctx.self)) s.sources.forEach((id, i) => { if (i >= S.fdCount(s) && match(id)) entries.push({ id, zone: 'src', s, i }); });
  if (!entries.length) { log(ctx, `${ctx.self} 파기할 「츄몬」/「스카몬」 카드가 없어 효과를 건너뜀`); return; }
  const k = await pickFromList(ctx, entries.map((e) => e.id), entries.map((e, i) => i), '파기할 「츄몬」/「스카몬」 카드 선택 (패 또는 진화원, 취소=하지 않음)');
  if (k == null) { decline(ctx); return; }
  const e = entries[k];
  if (e.zone === 'hand') S.trashFromHand(state, ctx.self, e.i); else S.trashEvoSources(state, ctx.self, e.s.uid, 1, 'bottom', [e.i]);
  await R.runOne({ op: 's2_overrideBase', name: '스카몬', color: 'white', dp: 3000 }, ctx);
});
SCRIPTS['EX13-031::진화 시'] = SCRIPTS['EX13-031::등장 시'];
SCRIPTS['EX13-031::소멸 시'] = SCRIPTS['EX13-031::등장 시'];
// [inherited] 【서로의 턴】[턴 1회] 명칭에 「스카몬」을 포함하는 다른 디지몬이 소멸했을 때, 덱 위 3장 오픈 … 등장 코스트 3 이하의 「츄몬」/「스카몬」 무료 등장. 나머지는 파기.
DI('EX13-031', '서로의 턴', '소멸했을 때', { limit: 1, events: { delete: (state, hp, h, info) => !!info.stack && info.stack !== h && info.stack.cardId && C(info.stack.cardId).category === 'digimon' && C(info.stack.cardId).nameKo.includes('스카몬') } });
sc('EX13-031::서로의 턴', (ctx, R) => runText(ctx, R, '자신의 덱 위에서부터 3장 오픈한다. 그중 명칭에 「츄몬」/「스카몬」을 포함하는 등장 코스트 3 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다. 나머지는 파기한다.'));

// EX13-032 치린몬 【진화 시】【어택 시】[턴 1회] 자신의 시큐리티를 위에서부터 1장 또는 자신의 테이머 아래의 뒷면 카드를 아래에서부터 1장 파기하는 것으로, 이 디지몬을 액티브로 한다. 또한, 상대의 턴 종료까지 상대의 디지몬 1마리의 【진화 시】 효과는 발휘하지 않는다.
sc('EX13-032::진화 시', async (ctx) => {
  const { state } = ctx; const st = me(ctx); const pl = PL(ctx, ctx.self);
  const tam = () => pl.battle.find((t) => isTam(t) && S.fdCount(t) >= 1);
  const opts = []; if (pl.security.length) opts.push('시큐리티를 위에서부터 1장 파기'); if (tam()) opts.push('테이머 아래의 뒷면 카드를 아래에서부터 1장 파기'); opts.push('하지 않음');
  if (st && st.suspended && opts.length > 1) {
    const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '이 디지몬을 액티브로 하기 위한 비용 선택', options: opts });
    const chosen = k == null ? null : opts[k];
    if (chosen && chosen !== '하지 않음') {
      if (chosen.startsWith('시큐리티')) S.trashTopSecurityByEffect(state, ctx.self);
      else { const t = tam(); const fd = S.fdCount(t); const [id] = t.sources.splice(0, 1); t.s5fd = Math.max(0, fd - 1); PL(ctx, ctx.self).trash.push(id); S.recomputeStackGrants(t); log(ctx, `${ctx.self} 테이머 아래의 뒷면 카드 1장 파기`); }
      S.unsuspendStack(state, ctx.self, st.uid);
    }
  }
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '【진화 시】 효과를 발휘할 수 없게 할 상대의 디지몬 선택');
  if (t && !S.effectBlocked(state, ctx.opp, t, 'other')) { t.noEvoTrigUntil = oppEnd(ctx); log(ctx, `${ctx.opp} ${C(t.cardId).nameKo}: 상대의 턴 종료까지 【진화 시】 효과 발휘 불가`); }
});
SCRIPTS['EX13-032::어택 시'] = SCRIPTS['EX13-032::진화 시'];

// EX13-033/034/037 서로의 턴 "자신의 시큐리티가 줄어들었을 때" (multi-step / conditional text: the generic event watcher only runs these when the card marks them trusted)
D('EX13-033', '서로의 턴', '줄어들었을', { ewTrusted: true });
D('EX13-034', '서로의 턴', '줄어들었을', { ewTrusted: true });
D('EX13-037', '서로의 턴', '줄어들었을', { ewTrusted: true });
// EX13-034 와이즈몬 【서로의 턴】[턴 1회] 자신의 시큐리티가 줄어들었을 때, 상대의 디지몬 1마리를 《퇴화 1》. 그 후, 자신의 시큐리티가 3장 이하라면, 상대의 턴 종료까지, 상대의 디지몬 1마리는 진화할 수 없다.
sc('EX13-034::서로의 턴@퇴화 1', async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '《퇴화 1》할 상대의 디지몬 선택');
  if (t) S.retreat(state, ctx.opp, t.uid, 1);
  if (PL(ctx, ctx.self).security.length <= 3) {
    const t2 = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '진화할 수 없게 할 상대의 디지몬 선택');
    if (t2 && !S.effectBlocked(state, ctx.opp, t2, 'other')) { t2.cannotEvolveUntil = oppEnd(ctx); log(ctx, `${ctx.opp} ${C(t2.cardId).nameKo}: 상대의 턴 종료까지 진화할 수 없음`); }
  }
});
// EX13-034 【등장 시】【진화 시】【어택 시】[턴 1회] 상대의 턴 종료까지, 자신의 디지몬 1마리는 《재기동》과 《블로커》를 얻고, 상대의 《퇴화》의 효과를 받지 않는다.
sc('EX13-034::등장 시', async (ctx) => {
  const { state } = ctx;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.self), '《재기동》《블로커》를 얻을 자신의 디지몬 선택');
  if (!t) { decline(ctx); return; }
  S.grantKeyword(state, ctx.self, t.uid, '재기동', true, 'opponentTurn');
  S.grantKeyword(state, ctx.self, t.uid, '블로커', true, 'opponentTurn');
  S.grantShield(state, ctx.self, t.uid, { kinds: ['retreat'], until: oppEnd(ctx) });
});
SCRIPTS['EX13-034::진화 시'] = SCRIPTS['EX13-034::등장 시'];
SCRIPTS['EX13-034::어택 시'] = SCRIPTS['EX13-034::등장 시'];

// EX13-036 슬레이프몬 【진화 시】 가장 시큐리티가 많은 플레이어 1명의 시큐리티를 위에서부터 1장 파기하는 것으로, 이 디지몬의 【시큐리티】 효과 1개를 발휘할 수 있다.
sc('EX13-036::진화 시@가장 시큐리티가 많은', async (ctx, R) => {
  const { state } = ctx; const a = PL(ctx, ctx.self).security.length, b = PL(ctx, ctx.opp).security.length;
  const most = a > b ? [ctx.self] : b > a ? [ctx.opp] : [ctx.self, ctx.opp];
  const who = most.filter((p) => PL(ctx, p).security.length);
  if (!who.length) { log(ctx, '시큐리티가 없어 효과를 건너뜀'); return; }
  if (!(await ask(ctx, '가장 시큐리티가 많은 플레이어의 시큐리티를 위에서부터 1장 파기하고 이 디지몬의 【시큐리티】 효과를 발휘합니까?'))) { decline(ctx); return; }
  let p = who[0];
  if (who.length > 1) { const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '시큐리티를 파기할 플레이어 선택', options: ['자신', '상대'] }); p = k === 1 ? ctx.opp : ctx.self; }
  S.trashTopSecurityByEffect(state, p);
  const seg = S.parseEffectSegments(C(ctx.sourceCardId).effectKo || '').segments.find((sg) => sg.tags.includes('시큐리티'));
  if (!seg) return;
  const script = R.lookupCardSpecific(ctx.sourceCardId, seg.tags, seg.body) || R.compileToScript(seg.body);
  if (script && script.length) await R.runScript(script, ctx);
});
// 【진화 시】【어택 종료 시】【카운터】[턴 1회] 서로의 디지몬 1마리씩을 시큐리티 위에 놓을 수 있다.
sc('EX13-036::진화 시@서로의 디지몬 1마리씩', async (ctx) => {
  const { state } = ctx;
  if (!digs(state, ctx.self).length && !digs(state, ctx.opp).length) return;
  if (!(await ask(ctx, '서로의 디지몬 1마리씩을 시큐리티 위에 놓습니까?'))) { decline(ctx); return; }
  const mine = await pickStack(ctx, ctx.self, digs(state, ctx.self), '시큐리티 위에 놓을 자신의 디지몬 선택');
  const theirs = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '시큐리티 위에 놓을 상대의 디지몬 선택');
  if (mine) stackToSecurityTop(ctx, ctx.self, mine);
  if (theirs) stackToSecurityTop(ctx, ctx.opp, theirs);
});

// EX13-043 두프트몬 【등장 시】【진화 시】 디지몬 1마리를 레스트시킬 수 있다. 그 후, DP가 가장 낮은 상대의 디지몬 1마리를 덱 아래로 되돌릴 수 있다.
sc('EX13-043::등장 시', async (ctx, R) => {
  const { state } = ctx;
  const r = await pickAnySide(ctx, '레스트시킬 디지몬 선택 (안 해도 됨)', (s, p) => !s.suspended && S.canRestByRule(state, p, s));
  if (r) S.restStack(state, r.player, r.stack.uid, r.player === ctx.self ? 'ownEffect' : 'effect');
  const opps = digs(state, ctx.opp); if (!opps.length) return;
  if (!(await ask(ctx, 'DP가 가장 낮은 상대의 디지몬 1마리를 덱 아래로 되돌립니까?'))) return;
  await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { extreme: { stat: 'dp', dir: 'min' } }, requireSuspended: null, dest: 'deckBottom' }, ctx);
});

// EX13-044 브레이크드라몬 【등장 시】【진화 시】 디지몬/테이머 2마리(명)까지 레스트시킬 수 있다. 그 후, 상대의 턴 종료까지 상대의 디지몬/테이머 2마리(명)는 액티브가 되지 않는다.
sc('EX13-044::등장 시', async (ctx, R) => {
  const { state } = ctx; const done = [];
  for (let k = 0; k < 2; k++) {
    const r = await pickAnySide(ctx, `레스트시킬 디지몬/테이머 선택 (${k + 1}/2, 안 해도 됨)`, (s, p) => !s.suspended && !done.includes(s.uid) && S.canRestByRule(state, p, s), { tamers: true });
    if (!r) break;
    done.push(r.stack.uid); S.restStack(state, r.player, r.stack.uid, r.player === ctx.self ? 'ownEffect' : 'effect');
  }
  await skipOppActive(ctx, 2);
});
// 【서로의 턴】[턴 1회] 자신의 디지몬이 레스트했을 때, 「드라코몬」/「엑자몬」이 기술되어 있는 자신의 디지몬 1마리와 상대의 디지몬 1마리로 배틀할 수 있다.
const battleWithOpp = async (ctx) => {
  const { state } = ctx;
  const mine = digs(state, ctx.self).filter((s) => mentions(s.cardId, '드라코몬', '엑자몬'));
  if (!mine.length || !digs(state, ctx.opp).length) return;
  const a = await pickStack(ctx, ctx.self, mine, '배틀할 「드라코몬」/「엑자몬」 기술 디지몬 선택 (취소=하지 않음)', { optional: true });
  if (!a) { decline(ctx); return; }
  const b = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '배틀할 상대의 디지몬 선택');
  if (!b || !findStack(state, ctx.self, a.uid)) return;
  const res = S.resolveDigimonBattle(state, ctx.self, a.uid, b.uid);
  // 16-7-3/16-7-4 (official Q&A): this scripted battle can also win with ≪관통≫ — capped at once per attack (S.consumePierceCheck, applied inside ctx.securityCheck).
  if (res && res.piercing && ctx.securityCheck) await ctx.securityCheck(ctx.self, a.uid, ctx.opp);
};
sc('EX13-044::서로의 턴', battleWithOpp);

// EX13-041 그라운드라몬 【등장 시】【진화 시】 상대의 디지몬/테이머 1마리(명)를 레스트시킨다. 그 후, 다음 상대의 액티브 페이즈에서는 상대의 디지몬/테이머 1마리(명)는 액티브가 되지 않는다. (두 번째는 별도로 고르는 1마리)
sc('EX13-041::등장 시', async (ctx) => {
  const { state } = ctx;
  const oppAll = () => state.players[ctx.opp].battle.filter((s) => isDig(s) || isTam(s));
  const t1 = await pickStack(ctx, ctx.self, oppAll().filter((s) => !s.suspended && S.canRestByRule(state, ctx.opp, s)), '레스트시킬 상대의 디지몬/테이머 선택');
  if (t1) S.restStack(state, ctx.opp, t1.uid, 'effect');
  const t2 = await pickStack(ctx, ctx.self, oppAll(), '다음 액티브 페이즈에 액티브가 되지 않게 할 상대의 디지몬/테이머 선택');
  if (t2 && !S.effectBlocked(state, ctx.opp, t2, 'other')) S.setSkipNextUnsuspend(state, ctx.opp, t2.uid);
});
SCRIPTS['EX13-041::진화 시'] = SCRIPTS['EX13-041::등장 시'];

// EX13-045 엑자몬 【진화 시】 조그레스 진화하고 있었다면, 이 디지몬으로 어택하고, 상대의 턴 종료까지 자신의 디지몬 전부를 DP +10000. 그 후, 이 디지몬과 상대의 디지몬 1마리로 배틀할 수 있다.
sc('EX13-045::진화 시', async (ctx, R) => {
  const { state } = ctx; const st = me(ctx);
  if (!st || !st.viaFusion) { log(ctx, `${ctx.self} 조그레스 진화가 아니므로 효과 없음`); return; }
  if (ctx.startAttack) ctx.startAttack(ctx.self, st.uid);
  await R.runOne({ op: 'modifyDPAll', target: 'self', amount: 10000, duration: 'opponentTurn' }, ctx);
  if (!findStack(state, ctx.self, st.uid) || !digs(state, ctx.opp).length) return;
  if (!(await ask(ctx, '이 디지몬과 상대의 디지몬 1마리로 배틀합니까?'))) return;
  await R.runOne({ op: 'n5_battle' }, ctx);
});
// 【자신의 턴】[턴 1회] 이 디지몬이 배틀에서 승리했을 때, 자신의 패나 이 디지몬의 진화원에서 「드라코몬」/「엑자몬」이 기술되어 있는 등장/사용 코스트 12 이하의 카드 1장을 코스트를 지불하지 않고 등장/사용할 수 있다.
D('EX13-045', '자신의 턴', '승리했을 때', { limit: 1, events: { battleWin: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('EX13-045::자신의 턴', async (ctx, R) => {
  await R.runOne({ op: 's8_playOrUse', zones: ['hand', 'sources'], kinds: ['digimon', 'tamer', 'option'], free: true, srcPlay: true, pred: (id) => (C(id).cost || 0) <= 12 && mentions(id, '드라코몬', '엑자몬') }, ctx);
});

// EX13-053 번개콩알몬 【등장 시】【소멸 시】 자신의 트래시에서 「콩알몬」이 기술되어 있는 디지몬 카드 3장까지를 덱 위로 되돌릴 수 있다. 그 후, 등장 코스트 3 이하의 상대의 디지몬 1마리를 소멸시킨다. 이 효과로 되돌린 1장마다 이 효과의 등장 코스트 상한 +1.
sc('EX13-053::등장 시', async (ctx) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self); let back = 0;
  for (let k = 0; k < 3; k++) {
    const idxs = pl.trash.map((id, i) => i).filter((i) => C(pl.trash[i]).category === 'digimon' && mentions(pl.trash[i], '콩알몬'));
    if (!idxs.length) break;
    const i = await pickFromList(ctx, pl.trash.slice(), idxs, `덱 위로 되돌릴 「콩알몬」 디지몬 카드 선택 (${k + 1}/3, 취소=그만)`);
    if (i == null) break;
    const [id] = pl.trash.splice(i, 1); pl.deck.unshift(id); back++; log(ctx, `${ctx.self} 트래시의 ${C(id).nameKo} → 덱 위`);
  }
  const cap = 3 + back;
  const cands = digs(state, ctx.opp).filter((s) => S.effectiveCost(state, s) <= cap);
  const t = await pickStack(ctx, ctx.self, cands, `소멸시킬 등장 코스트 ${cap} 이하의 상대의 디지몬 선택`);
  if (t) S.deleteStack(state, ctx.opp, t.uid, 'trash', 'effect');
});
SCRIPTS['EX13-053::소멸 시'] = SCRIPTS['EX13-053::등장 시'];

// EX13-057 그레이드몬 【등장 시】【진화 시】 상대의 턴 종료까지, 특징 「X항체」/「크로니클」을 가진 자신의 디지몬 1마리는 《재기동》과 《블로커》를 얻는다. 어택 중이라면, 추가로 상대의 디지몬의 효과를 받지 않고, DP +5000.
sc('EX13-057::등장 시', async (ctx) => {
  const { state } = ctx;
  const cands = digs(state, ctx.self).filter((s) => hasTrait(C(s.cardId), 'X항체', '크로니클') || (S.effectiveInfo(state, s, ctx.self).traits || []).some((t) => t === 'X항체' || t === '크로니클'));
  const t = await pickStack(ctx, ctx.self, cands, '《재기동》《블로커》를 얻을 「X항체」/「크로니클」 디지몬 선택');
  if (!t) { decline(ctx); return; }
  S.grantKeyword(state, ctx.self, t.uid, '재기동', true, 'opponentTurn');
  S.grantKeyword(state, ctx.self, t.uid, '블로커', true, 'opponentTurn');
  const atk = state.attackCtx;
  if (atk && atk.attacker === ctx.self && atk.uid === t.uid) {
    S.grantShield(state, ctx.self, t.uid, { kinds: ['all'], fromCategory: 'digimon', until: oppEnd(ctx) });
    S.modifyDP(state, ctx.self, t.uid, 5000, 'opponentTurn');
  }
});
SCRIPTS['EX13-057::진화 시'] = SCRIPTS['EX13-057::등장 시'];

// EX13-060 알파몬 【자신의 턴】[턴 1회] 특징 「크로니클」을 가진 자신의 디지몬/테이머가 등장했을 때, 자신의 디지몬 1마리로 어택할 수 있다. 그 후, 이 디지몬의 【진화 시】 효과 1개를 발휘할 수 있다.
sc('EX13-060::자신의 턴', async (ctx, R) => {
  const { state } = ctx;
  await R.runOne({ op: 'attackNow', who: 'self', thisStack: false }, ctx);
  const st = me(ctx); if (!st) return;
  const seg = S.parseEffectSegments(C(st.cardId).effectKo || '').segments.find((sg) => sg.tags.includes('진화 시'));
  if (!seg) return;
  if (!(await ask(ctx, '이 디지몬의 【진화 시】 효과를 발휘합니까?'))) return;
  const script = R.lookupCardSpecific(st.cardId, seg.tags, seg.body) || R.compileToScript(seg.body);
  if (script && script.length) await R.runScript(script, ctx);
});
// 【자신의 턴 종료 시】[턴 1회] 자신의 패에서 명칭에 「알파몬」을 포함하지 않는 특징 「크로니클」을 가진 카드 1장을 지불하는 코스트 -6 하여 등장시킬 수 있다. 턴 종료까지, 이 효과로 등장한 디지몬은 《속공》을 얻는다.
sc('EX13-060::자신의 턴 종료 시', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const before = new Set(pl.battle.map((s) => s.uid));
  await R.runOne({ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer'], delta: -6, pred: (id) => hasTrait(C(id), '크로니클') && !C(id).nameKo.includes('알파몬') }, ctx);
  const st = pl.battle.find((s) => !before.has(s.uid) && isDig(s));
  if (st) S.grantKeyword(state, ctx.self, st.uid, '속공', true, 'turn');
});

// EX13-061 간쿠몬 【등장 시】【진화 시】 「히누카무이」 토큰 1마리를 등장시킬 수 있다. 그 후, 상대의 턴 종료까지 화이트인 자신의 디지몬 1마리는 상대의 디지몬의 효과를 받지 않는다.
sc('EX13-061::등장 시', async (ctx, R) => {
  const { state } = ctx;
  await runText(ctx, R, '「히누카무이」(디지몬·화이트·DP 6000·《연계》《재기동》《블로커》) 토큰 1마리를 등장시킬 수 있다.');
  const cands = digs(state, ctx.self).filter((s) => S.stackColors(s).includes('white'));
  const t = await pickStack(ctx, ctx.self, cands, '상대 디지몬의 효과를 받지 않게 할 화이트인 자신의 디지몬 선택');
  if (t) S.grantShield(state, ctx.self, t.uid, { kinds: ['all'], fromCategory: 'digimon', until: oppEnd(ctx) });
});
SCRIPTS['EX13-061::진화 시'] = SCRIPTS['EX13-061::등장 시'];

// EX13-062 크레니엄몬 【등장 시】【진화 시】 상대의 턴 종료까지, 이 디지몬은 상대의 효과를 받지 않는다.
sc('EX13-062::등장 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  S.grantShield(ctx.state, ctx.self, st.uid, { kinds: ['all'], until: oppEnd(ctx) });
});
SCRIPTS['EX13-062::진화 시'] = SCRIPTS['EX13-062::등장 시'];
// 【서로의 턴】[턴 1회] 이 디지몬이 레스트했을 때, 가장 등장 코스트가 낮은 상대의 디지몬 전부를 소멸시킬 수 있다.
sc('EX13-062::서로의 턴@가장 등장 코스트가 낮은', async (ctx, R) => {
  if (!digs(ctx.state, ctx.opp).length) return;
  if (!(await ask(ctx, '가장 등장 코스트가 낮은 상대의 디지몬 전부를 소멸시킵니까?'))) { decline(ctx); return; }
  await R.runOne({ op: 'destroy', target: 'opponent', mode: 'all', filter: { extreme: { stat: 'cost', dir: 'min' } } }, ctx);
});

// EX13-067 시라미네 노키아 【자신의 턴】 자신의 디지몬이 진화했을 때, 자신의 디지몬이 1마리 이하라면, 이 테이머를 레스트시키는 것으로, 그 디지몬이 명칭에 「그레이몬」을 포함한다면 「파피몬」 1장을, 「가루몬」을 포함한다면 「아구몬」 1장을, 자신의 패/트래시에서 코스트를 지불하지 않고 등장시킬 수 있다.
D('EX13-067', '자신의 턴', '진화했을 때', { events: { digivolve: (state, hp, h, info) => info.owner === hp && isDig(info.stack) && digs(state, hp).length <= 1 && !h.suspended } });
sc('EX13-067::자신의 턴', async (ctx, R) => {
  const { state } = ctx; const tam = me(ctx); if (!tam || tam.suspended) return;
  const ev = ctx.trigger?.evt?.stackUid ? findStack(state, ctx.self, ctx.trigger.evt.stackUid) : null;
  const nm = ev ? C(ev.cardId).nameKo : '';
  const want = nm.includes('그레이몬') ? '파피몬' : nm.includes('가루몬') ? '아구몬' : null;
  if (!want) { log(ctx, `${ctx.self} 진화한 디지몬이 「그레이몬」/「가루몬」을 포함하지 않아 효과 없음`); return; }
  if (digs(state, ctx.self).length > 1) return;
  if (!(await ask(ctx, `이 테이머를 레스트시키고 패/트래시에서 「${want}」 1장을 코스트를 지불하지 않고 등장시킬까요?`))) { decline(ctx); return; }
  tam.suspended = true;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'any', filter: { exactAny: [want] }, rested: false, noTriggers: false, optional: true }, ctx);
});

// EX13-069 시노미야 리나 【자신의 턴】 자신의 디지몬이 액티브가 되었을 때, 이 테이머를 레스트시키는 것으로, 《1 드로우》. 그 후, 자신의 디지몬 1마리를 패의 명칭에 「브이드라몬」을 포함하는 디지몬 카드로 지불하는 코스트 -2 하여 진화시킬 수 있다.
{
  const activeEv = (state, hp, h, info) => info.owner === hp && isDig(info.stack) && !h.suspended;
  D('EX13-069', '자신의 턴', '액티브가 되었을 때', { events: { active: activeEv, unsuspend: activeEv } });
}
sc('EX13-069::자신의 턴', async (ctx, R) => {
  const { state } = ctx; const tam = me(ctx); if (!tam || tam.suspended) return;
  if (!(await ask(ctx, '이 테이머를 레스트시키고 《1 드로우》한 뒤, 「브이드라몬」을 포함하는 패의 디지몬 카드로 -2 진화시킬까요?'))) { decline(ctx); return; }
  tam.suspended = true;
  S.drawCards(state, ctx.self, 1);
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: false, other: false, desc: null, name: null }, zone: 'hand', cardFilter: { category: 'digimon', nameAny: ['브이드라몬'] }, cost: { mode: 'discount', n: 2 }, ignoreCond: false, ignoreLevel: false }, ctx);
});

// EX13-070 최산해&서정우 【자신의 턴 종료 시】 이 테이머를 레스트시키는 것으로, 이하의 효과에서 1개를 발휘한다.
sc('EX13-070::자신의 턴 종료 시', async (ctx, R) => {
  const { state } = ctx; const tam = me(ctx); if (!tam || tam.suspended) return;
  const k = await ctx.choose('multipleChoice', { player: ctx.self, prompt: '이 테이머를 레스트시키고 발휘할 효과 선택', options: ['자신의 디지몬 1마리를 패의 「황제드라몬」 포함/특징 「프리」 디지몬 카드로 진화 (상대 디지몬 1마리마다 코스트 -1)', '자신의 디지몬 2마리로 패의 특징 「프리」 디지몬 카드로 조그레스 진화', '하지 않음'] });
  if (k == null || k === 2) { decline(ctx); return; }
  tam.suspended = true;
  if (k === 0) await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: false, other: false, desc: null, name: null }, zone: 'hand', cardFilter: { category: 'digimon', anyOf: [{ nameAny: ['황제드라몬'] }, { traitAny: ['프리'] }] }, cost: { mode: 'discount', n: digs(state, ctx.opp).length }, ignoreCond: false, ignoreLevel: false }, ctx);
  else await R.runOne({ op: 'n5_jogressPair', pred: (id) => hasTrait(C(id), '프리') }, ctx);
});

// EX13-071 고동혁
// 【자신의 메인 페이즈 개시 시】【등장 시】 자신의 덱 위에서부터 1장을 이 테이머의 아래에 뒷면으로 놓을 수 있다. 그 후, 상대의 디지몬이 있다면, 메모리 +1.
sc('EX13-071::자신의 메인 페이즈 개시 시', async (ctx, R) => {
  const { state } = ctx; const tam = me(ctx); if (!tam) return;
  if (PL(ctx, ctx.self).deck.length && (await ask(ctx, '덱 위에서부터 1장을 이 테이머의 아래에 뒷면으로 놓습니까?'))) await R.runOne({ op: 's8_deckTopUnderTamer', thisTamer: true, n: 1 }, ctx);
  if (digs(state, ctx.opp).length) await R.runOne({ op: 'gainMemory', who: 'self', n: 1 }, ctx);
});
// 【메인】[턴 1회] 자신의 테이머 아래의 뒷면 카드를 아래에서부터 3장 파기하고, 트래시의 특징 「성수형」 옐로인 Lv.4/Lv.5 디지몬 1장씩을 「쿠다몬」 1마리의 진화원 아래에 놓는 것으로, 그 디지몬을 패/트래시의 「슬레이프몬」으로 Lv.을 무시하고 -1 하여 진화시킬 수 있다.
sc('EX13-071::메인', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const tamers = pl.battle.filter((t) => isTam(t) && S.fdCount(t) >= 3);
  const kudas = digs(state, ctx.self).filter((s) => S.cardNameIs(s.cardId, '쿠다몬'));
  const yl = (lv) => pl.trash.map((id, i) => i).filter((i) => { const c = C(pl.trash[i]); return c.category === 'digimon' && c.level === lv && (c.colors || []).includes('yellow') && hasTrait(c, '성수형'); });
  const slay = ['hand', 'trash'].some((z) => pl[z].some((id) => C(id).category === 'digimon' && C(id).nameKo === '슬레이프몬'));
  if (!tamers.length || !kudas.length || !yl(4).length || !yl(5).length || !slay) { log(ctx, `${ctx.self} 조건(뒷면 카드 3장 / 「쿠다몬」 / 트래시의 성수형 옐로 Lv.4·Lv.5 / 「슬레이프몬」)을 채울 수 없어 효과를 건너뜀`); decline(ctx); return; }
  if (!(await ask(ctx, '뒷면 카드 3장을 파기하고 트래시의 Lv.4·Lv.5 성수형을 「쿠다몬」의 진화원 아래에 놓아 「슬레이프몬」으로 진화시킵니까?'))) { decline(ctx); return; }
  const kuda = await pickStack(ctx, ctx.self, kudas, '진화시킬 「쿠다몬」 선택', { auto: true });
  const tam = await pickStack(ctx, ctx.self, tamers, '뒷면 카드를 파기할 테이머 선택', { auto: true });
  if (!kuda || !tam) { decline(ctx); return; }
  const i4 = await pickFromList(ctx, pl.trash.slice(), yl(4), '진화원 아래에 놓을 성수형 옐로인 Lv.4 디지몬 카드 선택');
  const i5 = i4 == null ? null : await pickFromList(ctx, pl.trash.slice(), yl(5), '진화원 아래에 놓을 성수형 옐로인 Lv.5 디지몬 카드 선택');
  if (i4 == null || i5 == null) { decline(ctx); return; }
  const ids = [pl.trash[i4], pl.trash[i5]];
  for (const i of [i4, i5].sort((a, b) => b - a)) pl.trash.splice(i, 1);
  const fd = S.fdCount(tam); const gone = tam.sources.splice(0, 3); tam.s5fd = Math.max(0, fd - 3); pl.trash.push(...gone); S.recomputeStackGrants(tam);
  kuda.sources.splice(S.fdCount(kuda), 0, ...ids); S.recomputeStackGrants(kuda);
  log(ctx, `${ctx.self} ${C(tam.cardId).nameKo} 아래의 뒷면 카드 3장 파기, ${ids.map((i) => C(i).nameKo).join('/')}을(를) ${C(kuda.cardId).nameKo}의 진화원 아래에 놓음`);
  const save = ctx.sourceStackUid; ctx.sourceStackUid = kuda.uid;
  try { await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'handTrash', cardFilter: { category: 'digimon', exactAny: ['슬레이프몬'] }, cost: { mode: 'discount', n: 1 }, ignoreCond: false, ignoreLevel: true }, ctx); } finally { ctx.sourceStackUid = save; }
});

// EX13-072 도모토 코타 【자신의 턴】 특징 「크로니클」을 가진 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 자신의 패에서 「X항체」 또는 특징 「크로니클」을 가진 옵션 카드 1장을 지불하는 코스트 -1 하여 사용할 수 있다.
sc('EX13-072::자신의 턴', (ctx, R) => R.runOne({ op: 's8_playOrUse', zones: ['hand'], kinds: ['option'], delta: -1, pred: (id) => hasTrait(C(id), 'X항체', '크로니클') }, ctx));

// EX13-074 키시베 리에
// 【서로의 턴】[턴 1회] 「나이트몬」이 기술되어 있는 자신의 디지몬이 등장/소멸했을 때, 자신의 패/트래시에서 「나이트몬」이 기술되어 있는 카드 1장을 이 테이머 아래에 놓는 것으로, 《1 드로우》.
{
  const nightEv = (state, hp, h, info) => info.owner === hp && !!info.stack && info.stack.cardId && C(info.stack.cardId).category === 'digimon' && mentions(info.stack.cardId, '나이트몬');
  D('EX13-074', '서로의 턴', '등장/소멸했을 때', { limit: 1, events: { play: nightEv, delete: nightEv } });
}
sc('EX13-074::서로의 턴', async (ctx) => {
  const { state } = ctx; const tam = me(ctx); if (!tam) return; const pl = PL(ctx, ctx.self);
  const entries = [];
  pl.hand.forEach((id, i) => { if (mentions(id, '나이트몬')) entries.push({ id, zone: 'hand', i }); });
  pl.trash.forEach((id, i) => { if (mentions(id, '나이트몬')) entries.push({ id, zone: 'trash', i }); });
  if (!entries.length) { log(ctx, `${ctx.self} 이 테이머 아래에 놓을 「나이트몬」 카드가 없음`); decline(ctx); return; }
  const k = await pickFromList(ctx, entries.map((e) => e.id), entries.map((e, i) => i), '이 테이머 아래에 놓을 「나이트몬」 기술 카드 선택 (패/트래시, 취소=하지 않음)');
  if (k == null) { decline(ctx); return; }
  const e = entries[k]; pl[e.zone].splice(e.i, 1);
  tam.sources.splice(S.fdCount(tam), 0, e.id); S.recomputeStackGrants(tam);
  log(ctx, `${ctx.self} ${C(e.id).nameKo}을(를) ${C(tam.cardId).nameKo} 아래에 놓음`);
  S.drawCards(state, ctx.self, 1);
});
// 【메인】[턴 1회] 이 테이머 아래에 「나이트몬」이 기술되어 있는 카드가 3장 이상 있다면, 이 테이머를 패/트래시의 「로드나이트몬」으로 진화 조건을 무시하고 진화 코스트 3으로 진화시킬 수 있다.
sc('EX13-074::메인', async (ctx, R) => {
  const tam = me(ctx); if (!tam) return;
  const n = tam.sources.filter((id, i) => i >= S.fdCount(tam) && mentions(id, '나이트몬')).length;
  if (n < 3) { log(ctx, `${ctx.self} 이 테이머 아래의 「나이트몬」 카드가 ${n}장뿐이라 효과 없음`); decline(ctx); return; }
  if (!(await ask(ctx, '이 테이머를 패/트래시의 「로드나이트몬」으로 진화 조건을 무시하고 진화 코스트 3으로 진화시킵니까?'))) { decline(ctx); return; }
  await R.runOne({ op: 'evolveEffect', who: 'self', subject: { thisStack: true }, zone: 'handTrash', cardFilter: { category: 'digimon', exactAny: ['로드나이트몬'] }, cost: { mode: 'fixed', n: 3 }, ignoreCond: true, ignoreLevel: false }, ctx);
});

// EX13-076 황제드라몬: 팔라딘 모드
// 【등장 시】【진화 시】【어택 시】[턴 1회] 상대의 디지몬 1마리를 레스트시킬 수 있다. 그 후, 상대의 디지몬 1마리의 진화원을 전부 덱 아래로 되돌리고, 이 디지몬으로 그 디지몬과 배틀할 수 있다. 이 배틀에서는 DP가 아닌 진화원 매수를 비교한다.
sc('EX13-076::등장 시', async (ctx) => {
  const { state } = ctx; const st = me(ctx);
  const t0 = await pickStack(ctx, ctx.self, digs(state, ctx.opp).filter((s) => !s.suspended && S.canRestByRule(state, ctx.opp, s)), '레스트시킬 상대의 디지몬 선택 (안 해도 됨)', { optional: true });
  if (t0) S.restStack(state, ctx.opp, t0.uid, 'effect');
  if (!digs(state, ctx.opp).length) return;
  const t = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '진화원을 전부 덱 아래로 되돌리고 배틀할 상대의 디지몬 선택 (안 해도 됨)', { optional: true });
  if (!t) { decline(ctx); return; }
  sourcesToDeckBottom(ctx, ctx.opp, t);
  if (!st || !findStack(state, ctx.self, st.uid) || !findStack(state, ctx.opp, t.uid)) return;
  if (!(await ask(ctx, `이 디지몬으로 ${C(t.cardId).nameKo}와(과) 배틀합니까? (이 배틀에서는 DP가 아닌 진화원 매수를 비교)`))) return;
  state._battleCompareSources = true;
  let res;
  try { res = S.resolveDigimonBattle(state, ctx.self, st.uid, t.uid); } finally { delete state._battleCompareSources; }
  // 16-7-3/16-7-4 (official Q&A): this scripted battle can also win with ≪관통≫ — capped at once per attack (S.consumePierceCheck, applied inside ctx.securityCheck).
  if (res && res.piercing && ctx.securityCheck) await ctx.securityCheck(ctx.self, st.uid, ctx.opp);
});
SCRIPTS['EX13-076::진화 시'] = SCRIPTS['EX13-076::등장 시'];
SCRIPTS['EX13-076::어택 시'] = SCRIPTS['EX13-076::등장 시'];
// 【서로의 턴】[턴 1회] 이 디지몬이 배틀에서 승리했을 때, 상대의 디지몬 1마리를 덱 아래로 되돌릴 수 있다. 그 후, 이 디지몬을 액티브로 할 수 있다.
D('EX13-076', '서로의 턴', '승리했을 때', { limit: 1, events: { battleWin: (state, hp, h, info) => info.owner === hp && info.stack === h } });
sc('EX13-076::서로의 턴', async (ctx, R) => {
  const { state } = ctx;
  if (digs(state, ctx.opp).length && (await ask(ctx, '상대의 디지몬 1마리를 덱 아래로 되돌립니까?'))) await R.runOne({ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: {}, requireSuspended: null, dest: 'deckBottom' }, ctx);
  const st = me(ctx);
  if (st && st.suspended && (await ask(ctx, '이 디지몬을 액티브로 합니까?'))) S.unsuspendStack(state, ctx.self, st.uid);
});

// EX13-077 오메가몬: 머시풀 모드
// 【서로의 턴】 이 디지몬은 이 디지몬의 진화원의 색 전부를 얻고, 자신의 디지몬과 테이머의 색 1색마다 DP +1000.
D('EX13-077', '서로의 턴', '진화원의 색 전부', {
  addColors: (state, hp, h) => h.sources.flatMap((id) => C(id).colors || []),
  dp: (state, hp, h, target) => (target === h ? 1000 * distinctColors(state.players[hp].battle.filter((s) => isDig(s) || isTam(s))).size : 0),
});
// 【등장 시】【진화 시】 자신의 디지몬 1마리로 레스트시키지 않고 어택할 수 있다. 그 후, 자신의 디지몬과 테이머의 색 2색마다, 이하의 효과에서 1개를 발휘한다. ·이 디지몬은 상대의 디지몬 1마리와 배틀할 수 있다. ·상대의 트래시에서 카드 5장을 덱 아래로 되돌리는 것으로, 《리커버리 +1》.
sc('EX13-077::등장 시', async (ctx, R) => {
  const { state } = ctx; const st = me(ctx);
  const a = await pickStack(ctx, ctx.self, digs(state, ctx.self), '레스트시키지 않고 어택할 자신의 디지몬 선택 (안 해도 됨)', { optional: true });
  if (a && ctx.startAttack) ctx.startAttack(ctx.self, a.uid, undefined, { noRest: true });
  const n = Math.floor(distinctColors(state.players[ctx.self].battle.filter((s) => isDig(s) || isTam(s))).size / 2);
  for (let k = 0; k < n; k++) {
    const opts = ['이 디지몬은 상대의 디지몬 1마리와 배틀', '상대의 트래시에서 카드 5장을 덱 아래로 되돌리고 《리커버리 +1》', '하지 않음'];
    const c = await ctx.choose('multipleChoice', { player: ctx.self, prompt: `효과 선택 (${k + 1}/${n})`, options: opts });
    if (c == null || c === 2) continue;
    if (c === 0) {
      if (!st || !findStack(state, ctx.self, st.uid)) continue;
      const t = await pickStack(ctx, ctx.self, digs(state, ctx.opp), '배틀할 상대의 디지몬 선택');
      if (t) {
        const res = S.resolveDigimonBattle(state, ctx.self, st.uid, t.uid);
        // 16-7-3/16-7-4: this scripted battle can also win with ≪관통≫ if granted dynamically — capped at once per attack (S.consumePierceCheck, applied inside ctx.securityCheck).
        if (res && res.piercing && ctx.securityCheck) await ctx.securityCheck(ctx.self, st.uid, ctx.opp);
      }
    } else {
      const otr = PL(ctx, ctx.opp).trash;
      if (otr.length < 5) { log(ctx, `${ctx.opp} 트래시가 5장 미만이라 비용을 지불할 수 없음`); continue; }
      const picked = [];
      for (let j = 0; j < 5; j++) {
        const i = await pickFromList(ctx, otr.slice(), otr.map((id, x) => x).filter((x) => !picked.includes(x)), `상대 트래시에서 덱 아래로 되돌릴 카드 선택 (${j + 1}/5)`);
        if (i == null) break; picked.push(i);
      }
      if (picked.length < 5) { log(ctx, '카드 5장을 고르지 않아 비용을 지불하지 않음'); continue; }
      const ids = picked.sort((x, y) => y - x).map((i) => otr.splice(i, 1)[0]); PL(ctx, ctx.opp).deck.push(...ids.reverse());
      log(ctx, `${ctx.opp} 트래시의 카드 5장 → 덱 아래`);
      await R.runOne({ op: 'recoverTop', who: 'self' }, ctx);
    }
  }
});
SCRIPTS['EX13-077::진화 시'] = SCRIPTS['EX13-077::등장 시'];

// EX13-023 알포스브이드라몬 【서로의 턴】 액티브 상태인 이 디지몬은 상대의 효과로 DP가 마이너스되지 않고, 겹쳐져 있는 카드가 패/덱으로 돌아가지 않으며, 파기되지 않는다.
D('EX13-023', '서로의 턴', '액티브 상태인 이 디지몬은', { effectImmune: (state, hp, h, target, tp, o) => target === h && !h.suspended && ['dpDown', 'bounce', 'srcReturn', 'srcTrash'].includes(o.kind) });

// EX13-039 코어드라몬 【등장 시】【진화 시】 자신의 트래시에서 디지타마 카드 이외의 「드라코몬」/「엑자몬」이 기술되어 있는 카드 1장을 패로 되돌릴 수 있다.
SCRIPTS['EX13-039::등장 시'] = [{ op: 's8_trashToHand', pred: (id) => C(id).category !== 'digitama' && mentions(id, '드라코몬', '엑자몬'), prompt: '패로 되돌릴 「드라코몬」/「엑자몬」이 기술된 카드 선택 (디지타마 제외)' }];
SCRIPTS['EX13-039::진화 시'] = SCRIPTS['EX13-039::등장 시'];

// EX13-026 쿠다몬 【이동 시】【등장 시】 자신의 덱 위에서부터 3장 오픈한다. 그중 특징 「성수형」/「로얄 나이츠」/「세이버즈」를 가진 카드 1장을 패에 추가하고, 1장을 특징 「세이버즈」를 가진 자신의 테이머 아래에 뒷면으로 놓는다. 나머지는 덱 아래로 되돌린다.
sc('EX13-026::이동 시', async (ctx) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  const n = Math.min(3, pl.deck.length); if (!n) return;
  const revealed = pl.deck.splice(0, n);
  log(ctx, `${ctx.self} 덱 위 ${n}장 오픈: ${revealed.map((i) => C(i).nameKo).join(', ')}`);
  const hi = await pickFromList(ctx, revealed.slice(), revealed.map((id, i) => i).filter((i) => hasTrait(C(revealed[i]), '성수형', '로얄 나이츠', '세이버즈')), '패에 추가할 카드 선택 (성수형/로얄 나이츠/세이버즈, 취소=하지 않음)');
  if (hi != null) { pl.hand.push(revealed[hi]); log(ctx, `${ctx.self} ${C(revealed[hi]).nameKo}을(를) 패에 추가`); revealed[hi] = null; }
  const tams = pl.battle.filter((t) => isTam(t) && hasTrait(C(t.cardId), '세이버즈'));
  const remIdx = revealed.map((id, i) => i).filter((i) => revealed[i]);
  if (tams.length && remIdx.length) {
    const fi = await pickFromList(ctx, revealed.slice(), remIdx, '「세이버즈」 테이머 아래에 뒷면으로 놓을 카드 선택 (취소=하지 않음)');
    if (fi != null) {
      const tam = tams.length === 1 ? tams[0] : await pickStack(ctx, ctx.self, tams, '카드를 뒷면으로 놓을 「세이버즈」 테이머 선택');
      if (tam) {
        tam.sources.unshift(revealed[fi]); tam.s5fd = S.fdCount(tam) + 1; S.recomputeStackGrants(tam);
        S.emitGameEvent(state, 'faceDownSource', { owner: ctx.self, stack: tam, cause: 'effect' });
        log(ctx, `${ctx.self} 덱 위에서 오픈한 1장을 뒷면으로 ${C(tam.cardId).nameKo} 아래에 놓음`); revealed[fi] = null;
      }
    }
  }
  const rest = revealed.filter(Boolean); pl.deck.push(...rest);
  log(ctx, `${ctx.self} 나머지 ${rest.length}장을 덱 아래로 되돌림`);
});

// EX13-040 미케몬 / EX13-044 브레이크드라몬: 상대의 턴 종료까지 상대의 디지몬/테이머 N마리(명)는 액티브가 되지 않는다 (skipUnsuspend op only offers Digimon)
async function skipOppActive(ctx, n) {
  const { state } = ctx; const done = [];
  for (let k = 0; k < n; k++) {
    const cands = state.players[ctx.opp].battle.filter((s) => (isDig(s) || isTam(s)) && !done.includes(s.uid));
    const t = await pickStack(ctx, ctx.self, cands, `액티브가 되지 않게 할 상대의 디지몬/테이머 선택 (${k + 1}/${n})`);
    if (!t) break;
    done.push(t.uid);
    if (!S.effectBlocked(state, ctx.opp, t, 'other')) S.setSkipNextUnsuspend(state, ctx.opp, t.uid);
  }
}
sc('EX13-040::등장 시', (ctx) => skipOppActive(ctx, 1));

// EX13-035 킹에테몬 【서로의 턴】 명칭에 「스카몬」/「에테몬」을 포함하는 디지몬이 3마리 이상 있는 동안, 상대의 디지몬 전부에게 《S 어택 -1》을 주고, DP -3000. (양쪽 배틀 에어리어의 디지몬을 센다)
{
  const scaCount = (state) => ['p1', 'p2'].reduce((n, p) => n + digs(state, p).filter((s) => C(s.cardId).nameKo.includes('스카몬') || C(s.cardId).nameKo.includes('에테몬')).length, 0);
  D('EX13-035', '서로의 턴', '3마리 이상', {
    dp: (state, hp, h, target, tp) => (tp !== hp && isDig(target) && scaCount(state) >= 3 ? -3000 : 0),
    sAtkOpp: (state, hp, h, aStack, ap) => (ap !== hp && isDig(aStack) && scaCount(state) >= 3 ? -1 : 0),
  });
}

// EX13-014 제스몬 【서로의 턴】[턴 1회] 자신의 디지몬이 등장했을 때, DP가 가장 낮은 상대의 디지몬 1마리를 소멸시킬 수 있다. 그 후, 자신의 「아트&르네&포르」가 없다면, 「아트&르네&포르」(디지몬·화이트·DP 6000·《재기동》《블로커》《디코이《레드》/《블랙》》) 토큰 1마리를 등장시킬 수 있다.
sc('EX13-014::서로의 턴', async (ctx, R) => {
  const { state } = ctx; const pl = PL(ctx, ctx.self);
  if (digs(state, ctx.opp).length && (await ask(ctx, 'DP가 가장 낮은 상대의 디지몬 1마리를 소멸시킵니까?'))) await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { extreme: { stat: 'dp', dir: 'min' } } }, ctx);
  if (pl.battle.some((s) => C(s.cardId).nameKo === '아트&르네&포르')) return;
  const before = new Set(pl.battle.map((s) => s.uid));
  await runText(ctx, R, '「아트&르네&포르」(디지몬·화이트·DP 6000·《재기동》《블로커》) 토큰 1마리를 등장시킬 수 있다.');
  const tok = pl.battle.find((s) => !before.has(s.uid) && C(s.cardId).nameKo === '아트&르네&포르');
  if (tok) S.grantKeyword(state, ctx.self, tok.uid, '디코이', ['red', 'black'], 'permanent'); // 《디코이《레드》/《블랙》》 (the nested keyword text is not parsed from the token definition)
});
