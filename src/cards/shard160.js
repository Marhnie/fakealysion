// Shard 160 — cards whose Korean text comes from data/ko-overrides.json (KOR export was empty): P-243 / P-244.
// Ops of shard8 (s8_delaySelf, s8_evolve, s8_link, s8_costThen, s8_appFuse, s8_if …) are shared through the merged OPS table.
import * as S from '../state.js';

export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};

const C = (id) => S.card(id);
const isDigi = (id) => C(id).category === 'digimon';
const trait = (id, ...ts) => (C(id).types || []).some(t => ts.includes(t));
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const H = (id, d) => { (HOOKS[id] ||= []).push(d); return d; };

// (P-239 -> shard151, P-241 -> shard6, P-242 -> shard8: implemented there by the Q&A audit agents while this shard was being written)

// ---- P-243 디지시배스 【자신의 턴 개시 시】 상대의 디지몬이 있다면, 《딜레이》. ·자신의 트래시에서 특징 「DM」를 가진 디지몬 카드 1장을 덱 위로 되돌리는 것으로,
//      자신의 트래시에서 특징 「DM」를 가진 등장 코스트 3 이하의 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
OPS.s160_dmReplay = async (i, ctx) => {
  const { state } = ctx, p = ctx.self, pl = state.players[p];
  const backIdx = pl.trash.map((id, k) => k).filter(k => isDigi(pl.trash[k]) && trait(pl.trash[k], 'DM'));
  if (!backIdx.length) return;
  const k = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: backIdx, prompt: '덱 위로 되돌릴 특징 「DM」 디지몬 카드 선택 (안 해도 됨)' });
  if (k == null) return;
  const [id] = pl.trash.splice(k, 1);
  pl.deck.unshift(id);
  S.log(state, `${p} 트래시의 ${C(id).nameKo}을(를) 덱 위로 되돌림`);
  const playIdx = pl.trash.map((c, j) => j).filter(j => ['digimon', 'tamer'].includes(C(pl.trash[j]).category) && trait(pl.trash[j], 'DM') && (C(pl.trash[j]).cost ?? 99) <= 3);
  if (!playIdx.length) return;
  const j = await ctx.choose('pickFromZoneIndex', { player: p, zone: 'trash', eligibleIdxs: playIdx, prompt: '코스트 없이 등장시킬 특징 「DM」 카드 선택 (안 해도 됨)' });
  if (j != null) S.playFreeFromZone(state, p, 'trash', j, {});
};
SCRIPTS['P-243::자신의 턴 개시 시'] = [{ op: 's8_if', test: (ctx) => ctx.state.players[ctx.opp].battle.some(s => isDigi(s.cardId)), then: [{ op: 's8_delaySelf', then: [{ op: 's160_dmReplay' }] }] }];

// ---- P-244 유니크 엠블럼: 라그나로크 어테이너 【자신의 턴】 자신의 디지몬의 진화원에 「벰몬」이 효과로 놓였을 때, 《딜레이》.
//      ·「벰몬」이 기술되어 있는 자신의 디지몬 1마리를 패/트래시의 「벰몬」이 기술되어 있는 디지몬 카드로 지불하는 코스트 -3 하여 진화시킬 수 있다.
H('P-244', { tag: '자신의 턴', has: '진화원에 「벰몬」이 효과로', events: { sourcesAdded: (state, hp, holder, info) => C(holder.cardId).category === 'option' && state.turnNumber > holder.placedTurn && info.owner === hp && info.cause === 'effect' && (info.added || []).some(id => C(id).nameKo === '벰몬') } });
SCRIPTS['P-244::자신의 턴'] = [{ op: 's8_delaySelf', then: [{ op: 's8_evolve', subject: 'pickOwn', pred: (ctx, s) => S.cardMentions(s.cardId, '벰몬'), zones: ['hand', 'trash'], card: (id) => isDigi(id) && S.cardMentions(id, '벰몬'), delta: -3 }] }];

// ---- P-060 앙고라몬 【자신의 턴】〔턴에 1회〕 이 디지몬이 블록당했을 때, 상대의 시큐리티를 위에서부터 1장 파기한다. (same watcher as its twin P-049 in shard43; 'blocked' is emitted by main.js when a blocker is chosen)
H('P-060', { tag: '자신의 턴', has: '블록당했을 때', src: 'effectKo', limit: 1, events: { blocked: (state, hp, holder, info) => info.owner === hp && info.stack === holder } });
