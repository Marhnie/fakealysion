// Shard 170 — unres-c audit (docs/audit-2026-09-unresolved-c.md): continuous/【서로의 턴】/【자신의 턴】/【상대의 턴】 "~했을 때" watchers whose printed trigger the generic
// watcher parsers (state.js parseWatcherTrigger / parseEventWatcher) cannot read — the segment compiled to something but NOTHING ever queued it (found by
// scripts/qa/scan-unwired-watchers.mjs). Each gets a HOOKS descriptor (event filter) + the SCRIPTS entry that runs when it fires.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const D = (id, tag, has, d, src = 'effectKo') => { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); };
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const isDig = (st) => S.isDigimonLike(st);
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
const traitIn = (id, ...ts) => (C(id).types || []).some((t) => ts.includes(t));
const findAny = (state, uid) => { for (const p of ['p1', 'p2']) { const pl = state.players[p]; const s = pl.raising?.uid === uid ? pl.raising : pl.battle.find((x) => x.uid === uid); if (s) return { p, s }; } return null; };
const unsuspendThis = [{ op: 'unsuspend', target: 'thisStack' }];
const drawOne = [{ op: 'draw', who: 'self', n: 1 }];
const evtUid = (ctx) => ctx.trigger?.evtStackUid ?? ctx.trigger?.evt?.stackUid ?? null;

// ---- BT12-041 초핫카이몬 【자신의 턴】 상대의 디지몬이 DP가 0이 되어 소멸됐을 때, 《1 드로우》 ("소멸됐을" spelling is not read by the generic watcher regex; 'delete' carries dp0)
D('BT12-041', '자신의 턴', 'DP가 0이 되어', { events: { delete: (state, hp, h, info) => info.owner !== hp && !!info.dp0 } });
SCRIPTS['BT12-041::자신의 턴'] = drawOne;

// ---- BT14-030 마린엔젤몬 【자신의 턴】[턴에 1회] 다른 디지몬이 패로 되돌아갔을 때, 《리커버리 +1《덱》》 — a Digimon that left the battle area INTO THE HAND (either side): stack._leftTo === 'hand' (set by the generic bounce ops)
D('BT14-030', '자신의 턴', '패로 되돌아갔을 때', { limit: 1, events: { leaveBattle: (state, hp, h, info) => !!info.stack && info.stack !== h && info.stack._leftTo === 'hand' && C(info.cardId).category === 'digimon' } }); // (_leftTo: set by the generic bounce ops — effects.js returnToHandStripSources, shard2/shard3 bounceStack)
SCRIPTS['BT14-030::자신의 턴'] = [{ op: 'recoverTop', who: 'self' }];

// ---- EX5-025 디아나몬 【서로의 턴】[턴에 1회] 상대의 디지몬의 진화원이 효과로 파기되었을 때, 이 디지몬을 액티브로 한다
D('EX5-025', '서로의 턴', '진화원이 효과로 파기되었을 때', { limit: 1, events: { sourcesTrashed: (state, hp, h, info) => info.owner !== hp && (info.cause === 'effect' || info.cause === 'ownEffect') && isDig(info.stack) } });
SCRIPTS['EX5-025::서로의 턴'] = unsuspendThis;

// ---- EX7-034 그랑게일몬 (진화원) 【자신의 턴】[턴에 1회] 이 디지몬이 상대의 디지몬에게 어택했을 때, 이 디지몬을 액티브로 할 수 있다 ('attackOnDigimon' = attack whose target is a Digimon)
DI('EX7-034', '자신의 턴', '상대의 디지몬에게 어택했을 때', { limit: 1, events: { attackOnDigimon: (state, hp, h, info) => info.owner === hp && info.stack === h } });
SCRIPTS['EX7-034::자신의 턴'] = unsuspendThis;

// ---- AD1-016 샤인그레이몬 【서로의 턴】[턴에 1회] 자신의 「최건우」가 등장하거나 레스트했을 때, 이 디지몬의 DP 이하의 상대 디지몬 1마리를 소멸시킬 수 있다
const choi = (state, hp, h, info) => info.owner === hp && !!info.stack && S.cardNameIs(info.stack.cardId, '최건우');
D('AD1-016', '서로의 턴', '등장하거나 레스트했을 때', { limit: 1, events: { play: choi, rest: choi } });
SCRIPTS['AD1-016::서로의 턴'] = [{ op: 'destroy', target: 'opponent', mode: 'choose', optional: true, filter: { dpMaxSelf: true } }];

// ---- BT26-057 베어캣몬 【서로의 턴】[턴 1회] 어택의 대상이 변경되었거나 자신의 테이머 아래의 카드가 효과로 파기되었을 때, 이 디지몬을 액티브로 할 수 있다
D('BT26-057', '서로의 턴', '어택의 대상이 변경되었거나', { limit: 1, events: {
  redirect: () => true,
  sourcesTrashed: (state, hp, h, info) => info.owner === hp && (info.cause === 'effect' || info.cause === 'ownEffect') && isTam(info.stack),
} });
SCRIPTS['BT26-057::서로의 턴'] = unsuspendThis;

// ---- BT9-085 매튜&한소라 【자신의 턴】 블루 또는 레드인 자신의 디지몬이 액티브 상태가 되었을 때, 이 테이머를 레스트시키는 것으로, Lv.3인 상대의 디지몬 1마리를 패로 되돌린다 ("A 또는 B인" colour alternative is not read by the generic parser)
const bt9085 = (state, hp, h, info) => info.owner === hp && !h.suspended && isDig(info.stack) && S.stackColors(info.stack).some((c) => c === 'blue' || c === 'red');
D('BT9-085', '자신의 턴', '액티브 상태가 되었을 때', { events: { active: bt9085, unsuspend: bt9085 } });
SCRIPTS['BT9-085::자신의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'returnToHandStripSources', target: 'opponent', n: 1, filter: { level: 3 }, requireSuspended: null, dest: 'hand' }], costText: '이 테이머를 레스트시키는', thenText: 'Lv.3인 상대의 디지몬 1마리를 패로 되돌린다.' }];

// ---- BT10-076 트루프몬 【상대의 턴】〔턴에 1회〕 상대의 디지몬 또는 테이머가 등장했을 때, 이 디지몬의 진화원을 선택하여 1장 파기하는 것으로 메모리+1 ("또는" subject)
D('BT10-076', '상대의 턴', '상대의 디지몬 또는 테이머가 등장했을 때', { limit: 1, events: { play: (state, hp, h, info) => info.owner !== hp && !!info.stack && (C(info.stack.cardId).category === 'digimon' || C(info.stack.cardId).category === 'tamer') } });
SCRIPTS['BT10-076::상대의 턴'] = [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, choose: true }], then: [{ op: 'gainMemory', who: 'self', n: 1 }], costText: '이 디지몬의 진화원을 선택하여 1장 파기하는', thenText: '메모리+1.' }];

// ---- RB1-011 젤리몬 (진화원) 【자신의 턴】[턴에 1회] 자신의 패가 자신의 효과로 파기되었을 때, 메모리 +1
DI('RB1-011', '자신의 턴', '자신의 효과로 파기되었을 때', { limit: 1, events: { discard: (state, hp, h, info) => info.owner === hp && info.cause === 'effect' && state._fxSrc?.player === hp } });
SCRIPTS['RB1-011::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];

// ---- RB1-033 이청솔 (a) 【서로의 턴】「젤리몬」이 기술되어 있는 자신의 디지몬 또는 Lv.5 이상의 상대의 디지몬이 어택했을 때, 자신의 패가 7장 이하라면, 이 테이머를 레스트시키는 것으로, 《1 드로우》
//                  (b) 【자신의 턴】 이 테이머가 액티브가 되었을 때, 메모리 +1
D('RB1-033', '서로의 턴', '이 테이머를 레스트시키는 것으로', { events: { attack: (state, hp, h, info) => !h.suspended && isDig(info.stack)
  && ((info.owner === hp && S.cardMentions(info.stack.cardId, '젤리몬')) || (info.owner !== hp && (C(info.stack.cardId).level || 0) >= 5)) } });
SCRIPTS['RB1-033::서로의 턴'] = [{ op: 'condition', if: { test: (ctx) => ctx.state.players[ctx.self].hand.length <= 7 }, then: [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: drawOne, costText: '이 테이머를 레스트시키는', thenText: '《1 드로우》.' }], else: [] }];
const rb1033b = (state, hp, h, info) => info.owner === hp && info.stack === h;
D('RB1-033', '자신의 턴', '이 테이머가 액티브가 되었을 때', { events: { active: rb1033b, unsuspend: rb1033b } });
SCRIPTS['RB1-033::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];

// ---- BT24-020 쉬라몬 (진화원) 【자신의 턴】[턴에 1회] 이 디지몬이 액티브가 되었을 때, 자신의 패가 7장 이하라면, 《1 드로우》 (generic watcher found it but dropped it as EW_UNSAFE "…라면" — trusted now that it has a script)
DI('BT24-020', '자신의 턴', '액티브가 되었을 때', { ewTrusted: true });
SCRIPTS['BT24-020::자신의 턴'] = [{ op: 'condition', if: { test: (ctx) => ctx.state.players[ctx.self].hand.length <= 7 }, then: drawOne, else: [] }];

// ---- BT26-068 데블몬 【서로의 턴】[턴 1회] 효과로 상대의 패가 늘어났을 때, 자신의 패를 1장 파기하는 것으로, 상대는 자신의 패를 1장 파기한다 (EW_UNSAFE "하는 것으로"; the generic compile also made the opponent's discard the acting player's own)
D('BT26-068', '서로의 턴', '효과로 상대의 패가 늘어났을 때', { ewTrusted: true });
SCRIPTS['BT26-068::서로의 턴'] = [{ op: 'costGroup', cost: [{ op: 'trashHand', who: 'self', n: 1 }], then: [{ op: 'trashHand', who: 'opponent', n: 1 }], costText: '자신의 패를 1장 파기하는', thenText: '상대는 자신의 패를 1장 파기한다.' }];

// ---- BT11-087 리리스몬 【상대의 턴】 상대의 디지몬이 육성 에어리어에서 이동했을 때, 이 디지몬의 진화원을 선택하여 1장 파기하는 것으로, 턴 종료까지 그 디지몬에게 「【어택 시】 메모리 -3.」의 효과를 준다 (EW_UNSAFE + "그 디지몬" grant compiled to a manual note)
D('BT11-087', '상대의 턴', '육성 에어리어에서 이동했을 때', { ewTrusted: true });
OPS.s170_grantAtkMem = async (instr, ctx) => {
  const f = findAny(ctx.state, evtUid(ctx)); if (!f) return;
  (f.s.s2Granted = f.s.s2Granted || []).push({ trigger: 'attack', label: '메모리 -3.', until: ctx.state.turnNumber });
  S.log(ctx.state, `${f.p} ${C(f.s.cardId).nameKo}에게 효과 부여: 메모리 -3.`);
};
SCRIPTS['BT11-087::상대의 턴'] = [{ op: 'costGroup', cost: [{ op: 'trashEvoSources', target: 'self', thisStack: true, count: 1, choose: true }], then: [{ op: 's170_grantAtkMem' }], costText: '이 디지몬의 진화원을 선택하여 1장 파기하는', thenText: '턴 종료까지 그 디지몬에게 「【어택 시】 메모리 -3.」의 효과를 준다.' }];

// ---- BT7-016 카이젤그레이몬 【자신의 턴】〔턴에 1회〕 이 디지몬이 블록당했을 때 (script existed in shard31 but the "블록당했을" trigger was never wired)
D('BT7-016', '자신의 턴', '블록당했을 때', { limit: 1, events: { blocked: (state, hp, h, info) => info.owner === hp && info.stack === h } });

// ---- BT23-059 저스티몬: 블리츠 암 【서로의 턴】[턴 1회] 배틀 에어리어의 옵션 카드가 파기되었을 때 (script existed in shard13; either player's placed Option leaving by 'delete' or a 《딜레이》 discard)
const optGone = (state, hp, h, info) => !!info.stack && C(info.stack.cardId).category === 'option';
D('BT23-059', '서로의 턴', '옵션 카드가 파기되었을 때', { limit: 1, events: { delete: optGone, optionTrashed: optGone } });

// ---- BT13-007 위그드라실_7D6 (진화원) [육성]【자신의 턴】[턴에 1회] 특징 「로얄 나이츠」를 가진 옵션 카드가 배틀 에어리어에 놓였을 때, 메모리 +1
DI('BT13-007', '자신의 턴', '배틀 에어리어에 놓였을 때', { limit: 1, events: { optionPlaced: (state, hp, h, info) => info.owner === hp && !!info.stack && C(info.stack.cardId).category === 'option' && traitIn(info.stack.cardId, '로얄 나이츠') } });
SCRIPTS['BT13-007::자신의 턴@배틀 에어리어에 놓였을 때'] = [{ op: 'gainMemory', who: 'self', n: 1 }];

// ---- BT15-081 리바이어몬 X항체 [트래시]【서로의 턴】 상대의 디지몬/테이머가 효과로 등장했을 때, 자신의 「리바이어몬」 또는 진화원에 「X항체」가 있는 자신의 디지몬 1마리를 이 카드로 코스트를 지불하지 않고 진화시킬 수 있다
//      (a trash-zone watcher: nothing scanned the trash for it)
D('BT15-081', '서로의 턴', '효과로 등장했을 때', { zone: 'trash', events: { play: (state, hp, h, info) => info.owner !== hp && info.cause === 'effect' && !!info.stack && (C(info.stack.cardId).category === 'digimon' || C(info.stack.cardId).category === 'tamer') } });
SCRIPTS['BT15-081::서로의 턴'] = [{ op: 's8_evolve', subject: 'pickOwn', zones: ['trash'], free: true,
  pred: (ctx, s) => C(s.cardId).nameKo === '리바이어몬' || (s.sources || []).some((id) => traitIn(id, 'X항체')),
  card: (id) => id === 'BT15-081' }];

// ---- BT17-037 라이즈그레이몬 (진화원) 【서로의 턴】[턴에 1회] 옐로/레드인 자신의 테이머가 소멸했을 때, 자신의 트래시에서 「최건우」 1장을 시큐리티 위에 놓는다 (watcher fired; the sentence compiled to nothing)
SCRIPTS['BT17-037::서로의 턴'] = [{ op: 'placeSecurity', who: 'self', zones: ['trash'], filter: { exactAny: ['최건우'] }, position: 'top' }];

// ---- BT24-021 / BT26-066 / BT26-069 (진화원) 【자신의 턴】[턴 1회] 자신의 패가 파기되었을 때, 특징 「타이탄족」(…)을 가진 이 디지몬을 트래시의 「타이타몬」/특징 「타이탄족」 디지몬 카드로 진화 코스트 -1 하여 진화시킬 수 있다 (watcher fired; manual only)
const hostHas = (ctx, ...ts) => { const f = findAny(ctx.state, ctx.sourceStackUid); return !!f && ts.some((t) => traitIn(f.s.cardId, t)); };
const titanEvo = (traits) => [{ op: 's8_if', test: (ctx) => hostHas(ctx, ...traits), then: [{ op: 's8_evolve', subject: 'this', zones: ['trash'], delta: -1,
  card: (id) => C(id).category === 'digimon' && (C(id).nameKo === '타이타몬' || traitIn(id, '타이탄족')) }] }];
SCRIPTS['BT24-021::자신의 턴'] = titanEvo(['귀인형', '타이탄족']);
SCRIPTS['BT26-066::자신의 턴'] = titanEvo(['타이탄족']);
SCRIPTS['BT26-069::자신의 턴'] = titanEvo(['타이탄족']);

// ---- BT25-065 모노드라몬 【자신의 턴】 이 디지몬이 플레이어에게 어택했을 때, 메모리 -2 (only its OTHER line, 【서로의 턴】 레스트했을 때 《1 드로우》, was read; 'attackTarget' carries the declared target kind)
D('BT25-065', '자신의 턴', '플레이어에게 어택했을 때', { events: { attackTarget: (state, hp, h, info) => info.owner === hp && info.stack === h && info.targetKind === 'player' } });
SCRIPTS['BT25-065::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: -2 }];

// ---- "A했을 때, 또는 B했을 때" two-clause triggers: the generic parser read only clause A and left "또는 B…" as the effect text (found by the 'effect starts with 또는' scan check)
// BT26-049 로제몬 【서로의 턴】[턴 1회] 상대의 디지몬/테이머가 레스트했을 때, 또는 자신의 테이머 아래의 카드가 효과로 파기되었을 때 (script in shard14; clause B was never wired)
D('BT26-049', '서로의 턴', '또는 자신의 테이머 아래의 카드가 효과로 파기되었을 때', { limit: 1, events: {
  rest: (state, hp, h, info) => info.owner !== hp && !!info.stack && (isDig(info.stack) || isTam(info.stack)),
  sourcesTrashed: (state, hp, h, info) => info.owner === hp && (info.cause === 'effect' || info.cause === 'ownEffect') && isTam(info.stack),
} });
// BT17-099 일륜의 각성 【서로의 턴】 자신의 테이머가 소멸했을 때 또는 패로 되돌아갔을 때, 《딜레이》. ·자신의 디지몬 1마리를 패의 명칭에 「샤인그레이몬」을 포함하는 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.
//   (clause A queued a garbled "또는 패로 되돌아갔을 때, 《딜레이》" text and clause B — a tamer returned to hand — was never wired)
const tamerGone = (state, hp, h, info) => info.owner === hp && isTam(info.stack) && state.turnNumber > h.placedTurn;
D('BT17-099', '서로의 턴', '소멸했을 때 또는 패로 되돌아갔을 때', { events: { delete: tamerGone, leaveBattle: (state, hp, h, info) => info.stack?._leftTo === 'hand' && tamerGone(state, hp, h, info) } });
SCRIPTS['BT17-099::서로의 턴'] = [{ op: 's8_delaySelf', then: [{ op: 's8_evolve', subject: 'pickOwn', zones: ['hand'], free: true, card: (id) => C(id).category === 'digimon' && C(id).nameKo.includes('샤인그레이몬') }] }];

// ---- AD1-025 오메가몬 【서로의 턴】[턴에 1회] 상대의 디지몬이 배틀 에어리어를 벗어났을 때, 배틀 에어리어의 상대의 옵션 카드 1장을 파기하고, 상대의 시큐리티를 위에서부터 1장 파기한다.
//   (open-d: the generic compiler read only the security half — "배틀 에어리어의 상대의 옵션 카드 1장을 파기" compiled to nothing, so the option was never destroyed; the hook itself is in shard8)
OPS.s170_destroyOppOption = async (instr, ctx) => {
  const { state } = ctx, opp = ctx.opp, pl = state.players[opp];
  const opts = pl.battle.filter((s) => C(s.cardId).category === 'option');
  if (!opts.length) return;
  let pick = opts[0];
  if (opts.length > 1) { const uid = await ctx.choose('pickStack', { player: ctx.self, uids: opts.map((s) => s.uid), prompt: '파기할 배틀 에어리어의 상대의 옵션 카드 선택', required: true }); pick = opts.find((s) => s.uid === uid) || opts[0]; }
  S.deleteStack(state, opp, pick.uid, 'trash', 'effect');
};
SCRIPTS['AD1-025::서로의 턴'] = [{ op: 's170_destroyOppOption' }, { op: 'removeSecurity', who: 'opponent', position: 'top' }];
