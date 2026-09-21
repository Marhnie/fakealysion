p='src/state.js'
t=open(p,encoding='utf8').read()
a="  if (!host || card(host.cardId).category !== 'digimon') return { ok: false, reason: '링크 대상은 디지몬이어야 함 (10-1-1)' };\n  if (lc.category"
assert a in t
b="  if (!host || (card(host.cardId).category !== 'digimon' && !(card(host.cardId).category === 'digitama' && state.players[p] && state.players[p].raising === host))) return { ok: false, reason: '링크 대상은 디지몬이어야 함 (10-1-1)' }; // QA-S6 Q6443: the (DP-less) Lv.2 digimon in the breeding area is a valid host\n  if (lc.category"
t=t.replace(a,b,1)
open(p,'w',encoding='utf8').write(t)
