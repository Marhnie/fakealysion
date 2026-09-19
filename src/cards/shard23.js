// Shard 23 — starter decks ST13-ST18 verified sentence-by-sentence against the printed text (docs/starter-ST13-18.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const C = (id) => S.card(id);
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const meOf = (ctx) => stacksOf(ctx.state, ctx.self).find(s => s.uid === ctx.sourceStackUid) || null;

// ST13-06 라그나로드몬 【진화 시】 《진격》. 조그레스 진화하고 있었을 때, 이 디지몬의 진화원 4장마다 등장 코스트 20 이하의 상대 디지몬 1마리를 소멸시키고, 상대의 시큐리티를 위에서부터 1장 파기한다.
OPS.s23_ragna = async (instr, ctx, H) => {
  const me = meOf(ctx);
  if (me && me.viaFusion) {
    const n = Math.floor(me.sources.length / 4);
    for (let i = 0; i < n; i++) {
      await H.runOne({ op: 'destroy', target: 'opponent', mode: 'choose', filter: { costMax: 20 } }, ctx);
      await H.runOne({ op: 'removeSecurity', who: 'opponent', position: 'top' }, ctx);
    }
  }
  await H.runOne({ op: 'raid' }, ctx);
};
SCRIPTS['ST13-06::진화 시'] = [{ op: 's23_ragna' }];

// ST13-05 듀란다몬 [상속] 【자신의 턴】 이 디지몬이 「라그나로드몬」인 동안, 이 디지몬이 체크한 옵션 카드의 【시큐리티】 효과는 발휘하지 않는다.
HOOKS['ST13-05'] = [{ tag: '자신의 턴', src: 'inheritedKo', has: '체크한 옵션', suppressSecurity: (state, hp, holder, revealedId) => C(holder.cardId).nameKo === '라그나로드몬' && C(revealedId).category === 'option' }];

// ================================================================== ST14 (퍼플 덱 파기)
// ST14-07 바알몬 — two 【진화 시】 segments share the key 'ST14-07::진화 시' (shard2 maps it to the grant-effect script), so the FIRST one
// ("자신의 덱 위에서부터 3장 파기한다.") was running the grant script and never trashed the 3 deck cards. Needle-key it to the plain trash op.
SCRIPTS['ST14-07::진화 시@자신의 덱 위에서부터 3장 파기'] = [{ op: 'trashDeckTop', who: 'self', n: 3 }];

// ST14-08 베르제브몬 【서로의 턴】[턴에 1회] 자신의 덱이 파기되었을 때, 자신의 트래시 10장마다, 메모리 +1.
OPS.s23_memPerTen = async (instr, ctx) => {
  const n = Math.floor(ctx.state.players[ctx.self].trash.length / 10);
  if (n > 0) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
};
HOOKS['ST14-08'] = [{ tag: '서로의 턴', has: '트래시 10장마다', ewTrusted: true }];
SCRIPTS['ST14-08::서로의 턴'] = [{ op: 's23_memPerTen' }];

// ST14-09 베르스타몬 패의 이 카드가 등장할 때, 자신의 트래시 10장마다 지불하는 등장 코스트 -4.
HOOKS['ST14-09'] = [{ tag: '__handPlay', selfPlayDiscount: (state, hp) => -4 * Math.floor(state.players[hp].trash.length / 10) }];

// ST14-11 다영&진 【자신의 턴】 (…이 테이머를 레스트시키는 것으로,) 자신의 패 1장을 덱 위로 되돌리고, 메모리 +1.
OPS.s23_handTopMem = async (instr, ctx) => {
  const pl = ctx.state.players[ctx.self];
  if (pl.hand.length) {
    const eligibleIdxs = pl.hand.map((id, i) => i);
    const ch = await ctx.choose('pickFromHandIndexes', { player: ctx.self, eligibleIdxs, n: 1, prompt: '덱 위로 되돌릴 패 1장 선택' });
    const i = Array.isArray(ch) ? ch[0] : ch;
    if (i != null && pl.hand[i] != null) { const [id] = pl.hand.splice(i, 1); pl.deck.unshift(id); S.log(ctx.state, `${ctx.self} 패의 ${C(id).nameKo}을(를) 덱 위로 되돌림`); }
  }
  S.grantMemory(ctx.state, ctx.self, 1, ctx.sourceCardId);
};
SCRIPTS['ST14-11::자신의 턴'] = [{ op: 's23_handTopMem' }];

// ================================================================== ST15 / ST16 "어택했을 때" watchers the generic parser does not know
// ST15-05 토이아구몬 【자신의 턴】 이 디지몬이 플레이어에게 어택했을 때, 메모리 -2.   (attackTarget event carries targetKind)
HOOKS['ST15-05'] = [{ tag: '자신의 턴', has: '플레이어에게 어택했을 때', events: { attackTarget: (state, hp, holder, info) => info.owner === hp && info.stack === holder && info.targetKind === 'player' } }];
SCRIPTS['ST15-05::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: -2 }];
// ST16-05 울퉁몬 【자신의 턴】 이 디지몬이 상대의 디지몬에게 어택했을 때, 메모리 -2.
HOOKS['ST16-05'] = [{ tag: '자신의 턴', has: '상대의 디지몬에게 어택했을 때', events: { attackOnDigimon: (state, hp, holder, info) => info.owner === hp && info.stack === holder } }];
SCRIPTS['ST16-05::자신의 턴'] = [{ op: 'gainMemory', who: 'self', n: -2 }];

// ================================================================== ST16 (퍼플 패 파기)
// "자신의 패가 자신의 효과로 파기되었을 때" (the generic watcher parser cannot read the "자신의 효과로" object form): own hand card(s) trashed while one of
// the owner's own effects resolves (state._fxSrc = the resolving effect's controller).
const ownHandDiscardByOwnEffect = (state, hp, holder, info) => info.owner === hp && info.cause === 'effect' && !!state._fxSrc && state._fxSrc.player === hp;
// ST16-13 스컬맘몬 【서로의 턴】[턴에 1회] … 자신의 트래시에서 퍼플인 Lv.4 이하의 디지몬 카드 1장을 코스트를 지불하지 않고 등장시킬 수 있다.
HOOKS['ST16-13'] = [{ tag: '서로의 턴', has: '패가 자신의 효과로 파기되었을 때', limit: 1, events: { discard: ownHandDiscardByOwnEffect } }];
SCRIPTS['ST16-13::서로의 턴'] = [{ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', colors: ['purple'], levelMax: 4 }, rested: false, noTriggers: false, optional: true }];
// ST16-14 매튜 【서로의 턴】 자신의 패가 자신의 효과로 파기되었을 때, 이 테이머를 레스트시키는 것으로, 메모리 +1.
HOOKS['ST16-14'] = [{ tag: '서로의 턴', has: '패가 자신의 효과로 파기되었을 때', events: { discard: (state, hp, holder, info) => ownHandDiscardByOwnEffect(state, hp, holder, info) && !holder.suspended } }];
SCRIPTS['ST16-14::서로의 턴'] = [{ op: 'costGroup', cost: [{ op: 'restStack' }], then: [{ op: 'gainMemory', who: 'self', n: 1 }] }];

// ================================================================== ST17 (그린 테리어몬)
// ST17-08 세인트가르고몬 — the second segment 【진화 시】【어택 종료 시】[턴에 1회] 이 디지몬을 액티브로 할 수 있다 shares the key 'ST17-08::진화 시' with the
// 【진화 시】 rest/lock script (shard11) and re-ran that whole script instead of reactivating itself. Needle-key it.
SCRIPTS['ST17-08::진화 시@이 디지몬을 액티브로 할 수 있다'] = [{ op: 'unsuspend', target: 'thisStack' }];

// ================================================================== ST18 (그린 조류)
// ST18-01 플러피몬 [상속] 【어택 시】[턴에 1회] 이 디지몬의 DP 이하의 다른 디지몬 1마리를 레스트시킬 수 있다.
// (the generic "디지몬 1마리를 레스트시킬 수 있다" compile offered every stack incl. Tamers/self with no DP bound)
OPS.s23_restLE = async (instr, ctx) => {
  const { state } = ctx;
  const me = meOf(ctx); if (!me) return;
  const dp = S.effectiveDP(state, ctx.self, me);
  const entries = [];
  for (const p of [ctx.self, ctx.opp]) for (const s of state.players[p].battle) if (s !== me && C(s.cardId).category === 'digimon' && !s.suspended && S.effectiveDP(state, p, s) <= dp) entries.push({ player: p, uid: s.uid });
  if (!entries.length) return;
  const picked = await ctx.choose('pickStackAnySide', { entries, prompt: `이 디지몬의 DP(${dp}) 이하의 다른 디지몬 1마리 레스트 (자신/상대 무관, 선택 안 함 가능)` });
  if (picked) S.restStack(state, picked.player, picked.uid);
};
SCRIPTS['ST18-01::어택 시'] = [{ op: 's23_restLE' }];

// ST18-05 레드펭귄몬 【서로의 턴】[턴에 1회] 이 디지몬이 효과로 레스트했을 때, 상대의 턴 종료까지 특징으로 「조」/「새」/「병아리」를 포함하거나 특징으로 「볼텍스 워리어」를 가진 자신의 디지몬 1마리를 DP +3000.
// (compile kept only the 「볼텍스 워리어」 half of the OR filter)
SCRIPTS['ST18-05::서로의 턴'] = [{ op: 'modifyDP', target: 'self', amount: 3000, duration: 'opponentTurn', filter: { anyOf: [{ traitIncludes: ['조', '새', '병아리'] }, { traitAny: ['볼텍스 워리어'] }] } }];
