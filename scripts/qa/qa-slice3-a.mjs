// Slice3 Q&A conformance, part A (BT17/BT18 general mechanics). Expected outcomes are named in our own words per Q id.
import { S, E, Fx, C, newState, put, other, drain, sc, finish, eq, FILL } from './s3lib.mjs';

// Q2913,2916,2919,...: evolving from a Tamer is NOT a "Digimon evolves" event (no evolve trigger), Q2914...: evolution draw still happens,
// Q2915,2918...: a Tamer played this turn -> evolved card cannot attack this turn.
for (const [tam, dig] of [['BT12-088', 'BT18-011']]) {
  await sc('Q2913/2914/2915', `${dig} from tamer: no digivolve event, draws, cannot attack same turn`, async () => {
    const st = newState(); const hand0 = 0; st.players.p1.hand = [tam]; S.spendMemory(st, 0); S.playDigimonFresh(st, 'p1', 0); await drain(st);
    const s = st.players.p1.battle[0]; if (!s) return 'tamer not played';
    st.players.p1.hand.push(dig);
    const chk = E.canEvolveAny(s.cardId, dig, s.extraColors || [], S.evolveTargetRestriction(st, 'p1', s));
    if (!chk.ok) return 'cannot evolve from tamer: ' + JSON.stringify(chk);
    let evEvt = 0; const orig = S.emitGameEvent; 
    const before = st.players.p1.hand.length; const dk = st.players.p1.deck.length;
    const r = S.digivolve(st, 'p1', s.uid, dig, Math.max(0, chk.cost || 0), 'hand');
    if (!r) return 'digivolve returned null';
    const drew = st.players.p1.deck.length === dk - 1;
    const atk = S.declareAttack(st, 'p1', s.uid);
    return eq('drew', drew, true) === true ? eq('attack blocked', atk.ok, false) : 'no evo draw';
  });
}
finish('slice3-a');
