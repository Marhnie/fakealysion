// Official Q&A (BT9-013/014/031/040/041/043/044/055/056 등, wave-2 audit idx 835-1334): bare quoted-name
// conditions like "진화원에 「A」/「X항체」가 있다면" name a CARD NAME — including "X항체" meaning the specific
// BT9-109 support card — never the trait 특징:X항체 that 238 other cards happen to carry (e.g. "그레이몬 X항체").
// EX7-061 리리스몬 X항체 prints this exact "「리리스몬」/「X항체」가 있다면" condition on its leave-prevention
// ability (state.js's printed-survive-ability parser, ~line 4561). Run: node scripts/qa/qa-w2-part2-x-antibody-name-vs-trait.mjs < /dev/null
import { S, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

const LILITH_XA = 'EX7-061'; // 리리스몬 X항체
const XA_CARD = 'BT9-109'; // literally named "X항체"
const TRAIT_ONLY = 'BT9-012'; // 그레이몬 X항체 — has the TRAIT 'X항체' but its NAME is "그레이몬 X항체", not "X항체" or "리리스몬"
const OTHER = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.dp && !c.effectKo && !c.inheritedKo && c.id !== TRAIT_ONLY)?.id;

function setup(sourceId) {
  const st = mk();
  const s = put(st, 'p1', LILITH_XA, { src: [sourceId] });
  // another own Digimon on board to sacrifice for the barrier's cost ("다른 디지몬 1마리를 소멸시키는 것으로")
  const other = put(st, 'p1', OTHER, {});
  return { st, s, other };
}

T(1, 'EX7-061: 진화원에 트레이트만 X항체인 카드(그레이몬 X항체, 이름 불일치)뿐이면 벗어남 방지 조건 불충족 — 정상 소멸', async () => {
  const { st, s, other } = setup(TRAIT_ONLY);
  S.deleteStack(st, 'p1', s.uid, 'trash', 'effect');
  ok('리리스몬 X항체가 실제로 트래시로 감 (방지되지 않음)', !st.players.p1.battle.some(x => x.uid === s.uid));
  ok('다른 디지몬은 방지 비용으로 소멸되지 않음 (조건 불충족이라 발동 자체가 안 됨)', st.players.p1.battle.some(x => x.uid === other.uid));
});

T(2, 'EX7-061: 진화원에 실제로 이름이 "X항체"인 카드(BT9-109)가 있으면 조건 충족 — 다른 디지몬 소멸시키고 벗어나지 않음', async () => {
  const { st, s, other } = setup(XA_CARD);
  S.deleteStack(st, 'p1', s.uid, 'trash', 'effect');
  ok('리리스몬 X항체가 배틀 에어리어에 남음 (방지 성공)', st.players.p1.battle.some(x => x.uid === s.uid));
  ok('비용으로 다른 디지몬이 소멸함', !st.players.p1.battle.some(x => x.uid === other.uid));
});

await runAll('qa-w2-part2-x-antibody-name-vs-trait');
