import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HEIGHT_CM, WATER_COOLDOWN_MS, TREE_STAGES, defaultTree, getTreeStage, getNextStage, rollGrowth,
  applyWatering, topContributors, getTree, waterTree,
} from '../src/services/tree/treeLogic.js';

const makeClient = () => {
  const store = new Map();
  return { db: { get: async (k, d = null) => (store.has(k) ? structuredClone(store.get(k)) : d), set: async (k, v) => { store.set(k, structuredClone(v)); return true; } } };
};

test('stages by height', () => {
  assert.equal(getTreeStage(0).name, 'Seed');
  assert.equal(getTreeStage(9).name, 'Seed');
  assert.equal(getTreeStage(10).name, 'Sprout');
  assert.equal(getTreeStage(799).name, 'Grown Tree');
  assert.equal(getTreeStage(999).name, 'Mighty Tree');
  assert.equal(getNextStage(0).name, 'Sprout');
  assert.equal(getNextStage(900), null);
  assert.deepEqual(TREE_STAGES.map((s) => s.min), [...TREE_STAGES.map((s) => s.min)].sort((a, b) => a - b));
});

test('growth roll is 1-5', () => {
  assert.equal(rollGrowth(() => 0), 1);
  assert.equal(rollGrowth(() => 0.999999), 5);
  for (let i = 0; i < 200; i += 1) { const g = rollGrowth(); assert.ok(g >= 1 && g <= 5); }
});

test('watering grows the tree and starts the cooldown', () => {
  const now = 10_000_000;
  const result = applyWatering(defaultTree(0), 'u1', now, 3);
  assert.equal(result.ok, true);
  assert.equal(result.tree.height, 3);
  assert.equal(result.tree.totalWaterings, 1);
  assert.equal(result.tree.contributors.u1, 1);

  const again = applyWatering(result.tree, 'u1', now + 1000, 3);
  assert.equal(again.ok, false);
  assert.equal(again.retryAt, now + WATER_COOLDOWN_MS);

  const later = applyWatering(result.tree, 'u1', now + WATER_COOLDOWN_MS, 3);
  assert.equal(later.ok, true);
  assert.equal(later.tree.height, 6);
  assert.equal(later.tree.contributors.u1, 2);
});

test('other people are not blocked by someone else\'s cooldown', () => {
  const now = 5_000_000;
  const first = applyWatering(defaultTree(0), 'u1', now, 2).tree;
  assert.equal(applyWatering(first, 'u2', now + 5, 2).ok, true);
});

test('crossing a stage boundary is reported', () => {
  const tree = { ...defaultTree(0), height: 8 };
  const result = applyWatering(tree, 'u1', 1, 3);
  assert.equal(result.stageChanged, true);
  assert.equal(result.newStage.name, 'Sprout');
  assert.equal(applyWatering({ ...defaultTree(0), height: 20 }, 'u1', 1, 3).stageChanged, false);
});

test('reaching the top completes the tree and plants a new seed', () => {
  const tree = { ...defaultTree(0), height: MAX_HEIGHT_CM - 2, totalWaterings: 50 };
  const result = applyWatering(tree, 'u1', 777, 5);
  assert.equal(result.completed, true);
  assert.equal(result.tree.height, 0);
  assert.equal(result.tree.treesGrown, 1);
  assert.equal(result.tree.plantedAt, 777);
  assert.equal(result.tree.totalWaterings, 51);
  assert.equal(result.stageChanged, false);
});

test('the cooldown map prunes finished entries', () => {
  const tree = { ...defaultTree(0), lastWatered: { old1: 0, old2: 10, recent: 4_000_000 } };
  const result = applyWatering(tree, 'u9', 4_000_000 + 1000, 1);
  assert.deepEqual(Object.keys(result.tree.lastWatered).sort(), ['recent', 'u9']);
});

test('top contributors sorted', () => {
  const tree = { contributors: { a: 3, b: 9, c: 5 } };
  assert.deepEqual(topContributors(tree, 2), [['b', 9], ['c', 5]]);
  assert.deepEqual(topContributors({}), []);
});

test('storage: defaults, cooldown and simultaneous waterings by different people', async () => {
  const client = makeClient();
  assert.equal((await getTree(client, 'g1')).height, 0);

  const now = 50_000_000;
  const first = await waterTree(client, 'g1', 'u1', now, () => 0);
  assert.equal(first.ok, true);
  assert.equal((await waterTree(client, 'g1', 'u1', now + 10, () => 0)).ok, false);

  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => waterTree(client, 'g1', `p${i}`, now + 20, () => 0)));
  assert.ok(results.every((r) => r.ok));
  const tree = await getTree(client, 'g1');
  assert.equal(tree.totalWaterings, 21, 'no waterings may be lost to a race');
  assert.equal(tree.height, 21);
});
