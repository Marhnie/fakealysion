// Shard 31 — batch-3 verification fixes (BT7-/BT8-/BT9- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-BT7-9.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's31_fn', fn: f });
OPS.s31_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };

// BT7-018 쉬라몬 【등장 시】 진화원에서 등장했을 때 《2 드로우》 — only when played out of an evolution-source pile
SCRIPTS['BT7-018::등장 시'] = [{ op: 'condition', if: { test: (ctx) => !!me(ctx)?.playedFromSources }, then: [{ op: 'draw', who: 'self', n: 2 }], else: [] }];

// BT7-016 카이젤그레이몬 【자신의 턴】〔턴에 1회〕 블록당했을 때: 이 디지몬을 액티브로 하고, 진화원의 「하이브리드체」 카드 1장마다 메모리 +1
sc('BT7-016::자신의 턴', async (ctx) => {
  const st = me(ctx); if (!st) return;
  st.suspended = false;
  const n = st.sources.filter(id => (C(id).types || []).includes('하이브리드체')).length;
  if (n) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
});

// BT7-039 스티필몬 【진화 시】 진화원이 1장일 때: 패의 옐로 Lv.4 이하 디지몬 2장까지를 진화원 아래에 놓을 수 있다 → 놓은 카드 1장마다 《1 드로우》 (was: drew 1 without placing anything)
sc('BT7-039::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st || st.sources.length !== 1) return;
  await R.runOne({ op: 'placeUnderSource', who: 'self', zones: ['hand'], filter: { category: 'digimon', colors: ['yellow'], levelMax: 4 }, n: 2, thisStack: true, optional: true }, ctx);
  const n = ctx._lastPlacedSource || 0;
  if (n) S.drawCards(ctx.state, ctx.self, n);
});
// BT7-041 카즈치몬 【진화 시】 시큐리티 3장 이상: 메모리 +2 / 2장 이하: 시큐리티가 3장이 되도록 《리커버리 +1《덱》》 할 수 있다 (was: recovered exactly 1, not optional)
sc('BT7-041::진화 시', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  if (pl.security.length >= 3) { S.grantMemory(ctx.state, ctx.self, 2, ctx.sourceCardId); return; }
  const need = 3 - pl.security.length;
  if (!pl.deck.length) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `시큐리티가 3장이 되도록 《리커버리 +1《덱》》을 ${need}번 하시겠습니까?` }))) return;
  for (let i = 0; i < need && pl.deck.length; i++) S.recoverTopOfDeckToSecurity(ctx.state, ctx.self);
});

// 【상대의 턴】 [이 디지몬의 진화원에 「하이브리드체」가 있는 동안] 자신의 시큐리티 디지몬 전부의 DP +N — s1securityDP hooks (checked when a security Digimon battles)
HOOKS['BT7-042'] = [{ tag: '상대의 턴', has: '시큐리티 디지몬', src: 'effectKo', s1securityDP: (state, hp, holder, info) => (info.p === hp && holder.sources.some(id => (C(id).types || []).includes('하이브리드체')) ? 4000 : 0) }];
HOOKS['BT7-088'] = [{ tag: '상대의 턴', has: '시큐리티 디지몬', src: 'inheritedKo', s1securityDP: (state, hp, holder, info) => (info.p === hp ? 3000 : 0) }];

const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const hasT = (id, t) => (C(id).types || []).includes(t);
// BT7-053 다이노렉스몬 【자신의 턴】 레스트 상태의 상대 디지몬 1마리당 이 디지몬의 DP +1000 (per-count continuous, not handled generically)
HOOKS['BT7-053'] = [{ tag: '자신의 턴', has: '1마리당', src: 'effectKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * state.players[opp(hp)].battle.filter(s => isDig(s) && s.suspended).length : 0) }];
// BT7-062 도루가몬 【상대의 턴】 (X항체를 갖는 다른 자신의 디지몬이 있는 동안 또는 진화원에 X항체 카드가 있는 동안) 《블로커》 (the "A 동안, 또는 B 동안" form)
HOOKS['BT7-062'] = [{ tag: '상대의 턴', has: '블로커', src: 'effectKo', kw: (state, hp, holder, name) => name === '블로커' && (state.players[hp].battle.some(s => s !== holder && isDig(s) && hasT(s.cardId, 'X항체')) || holder.sources.some(id => hasT(id, 'X항체'))) }];

// BT7-072 아이즈몬 자신의 효과로 패에서 파기되었을 때, 트래시에 「아이즈몬: 스캐터모드」가 있다면 이 카드를 코스트 없이 등장시킬 수 있다 (generic compile played a random hand card)
sc('BT7-072::__ownDiscard', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  if (!pl.trash.some(id => C(id).nameKo === '아이즈몬: 스캐터모드')) return;
  const i = pl.trash.lastIndexOf(ctx.sourceCardId); if (i < 0) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `${C(ctx.sourceCardId).nameKo}을(를) 코스트를 지불하지 않고 등장시키겠습니까?` }))) return;
  S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, {});
});

// "진화원에 테이머 카드를 갖는 자신의 디지몬이 패의 이 카드로 진화할 때, 지불하는 진화 코스트를 -2 한다." (BT7-014/025/038/051/075) — printed on the card being evolved INTO (state.hookEvoCostDiscount -> selfEvoDiscount)
for (const id of ['BT7-014', 'BT7-025', 'BT7-038', 'BT7-051', 'BT7-075']) (HOOKS[id] ||= []).push({ selfEvoDiscount: (state, p, stack) => (stack && stack.sources.some(sid => C(sid).category === 'tamer') ? -2 : 0) });
// BT7-111 루체몬: 폴다운 모드 — 자신의 트래시 10장마다 패의 이 카드를 등장시킬 때 등장 코스트 -3 (state.handSelfPlayDiscount -> selfPlayDiscount)
(HOOKS['BT7-111'] ||= []).push({ selfPlayDiscount: (state, p) => -3 * Math.floor(state.players[p].trash.length / 10) });

// "【자신의 턴】 자신의 디지몬의 진화원에서 디지몬이 등장했을 때, …" (BT7-002 inherited [턴에 1회] / BT7-028): a Digimon that came out of an own Digimon's evolution sources (stack.playedFromSources)
const playedFromOwnSources = { play: (state, hp, holder, info) => info.owner === hp && !!info.stack && info.stack.playedFromSources && isDig(info.stack) };
(HOOKS['BT7-002'] ||= []).push({ tag: '자신의 턴', has: '진화원에서 디지몬이 등장', src: 'inheritedKo', limit: 1, events: playedFromOwnSources });
(HOOKS['BT7-028'] ||= []).push({ tag: '자신의 턴', has: '진화원에서 디지몬이 등장', src: 'effectKo', events: playedFromOwnSources });
sc('BT7-002::자신의 턴', async (ctx) => { S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId); });
sc('BT7-028::자신의 턴', async (ctx, R) => { await R.runScript(R.compileToScript('Lv.4 이하의 상대 디지몬 1마리를 패로 되돌린다. 그 디지몬이 갖는 진화원은 파기한다.'), ctx); });

// BT7-037 바우트몬 (inherited, 【상대의 턴】) 상대 디지몬이 플레이어에게 어택했을 때, 자신의 시큐리티가 3장 이상이라면 이 디지몬을 액티브로 한다 (was never queued)
(HOOKS['BT7-037'] ||= []).push({ tag: '상대의 턴', has: '플레이어에게', src: 'inheritedKo', events: { attackTarget: (state, hp, holder, info) => info.owner !== hp && info.targetKind === 'player' && isDig(info.stack) } });
sc('BT7-037::상대의 턴', async (ctx) => {
  const st = me(ctx); if (!st || ctx.state.players[ctx.self].security.length < 3) return;
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
});

// BT7-028 킹고래몬 【어택 시】 이 디지몬의 진화원의 Lv.3 디지몬 카드 1장 또는 「고래몬」 1장을 코스트를 지불하지 않고 별개의 디지몬으로서 등장시킬 수 있다 (was a manual no-op)
sc('BT7-028::어택 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  const pl = ctx.state.players[ctx.self];
  const ok = (id) => C(id).category === 'digimon' && (C(id).level === 3 || C(id).nameKo === '고래몬');
  if (!st.sources.some(ok)) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '진화원의 Lv.3 디지몬 또는 「고래몬」을 코스트를 지불하지 않고 등장시키겠습니까?' }))) return;
  const [i] = await S.chooseSourceIdxs(ctx.state, ctx.self, st, 1, ctx.choose, ok, '코스트 없이 등장시킬 진화원의 카드 1장 선택');
  if (i == null) return;
  const [id] = st.sources.splice(i, 1);
  S.recomputeStackGrants(st);
  pl.trash.push(id);
  S.playFreeFromZone(ctx.state, ctx.self, 'trash', pl.trash.length - 1, { fromSources: true });
});

// BT7-072 아이즈몬 【자신의 턴】 자신의 트래시의 「아이즈몬: 스캐터모드」 1장마다 이 디지몬의 DP +2000 (per-count continuous, not handled generically)
HOOKS['BT7-072'] = (HOOKS['BT7-072'] || []).concat([{ tag: '자신의 턴', has: '1장마다', src: 'effectKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 2000 * state.players[hp].trash.filter(id => C(id).nameKo === '아이즈몬: 스캐터모드').length : 0) }]);

// BT8-004 비비몬 (inherited, 【상대의 턴】) 자신의 디지몬 전부가 레스트 상태인 동안, 이 디지몬을 DP+1000 (condition not parsed generically)
(HOOKS['BT8-004'] ||= []).push({ tag: '상대의 턴', has: '레스트 상태인 동안', src: 'inheritedKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp && state.players[hp].battle.filter(isDig).every(s => s.suspended) ? 1000 : 0) });

// BT8-024 엔젤몬 【자신의 턴】 이 디지몬이 진화할 때, 자신의 시큐리티가 3장 이하라면 《리커버리 +1《덱》》 (was never queued — "진화할 때" isn't a known watcher phrase)
(HOOKS['BT8-024'] ||= []).push({ tag: '자신의 턴', has: '진화할 때', src: 'effectKo', events: { digivolve: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
sc('BT8-024::자신의 턴', async (ctx) => {
  if (ctx.state.players[ctx.self].security.length > 3) return;
  S.recoverTopOfDeckToSecurity(ctx.state, ctx.self);
});

// "…동안, 이 디지몬은 액티브 상태의 상대 디지몬에게도 어택할 수 있다" with a condition prefix: state.canAttackAnyActive's generic text match is now anchored (unconditional form only),
// so the conditional variants live here (they used to grant it unconditionally): BT8-067 (inherited), BT9-013, EX3-061 (inherited), EX11-002 (inherited).
const trait = (id, ...ts) => ts.some(t => (C(id).types || []).includes(t));
(HOOKS['BT8-067'] ||= []).push({ tag: '자신의 턴', has: '액티브 상태의 상대 디지몬에게도', src: 'inheritedKo', attackAnyActive: (state, hp, holder) => trait(holder.cardId, '용인형', '머신형') });
(HOOKS['BT9-013'] ||= []).push({ tag: '자신의 턴', has: '액티브 상태의 상대 디지몬에게도', src: 'effectKo', attackAnyActive: (state, hp, holder) => holder.sources.some(id => S.cardNameIs(id, '오메가샤우트몬') || S.cardNameIs(id, 'X항체')) });
(HOOKS['EX3-061'] ||= []).push({ tag: '자신의 턴', has: '액티브 상태의 상대의 디지몬에게도', src: 'inheritedKo', attackAnyActive: (state, hp, holder) => S.cardNameHas(holder.cardId, '황제드라몬') });
(HOOKS['EX11-002'] ||= []).push({ tag: '자신의 턴', has: '액티브 상태의 상대의 디지몬에게도', src: 'inheritedKo', attackAnyActive: (state, hp, holder) => trait(holder.cardId, '빙설형') && !state.players[opp(hp)].battle.some(s => isDig(s) && s.sources.length > 0) });

// BT8-047/050/054 (inherited, 【서로의 턴】) 다른 레스트 상태의 자신의 디지몬 1마리마다 이 디지몬을 DP+1000 (per-count continuous)
for (const id of ['BT8-047', 'BT8-050', 'BT8-054']) (HOOKS[id] ||= []).push({ tag: '서로의 턴', has: '레스트 상태의 자신의 디지몬 1마리마다', src: 'inheritedKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp ? 1000 * state.players[hp].battle.filter(s => s !== holder && isDig(s) && s.suspended).length : 0) });

// BT8-069 오류우몬 【자신의 턴】〔턴에 1회〕 자신의 효과로 자신의 디지몬의 진화원이 늘어났을 때, 다음 상대의 턴 종료 시까지 이 디지몬 DP+2000, 상대의 효과로는 소멸하지 않는다 (event unparsed + immunity half was dropped)
(HOOKS['BT8-069'] ||= []).push({ tag: '자신의 턴', has: '진화원이 늘어났을 때', src: 'effectKo', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.owner === hp && info.srcPlayer === hp && !!info.stack && isDig(info.stack) } });
SCRIPTS['BT8-069::자신의 턴'] = [{ op: 's4_shield', thisStack: true, kinds: ['delete'], dur: 'opp', dp: 2000 }];

// BT8-081 라센몬: 격앙 모드 (inherited) 이 카드가 「라센몬」의 효과로 진화원에서 파기되었을 때, 자신의 디지몬 1마리를 액티브로 하고, 이 턴 동안 (그 디지몬) DP+3000 (generic compile dropped the DP half)
sc('BT8-081::__ownDiscard', async (ctx) => {
  const digs = ctx.state.players[ctx.self].battle.filter(isDig);
  if (!digs.length) return;
  const uid = digs.length === 1 ? digs[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: digs.map(s => s.uid), prompt: '액티브로 하고 DP+3000 할 자신의 디지몬 선택' });
  if (!uid) return;
  S.unsuspendStack(ctx.state, ctx.self, uid);
  S.modifyDP(ctx.state, ctx.self, uid, 3000, 'turn');
});

// BT8-087 리키 【상대의 턴】 상대의 디지몬이 블루인 자신의 디지몬에게 어택했을 때, 이 테이머를 레스트시키는 것으로 《1 드로우》 (event was never queued)
(HOOKS['BT8-087'] ||= []).push({ tag: '상대의 턴', has: '블루인 자신의 디지몬에게 어택했을 때', src: 'effectKo', events: { attackOnDigimon: (state, hp, holder, info) => info.owner !== hp && !!info.target && state.players[hp].battle.includes(info.target) && isDig(info.target) && S.stackColors(info.target).includes('blue') } });
SCRIPTS['BT8-087::상대의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'draw', who: 'self', n: 1 }] }];
// BT8-092 무샤 유지 【자신의 턴】 (X항체·블랙 디지몬이 어택했을 때) 이 테이머를 레스트시키는 것으로 패의 「X항체」 카드 1장을 그 디지몬의 진화원 가장 아래에 놓을 수 있다 (was a manual no-op; the tamer rest is paid by the watcher)
sc('BT8-092::자신의 턴@그 디지몬의 진화원의 가장 아래에', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  const uid = ctx.trigger?.evtStackUid || ctx.trigger?.evt?.stackUid;
  const st = uid ? pl.battle.find(s => s.uid === uid) : null;
  const el = pl.hand.map((id, i) => i).filter(i => (C(pl.hand[i]).types || []).includes('X항체'));
  if (!st || !el.length) return;
  const i = await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: el, prompt: '진화원 가장 아래에 놓을 「X항체」 카드 선택 (취소 가능)' });
  if (i == null) return;
  const [id] = pl.hand.splice(i, 1);
  st.sources.splice(S.fdCount(st), 0, id);
  S.recomputeStackGrants(st);
});

// BT8-111 마왕몬 【진화 시】 상대의 디지몬 1마리당 자신의 덱 위에서부터 2장 파기. 이 효과로 4장 이상 파기했을 때 트래시의 퍼플 Lv.5 이하 디지몬 1장을 코스트 없이 등장시킬 수 있다 (the ≥4 gate was dropped)
sc('BT8-111::진화 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  const n = ctx.state.players[ctx.opp].battle.filter(isDig).length * 2;
  const before = pl.deck.length;
  if (n) S.trashTopOfDeck(ctx.state, ctx.self, n);
  if (before - pl.deck.length < 4) return;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', colors: ['purple'], levelMax: 5 }, rested: false, noTriggers: false, optional: true }, ctx);
});
// 【어택 시】〔턴에 1회〕 자신의 트래시 10장마다 상대의 덱을 위에서부터 3장 파기하고, 이 턴 동안 이 디지몬을 DP+3000 (the per-10 discard half was dropped)
sc('BT8-111::어택 시', async (ctx) => {
  const k = Math.floor(ctx.state.players[ctx.self].trash.length / 10);
  if (!k) return;
  S.trashTopOfDeck(ctx.state, ctx.opp, 3 * k);
  const st = me(ctx);
  if (st) S.modifyDP(ctx.state, ctx.self, st.uid, 3000 * k, 'turn');
});

// BT8-112 황제드라몬: 팔라딘 모드 — 자신의 디지몬이 패의 이 카드로 진화할 때, 자신의 트래시에서 화이트인 Lv.7의 디지몬 카드 1장을 덱 아래로 되돌리는 것으로, 지불하는 진화 코스트 -4 (optional cost; state.hookEvoCostOptions -> selfEvoOption)
(HOOKS['BT8-112'] ||= []).push({ selfEvoOption: (state, p, stack) => {
  const pl = state.players[p], ok = (id) => C(id).category === 'digimon' && C(id).level === 7 && (C(id).colors || []).includes('white');
  const el = pl.trash.map((id, i) => i).filter(i => ok(pl.trash[i]));
  if (!el.length) return null;
  return { label: '트래시의 화이트 Lv.7 디지몬 카드 1장을 덱 아래로 되돌려 진화 코스트 -4 하시겠습니까?', apply: async (choose) => {
    const i = el.length === 1 ? el[0] : await choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: el, prompt: '덱 아래로 되돌릴 화이트 Lv.7 디지몬 카드 선택' });
    if (i == null) return 0;
    const [id] = pl.trash.splice(i, 1); pl.deck.push(id);
    S.log(state, `${p} ${C(id).nameKo}을(를) 트래시에서 덱 아래로 되돌림 (${C('BT8-112').nameKo} 진화 코스트 -4)`);
    return -4;
  } };
} });

// BT9-005 고로몬 (inherited, 【상대의 턴】) 이 디지몬이 《블로커》를 가진 동안 이 디지몬을 DP+1000 (keyword-conditioned DP not parsed generically)
(HOOKS['BT9-005'] ||= []).push({ tag: '상대의 턴', has: '《블로커》를 가진 동안', src: 'inheritedKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp && (S.hasKeyword(holder, '블로커') || S.hookGrantedKeywords(state, hp, holder).includes('블로커')) ? 1000 : 0) });

// BT9-040 엔젤우몬 X항체 【진화 시】 …그 후, 이 디지몬의 진화원에 「엔젤우몬」 또는 「X항체」가 있을 때, 자신의 시큐리티가 5장 이하라면 《리커버리 +1《덱》》 (the source condition was dropped by the recovery compile)
sc('BT9-040::진화 시', async (ctx, R) => {
  await R.runOne({ op: 'grantKeyword', target: 'opponent', thisStack: false, keyword: '시큐리티어택', value: -1, duration: 'nextOpponentTurn' }, ctx);
  const st = me(ctx);
  if (!st || !st.sources.some(id => S.cardNameIs(id, '엔젤우몬') || S.cardNameIs(id, 'X항체'))) return;
  if (ctx.state.players[ctx.self].security.length <= 5) S.recoverTopOfDeckToSecurity(ctx.state, ctx.self);
});

// BT9-050 레오몬 X항체 / BT9-051 화이트레오몬 X항체 【서로의 턴】 이 디지몬이 배틀에서 소멸할 때, 이 디지몬의 진화원에서 「레오몬」 1장을 코스트를 지불하지 않고 등장시킬 수 있다 (never queued)
for (const id of ['BT9-050', 'BT9-051']) (HOOKS[id] ||= []).push({ tag: '서로의 턴', has: '진화원에서 「레오몬」', src: 'effectKo', onLeave: (state, hp, holder, cause) => cause === 'battle' && holder.sources.some(sid => C(sid).category === 'digimon' && S.cardNameIs(sid, '레오몬')) });
for (const id of ['BT9-050', 'BT9-051']) sc(id + '::서로의 턴', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  const ids = ctx.trigger?.evt?.sources || [];
  const i = pl.trash.reduce((acc, tid, k) => (ids.includes(tid) ? k : acc), -1); // (the sources were already trashed together with the deleted stack)
  if (i < 0) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '진화원의 「레오몬」을 코스트를 지불하지 않고 등장시키겠습니까?' }))) return;
  S.playFreeFromZone(ctx.state, ctx.self, 'trash', i, { fromSources: true });
});

// BT9-029/042/054 〔패〕【메인】 명칭에 「저스티몬」 또는 「라이덴몬」을 포함하는 자신의 디지몬이 있을 때, 1코스트 지불하는 것으로, 이 카드를 그 디지몬 1마리의 진화원 아래에 놓는다 (placement was a manual no-op)
for (const id of ['BT9-029', 'BT9-042', 'BT9-054']) sc(id + '::메인', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  const hi = pl.hand.lastIndexOf(ctx.sourceCardId);
  const cands = pl.battle.filter(s => isDig(s) && (S.cardNameHas(s.cardId, '저스티몬') || S.cardNameHas(s.cardId, '라이덴몬')));
  if (hi < 0 || !cands.length || !S.canPayCost(ctx.state, 1)) return;
  const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: '이 카드를 진화원 아래에 놓을 디지몬 선택' });
  const tgt = cands.find(s => s.uid === uid); if (!tgt) return;
  S.grantMemory(ctx.state, ctx.self, -1, ctx.sourceCardId);
  pl.hand.splice(hi, 1);
  tgt.sources.splice(S.fdCount(tgt), 0, ctx.sourceCardId);
  S.recomputeStackGrants(tgt);
  S.log(ctx.state, `${ctx.self} ${C(ctx.sourceCardId).nameKo}을(를) ${C(tgt.cardId).nameKo}의 진화원 아래에 놓음 (메모리 -1)`);
});

// BT9-059 테이파몬 (inherited, 【서로의 턴】) 이 디지몬이 2색 이상인 동안 이 디지몬을 DP+1000 (color-count condition not parsed generically)
(HOOKS['BT9-059'] ||= []).push({ tag: '서로의 턴', has: '2색 이상인 동안', src: 'inheritedKo', dp: (state, hp, holder, target, tp) => (target === holder && tp === hp && S.stackColors(holder).length >= 2 ? 1000 : 0) });

// ---- BT9 tamers whose trigger phrase uses "A 또는 B인 …" (the generic watcher parser skips alternatives): event hooks + explicit scripts ----
const colorsAny = (stack, ...cols) => S.stackColors(stack).some(c => cols.includes(c));
const restThen = (then) => [{ op: 'costGroup', cost: [{ op: 'restStack' }], then }];
// BT9-084 신태일&신나리 【자신의 턴】 레드 또는 옐로인 자신의 디지몬이 어택했을 때, 이 테이머를 레스트시키는 것으로, 이 턴 동안 상대의 시큐리티 디지몬 전부를 DP-2000
(HOOKS['BT9-084'] ||= []).push({ tag: '자신의 턴', has: '레드 또는 옐로인 자신의 디지몬이 어택했을 때', src: 'effectKo', events: { attack: (state, hp, holder, info) => info.owner === hp && isDig(info.stack) && colorsAny(info.stack, 'red', 'yellow') } });
SCRIPTS['BT9-084::자신의 턴@어택했을 때'] = restThen([{ op: 'securityDPMod', target: 'opponent', amount: -2000, duration: 'turn' }]);
// BT9-086 이청솔 【자신의 턴】 명칭에 「젤리몬」을 포함하거나 Lv.5 이상인 자신의 디지몬이 어택했을 때, 자신의 패가 7장 이하라면 이 테이머를 레스트시키는 것으로 《1 드로우》
(HOOKS['BT9-086'] ||= []).push({ tag: '자신의 턴', has: '젤리몬」을 포함하거나', src: 'effectKo', events: { attack: (state, hp, holder, info) => info.owner === hp && isDig(info.stack) && (S.cardNameHas(info.stack.cardId, '젤리몬') || (C(info.stack.cardId).level || 0) >= 5) } });
sc('BT9-086::자신의 턴@어택했을 때', async (ctx, R) => {
  if (ctx.state.players[ctx.self].hand.length > 7) return;
  await R.runScript(restThen([{ op: 'draw', who: 'self', n: 1 }]), ctx);
});
// BT9-087 리키&장한솔 【자신의 턴】 자신의 디지몬이 옐로 또는 그린인 디지몬으로 진화했을 때, 이 테이머를 레스트시키는 것으로, 다음 상대의 턴 종료까지 상대 디지몬 1마리를 DP-1000
(HOOKS['BT9-087'] ||= []).push({ tag: '자신의 턴', has: '옐로 또는 그린인 디지몬으로 진화했을 때', src: 'effectKo', events: { digivolve: (state, hp, holder, info) => info.owner === hp && isDig(info.stack) && colorsAny(info.stack, 'yellow', 'green') } });
SCRIPTS['BT9-087::자신의 턴@진화했을 때'] = restThen([{ op: 'modifyDP', target: 'opponent', amount: -1000, duration: 'nextOpponentTurn' }]);

// BT9-075/078/081 【진화 시】 이 디지몬의 진화원에 「X」가 있거나, 트래시에서 진화하고 있었을 때, … — the "트래시에서 진화하고 있었을 때" half was a manual yes/no prompt; now auto (stack.byEffect.from === 'trash')
const srcOrTrashEvo = (name) => (ctx) => { const st = me(ctx); return !!st && (st.sources.some(id => S.cardNameIs(id, name)) || st.byEffect?.from === 'trash'); };
sc('BT9-075::진화 시@트래시에서 진화하고 있었을 때', async (ctx, R) => {
  if (!srcOrTrashEvo('도루가몬')(ctx)) return;
  const digs = ctx.state.players[ctx.self].battle.filter(isDig); if (!digs.length) return;
  const uid = digs.length === 1 ? digs[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: digs.map(s => s.uid), prompt: '《블로커》와 《길동무》를 얻을 자신의 디지몬 선택' });
  if (!uid) return;
  S.grantKeyword(ctx.state, ctx.self, uid, '블로커', true, 'nextOpponentTurn');
  S.grantKeyword(ctx.state, ctx.self, uid, '길동무', true, 'nextOpponentTurn');
});
sc('BT9-078::진화 시@트래시에서 진화하고 있었을 때', async (ctx, R) => {
  if (!srcOrTrashEvo('도루그레몬')(ctx)) return;
  await R.runScript(R.compileToScript('Lv.4 이하의 상대 디지몬 1마리를 소멸시킨다.'), ctx);
});
sc('BT9-081::진화 시@트래시에서 진화하고 있었을 때', async (ctx, R) => {
  if (!srcOrTrashEvo('도루고라몬')(ctx)) return;
  await R.runScript(R.compileToScript('가장 Lv.이 낮은 상대 디지몬 전부를 소멸시킨다.'), ctx);
});

// BT9-074 메이쿠몬 (inherited) 【소멸 시】 이 디지몬이 2색 이상이었을 때, 메모리+2 (the color gate was dropped; uses the deleted stack's top card)
sc('BT9-074::소멸 시', async (ctx) => {
  const info = ctx.state.deletedInfo && ctx.state.deletedInfo[ctx.sourceStackUid];
  const cols = info ? C(info.cardId).colors || [] : [];
  if (cols.length >= 2) S.grantMemory(ctx.state, ctx.self, 2, ctx.sourceCardId);
});
// BT9-080 라구엘몬 【등장 시】 트래시의 퍼플 또는 옐로 DP6000 이하 디지몬 1장을 코스트 없이 등장. 시큐리티가 1장 이하일 때, 대신 트래시(문맥)의 「천사형」/「타천사형」 Lv.6 이하 1장을 등장시킬 수 있다 (the replacement pulled from HAND)
sc('BT9-080::등장 시', async (ctx, R) => {
  if (ctx.state.players[ctx.self].security.length <= 1) {
    await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['천사형', '타천사형'], levelMax: 6 }, rested: false, noTriggers: false, optional: true }, ctx);
    return;
  }
  await R.runScript(R.compileToScript('자신의 트래시에서 퍼플 또는 옐로인 DP 6000 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킨다.'), ctx);
});
// BT9-112 데크스몬 이 카드가 등장할 때, 상대 디지몬과 테이머 1장마다 지불하는 등장 코스트 -3 (from hand)
(HOOKS['BT9-112'] ||= []).push({ selfPlayDiscount: (state, p) => -3 * state.players[opp(p)].battle.filter(s => isDig(s) || C(s.cardId).category === 'tamer').length });
