import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POOL_SIZE, MAX_PER_USER, parseTitleInput, normalizeTitle, formatMovie, addToPool, removeFromPool,
  filterCatalog, searchCatalog, buildSpinSequence, frameWindow, wheelRotation, getPool, updatePool,
} from '../src/services/movies/movieLogic.js';
import { MOVIE_CATALOG, MOVIE_GENRES } from '../src/config/movies/catalog.js';

const makeClient = () => {
  const store = new Map();
  return { db: { get: async (k, d = null) => (store.has(k) ? structuredClone(store.get(k)) : d), set: async (k, v) => { store.set(k, structuredClone(v)); return true; } } };
};

test('the built-in catalog is well formed', () => {
  assert.ok(MOVIE_CATALOG.length >= 80);
  const seen = new Set();
  for (const movie of MOVIE_CATALOG) {
    assert.ok(movie.title && movie.title.length <= 100, movie.title);
    assert.ok(Number.isInteger(movie.year) && movie.year >= 1900 && movie.year <= 2030, movie.title);
    assert.ok(movie.genres.length > 0 && movie.genres.every((g) => MOVIE_GENRES.includes(g)), `${movie.title}: bad genre`);
    const key = normalizeTitle(movie.title);
    assert.ok(!seen.has(key), `duplicate: ${movie.title}`);
    seen.add(key);
    assert.ok(formatMovie(movie).length <= 100, `autocomplete label too long: ${movie.title}`);
  }
  for (const genre of MOVIE_GENRES) assert.ok(filterCatalog(MOVIE_CATALOG, genre).length >= 5, `too few ${genre} movies`);
});

test('parsing titles with a year', () => {
  assert.deepEqual(parseTitleInput('Inception (2010)'), { title: 'Inception', year: 2010 });
  assert.deepEqual(parseTitleInput('  Up  '), { title: 'Up', year: null });
  assert.deepEqual(parseTitleInput('(2010)'), { title: '(2010)', year: null });
  assert.deepEqual(parseTitleInput('Blade   Runner  2049 (2017)'), { title: 'Blade Runner 2049', year: 2017 });
  assert.equal(normalizeTitle("Ferris Bueller's Day Off"), 'ferris bueller s day off');
  assert.equal(formatMovie({ title: 'Up', year: 2009 }), 'Up (2009)');
  assert.equal(formatMovie({ title: 'Up', year: null }), 'Up');
});

test('adding movies and the rules around it', () => {
  let pool = [];
  const add = (title, userId, extra = {}) => addToPool(pool, { title, userId, now: 1000, ...extra });

  let result = add('Inception', 'u1', { year: 2010 });
  assert.equal(result.ok, true);
  pool = result.pool;
  assert.equal(pool[0].year, 2010);

  assert.equal(add('  inception ', 'u2').reason, 'duplicate');
  assert.equal(add('INCEPTION!', 'u2').reason, 'duplicate');
  assert.equal(add('   ', 'u2').reason, 'empty');
  assert.equal(add('x'.repeat(101), 'u2').reason, 'too_long');

  for (let i = 0; i < MAX_PER_USER - 1; i += 1) { result = add(`Movie ${i}`, 'u1'); assert.equal(result.ok, true); pool = result.pool; }
  assert.equal(add('One too many', 'u1').reason, 'user_limit');
  assert.equal(add('Admin extra', 'u1', { exemptFromLimit: true }).ok, true);
  assert.equal(add('Other person fine', 'u2').ok, true);
});

test('the list has a hard cap', () => {
  const pool = Array.from({ length: MAX_POOL_SIZE }, (_, i) => ({ id: String(i), title: `M${i}`, year: null, addedBy: `u${i}`, addedAt: 0 }));
  assert.equal(addToPool(pool, { title: 'New', userId: 'x' }).reason, 'pool_full');
});

test('removing movies', () => {
  const pool = [
    { id: '1', title: 'Inception', year: 2010, addedBy: 'a', addedAt: 0 },
    { id: '2', title: 'Up', year: null, addedBy: 'b', addedAt: 0 },
  ];
  assert.equal(removeFromPool(pool, 'inception').removed.id, '1');
  assert.equal(removeFromPool(pool, 'Inception (2010)').ok, true);
  assert.equal(removeFromPool(pool, 'Inception (1999)').reason, 'not_found');
  assert.equal(removeFromPool(pool, 'Nope').reason, 'not_found');
  assert.equal(removeFromPool(pool, '').reason, 'empty');
  assert.equal(removeFromPool(pool, 'Up').pool.length, 1);
  assert.equal(pool.length, 2, 'original array untouched');
});

test('catalog search ranks prefix matches first', () => {
  const results = searchCatalog(MOVIE_CATALOG, 'the', 10).map((m) => m.title);
  assert.ok(results.length > 0);
  assert.ok(results[0].toLowerCase().startsWith('the'));
  assert.equal(searchCatalog(MOVIE_CATALOG, '', 7).length, 7);
  assert.equal(searchCatalog(MOVIE_CATALOG, 'zzzzqqq').length, 0);
  assert.ok(searchCatalog(MOVIE_CATALOG, 'inception')[0].title === 'Inception');
});

test('wheel sequence always lands on the winner, one step at a time', () => {
  for (const count of [2, 3, 7, 40]) {
    for (let winner = 0; winner < count; winner += 1) {
      const sequence = buildSpinSequence(count, winner, 10);
      assert.equal(sequence.length, 10);
      assert.equal(sequence.at(-1), winner);
      for (let i = 1; i < sequence.length; i += 1) assert.equal(sequence[i], (sequence[i - 1] + 1) % count);
      assert.ok(sequence.every((i) => i >= 0 && i < count));
    }
  }
});

test('frame window wraps around the list', () => {
  const titles = ['a', 'b', 'c'];
  assert.deepEqual(frameWindow(titles, 0, 2).map((l) => l.title), ['b', 'c', 'a', 'b', 'c']);
  assert.equal(frameWindow(titles, 0, 2)[2].offset, 0);
});

test('wheel rotation parks the winner under the pointer', () => {
  for (const count of [2, 5, 12, 41]) {
    for (let winner = 0; winner < count; winner += 1) {
      const slice = (Math.PI * 2) / count;
      const centre = -Math.PI / 2 + wheelRotation(winner, count) + (winner + 0.5) * slice;
      assert.ok(Math.abs(centre - -Math.PI / 2) < 1e-9);
    }
  }
});

test('pool storage round trip and concurrent adds', async () => {
  const client = makeClient();
  assert.deepEqual(await getPool(client, 'g1'), []);
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => updatePool(client, 'g1', (pool) => addToPool(pool, { title: `Film ${i}`, userId: `u${i}` }))));
  assert.ok(results.every((r) => r.ok));
  assert.equal((await getPool(client, 'g1')).length, 15, 'no add may be lost to a race');

  const failed = await updatePool(client, 'g1', (pool) => addToPool(pool, { title: 'Film 3', userId: 'zz' }));
  assert.equal(failed.ok, false);
  assert.equal((await getPool(client, 'g1')).length, 15);
});
