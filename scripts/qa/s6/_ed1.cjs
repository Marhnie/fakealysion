const fs=require('fs');let t=fs.readFileSync('src/state.js','utf8');
const a="  discardLinkCardsOnNewCard(state, p, stack); // 10-4-1: this stack is about to become a new card
  S2.beforeDigivolve(state, p, stack); // shard2 (BT14-018 tokens)";
if(!t.includes(a))throw new Error('anchor1');
t=t.replace(a,"  const tamerDirect = !!state._evoTamerDirect && card(stack.cardId).category === 'tamer' && !stack.s2AsDigimon; // QA-S6 Q6583 (BT18-018 family): an evolution CONDITION printed for a Tamer evolves it directly (not as a Digimon) -> no 'a Digimon digivolved' events\n"+a);
const b="if (pl.battle.includes(stack)) emitGameEvent(state, 'digivolve', { owner: p, stack, cause: state._fxSrc ? (state._fxSrc.player === p ? 'ownEffect' :";
if(!t.includes(b))throw new Error('anchor2');
t=t.replace(b,"if (pl.battle.includes(stack) && !tamerDirect) emitGameEvent(state, 'digivolve', { owner: p, stack, cause: state._fxSrc ? (state._fxSrc.player === p ? 'ownEffect' :");
fs.writeFileSync('src/state.js',t);console.log('ok')
