import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RARITIES, CAT_TYPES, pickRarity, pickCat, registerMessage, resetPacing, getCatConfig, saveCatConfig,
  clearConfigCache, recordCatch, getUserCats, getCatBoard, summarizeCats, getCatById,
  SPAWN_MIN_MESSAGES, SPAWN_MIN_INTERVAL_MS,
} from '../src/services/cats/catLogic.js';

const makeClient = () => {
  const store = new Map();
  return { store, db: { get: async (k, d = null) => (store.has(k) ? structuredClone(store.get(k)) : d), set: async (k, v) => { store.set(k, structuredClone(v)); return true; } } };
};

test('every rarity has cats and weights add up to 100', () => {
  assert.equal(Object.values(RARITIES).reduce((sum, r) => sum + r.weight, 0), 100);
  for (const key of Object.keys(RARITIES)) assert.ok(CAT_TYPES.some((cat) => cat.rarity === key), `no ${key} cat`);
  assert.equal(new Set(CAT_TYPES.map((c) => c.id)).size, CAT_TYPES.length, 'duplicate cat ids');
  assert.ok(CAT_TYPES.every((c) => RARITIES[c.rarity] && c.emoji && c.name));
});

test('rarity roll boundaries', () => {
  assert.equal(pickRarity(() => 0), 'common');
  assert.equal(pickRarity(() => 0.5999), 'common');
  assert.equal(pickRarity(() => 0.6), 'uncommon');
  assert.equal(pickRarity(() => 0.85), 'rare');
  assert.equal(pickRarity(() => 0.95), 'epic');
  assert.equal(pickRarity(() => 0.99), 'legendary');
  assert.equal(pickRarity(() => 0.999999), 'legendary');
});

test('rarity distribution is roughly as designed', () => {
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const counts = {};
  const total = 20000;
  for (let i = 0; i < total; i += 1) { const r = pickRarity(rng); counts[r] = (counts[r] || 0) + 1; }
  for (const [key, rarity] of Object.entries(RARITIES)) {
    const share = ((counts[key] || 0) / total) * 100;
    assert.ok(Math.abs(share - rarity.weight) < 2, `${key}: ${share.toFixed(1)}% vs ${rarity.weight}%`);
  }
});

test('pickCat returns a cat of the rolled rarity', () => {
  assert.equal(pickCat(() => 0.999).rarity, 'legendary');
  assert.equal(pickCat(() => 0).rarity, 'common');
});

test('cats appear after 25-60 messages and never faster than the minimum interval', () => {
  resetPacing();
  const rng = () => 0; // threshold = minimum
  const t0 = 1_000_000_000;
  for (let i = 1; i < SPAWN_MIN_MESSAGES; i += 1) assert.equal(registerMessage('g', t0, rng), false, `message ${i}`);
  assert.equal(registerMessage('g', t0, rng), true, 'spawns exactly at the threshold');

  for (let i = 0; i < SPAWN_MIN_MESSAGES + 5; i += 1) {
    assert.equal(registerMessage('g', t0 + 1000, rng), false, 'too soon after the last cat');
  }
  assert.equal(registerMessage('g', t0 + SPAWN_MIN_INTERVAL_MS, rng), true, 'allowed again once the interval passed');
  resetPacing();
});

test('pacing is tracked per server', () => {
  resetPacing();
  const rng = () => 0;
  const now = 2_000_000_000;
  for (let i = 0; i < SPAWN_MIN_MESSAGES - 1; i += 1) registerMessage('a', now, rng);
  assert.equal(registerMessage('b', now, rng), false);
  assert.equal(registerMessage('a', now, rng), true);
  resetPacing();
});

test('config round trip with cache', async () => {
  clearConfigCache();
  const client = makeClient();
  assert.deepEqual(await getCatConfig(client, 'g1'), { enabled: false, channelId: null });
  await saveCatConfig(client, 'g1', { enabled: true, channelId: 'c9' });
  assert.deepEqual(await getCatConfig(client, 'g1'), { enabled: true, channelId: 'c9' });
  clearConfigCache();
  assert.deepEqual(await getCatConfig(client, 'g1'), { enabled: true, channelId: 'c9' }, 'reads back from storage');
});

test('catches accumulate per user and feed the leaderboard', async () => {
  const client = makeClient();
  const tabby = getCatById('tabby');
  const dragon = getCatById('dragon');
  await recordCatch(client, 'g1', 'u1', tabby);
  await recordCatch(client, 'g1', 'u1', tabby);
  const user = await recordCatch(client, 'g1', 'u1', dragon);
  await recordCatch(client, 'g1', 'u2', tabby);

  assert.equal(user.total, 3);
  assert.deepEqual(user.byCat, { tabby: 2, dragon: 1 });
  assert.equal((await getUserCats(client, 'g1', 'nobody')).total, 0);
  assert.deepEqual(await getCatBoard(client, 'g1'), [['u1', 3], ['u2', 1]]);
  assert.deepEqual(await getCatBoard(client, 'other'), []);
});

test('simultaneous catches are all counted', async () => {
  const client = makeClient();
  const tabby = getCatById('tabby');
  await Promise.all(Array.from({ length: 10 }, () => recordCatch(client, 'g1', 'u1', tabby)));
  assert.equal((await getUserCats(client, 'g1', 'u1')).total, 10);
});

test('inventory summary puts rare cats first', () => {
  const summary = summarizeCats({ total: 4, byCat: { tabby: 2, dragon: 1, ninja: 1, gone: 5 } });
  assert.deepEqual(summary.owned.map((e) => e.cat.id), ['dragon', 'ninja', 'tabby'], 'unknown cat ids are ignored');
  assert.equal(summary.byRarity.legendary, 1);
  assert.equal(summary.byRarity.common, 2);
  assert.equal(summary.uniqueOwned, 3);
  assert.equal(summary.uniqueTotal, CAT_TYPES.length);
});
