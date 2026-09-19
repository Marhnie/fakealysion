// Shard 18 — Option cards, batch 1 (zone/side audit: "옵션이 배틀 에어리어만 참조"): bespoke fixes.
// state.js is imported lazily (only used inside functions) because state.js imports cards/index.js.
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

OPS.s18_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [{ op: 's18_fn', fn: f }]; };
const opDigs = (ctx) => ctx.state.players[ctx.opp].battle.filter(s => S.card(s.cardId).category === 'digimon');

// BT8-101 플라즈마 슛 【메인】 이 턴 동안 상대 디지몬 1마리를 DP-4000 하고, 자신의 트래시의 특징으로 「아머체」를 가진 카드 1장마다 상대의 디지몬 전부를 DP-1000.
sc('BT8-101::메인', async (ctx) => {
  const { state } = ctx;
  const cands = opDigs(ctx);
  if (cands.length) {
    const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: 'DP -4000 할 상대 디지몬 선택' });
    if (uid) S.modifyDP(state, ctx.opp, uid, -4000, 'turn');
  }
  const k = state.players[ctx.self].trash.filter(id => (S.card(id).types || []).includes('아머체')).length; // 자신의 트래시의 「아머체」 카드 (own trash)
  if (k) for (const s of opDigs(ctx)) S.modifyDP(state, ctx.opp, s.uid, -1000 * k, 'turn');
});

// BT5-094 (its 【메인】 header is missing in the data; state.queueTriggersFor treats the bare text as 【메인】):
// 자신의 패에서 레드인 Lv.4 이하의 디지몬 카드 1장을 자신의 디지몬 1마리의 진화원의 가장 아래쪽에 놓을 수 있다. 그렇게 했을 때, 《2 드로우》.
SCRIPTS['BT5-094::메인'] = [
  { op: 'placeUnderSource', who: 'self', zones: ['hand'], filter: { category: 'digimon', colors: ['red'], levelMax: 4 }, n: 1, optional: true },
  { op: 'condition', if: { test: (ctx) => (ctx._lastPlacedSource || 0) > 0 }, then: [{ op: 'draw', who: 'self', n: 2 }], else: [] },
];

const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const digsOf = (state, p) => state.players[p].battle.filter(s => S.card(s.cardId).category === 'digimon');
const tamsOf = (state, p) => state.players[p].battle.filter(s => S.card(s.cardId).category === 'tamer');
const pick = async (ctx, list, prompt) => { if (!list.length) return null; const uid = list.length === 1 ? list[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: list.map(s => s.uid), prompt }); return list.find(s => s.uid === uid) || null; };

// P-021 새로운 세계 【메인】 자신의 「이미나」가 있을 때, 자신의 패에서 「팔몬」 1장을 코스트를 지불하지 않고 등장시키는 것으로, 자신의 「이미나」 1명을 패로 되돌린다.
sc('P-021::메인', async (ctx, R) => {
  const { state } = ctx, pl = state.players[ctx.self];
  const imina = () => tamsOf(state, ctx.self).filter(s => S.effectiveInfo(state, s).nameIs('이미나'));
  const palIdx = pl.hand.map((id, i) => i).filter(i => S.card(pl.hand[i]).category === 'digimon' && S.card(pl.hand[i]).nameKo === '팔몬');
  if (!imina().length || !palIdx.length) return; // 자신의 「이미나」(배틀 에어리어) / 패의 「팔몬」이 필요
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: '패의 「팔몬」 1장을 코스트 없이 등장시키고 「이미나」 1명을 패로 되돌리시겠습니까?' }))) return;
  const idx = palIdx.length === 1 ? palIdx[0] : await ctx.choose('pickFromZoneIndex', { player: ctx.self, zone: 'hand', eligibleIdxs: palIdx, prompt: '등장시킬 「팔몬」 선택' });
  if (idx == null) return;
  if (!S.playFreeFromZone(state, ctx.self, 'hand', idx, {})) return; // (등장 불가면 비용 미지불 — 되돌리지 않음)
  const t = await pick(ctx, imina(), '패로 되돌릴 「이미나」 선택');
  if (t) await R.runScript([{ op: 'returnToHandStripSources', target: 'self', last: false, thisStack: false, n: 1, filter: { exactAny: ['이미나'], category: 'tamer' } }], ctx);
});

// BT12-109 끓어오르는 힘 【메인】 자신의 디지몬 1마리를 자신의 테이머 아래에 있는 《세이브》가 기술되어 있는 디지몬 카드로 진화시킨다. (테이머 아래 = 자신의 테이머의 카드 아래)
sc('BT12-109::메인', async (ctx) => {
  const { state, E } = ctx, me = ctx.self;
  const isSave = (id) => S.card(id).category === 'digimon' && /《세이브》/.test(S.card(id).effectKo || '');
  const cands = [];
  for (const st of digsOf(state, me)) {
    const restr = S.evolveTargetRestriction(state, me, st);
    if (restr && restr.cannotEvolve) continue;
    for (const t of tamsOf(state, me)) for (const id of t.sources) if (isSave(id) && E.canEvolveAny(st.cardId, id, S.evoExtraArg(state, null, st), restr).ok) cands.push({ st, t, id });
  }
  if (!cands.length) { S.log(state, `${me} 테이머 아래의 《세이브》 디지몬 카드로 진화시킬 수 있는 조합이 없음`); return; }
  const st = await pick(ctx, [...new Map(cands.map(c => [c.st.uid, c.st])).values()], '진화시킬 자신의 디지몬 선택');
  if (!st) return;
  const cs = cands.filter(c => c.st === st);
  const tamers = [...new Map(cs.map(c => [c.t.uid, c.t])).values()];
  const tm = await pick(ctx, tamers, '진화할 카드가 있는 테이머(아래의 카드) 선택');
  if (!tm) return;
  const idxs = await S.chooseSourceIdxs(state, me, tm, 1, ctx.choose, (id) => cs.some(c => c.t === tm && c.id === id), '테이머 아래에서 진화할 《세이브》 디지몬 카드 선택');
  const id = tm.sources[idxs[0]]; if (id == null) return;
  const chk = E.canEvolveAny(st.cardId, id, S.evoExtraArg(state, null, st), S.evolveTargetRestriction(state, me, st));
  const cost = Math.max(0, (chk.ok ? chk.cost : (S.card(id).evoNormal?.cost ?? 0)) + S.hookEvoCostDiscount(state, me, st, id));
  tm.sources.splice(idxs[0], 1); S.recomputeStackGrants(tm);
  S.digivolve(state, me, st.uid, id, cost, 'tamer');
});

// BT3-097 치밀한 전술 【메인】 이 턴 동안, 자신의 디지몬 1마리는 「이 디지몬이 체크한 옵션 카드의 【시큐리티】 효과는 발휘하지 않는다.」의 효과를 얻는다. (was: permanent, on a non-existent "this" stack)
SCRIPTS['BT3-097::메인'] = [{ op: 'grantKeyword', target: 'self', thisStack: false, keyword: '옵션시큐리티효과무효', duration: 'turn' }];

// BT1-112 디멘션 시저 【메인】 이 턴 동안, 자신의 디지몬 1마리는 「이 디지몬이 배틀에서 상대의 디지몬만을 소멸시켰을 때, 이 디지몬을 액티브로 한다.」의 효과를 얻는다. (= 《전투후액티브》; was: un-rest "this stack" immediately)
SCRIPTS['BT1-112::메인'] = [{ op: 'grantKeyword', target: 'self', thisStack: false, keyword: '전투후액티브', duration: 'turn' }];

// BT7-098 울트라 터뷸런스 【메인】 이 턴 동안 상대 디지몬 1마리와 상대의 시큐리티 디지몬 전부의 DP를 -3000 한다. (was: only the security digimon half)
SCRIPTS['BT7-098::메인'] = [
  { op: 'modifyDP', target: 'opponent', amount: -3000, duration: 'turn' },
  { op: 'securityDPMod', target: 'opponent', amount: -3000, duration: 'turn' },
];
