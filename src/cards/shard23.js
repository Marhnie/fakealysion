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
