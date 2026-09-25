// Ad-hoc verification for two fixes found while auditing rulings slice 2169..2336 (data/rulings/all.json).
// Not part of the permanent QA suite; safe to delete after review. Run: node scripts/qa/qa-verify-2169-2336.mjs
import { S, Fx, mk, put, setHand, drain, evolve, T, eq, ok, runAll } from './lib-s1.mjs';
import { SCRIPTS as SHARD4_SCRIPTS } from '../../src/cards/shard4.js';

const C = (id) => S.CARDS[id];
const findVanilla = (lv) => Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === lv && c.dp && !c.effectKo && !c.inheritedKo)?.id;

T('2851-BT17-078', 'BT17-078 오메가몬ACE: 조그레스 진화하지 않았어도 "그 후" 상대 디지몬 소멸은 발휘된다', async () => {
  const st = mk();
  const L6a = findVanilla(6);
  // opponent has one digimon that should be destroyed by the unconditional "그 후" clause
  const oppMon = put(st, 'p2', findVanilla(4));
  // our own Lv.6 body that we will evolve (via hand, NOT fusion) into BT17-078
  const me = put(st, 'p1', L6a);
  st._qaAns = { pickStack: (o) => o.uids?.[0] ?? null };
  await evolve(st, 'p1', me.uid, 'BT17-078', 0, 'hand');
  ok('조그레스 아니어도 상대 디지몬이 소멸했다 (viaFusion=false)', !st.players.p2.battle.some(s => s.uid === oppMon.uid));
});

T('2896-BT17-100', 'BT17-100 종말의 시계: 방금 등장한 「디아블로몬」 토큰 아래에는 놓을 수 없다 (실제 배포된 pred 직접 검증)', async () => {
  const st = mk();
  // simulate: a 디아블로몬 token already on the field with no sources (as if just spawned via the same 【메인】 effect)
  const tokenDef = { id: 'TOK_DIABOLOMON_TEST', cardId: 'TOK_DIABOLOMON_TEST', level: 6, cost: 14, dp: 3000, colors: ['white'], category: 'digimon', isToken: true, effectKo: '', nameKo: '디아블로몬' };
  S.CARDS[tokenDef.id] = tokenDef;
  const token = put(st, 'p1', tokenDef.id); // no sources -> would satisfy the old (buggy) predicate
  const step = SHARD4_SCRIPTS['BT17-100::메인'].find(x => x.op === 's4_placeThisUnder');
  ok('BT17-100::메인 스크립트에 s4_placeThisUnder 단계가 존재', !!step);
  const ctx = { state: st, self: 'p1' };
  eq('토큰은 pred를 통과하지 못한다 (isTokenId 배제)', step.pred(token, ctx), false);
});

await runAll('qa-verify-2169-2336');
