// Shard 22 — starter decks ST7-ST12 verified sentence-by-sentence against the printed text (docs/starter-ST7-12.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const meOf = (ctx) => stacksOf(ctx.state, ctx.self).find(s => s.uid === ctx.sourceStackUid) || null;

// ST10-06 마스테몬 【진화 시】 자신의 트래시에서 옐로 또는 퍼플인 디지몬 카드 1장을 자신의 시큐리티 위에 뒤집어서 놓는다.
// 조그레스 진화하고 있었을 때, 자신의 시큐리티를 모두 확인하여, 그중 Lv.5 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다. 그 후, 자신의 시큐리티를 셔플한다.
SCRIPTS['ST10-06::진화 시'] = [
  { op: 'placeSecurity', who: 'self', zones: ['trash'], position: 'top', faceUp: false, filter: { category: 'digimon', colors: ['yellow', 'purple'] } },
  { op: 'condition', if: { test: (ctx) => !!meOf(ctx)?.viaFusion },
    then: [{ op: 'secLook', who: 'self', action: 'play', optional: true, filter: { category: 'digimon', levelMax: 5 }, ifTaken: [], ifCard: [] }], else: [] },
  { op: 'shuffleSecurity', who: 'self' },
];

// ST10-06 【서로의 턴】 효과로 자신의 다른 디지몬이 등장했을 때, 등장한 디지몬의 Lv. 이하인 상대 디지몬 1마리를 소멸시킨다.
// (the watcher itself is queued by the generic path; only the Lv. bound comes from the snapshot of the Digimon that entered play)
OPS.s22_destroyLvLE = async (instr, ctx, H) => {
  const lv = ctx.trigger?.evt?.lv ?? ctx.trigger?.evtSnap?.level;
  if (lv == null) return;
  await H.runScript([{ op: 'destroy', target: 'opponent', mode: 'choose', filter: { levelMax: lv } }], ctx);
};
SCRIPTS['ST10-06::서로의 턴'] = [{ op: 's22_destroyLvLE' }];
HOOKS['ST10-06'] = [{ tag: '서로의 턴', has: '등장했을 때', events: {
  // "효과로 자신의 다른 디지몬이 등장했을 때" (the generic watcher parser only knows a trailing 「효과로」): own OTHER Digimon entering play through an effect
  play: (state, hp, holder, info) => {
    if (info.owner !== hp || !info.stack || info.stack === holder || info.cause !== 'effect' || C(info.stack.cardId).category !== 'digimon') return false;
    info.lv = C(info.stack.cardId).level; // Lv. at trigger time (15-8-3-8) travels in trigger.evt
    return true;
  } } }];

// ST10-12 레이디데블몬 (진화원) 【자신의 턴】 옐로인 자신의 디지몬 전부는 《길동무》를 얻는다. — continuous grant to ALL own yellow Digimon (the generic
// parser only grants to the holder itself), so it is a live hook, not the one-shot grantKeyword the compiler produced.
HOOKS['ST10-12'] = [{ tag: '자신의 턴', src: 'inheritedKo', has: '길동무', grantKw: (state, hp, h, t) =>
  (C(t.cardId).category === 'digimon' && S.ownerOfStack(state, t) === hp && S.stackColors(t).includes('yellow') ? ['길동무'] : []) }];

// ST9-11 다이노몬 (진화원) 【자신의 턴】 이 디지몬의 색 1색당 이 디지몬의 DP를 +1000 한다. (live: counts the holder's CURRENT colors)
HOOKS['ST9-11'] = [{ tag: '자신의 턴', src: 'inheritedKo', has: '색 1색당', dp: (state, hp, holder, target) => (target === holder ? 1000 * S.stackColors(holder).length : 0) }];

// ST12-13 시스터몬 느와르 【서로의 턴】 명칭에 「헉몬」을 포함하거나 특징으로 「로얄 나이츠」를 가진 자신의 디지몬 전부는 《재기동》을 얻는다. — continuous grant to ALL matching own Digimon.
HOOKS['ST12-13'] = [{ tag: '서로의 턴', has: '재기동', grantKw: (state, hp, h, t) =>
  (C(t.cardId).category === 'digimon' && S.ownerOfStack(state, t) === hp && (S.effectiveInfo(state, t, hp).names.some(n => n.includes('헉몬')) || (C(t.cardId).types || []).includes('로얄 나이츠')) ? ['재기동'] : []) }];
