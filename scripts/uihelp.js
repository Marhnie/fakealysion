// UI playtest helpers (dev tool): await import('/scripts/uihelp.js') after /scripts/uibot.js
window.SS = __dbg().S; window.seen = window.seen || {};
window.go = (a, b) => { window.res = null; bots.newGame(a, b).then(() => bots.run(2500, 80)).then(r => window.res = r); };
window.hx = (p) => [...document.querySelectorAll('.hand-zone')][p === 'p1' ? 1 : 0].querySelectorAll('.card-chip');
window.zone = (p) => document.querySelectorAll('.drop-zone .stack-list')[p === 'p1' ? 1 : 0];
window.play = async (p, id, target) => { const s = __dbg().state; const i = s.players[p].hand.indexOf(id); dnd(hx(p)[i], target || zone(p)); await wait(500); };
window.mkStack = (p, cardId, sources = [], o = {}) => { const s = __dbg().state; const t = { uid: 't' + Math.random().toString(36).slice(2, 6), cardId, sources, suspended: false, attackEligibleTurn: 0, placedTurn: 0, tempDP: 0, keywords: {}, attacksThisTurn: 0, turnEffectUses: {}, extraColors: [], linkCards: [], inheritedDP: 0, inheritedKeywords: {}, xrosCount: 0, kwTs: {}, keywordExpiry: {} }; Object.assign(t, o); s.players[p].battle.push(t); return t; };
window.clickB = async (re) => { [...document.querySelectorAll('.modal-panel button')].find(b => re.test(b.textContent))?.click(); await wait(600); return document.querySelector('.modal-panel')?.innerText.slice(0, 300); };
window.mtxt = () => document.querySelector('.modal-panel')?.innerText.replace(/\n/g, ' | ').slice(0, 400);
window.setup = async (a, b) => { await bots.newGame(a, b); const s = __dbg().state; s.memory = 10; s.phase = 'main'; return s; };
