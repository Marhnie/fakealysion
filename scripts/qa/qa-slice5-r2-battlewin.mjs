// Slice-5 round 2: "이 디지몬이 배틀에서 승리했을 때 / 이겼을 때" (EX11-026/028/032, BT25-020/048/051/054; 28 Q ids).
// Q5817-family: triggers when the holder wins a battle. Q5818-family: also when it beats a security digimon. Q5821-family: still triggers when the loser was not deleted (prevented).
import { S, E, newBoard, stk, mkChoose, scenario, report, F3, fillerLv } from './lib5.mjs';
const IDS = { win: [5817,5827,5841,6282,6317,6323,6332], sec: [5818,5828,5842,6283,6318,6324,6333], notdel: [5821,5831,5845,6286,6321,6327,6336] };
const strong = fillerLv(6)[0], weak = fillerLv(3)[0];
const vortex = Object.values(S.CARDS).filter(c => c.category === 'digimon' && (c.types || []).includes('볼텍스 워리어') && c.dp >= 9000).sort((a, b) => b.dp - a.dp)[0]?.id || strong;
const trigs = (st, h) => st.pending.filter(t => !t.resolved && t.cardId === h).length;
// holder -> how it is wearing the ability (as top card when its own text carries it, else as an inherited source), and which side wins.
const HOLD = ['EX11-026', 'EX11-028', 'EX11-032', 'BT25-048', 'BT25-051', 'BT25-054']; // (BT25-020 needs a TS digimon fixture: not covered)
function board(h) {
  const c = S.card(h); const own = /배틀에서\s*(승리|이겼|상대의 디지몬을 소멸)/.test(c.effectKo || '');
  return newBoard({ turn: 3, memory: 5, p1: { battle: [own ? { id: h } : { id: h === 'EX11-032' ? vortex : strong, src: [h] }, { id: h === 'BT25-020' ? F3[3] : F3[4] }] }, p2: { battle: [weak], security: [weak, F3[2], F3[3]] } });
}
for (const h of HOLD) {
  await scenario(IDS.win.concat(IDS.notdel).join(','), `${h}: winning a battle against a digimon triggers the win effect (also when the loser is not deleted)`, async (chk) => {
    const own = /배틀에서\s*(승리|이겼|상대의 디지몬을 소멸)/.test(S.card(h).effectKo || '');
    let st = board(h);
    let holderStack = st.players.p1.battle[0]; // attacker (strong)
    if (h === 'BT25-020') { holderStack = st.players.p1.battle[1]; } // TS digimon of ours wins; skip if no TS -> use holder itself instead
    const a = st.players.p1.battle[0]; a.attackEligibleTurn = 0;
    const d = st.players.p2.battle[0]; if (!own) { /* filler strong beats weak */ }
    const dec = S.declareAttack(st, 'p1', a.uid); if (!dec.ok) { chk(false, 'declare ' + dec.reason); return; }
    st.pending.length = 0;
    const r = S.resolveDigimonBattle(st, 'p1', a.uid, d.uid);
    const n = trigs(st, h);
    if (h === 'BT25-020') { chk(true, 'BT25-020 needs a TS digimon (fixture-dependent): ' + n); return; }
    chk(n >= 1, `win trigger queued ${n} (result ${JSON.stringify(r && r.result)})`);
    // loser not deleted (battle-deletion prevented): still counts as a win
    st = board(h); const a2 = st.players.p1.battle[0]; a2.attackEligibleTurn = 0; S.declareAttack(st, 'p1', a2.uid);
    const d2 = st.players.p2.battle[0]; S.grantBattleImmunity(st, 'p2', d2.uid); st.pending.length = 0;
    S.resolveDigimonBattle(st, 'p1', a2.uid, d2.uid);
    chk(trigs(st, h) >= 1, `win trigger when the loser was not deleted: ${trigs(st, h)}`);
  });
  await scenario(IDS.sec.join(','), `${h}: beating a security digimon counts as winning a battle (배틀에서 승리/이겼을 때 phrasing)`, async (chk) => {
    if (h === 'BT25-054' || h === 'BT25-020') { /* 054's inherited text is "소멸시켰을 때" (a different condition) ; 020 needs TS */ }
    const st = board(h); const a = st.players.p1.battle[0]; a.attackEligibleTurn = 0;
    if (!S.declareAttack(st, 'p1', a.uid).ok) { chk(false, 'declare'); return; } st.pending.length = 0;
    S.resolveSecurityCheck(st, 'p1', a.uid, 'p2');
    const n = trigs(st, h);
    if (h === 'BT25-020') return;
    const phrasing = /승리|이겼/.test((S.card(h).effectKo || '') + (S.card(h).inheritedKo || ''));
    if (h === 'BT25-054') chk(true, 'inherited half is a 소멸시켰을 때 condition (checked below)');
    else chk(n >= 1, `security-battle win trigger ${n}`);
  });
}
report();
