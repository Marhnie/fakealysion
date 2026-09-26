// Shard 46 — batch-9 verification fixes (BT25-/BT26-/RB1-/AD1- cards; docs/verify-sets-BT25-BT26-RB1-AD1.md).
// (batch 9 would be shard39 by the numbering rule, but shard39 was taken by another batch: this file is registered as s46.)
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const digs = (state, p) => state.players[p].battle.filter(s => S.isDigimonLike(s));
const tams = (state, p) => state.players[p].battle.filter(s => C(s.cardId).category === 'tamer');
const fn = (f) => ({ op: 's46_fn', fn: f });
OPS.s46_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const memOf = (state, p) => (p === 'p1' ? state.memory : -state.memory);
const mentionsName = (id, n) => C(id).nameKo.includes(n) || `${C(id).effectKo || ''}\n${C(id).inheritedKo || ''}`.replace(/〈룰〉[^\n]*/g, '').includes(`「${n}」`);
const tamerColorCount = (state, p) => new Set(tams(state, p).flatMap((s) => S.stackColors(s))).size;
const evtStack = (ctx) => { const u = ctx.trigger?.evtStackUid; return u ? findStack(ctx.state, ctx.self, u) || findStack(ctx.state, opp(ctx.self), u) : null; };

async function pickOne(ctx, who, stacks, prompt) {
  if (!stacks.length) return null;
  if (stacks.length === 1) return stacks[0];
  const uid = await ctx.choose('pickStack', { player: who, uids: stacks.map((s) => s.uid), prompt });
  return stacks.find((s) => s.uid === uid) || null;
}
async function ask(ctx, prompt) { return !!(await ctx.choose('confirmEffect', { player: ctx.self, prompt })); }
// place a card face-down at the BOTTOM of a stack's sources (the face-down block sits below the face-up sources)
function putFaceDown(st, id) { st.sources.unshift(id); st.s5fd = S.fdCount(st) + 1; st.s5fdFlag = true; S.recomputeStackGrants(st); }

// ------------------------------------------------------------------ BT25-008 【이동 시】【등장 시】 discard up to 2 (일리아스/TS) → draw as many as were discarded
SCRIPTS['BT25-008::이동 시'] = [{ op: 'costGroup', cost: [{ op: 'moveEach', who: 'self', from: ['hand'], groups: [{ filter: { traitAny: ['일리아스', 'TS'] }, max: 2, label: '특징 「일리아스」/「TS」를 가진 카드' }], dest: 'trash', ordered: false, upTo: true }], then: [{ op: 'draw', who: 'self', n: 1, per: { kind: 'moved', size: 1 } }] }];

// ------------------------------------------------------------------ BT25-012 그리즈몬: one own 수/짐승-포함 or 신인형/TS digimon gets 《돌진》 AND DP +3000 (same digimon)
sc('BT25-012::등장 시', async (ctx) => {
  const pr = S.cardDescPredicate('특징으로 「수」/「짐승」을 포함하거나 특징 「신인형」/「TS」를 가진');
  const cands = digs(ctx.state, ctx.self).filter((s) => pr && pr(C(s.cardId)));
  const t = await pickOne(ctx, ctx.self, cands, '《돌진》과 DP +3000을 얻을 디지몬 선택');
  if (!t) return;
  S.grantKeyword(ctx.state, ctx.self, t.uid, '돌진', true, 'turn');
  S.modifyDP(ctx.state, ctx.self, t.uid, 3000, 'turn');
});

// ------------------------------------------------------------------ BT25-076 데스몬: destroy the opponent digimon with the LOWEST 등장 코스트; if none was destroyed, trash opp security top
sc('BT25-076::등장 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  const list = digs(state, o);
  let destroyed = false;
  if (list.length) {
    const low = Math.min(...list.map((s) => S.effectiveCost(state, s)));
    const t = await pickOne(ctx, o, list.filter((s) => S.effectiveCost(state, s) === low), '소멸시킬 디지몬 선택 (등장 코스트가 가장 낮은 디지몬)');
    if (t) { S.deleteStack(state, o, t.uid, 'trash', 'effect'); destroyed = !state.players[o].battle.includes(t); }
  }
  if (!destroyed) await R.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx);
});

// ------------------------------------------------------------------ AD1-014 메탈가루몬: 상대 Lv.5 이하 소멸 → 자신의 테이머 2색마다 상대 디지몬/테이머 1마리(명) 레스트 불가
sc('AD1-014::등장 시', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const lv5 = digs(state, o).filter((s) => (C(s.cardId).level ?? 99) <= 5);
  const t = await pickOne(ctx, o, lv5, '소멸시킬 디지몬 선택 (Lv.5 이하)');
  if (t) S.deleteStack(state, o, t.uid, 'trash', 'effect');
  const n = Math.floor(tamerColorCount(state, ctx.self) / 2);
  const until = S.durationEnd(state, 'opponentTurn', ctx.self);
  const picked = [];
  for (let i = 0; i < n; i++) {
    const cand = state.players[o].battle.filter((s) => ['digimon', 'tamer'].includes(C(s.cardId).category) && !picked.includes(s));
    const p = await pickOne(ctx, o, cand, '레스트할 수 없게 될 디지몬/테이머 선택');
    if (!p) break;
    picked.push(p); S.preventRest(state, o, p.uid, until);
  }
});

// ------------------------------------------------------------------ AD1-017 듀나스몬 【시큐리티】(inherited): 상대 디지몬 1마리 《S 어택 +1》(턴 종료까지) → 그 후 자신의 턴 종료까지 상대 디지몬 1마리 DP -3000
sc('AD1-017::시큐리티', async (ctx) => {
  const { state } = ctx, o = opp(ctx.self);
  const a = await pickOne(ctx, o, digs(state, o), '《S 어택 +1》을 부여할 디지몬 선택');
  if (a) S.grantKeyword(state, o, a.uid, '시큐리티어택', 1, 'turn');
  const b = await pickOne(ctx, o, digs(state, o), 'DP -3000 (자신의 턴 종료까지)을 줄 디지몬 선택');
  if (b) S.modifyDP(state, o, b.uid, -3000, 'ownTurn');
});
// 등장 코스트 -5 when 4+ cards in own trash mention 「루체몬」/「윗체르니」
hk('AD1-017', { tag: '__handPlay', selfPlayDiscount: (state, hp) => { const pr = S.cardDescPredicate('「루체몬」/「윗체르니」가 기술되어 있는'); return pr && state.players[hp].trash.filter((id) => pr(C(id))).length >= 4 ? -5 : 0; } });

// ------------------------------------------------------------------ BT25-077 바쿠스몬 【서로의 턴】: rest 1 digimon (optional); then if the event digimon entered BY EFFECT → destroy opp's lowest-DP digimon
sc('BT25-077::서로의 턴', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self);
  const entries = [...digs(state, ctx.self), ...digs(state, o)].filter((s) => !s.suspended).map((s) => ({ player: S.ownerOfStack(state, s), uid: s.uid }));
  if (entries.length) {
    const picked = await ctx.choose('pickStackAnySide', { entries, prompt: '레스트시킬 디지몬 선택 (자신/상대 무관, 취소 = 하지 않음)' });
    if (picked && picked.uid) S.restStack(state, picked.player, picked.uid);
  }
  const c = ctx.trigger?.evtCause;
  if (c === 'effect' || c === 'ownEffect') await R.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { extreme: { stat: 'dp', dir: 'min' } } }, ctx);
});
// 등장 코스트 -5 when the digimon Lv. total (both sides) is 12+
hk('BT25-077', { tag: '__handPlay', selfPlayDiscount: (state) => (['p1', 'p2'].reduce((n, p) => n + digs(state, p).reduce((m, s) => m + (C(s.cardId).level || 0), 0), 0) >= 12 ? -5 : 0) });

// ------------------------------------------------------------------ BT26-045 그랜쿠가몬: 등장 코스트 -4 while own hand is smaller than the opponent's; 【자신의 턴】 곤충형/타이탄족 own digimon get 《연계》《관통》《볼텍스》
hk('BT26-045', { tag: '__handPlay', selfPlayDiscount: (state, hp) => (state.players[hp].hand.length < state.players[opp(hp)].hand.length ? -4 : 0) }); // slice6 G261: the card being declared is still in hand and counts (equal sizes -> no discount)
hk('BT26-045', { tag: '자신의 턴', has: '《연계》', grantKw: (state, hp, h, t) => (C(t.cardId).category === 'digimon' && S.ownerOfStack(state, t) === hp && (C(t.cardId).types || []).some((x) => x === '곤충형' || x === '타이탄족') ? ['연계', '관통', '볼텍스'] : []) });

// ------------------------------------------------------------------ BT26-015 부텐몬: 【자신의 턴】 [턴1회] 덱이 자신의 효과로 늘어났을 때: own digimon 1 DP +3000 & may attack with it; inherited 【서로의 턴】: 「크로노몬」 기술 디지몬 액티브
sc('BT26-015::자신의 턴', async (ctx) => {
  const { state } = ctx;
  const t = await pickOne(ctx, ctx.self, digs(state, ctx.self), 'DP +3000을 얻고 어택할 디지몬 선택');
  if (!t) return;
  S.modifyDP(state, ctx.self, t.uid, 3000, 'opponentTurn');
  // official Q&A 6972: the Digimon boosted by this effect attacks whenever possible -- not an optional prompt.
  if (!t.suspended && ctx.startAttack) ctx.startAttack(ctx.self, t.uid);
});
sc('BT26-015::서로의 턴', async (ctx) => {
  const st = me(ctx);
  if (st && st.suspended && mentionsName(st.cardId, '크로노몬') && await ask(ctx, `${C(st.cardId).nameKo}을(를) 액티브로 할까요?`)) S.unsuspendStack(ctx.state, ctx.self, st.uid);
});

// ------------------------------------------------------------------ BT26-017 황금무사몬: one own 샴발라 digimon gets 《S 어택 +1》 and 《프로그레스》 until turn end
sc('BT26-017::등장 시', async (ctx) => {
  const t = await pickOne(ctx, ctx.self, digs(ctx.state, ctx.self).filter((s) => (C(s.cardId).types || []).includes('샴발라')), '《S 어택 +1》/《프로그레스》를 얻을 샴발라 디지몬 선택');
  if (!t) return;
  S.grantKeyword(ctx.state, ctx.self, t.uid, '시큐리티어택', 1, 'turn');
  S.grantKeyword(ctx.state, ctx.self, t.uid, '프로그레스', true, 'turn');
});

// ------------------------------------------------------------------ 테이머: 덱 위에서 이 테이머 아래에 뒷면
// BT25-090 차내일 【서로의 턴】 (tamer rested as the cost by the event queue): deck top 2 → face-down under this tamer
sc('BT25-090::서로의 턴', async (ctx) => {
  const st = me(ctx), pl = ctx.state.players[ctx.self];
  if (!st || !(await ask(ctx, '덱 위에서부터 2장을 뒷면으로 이 테이머 아래에 놓을까요?'))) return;
  for (let i = 0; i < 2 && pl.deck.length; i++) putFaceDown(st, pl.deck.shift());
});
// BT26-093 이레나 【서로의 턴】: deck top 1 face-down under this tamer; then 비트브레이크 own digimon 1 gets 《충돌》《블로커》
sc('BT26-093::서로의 턴', async (ctx) => {
  const { state } = ctx, st = me(ctx), pl = state.players[ctx.self];
  if (st && pl.deck.length) putFaceDown(st, pl.deck.shift());
  const t = await pickOne(ctx, ctx.self, digs(state, ctx.self).filter((s) => (C(s.cardId).types || []).includes('비트브레이크')), '《충돌》《블로커》를 얻을 비트브레이크 디지몬 선택');
  if (!t) return;
  S.grantKeyword(state, ctx.self, t.uid, '충돌', true, 'turn');
  S.grantKeyword(state, ctx.self, t.uid, '블로커', true, 'turn');
});

// ------------------------------------------------------------------ RB1
// RB1-015 후우마몬 【진화 시】: opp digimon with DP ≤ this DP: top 3 sources trashed; then opp digimon w/o sources can't attack until opp turn end
sc('RB1-015::진화 시', async (ctx, R) => {
  const { state } = ctx, o = opp(ctx.self), self = me(ctx);
  const dp = self ? S.effectiveDP(state, ctx.self, self) : 0;
  const t = await pickOne(ctx, o, digs(state, o).filter((s) => S.effectiveDP(state, o, s) <= dp), '진화원을 파기시킬 디지몬 선택 (이 디지몬의 DP 이하)');
  if (t) S.trashEvoSources(state, o, t.uid, Math.min(3, t.sources.length), 'top');
  await R.runOne({ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: 'opponentTurn', filter: { noSources: true } }, ctx);
});
// RB1-025 딜비트몬 【자신의 턴 종료 시】: attack an opponent DIGIMON with own digimon that mentions 「앙고라몬」
sc('RB1-025::자신의 턴 종료 시', async (ctx) => {
  const { state } = ctx;
  const c = digs(state, ctx.self).filter((s) => !s.suspended && mentionsName(s.cardId, '앙고라몬'));
  const t = await pickOne(ctx, ctx.self, c, '상대의 디지몬에게 어택할 디지몬 선택 (「앙고라몬」이 기술되어 있는 디지몬)');
  if (t && ctx.startAttack && await ask(ctx, `${C(t.cardId).nameKo}(으)로 상대의 디지몬에게 어택할까요?`)) ctx.startAttack(ctx.self, t.uid, undefined, { digimonOnly: true });
});
// RB1-032 은하준 【자신의 턴】 (tamer rested by the event queue): the digivolved 「감마몬」 digimon gets DP +2000 until turn end
sc('RB1-032::자신의 턴', async (ctx) => {
  const t = evtStack(ctx);
  if (t) S.modifyDP(ctx.state, ctx.self, t.uid, 2000, 'turn');
});
// RB1-035 은성일 【서로의 턴】 (tamer rested): the opp digimon that entered: Lv.4+ → memory +1; Lv.3 → draw 1
sc('RB1-035::서로의 턴', async (ctx) => {
  const lv = ctx.trigger?.evtSnap?.level ?? (evtStack(ctx) ? C(evtStack(ctx).cardId).level : null);
  // QA-W6 Q3453/3454: simultaneous entrants (one instruction) share this single trigger: Lv.4+ anywhere -> memory +1 once, Lv.3 anywhere -> draw once, both if both kinds entered
  const lvs = [lv, ...((ctx.trigger?.evtSnapsExtra || []).map((x) => x.level))].filter((x) => x != null);
  if (!lvs.length) return;
  if (lvs.some((x) => x >= 4)) S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
  if (lvs.some((x) => x === 3)) S.drawCards(ctx.state, ctx.self, 1);
});

// ------------------------------------------------------------------ AD1-019 매튜&리키 【자신의 턴】 (tamer rested): play 1 「어드벤처」 card from hand, play cost -1 per 2 of own tamers' colors
sc('AD1-019::자신의 턴', async (ctx, R) => {
  const delta = -Math.floor(tamerColorCount(ctx.state, ctx.self) / 2);
  await R.runOne({ op: 's8_playOrUse', zones: ['hand'], kinds: ['digimon', 'tamer'], delta, pred: (id) => (C(id).types || []).includes('어드벤처') }, ctx);
});

// ------------------------------------------------------------------ BT26-078 케루비몬 [트래시]【자신의 턴】 (queued by state.queueTrashZoneEventTriggers): opp memory ≥5 → this card to deck bottom → the played digimon gets 《속공》《에그제큐트》
sc('BT26-078::자신의 턴', async (ctx) => {
  const { state } = ctx, pl = state.players[ctx.self];
  if (memOf(state, opp(ctx.self)) < 5) return;
  const i = pl.trash.lastIndexOf(ctx.sourceCardId);
  const t = evtStack(ctx);
  if (i < 0 || !t) return;
  if (!(await ask(ctx, '이 카드를 덱 아래로 되돌려 등장한 디지몬에게 《속공》《에그제큐트》를 부여할까요?'))) return;
  pl.trash.splice(i, 1); pl.deck.push(ctx.sourceCardId);
  S.grantKeyword(state, ctx.self, t.uid, '속공', true, 'turn');
  S.grantKeyword(state, ctx.self, t.uid, '에그제큐트', true, 'turn');
});

// ------------------------------------------------------------------ 진화원/테이머 아래 카드 파기 이벤트 (S 'sourcesTrashed': { owner, stack, cause, ids, fdGone })
// BT26-002 버드몬 (inherited 【자신의 턴】 [턴1회]): a card under own Tamer trashed by an effect → 《1 드로우》 (generic compile draws)
hk('BT26-002', { tag: '자신의 턴', src: 'inheritedKo', has: '테이머 아래', limit: 1, events: { sourcesTrashed: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && !!info.stack && C(info.stack.cardId).category === 'tamer' } });
// BT26-048 블룸로드몬 【서로의 턴】: a FACE-DOWN source of an own digimon trashed by an effect → opp digimon DP -6000
hk('BT26-048', { tag: '서로의 턴', has: '뒷면인 진화원', events: { sourcesTrashed: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && (info.fdGone || 0) > 0 && !!info.stack && C(info.stack.cardId).category === 'digimon' } });

// RB1-013 테슬라젤리몬 (inherited 【자신의 턴】 [턴1회]): own hand discarded by an OWN effect → 메모리 +1 (generic compile gains the memory)
hk('RB1-013', { tag: '자신의 턴', src: 'inheritedKo', has: '파기되었을', limit: 1, events: { discard: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && state._fxSrc?.player === hp } });


// BT26-051 트래쉬몬 【자신의 턴】 [턴1회] 이 디지몬이 링크했을 때 (S 'linked' event: { owner, stack, linkCardId }): 소셜/툴/개방/세븐 코드 own digimon 1 gets 《충돌》 + DP +3000 (generic compile)
hk('BT26-051', { tag: '자신의 턴', has: '링크했을 때', limit: 1, events: { linked: (state, hp, h, info) => info.owner === hp && info.stack === h } });
