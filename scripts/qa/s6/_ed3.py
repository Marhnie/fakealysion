p='src/cards/shard8.js'
t=open(p,encoding='utf8').read()
a="""  else { const uid = await pickOne(ctx, ctx.self, pl.battle.filter(s => isDigi(s.cardId)).map(s => s.uid), '링크할 디지몬 선택'); host = uid && findStack(state, ctx.self, uid); }
  if (!host || !pl.battle.includes(host)) return;
  const names = [];"""
assert a in t
b="""  else { const rz = pl.raising && ['digimon', 'digitama'].includes(C(pl.raising.cardId).category) ? [pl.raising] : []; /* QA-S6 Q6441/6443: 「에어리어의 자신의 디지몬」 includes the breeding-area digimon (also one without DP) */ const uid = await pickOne(ctx, ctx.self, [...pl.battle.filter(s => isDigi(s.cardId)), ...rz].map(s => s.uid), '링크할 디지몬 선택'); host = uid && findStack(state, ctx.self, uid); }
  if (!host || !(pl.battle.includes(host) || pl.raising === host)) return;
  const names = [];"""
t=t.replace(a,b,1)
open(p,'w',encoding='utf8').write(t)
