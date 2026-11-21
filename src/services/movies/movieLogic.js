// Movie pool rules + wheel maths + storage. No Discord objects in here.

import { Mutex } from '../../utils/mutex.js';

export const MAX_POOL_SIZE = 100;
export const MAX_PER_USER = 5;
export const MAX_TITLE_LENGTH = 100;

/** "Inception (2010)" -> { title: 'Inception', year: 2010 } */
export function parseTitleInput(input) {
    const cleaned = String(input ?? '').replace(/\s+/g, ' ').trim();
    const match = cleaned.match(/^(.*?)\s*\((\d{4})\)$/);
    if (match && match[1].trim()) {
        return { title: match[1].trim(), year: Number(match[2]) };
    }
    return { title: cleaned, year: null };
}

export function normalizeTitle(title) {
    return String(title ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export const formatMovie = (movie) => (movie.year ? `${movie.title} (${movie.year})` : movie.title);

/**
 * Pure. Returns { ok:true, pool, movie } or { ok:false, reason, ... } where reason is one of
 * empty | too_long | duplicate | pool_full | user_limit.
 */
export function addToPool(pool, { title, year = null, userId, now = Date.now(), exemptFromLimit = false }) {
    const clean = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return { ok: false, reason: 'empty' };
    if (clean.length > MAX_TITLE_LENGTH) return { ok: false, reason: 'too_long' };
    if (pool.length >= MAX_POOL_SIZE) return { ok: false, reason: 'pool_full' };

    const key = normalizeTitle(clean);
    if (pool.some((movie) => normalizeTitle(movie.title) === key)) {
        return { ok: false, reason: 'duplicate' };
    }
    if (!exemptFromLimit && pool.filter((movie) => movie.addedBy === userId).length >= MAX_PER_USER) {
        return { ok: false, reason: 'user_limit' };
    }

    const movie = { id: `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, title: clean, year, addedBy: userId, addedAt: now };
    return { ok: true, pool: [...pool, movie], movie };
}

/** Removes by title (year in parentheses optional). */
export function removeFromPool(pool, query) {
    const { title, year } = parseTitleInput(query);
    const key = normalizeTitle(title);
    if (!key) return { ok: false, reason: 'empty' };

    const index = pool.findIndex((movie) => normalizeTitle(movie.title) === key && (year === null || movie.year === year));
    if (index === -1) return { ok: false, reason: 'not_found' };

    const removed = pool[index];
    return { ok: true, pool: pool.filter((_, i) => i !== index), removed };
}

export function filterCatalog(catalog, genre) {
    if (!genre) return catalog;
    return catalog.filter((movie) => movie.genres.includes(genre));
}

/** Titles that start with the query first, then ones that merely contain it. */
export function searchCatalog(catalog, query, limit = 25) {
    const key = normalizeTitle(query);
    if (!key) return catalog.slice(0, limit);
    const starts = [];
    const contains = [];
    for (const movie of catalog) {
        const normalized = normalizeTitle(movie.title);
        if (normalized.startsWith(key)) starts.push(movie);
        else if (normalized.includes(key)) contains.push(movie);
    }
    return [...starts, ...contains].slice(0, limit);
}

// ---------- wheel ----------

/**
 * Indexes shown on each animation frame. The last frame is always `winnerIndex`,
 * and each earlier frame steps one entry back, so the "wheel" appears to roll onto the winner.
 */
export function buildSpinSequence(count, winnerIndex, steps) {
    const sequence = [];
    for (let k = 0; k < steps; k += 1) {
        const offset = steps - 1 - k;
        sequence.push((((winnerIndex - offset) % count) + count) % count);
    }
    return sequence;
}

/** Entries around `index` (wrapping), for the text animation. */
export function frameWindow(titles, index, radius = 2) {
    const lines = [];
    for (let offset = -radius; offset <= radius; offset += 1) {
        lines.push({ offset, title: titles[(((index + offset) % titles.length) + titles.length) % titles.length] });
    }
    return lines;
}

/** Rotation (radians) that parks the centre of segment `winnerIndex` under a pointer at 12 o'clock. */
export function wheelRotation(winnerIndex, count) {
    return -(winnerIndex + 0.5) * ((Math.PI * 2) / count);
}

// ---------- storage ----------

const poolKey = (guildId) => `guild:${guildId}:movies:pool`;

export async function getPool(client, guildId) {
    const stored = await client.db.get(poolKey(guildId), null);
    return Array.isArray(stored) ? stored : [];
}

export async function updatePool(client, guildId, mutate) {
    return Mutex.runExclusive(`movies:${guildId}`, async () => {
        const pool = await getPool(client, guildId);
        const result = mutate(pool);
        if (result.ok) {
            await client.db.set(poolKey(guildId), result.pool);
        }
        return result;
    });
}
