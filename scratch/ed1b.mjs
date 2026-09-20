import fs from 'fs';
const f = 'D:/닼웤롴덬/digimon-sim/src/state.js';
let s = fs.readFileSync(f, 'utf8');
const re = /  scheduleEndOfTurn\(state, \(\) => \{\n    const s = state\.players\[p\]\.battle\.find\(x => x\.uid === uid\);\n.*\n    trashEvoSources\(state, p, uid, 1, 'top'\);\n  \}, (\{ player: p, cardId, label: '[^']*') \}\);/;
if (!re.test(s)) throw new Error('nomatch');
s = s.replace(re, (m, meta) => `  scheduleEndOfTurn(state, burstEotFn(state, p, uid), ${meta}, desc: { kind: 'burst', p, uid } });`);
s += fs.readFileSync('D:/닼웤롴덬/digimon-sim/scratch/ed1.mjs','utf8').split('s += `')[1].split('`;\nfs.writeFileSync')[0].replace(/\`/g,'`');
fs.writeFileSync(f, s);
