// The server tree: everyone waters it, it grows. Pure rules + storage.

import { Mutex } from '../../utils/mutex.js';
import { pickRandom } from '../fun/gameLogic.js';

export const MAX_HEIGHT_CM = 1000;
export const WATER_COOLDOWN_MS = 60 * 60 * 1000;
export const MIN_GROWTH_CM = 1;
export const MAX_GROWTH_CM = 5;

export const TREE_STAGES = [
    { min: 0, name: 'Seed', emoji: '🌰' },
    { min: 10, name: 'Sprout', emoji: '🌱' },
    { min: 50, name: 'Sapling', emoji: '🌿' },
    { min: 150, name: 'Young Tree', emoji: '🌲' },
    { min: 400, name: 'Grown Tree', emoji: '🌳' },
    { min: 800, name: 'Mighty Tree', emoji: '🌳✨' },
];

export function defaultTree(now = Date.now()) {
    return { height: 0, treesGrown: 0, totalWaterings: 0, contributors: {}, lastWatered: {}, plantedAt: now };
}

export function getTreeStage(height) {
    let current = TREE_STAGES[0];
    for (const stage of TREE_STAGES) {
        if (height >= stage.min) current = stage;
    }
    return current;
}

/** The next stage, or null when the tree is in its last stage (next goal is MAX_HEIGHT_CM). */
export function getNextStage(height) {
    return TREE_STAGES.find((stage) => stage.min > height) || null;
}

export function rollGrowth(rng = Math.random) {
    return MIN_GROWTH_CM + Math.floor(rng() * (MAX_GROWTH_CM - MIN_GROWTH_CM + 1));
}

/**
 * Pure: returns { ok:false, retryAt } while the person is on cooldown,
 * otherwise { ok:true, tree, growth, completed, stageChanged, newStage }.
 */
export function applyWatering(tree, userId, now, growth) {
    const last = tree.lastWatered?.[userId];
    if (last && now - last < WATER_COOLDOWN_MS) {
        return { ok: false, retryAt: last + WATER_COOLDOWN_MS };
    }

    // Only keep people who are still on cooldown, so this map stays tiny.
    const lastWatered = {};
    for (const [id, timestamp] of Object.entries(tree.lastWatered || {})) {
        if (now - timestamp < WATER_COOLDOWN_MS) lastWatered[id] = timestamp;
    }
    lastWatered[userId] = now;

    const grownHeight = tree.height + growth;
    const completed = grownHeight >= MAX_HEIGHT_CM;
    const previousStage = getTreeStage(tree.height);

    const next = {
        ...tree,
        height: completed ? 0 : grownHeight,
        treesGrown: tree.treesGrown + (completed ? 1 : 0),
        totalWaterings: tree.totalWaterings + 1,
        contributors: { ...tree.contributors, [userId]: (tree.contributors?.[userId] || 0) + 1 },
        lastWatered,
        plantedAt: completed ? now : tree.plantedAt,
    };

    const newStage = getTreeStage(next.height);
    return { ok: true, tree: next, growth, completed, stageChanged: !completed && newStage.name !== previousStage.name, newStage };
}

export function topContributors(tree, limit = 10) {
    return Object.entries(tree.contributors || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
}

const treeKey = (guildId) => `guild:${guildId}:tree`;

export async function getTree(client, guildId) {
    const stored = await client.db.get(treeKey(guildId), null);
    if (!stored || typeof stored !== 'object') return defaultTree();
    return { ...defaultTree(), ...stored };
}

export async function waterTree(client, guildId, userId, now = Date.now(), rng = Math.random) {
    return Mutex.runExclusive(`tree:${guildId}`, async () => {
        const tree = await getTree(client, guildId);
        const result = applyWatering(tree, userId, now, rollGrowth(rng));
        if (result.ok) {
            await client.db.set(treeKey(guildId), result.tree);
        }
        return result;
    });
}

export const WATER_FLAVOR = [
    'The roots drink it up.',
    'A few leaves wiggle happily.',
    'You hear the tree sigh in relief.',
    'A tiny bird chirps in thanks.',
    'The soil smells fresh.',
];

export const pickWaterFlavor = (rng = Math.random) => pickRandom(WATER_FLAVOR, rng);
