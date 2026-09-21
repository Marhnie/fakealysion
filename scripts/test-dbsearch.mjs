import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as D from '../src/dbsearch.js';
const arr = JSON.parse(fs.readFileSync(new URL('../data/cards_full.json', import.meta.url), 'utf8'));
const cards = Object.fromEntries((Array.isArray(arr) ? arr : Object.values(arr)).map(c => [c.id, c]));
const ix = D.buildIndex(cards);
const run = (q, scope = 'all', extra = {}) => D.runSearch({ ...D.defaultFilter(), q, scope, ...extra }, cards, ix, { copies: () => 0, max: () => 4 }).ids;
const has = (ids, id) => ids.includes(id);
assert.deepEqual(D.parseQuery('a b').include, [['a'], ['b']]);
assert.deepEqual(D.parseQuery('"x  y" -z').include, [['xy']]);
assert.deepEqual(D.parseQuery('"x y" -z').exclude, [['z']]);
assert.deepEqual(D.parseQuery('a|B c').include, [['a', 'b'], ['c']]);
assert.deepEqual(D.parseQuery('- ').include, [['-']]); // lone dash is literal
assert.ok(has(run('코어드라몬'), 'ST1-06'));
assert.ok(has(run('코어 드라몬'.replace(' ', ' ')), 'ST1-06'), 'space-insensitive');
assert.ok(has(run('st1-06', 'name'), 'ST1-06'), 'id, case-insens');
assert.ok(!has(run('블로커', 'name'), 'ST1-06'), 'scope name excludes effect');
assert.ok(has(run('블로커', 'effect'), 'ST1-06'));
assert.ok(has(run('용형', 'traits'), 'ST1-06'));
assert.ok(!has(run('용형', 'effect'), 'ST1-06'));
assert.ok(!has(run('코어드라몬 -블로커'), 'ST1-06'), 'exclusion');
assert.ok(has(run('코어드라몬|없는이름'), 'ST1-06'), 'OR');
assert.ok(has(run('"어택 시" 메모리'), 'ST1-06'), 'phrase + AND');
assert.ok(has(run('진화원 4장', 'inherited'), 'ST1-01'));
const yp = run('옐로 퍼플'); assert.ok(yp.some(id => cards[id].colors.includes('yellow') && cards[id].colors.includes('purple')), 'multi-color words');
const mono = run('', 'all', { colors: ['red'], mono: true }); assert.ok(mono.length && mono.every(id => cards[id].colors.length === 1 && cards[id].colors[0] === 'red'));
assert.ok(run('', 'all', { cats: ['tamer'] }).every(id => cards[id].category === 'tamer'));
// 색 AND/OR: colorAnd 켜면 선택한 색을 전부 가진 카드만, 끄면 하나라도 가진 카드
{ const orR = run('', 'all', { colors: ['red', 'blue'] }), andR = run('', 'all', { colors: ['red', 'blue'], colorAnd: true });
  assert.ok(andR.length > 0 && andR.length < orR.length, 'AND is narrower than OR');
  assert.ok(andR.every(id => cards[id].colors.includes('red') && cards[id].colors.includes('blue')), 'AND: every card has both');
  assert.ok(orR.every(id => cards[id].colors.includes('red') || cards[id].colors.includes('blue')), 'OR: any of'); }

assert.ok(run('', 'all', { levels: [3, 4], cost: { min: '2', max: '5' } }).every(id => [3, 4].includes(cards[id].level) && cards[id].cost >= 2 && cards[id].cost <= 5));
assert.ok(has(run('', 'all', { keywords: ['블로커'], packs: ['ST'] }), 'ST1-06'));
assert.ok(has(run('', 'all', { tags: ['어택시'] }), 'ST1-06'));
assert.ok(run('', 'all', { sort: 'dp' }).length > 100);
const hl = D.splitHighlight('덱 위에서부터 3장 오픈', ['덱위에서부터3장']); assert.equal(hl.filter(x => x.hit).length, 1);
assert.equal(D.parseKeyword('시큐리티 어택 +1'), '시큐리티어택');
assert.equal(D.tagLabel('등장시'), '등장 시');
console.log('dbsearch tests OK');
