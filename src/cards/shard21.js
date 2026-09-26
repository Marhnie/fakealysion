// ST1-ST6 starter-deck per-card fixes (starter audit, agent 21). See docs/starter-ST1-6.md.
//   Continuous / event abilities the generic pipeline cannot express (HOOKS) + bespoke scripts (SCRIPTS) for effects the compiler mis-compiled.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const isDigimon = (st) => S.isDigimonLike(st);
function D(id, tag, has, d, src = 'effectKo') { (HOOKS[id] ||= []).push({ tag, has, src, ...d }); }
const DI = (id, tag, has, d) => D(id, tag, has, d, 'inheritedKo');
OPS.s21_fn = async (instr, ctx) => { await instr.fn(ctx); };
const fn = (f) => ({ op: 's21_fn', fn: f });
const srcStack = (ctx) => { const pl = ctx.state.players[ctx.self]; return pl.raising?.uid === ctx.sourceStackUid ? pl.raising : pl.battle.find(s => s.uid === ctx.sourceStackUid) || null; };

// ---- ST1-11 워그레이몬 【자신의 턴】 이 디지몬이 가지는 진화원 2장마다 《시큐리티 어택 +1》
D('ST1-11', '자신의 턴', '진화원 2장마다', { kwNum: (state, hp, holder) => Math.floor((holder.sources || []).length / 2) });

// ---- ST1-12 신태일 【자신의 턴】 자신의 디지몬 전부의 DP +1000 (battle-area Digimon only; reaches Digimon that enter later)
D('ST1-12', '자신의 턴', 'DP를 +1000', { dp: (state, hp, holder, target, tp) => (tp === hp && state.players[hp].battle.includes(target) && isDigimon(target) ? 1000 : 0) });

// ---- ST3-12 리키 【상대의 턴】 자신의 시큐리티 디지몬 전부의 DP +2000 (applies to the security Digimon revealed during the opponent's attack)
D('ST3-12', '상대의 턴', '시큐리티 디지몬', { s1securityDP: (state, hp, holder, info) => (info.p === hp ? 2000 : 0) });

// ---- ST1-09 메탈그레이몬 (진화원) 【자신의 턴】 이 디지몬이 블록당했을 때, 메모리 +3  — 'blocked' is emitted by main.js when a blocker is chosen
DI('ST1-09', '자신의 턴', '블록당했을 때', { events: { blocked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
SCRIPTS['ST1-09::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 3 }];

// ---- ST3-01 코로몬... / ST3-04 파닥몬 (진화원) 【자신의 턴】[턴에 1회] 상대의 디지몬이 DP가 0이 되어 소멸했을 때 — 'delete' event carries dp0 (DP-0 rule check)
const oppDp0Delete = { delete: (state, hp, holder, info) => info.owner !== hp && !!info.dp0 };
DI('ST3-01', '자신의 턴', 'DP가 0이 되어 소멸', { limit: 1, events: oppDp0Delete });
SCRIPTS['ST3-01::자신의 턴'] = [{ op: 'modifyDP', target: 'self', thisStack: true, amount: 1000, duration: 'turn' }];
DI('ST3-04', '자신의 턴', 'DP가 0이 되어 소멸', { limit: 1, events: oppDp0Delete });
SCRIPTS['ST3-04::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: 1 }];

// ---- ST5-14 신태일 【상대의 턴】 자신의 디지몬이 《블로커》를 사용하여 레스트했을 때, 이 테이머를 레스트시키는 것으로 자신의 디지몬 1마리를 액티브로 한다
D('ST5-14', '상대의 턴', '블로커', { events: { rest: (state, hp, holder, info) => info.owner === hp && info.cause === 'block' && !!info.stack && isDigimon(info.stack) && !holder.suspended } });
SCRIPTS['ST5-14::상대의 턴'] = [fn(async (ctx) => {
  const { state } = ctx;
  const t = srcStack(ctx);
  if (!t || t.suspended) return; // the cost: this Tamer must be able to rest
  const uids = state.players[ctx.self].battle.filter(isDigimon).map(s => s.uid);
  S.restStack(state, ctx.self, t.uid, 'effect');
  if (!t.suspended) return;
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.self, uids, prompt: '액티브로 할 자신의 디지몬 1마리 선택' });
  if (uid) S.unsuspendStack(state, ctx.self, uid);
})];

// ---- ST2-03 파피몬 (진화원) 【어택 시】 Lv.5 이하인 상대의 디지몬 1마리의 진화원을, 아래에서 1장 파기한다 (the Lv. limit was dropped by the generic compiler)
SCRIPTS['ST2-03::어택 시'] = [{ op: 'trashEvoSources', target: 'opponent', stacks: 1, count: 1, from: 'bottom', filter: { levelMax: 5 }, prompt: '진화원을 파기시킬 Lv.5 이하의 상대 디지몬 선택' }];

// ---- ST2-14 소로 블루 (시큐리티) 진화원을 갖지 않은 상대의 디지몬 1마리 — 다음 자신의 턴 종료 시까지 어택과 블록을 할 수 없다
// (shard1 used the OPPONENT's next turn end; the card says "다음 자신의 턴" = the activating player's own next turn.)
SCRIPTS['ST2-14::시큐리티'] = [fn(async (ctx) => {
  const { state } = ctx;
  const uids = state.players[ctx.opp].battle.filter(s => isDigimon(s) && s.sources.length === 0 && !S.effectBlocked(state, ctx.opp, s, 'other')).map(s => s.uid);
  if (!uids.length) return;
  const uid = await ctx.choose('pickStack', { player: ctx.opp, uids, prompt: '어택과 블록을 할 수 없게 할 진화원이 없는 상대 디지몬 선택' });
  if (!uid) return;
  const until = S.durationEnd(state, 'nextOwnTurn', ctx.self);
  S.restrictAttack(state, ctx.opp, uid, until);
  const st = state.players[ctx.opp].battle.find(s => s.uid === uid);
  if (st) S.setS3Flag(st, 'noBlock', until);
})];

// ---- ST6-04 드라큐몬 【등장 시】 자신의 트래시에서, 퍼플인 사용 코스트 1 또는 7의 옵션 카드 1장을 패에 되돌릴 수 있다 (cost 1 OR 7)
SCRIPTS['ST6-04::등장 시'] = [{ op: 'returnFromTrash', who: 'self', filter: { category: 'option', colors: ['purple'], anyOf: [{ costEq: 1 }, { costEq: 7 }] } }];
