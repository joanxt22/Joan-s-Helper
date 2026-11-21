// Cat catching game: rules, pacing and storage. No Discord objects in here.

import { Mutex } from '../../utils/mutex.js';
import { logger } from '../../utils/logger.js';
import { pickRandom } from '../fun/gameLogic.js';

export const RARITIES = {
    common: { label: 'Common', weight: 60, color: '#95a5a6', order: 0 },
    uncommon: { label: 'Uncommon', weight: 25, color: '#2ecc71', order: 1 },
    rare: { label: 'Rare', weight: 10, color: '#3498db', order: 2 },
    epic: { label: 'Epic', weight: 4, color: '#9b59b6', order: 3 },
    legendary: { label: 'Legendary', weight: 1, color: '#f1c40f', order: 4 },
};

export const CAT_TYPES = [
    { id: 'tabby', name: 'Tabby Cat', emoji: '🐱', rarity: 'common' },
    { id: 'ginger', name: 'Ginger Cat', emoji: '🐈', rarity: 'common' },
    { id: 'black', name: 'Black Cat', emoji: '🐈‍⬛', rarity: 'common' },
    { id: 'happy', name: 'Happy Cat', emoji: '😺', rarity: 'common' },
    { id: 'grinning', name: 'Grinning Cat', emoji: '😸', rarity: 'uncommon' },
    { id: 'smirk', name: 'Smirking Cat', emoji: '😼', rarity: 'uncommon' },
    { id: 'kissy', name: 'Kissy Cat', emoji: '😽', rarity: 'uncommon' },
    { id: 'heart', name: 'Heart-Eyes Cat', emoji: '😻', rarity: 'rare' },
    { id: 'ninja', name: 'Ninja Cat', emoji: '🥷', rarity: 'rare' },
    { id: 'wizard', name: 'Wizard Cat', emoji: '🧙', rarity: 'epic' },
    { id: 'royal', name: 'Royal Cat', emoji: '👑', rarity: 'epic' },
    { id: 'golden', name: 'Golden Cat', emoji: '🌟', rarity: 'legendary' },
    { id: 'dragon', name: 'Dragon Cat', emoji: '🐉', rarity: 'legendary' },
];

const CATS_BY_ID = new Map(CAT_TYPES.map((cat) => [cat.id, cat]));
export const getCatById = (id) => CATS_BY_ID.get(id) || null;

export function pickRarity(rng = Math.random) {
    const entries = Object.entries(RARITIES);
    const total = entries.reduce((sum, [, rarity]) => sum + rarity.weight, 0);
    let roll = rng() * total;
    for (const [key, rarity] of entries) {
        roll -= rarity.weight;
        if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
}

export function pickCat(rng = Math.random) {
    const rarity = pickRarity(rng);
    return pickRandom(CAT_TYPES.filter((cat) => cat.rarity === rarity), rng);
}

// ---- spawn pacing (in memory; resets on restart, which is fine) ----

export const SPAWN_MIN_MESSAGES = 25;
export const SPAWN_MAX_MESSAGES = 60;
export const SPAWN_MIN_INTERVAL_MS = 3 * 60 * 1000;

const pace = new Map();

function randomThreshold(rng) {
    return SPAWN_MIN_MESSAGES + Math.floor(rng() * (SPAWN_MAX_MESSAGES - SPAWN_MIN_MESSAGES + 1));
}

/** Call once per chat message in the cat channel. Returns true when a cat should appear now. */
export function registerMessage(guildId, now = Date.now(), rng = Math.random) {
    let state = pace.get(guildId);
    if (!state) {
        state = { count: 0, threshold: randomThreshold(rng), lastSpawnAt: 0 };
        pace.set(guildId, state);
    }
    state.count += 1;
    if (state.count >= state.threshold && now - state.lastSpawnAt >= SPAWN_MIN_INTERVAL_MS) {
        state.count = 0;
        state.threshold = randomThreshold(rng);
        state.lastSpawnAt = now;
        return true;
    }
    return false;
}

export function resetPacing(guildId) {
    if (guildId === undefined) pace.clear();
    else pace.delete(guildId);
}

// ---- storage ----

const CONFIG_TTL_MS = 60 * 1000;
const configCache = new Map();

const configKey = (guildId) => `guild:${guildId}:cats:config`;
const userKey = (guildId, userId) => `guild:${guildId}:cats:user:${userId}`;
const boardKey = (guildId) => `guild:${guildId}:cats:board`;

export async function getCatConfig(client, guildId, now = Date.now()) {
    const cached = configCache.get(guildId);
    if (cached && now - cached.at < CONFIG_TTL_MS) return cached.value;

    let value = { enabled: false, channelId: null };
    try {
        const stored = await client.db.get(configKey(guildId), null);
        if (stored && typeof stored === 'object') {
            value = { enabled: Boolean(stored.enabled), channelId: stored.channelId || null };
        }
    } catch (error) {
        logger.warn(`Failed to load cat config for guild ${guildId}`, { error: error.message });
    }
    configCache.set(guildId, { at: now, value });
    return value;
}

export async function saveCatConfig(client, guildId, config) {
    const value = { enabled: Boolean(config.enabled), channelId: config.channelId || null };
    await client.db.set(configKey(guildId), value);
    configCache.set(guildId, { at: Date.now(), value });
    return value;
}

export function clearConfigCache() {
    configCache.clear();
}

const emptyUser = () => ({ total: 0, byCat: {} });

export async function recordCatch(client, guildId, userId, cat) {
    return Mutex.runExclusive(`cats:${guildId}`, async () => {
        const stored = await client.db.get(userKey(guildId, userId), null);
        const user = stored && typeof stored === 'object' ? { ...emptyUser(), ...stored } : emptyUser();
        user.byCat = { ...user.byCat, [cat.id]: (user.byCat[cat.id] || 0) + 1 };
        user.total += 1;
        await client.db.set(userKey(guildId, userId), user);

        const board = (await client.db.get(boardKey(guildId), null)) || {};
        board[userId] = user.total;
        await client.db.set(boardKey(guildId), board);

        return user;
    });
}

export async function getUserCats(client, guildId, userId) {
    const stored = await client.db.get(userKey(guildId, userId), null);
    return stored && typeof stored === 'object' ? { ...emptyUser(), ...stored } : emptyUser();
}

/** @returns {Promise<Array<[string, number]>>} top entries, highest first */
export async function getCatBoard(client, guildId, limit = 10) {
    const board = (await client.db.get(boardKey(guildId), null)) || {};
    return Object.entries(board)
        .filter(([, total]) => Number.isFinite(total) && total > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
}

/** Pure: owned cats grouped for display, rarest first. */
export function summarizeCats(user) {
    const owned = Object.entries(user.byCat || {})
        .map(([id, count]) => ({ cat: getCatById(id), count }))
        .filter((entry) => entry.cat && entry.count > 0)
        .sort((a, b) => RARITIES[b.cat.rarity].order - RARITIES[a.cat.rarity].order || b.count - a.count);

    const byRarity = {};
    for (const key of Object.keys(RARITIES)) byRarity[key] = 0;
    for (const { cat, count } of owned) byRarity[cat.rarity] += count;

    return { owned, byRarity, uniqueOwned: owned.length, uniqueTotal: CAT_TYPES.length };
}
