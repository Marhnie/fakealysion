// Position evaluation for the 어려움 lookahead search: a logistic model of "who wins from here" over public-information features,
// fitted on heuristic-vs-heuristic self-play by scripts/fit-eval.mjs (positions = the start of a main phase, label = eventual winner).
// The search uses the log-odds (w . x) scaled by EVAL_SCALE as the leaf value.  Features only read public zones + the evaluated
// player's own hand (the opponent's hand contributes its SIZE only), so the value never depends on hidden information.
import * as S from './state.js';
import * as Cpu from './cpu.js';

const { stackValue, handCardValue, canDeclareAttack, isDigi, hasKw } = Cpu.HX;
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const card = (id) => S.card(id);
export const FEATURE_NAMES = ['bias', 'first', 'secMe', 'secOpp', 'secMe0', 'secMe1', 'secOpp0', 'secOpp1', 'boardMe', 'boardOpp', 'digiMe', 'digiOpp', 'blkMe', 'blkOpp', 'handMe', 'handOpp', 'handValMe', 'mem', 'raisMe', 'raisOpp', 'eggsMe', 'eggsOpp', 'deckLowMe', 'deckLowOpp', 'tamerMe', 'tamerOpp', 'readyMe', 'lvMe', 'lvOpp', 'turn'];

// -> Float array aligned with FEATURE_NAMES (perspective of player p)
export function features(state, p) {
  const o = opp(p), me = state.players[p], op = state.players[o];
  const memV = p === 'p1' ? state.memory : -state.memory;
  let boardMe = 0, boardOpp = 0, digiMe = 0, digiOpp = 0, blkMe = 0, blkOpp = 0, tamerMe = 0, tamerOpp = 0, readyMe = 0, lvMe = 0, lvOpp = 0;
  for (const st of me.battle) {
    boardMe += stackValue(state, p, st);
    if (isDigi(st)) { digiMe++; lvMe += card(st.cardId).level || 0; if (!st.suspended && hasKw(state, p, st, '블로커')) blkMe++; if (canDeclareAttack(state, p, st)) readyMe++; } else tamerMe++;
  }
  for (const st of op.battle) {
    boardOpp += stackValue(state, o, st);
    if (isDigi(st)) { digiOpp++; lvOpp += card(st.cardId).level || 0; if (!st.suspended && hasKw(state, o, st, '블로커')) blkOpp++; } else tamerOpp++;
  }
  let handVal = 0; for (const id of me.hand) handVal += handCardValue(id);
  const sm = me.security.length, so = op.security.length;
  return [
    1, state.firstPlayer === p ? 1 : 0,
    Math.min(sm, 8), Math.min(so, 8), sm === 0 ? 1 : 0, sm <= 1 ? 1 : 0, so === 0 ? 1 : 0, so <= 1 ? 1 : 0,
    Math.min(boardMe, 40), Math.min(boardOpp, 40), Math.min(digiMe, 8), Math.min(digiOpp, 8), Math.min(blkMe, 4), Math.min(blkOpp, 4),
    Math.min(me.hand.length, 10), Math.min(op.hand.length, 10), Math.min(handVal, 40), Math.max(-10, Math.min(10, memV)),
    me.raising ? 1 : 0, op.raising ? 1 : 0, Math.min(me.digitamaDeck.length, 5), Math.min(op.digitamaDeck.length, 5),
    me.deck.length <= 6 ? (7 - me.deck.length) / 7 : 0, op.deck.length <= 6 ? (7 - op.deck.length) / 7 : 0,
    Math.min(tamerMe, 3), Math.min(tamerOpp, 3), Math.min(readyMe, 6), Math.min(lvMe, 30), Math.min(lvOpp, 30), Math.min(state.turnNumber, 30) / 10,
  ];
}

// fitted by scripts/fit-eval.mjs (see the header of that file); null -> the search falls back to its hand-tuned evaluation
// 26.5k positions from 2800 heuristic-vs-heuristic games (color-coherent legal decks), hold-out accuracy 71%, log-loss 0.514; the deck-size / unit-count /
// level-sum features were dropped (collinear artefacts that would mislead the search outside the training distribution)
export const EVAL_WEIGHTS = [-0.1463, -0.2029, 0.7296, -0.822, -0.2898, -0.2186, 1.2723, 0.6244, 0.1349, -0.1013, 0, 0, -0.1755, -0.0986, 0.1424, -0.2197, 0.0224, 0.1045, 0.205, -0.3231, 0, 0, 0, 0, 0, 0, 0.2074, 0, 0, -0.5564];
export const EVAL_SCALE = 10; // leaf value = EVAL_SCALE * log-odds(win)
export function logOdds(state, p, w = EVAL_WEIGHTS) {
  if (!w) return null;
  const x = features(state, p);
  let z = 0;
  for (let i = 0; i < x.length; i++) z += w[i] * x[i];
  return z;
}
