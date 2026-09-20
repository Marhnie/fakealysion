// Shard 45 — batch-1 verification fixes (BT1-/BT2-/BT3- cards). Continuous / event abilities printed under 【자신/상대/서로의 턴】
// that the generic pipeline compiled into a one-shot script that never runs (see docs/verify-sets-BT1-3.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const isTam = (st) => !!st && C(st.cardId).category === 'tamer';
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
const digs = (state, p) => state.players[p].battle.filter(isDig);
const tams = (state, p) => state.players[p].battle.filter(isTam);
const self = (target, holder, tp, hp) => target === holder && tp === hp;
const lvOf = (st) => C(st.cardId).level ?? 0;

// ---------------- DP conditional / per-count (dp hook) ----------------
// BT1-004 와냐몬(진) 진화원을 갖지 않은 상대의 디지몬이 2마리 이상 있는 동안 DP+2000
DI('BT1-004', '자신의 턴', '2마리 이상', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) && digs(state, opp(hp)).filter(s => !s.sources.length).length >= 2 ? 2000 : 0) });
// BT1-005 캬로몬(진) 자신의 시큐리티가 6장 이상 있는 동안 DP+2000
DI('BT1-005', '자신의 턴', '6장 이상', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) && state.players[hp].security.length >= 6 ? 2000 : 0) });
// BT1-008 프리몬(진) 레스트 상태인 상대의 디지몬이 2마리 이상 있는 동안 DP+2000
DI('BT1-008', '자신의 턴', '2마리 이상', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) && digs(state, opp(hp)).filter(s => s.suspended).length >= 2 ? 2000 : 0) });
// BT2-006 츠메몬(진) 이 디지몬과 같은 명칭의 다른 자신의 디지몬이 있는 동안 DP+2000
DI('BT2-006', '자신의 턴', '같은 명칭', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) && digs(state, hp).some(s => s !== holder && C(s.cardId).nameKo === C(holder.cardId).nameKo) ? 2000 : 0) });
// (BT2-001/009/017 상대의 트래시 5장 이상 DP+1000 — now handled by the generic contGrantCond "상대의 트래시가 N장 이상일 동안")
// BT1-060 홀리엔젤몬(진) 자신의 시큐리티 3장마다 DP+1000
DI('BT1-060', '자신의 턴', '3장마다', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) ? Math.floor(state.players[hp].security.length / 3) * 1000 : 0) });
// BT1-073 / BT3-048 / BT3-052 (진) 레스트 상태인 상대의 디지몬 1마리마다 DP+1000
for (const id of ['BT1-073', 'BT3-048', 'BT3-052']) DI(id, '자신의 턴', '1마리마다', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) ? digs(state, opp(hp)).filter(s => s.suspended).length * 1000 : 0) });
// BT2-041 (본체) 자신의 테이머 1명마다 DP+1000
D('BT2-041', '자신의 턴', '1명마다', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) ? tams(state, hp).length * 1000 : 0) });
// BT2-089 신태일 【상대의 턴】 블랙인 자신의 디지몬 전부의 DP+1000 (later arrivals too)
D('BT2-089', '상대의 턴', 'DP를 +1000', { dp: (state, hp, holder, t, tp) => (tp === hp && state.players[hp].battle.includes(t) && isDig(t) && S.stackColors(t).includes('black') ? 1000 : 0) });
// BT2-031 바이킹몬 【자신의 턴】 진화원을 갖지 않은 상대 디지몬이 있는 동안 DP+1000 하고 《S 어택 +1》
const vikingOn = (state, hp) => digs(state, opp(hp)).some(s => !s.sources.length);
D('BT2-031', '자신의 턴', 'DP를 +1000', { dp: (state, hp, holder, t, tp) => (self(t, holder, tp, hp) && vikingOn(state, hp) ? 1000 : 0), kwNum: (state, hp, holder) => (vikingOn(state, hp) ? 1 : 0) });

// ---------------- 《시큐리티 어택》 grants ----------------
// BT1-068 코쿠와몬(진) 이 디지몬이 Lv.6 이상일 동안 / BT3-010 즈바이거몬(진), BT3-013 듀라몬(진) Lv.7인 동안
DI('BT1-068', '자신의 턴', 'Lv.6', { kwNum: (state, hp, holder) => (lvOf(holder) >= 6 ? 1 : 0) });
for (const id of ['BT3-010', 'BT3-013']) DI(id, '자신의 턴', 'Lv.7', { kwNum: (state, hp, holder) => (lvOf(holder) === 7 ? 1 : 0) });
// BT2-038 (진) 옐로인 자신의 테이머가 3명 이상 있을 경우 《S 어택 +1》
DI('BT2-038', '자신의 턴', '3명 이상', { kwNum: (state, hp, holder) => (tams(state, hp).filter(s => S.stackColors(s).includes('yellow')).length >= 3 ? 1 : 0) });
// BT2-050 아르고몬 다른 자신의 레스트 상태의 디지몬 1마리마다 《S 어택 +1》
D('BT2-050', '자신의 턴', '1마리마다', { kwNum: (state, hp, holder) => digs(state, hp).filter(s => s !== holder && s.suspended).length });
// BT1-085 (테이머) 진화원을 4장 이상 가지는 레드인 자신의 디지몬 전부는 《S 어택 +1》
D('BT1-085', '자신의 턴', '진화원을 4장', { sAtk: (state, hp, holder, a) => (state.players[hp].battle.includes(a) && isDig(a) && a.sources.length >= 4 && S.stackColors(a).includes('red') ? 1 : 0) });
// BT3-030 Lv.4 이하인 자신의 디지몬 전부는 《재밍》
D('BT3-030', '자신의 턴', '재밍', { grantKw: (state, hp, holder, st) => (state.players[hp].battle.includes(st) && isDig(st) && lvOf(st) <= 4 ? ['재밍'] : []) });
// BT3-040 토우몬 【자신의 턴】 색은 블루로도 취급 / 【상대의 턴】 진화원을 갖지 않은 상대의 디지몬 전부 《S 어택 -1》
D('BT3-040', '자신의 턴', '블루로도', { addColors: () => ['blue'] });
D('BT3-040', '상대의 턴', '시큐리티 어택 -1', { sAtkOpp: (state, hp, holder, a) => (isDig(a) && !a.sources.length ? -1 : 0) });

// ---------------- other continuous ----------------
// BT2-058 가드로몬 【자신의 턴】 이 디지몬은 어택할 수 없다.
D('BT2-058', '자신의 턴', '어택할 수 없다', { noAttack: () => true });
// BT1-025 워그레이몬 【자신의 턴】 이 디지몬이 체크한 옵션 카드의 【시큐리티】 효과는 발휘하지 않는다.
D('BT1-025', '자신의 턴', '옵션', { suppressSecurity: (state, hp, holder, id) => C(id).category === 'option' });

// ---------------- event abilities ----------------
// BT1-012 피요몬(진) 이 디지몬이 블록당했을 때 DP+2000 / BT1-022 가루다몬(진) 블록당했을 때 《1 드로우》
DI('BT1-012', '자신의 턴', '블록당했을 때', { events: { blocked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['BT1-012::자신의 턴'] = [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 2000, duration: 'turn' }];
DI('BT1-022', '자신의 턴', '블록당했을 때', { events: { blocked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['BT1-022::자신의 턴'] = [{ op: 'draw', who: 'self', n: 1 }];
// BT1-049 래브라몬(진) 상대의 디지몬이 DP 0이 되어 소멸했을 때 《1 드로우》
DI('BT1-049', '자신의 턴', 'DP 0이 되어', { events: { delete: (state, hp, holder, info) => info.owner !== hp && !!info.dp0 } });
SCRIPTS['BT1-049::자신의 턴'] = [{ op: 'draw', who: 'self', n: 1 }];
// BT1-082 로제몬 【상대의 턴】 상대의 디지몬이 플레이어에게 어택했을 때, 이 디지몬이 레스트 상태라면 상대의 디지몬 1마리를 레스트
D('BT1-082', '상대의 턴', '플레이어에게', { events: { attackTarget: (state, hp, holder, info) => info.owner !== hp && info.targetKind === 'player' && isDig(info.stack) && !!holder.suspended } });
SCRIPTS['BT1-082::상대의 턴'] = [{ op: 'rest', target: 'opponent', n: 1, skipNextUnsuspend: false, digimonOnly: true }];
// BT2-046 메탈티라노몬(진) 배틀에서 Lv.6 이상인 상대의 디지몬만을 소멸시켰을 때 이 디지몬을 액티브
DI('BT2-046', '자신의 턴', 'Lv.6', { events: { battleWin: (state, hp, holder, info) => info.owner === hp && info.stack === holder && !!info.loser && isDig(info.loser) && lvOf(info.loser) >= 6 } });
SCRIPTS['BT2-046::자신의 턴'] = [{ op: 'unsuspend', target: 'thisStack' }];
// BT2-053 케라몬 《1 드로우》 / BT2-059 크리사리몬 메모리+1 — 이 디지몬과 같은 명칭의 다른 자신의 디지몬이 등장했을 때
const samePlay = { play: (state, hp, holder, info) => info.owner === hp && !!info.stack && info.stack !== holder && isDig(info.stack) && C(info.stack.cardId).nameKo === C(holder.cardId).nameKo };
DI('BT2-053', '자신의 턴', '같은 명칭', { events: samePlay });
SCRIPTS['BT2-053::자신의 턴'] = [{ op: 'draw', who: 'self', n: 1 }];
DI('BT2-059', '자신의 턴', '같은 명칭', { events: samePlay });
SCRIPTS['BT2-059::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];
// BT2-085 정석 【자신의 턴】 상대 디지몬의 진화원을 파기했을 때, 이 테이머를 레스트시키는 것으로 메모리+1
D('BT2-085', '자신의 턴', '진화원을 파기했을 때', { events: { sourcesTrashed: (state, hp, holder, info) => info.owner !== hp && !!info.stack && isDig(info.stack) && !holder.suspended } });
SCRIPTS['BT2-085::자신의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];
// BT3-096 이미나 【서로의 턴】 자신 또는 상대가 옵션 카드를 사용했을 때, 이 테이머를 레스트시키는 것으로 메모리+1
D('BT3-096', '서로의 턴', '옵션 카드를 사용', { events: { optionUsed: (state, hp, holder, info) => !holder.suspended } });
SCRIPTS['BT3-096::서로의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];
// BT3-092 베리얼묘티스몬 【서로의 턴】 다른 자신의 디지몬 또는 상대의 디지몬이 소멸했을 때, 소멸한 디지몬 1마리마다 메모리+1
D('BT3-092', '서로의 턴', '소멸했을 때', { events: { delete: (state, hp, holder, info) => !!info.stack && isDig(info.stack) && info.stack !== holder } });
SCRIPTS['BT3-092::서로의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];
// BT1-007 시드몬(진) 【어택 시】 이 턴에 자신이 디지몬을 1회 이상 진화시키고 있는 경우, 이 턴 동안 이 디지몬의 DP+1000
SCRIPTS['BT1-007::어택 시'] = [{ op: 'condition', if: { test: (ctx) => S.digivolvedThisTurn(ctx.state, ctx.self) >= 1 }, then: [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 1000, duration: 'turn' }], else: [] }];
// BT3-058 반쵸스팅몬 【어택 시】 DP 12000 이상의 상대 디지몬에게 어택했을 때, 이 턴 동안 DP+7000 하고 《S 어택 +2》 (target condition was dropped by the generic compiler)
const atkTarget = (ctx) => { const ac = ctx.state.attackCtx; if (!ac || ac.targetKind !== 'digimon') return null; return ctx.state.players[ctx.opp].battle.find(s => s.uid === ac.targetUid) || null; };
SCRIPTS['BT3-058::어택 시'] = [{ op: 'condition', if: { test: (ctx) => { const t = atkTarget(ctx); return !!t && S.effectiveDP(ctx.state, ctx.opp, t) >= 12000; } }, then: [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 7000, duration: 'turn' }, { op: 'grantKeyword', target: 'self', thisStack: true, keyword: '시큐리티어택', value: 2, duration: 'turn' }], else: [] }];
// BT2-112 블랙워그레이몬 【어택 시】 가장 DP가 높은 상대 디지몬에게 어택했을 때, 이 디지몬을 액티브로 한다
SCRIPTS['BT2-112::어택 시'] = [{ op: 'condition', if: { test: (ctx) => { const t = atkTarget(ctx); if (!t) return false; const mx = Math.max(...digs(ctx.state, ctx.opp).map(s => S.effectiveDP(ctx.state, ctx.opp, s))); return S.effectiveDP(ctx.state, ctx.opp, t) >= mx; } }, then: [{ op: 'unsuspend', target: 'thisStack' }], else: [] }];
// ---------------- cost modifiers printed without a turn tag (not read by the generic continuousEvoCostDiscount) ----------------
// BT2-023 쉬라몬 패의 이 카드를 등장시킬 때, 진화원을 갖지 않은 상대 디지몬 1마리마다 지불하는 진화 코스트 -1
(HOOKS['BT2-023'] ||= []).push({ selfEvoDiscount: (state, p) => -digs(state, opp(p)).filter(s => !s.sources.length).length });
// BT3-031 / BT3-111 황제드라몬: 자신의 「파일드라몬」 또는 「다이노몬」이 패의 이 카드로 진화할 때, 지불하는 진화 코스트 -2
for (const id of ['BT3-031', 'BT3-111']) (HOOKS[id] ||= []).push({ selfEvoDiscount: (state, p, stack) => (stack && isDig(stack) && (S.cardNameIs(stack.cardId, '파일드라몬') || S.cardNameIs(stack.cardId, '다이노몬')) ? -2 : 0) });
// BT2-111 베르제브몬: 자신의 트래시가 10장 이상일 동안, 자신의 「임프몬」은 패의 이 카드에 진화 조건을 무시하고 진화 코스트 4로 진화할 수 있다
(HOOKS['BT2-111'] ||= []).push({ evoTargetAlt: (state, p, stack, tid) => (stack && isDig(stack) && state.players[p].trash.length >= 10 && S.cardNameIs(stack.cardId, '임프몬') ? { cost: 4, test: (tgt) => tgt.id === tid } : null) });
// BT2-112 블랙워그레이몬: DP 10000 이상의 상대 디지몬이 있는 동안, 패의 이 카드를 등장시킬 때 지불하는 등장 코스트 -6
(HOOKS['BT2-112'] ||= []).push({ selfPlayDiscount: (state, p) => (digs(state, opp(p)).some(s => S.effectiveDP(state, opp(p), s) >= 10000) ? -6 : 0) });
