// Search-as-you-type for /play: shows "🎵 Title - Artist - 3:54" suggestions while the
// person is still typing, and remembers the exact track they pick.
//
// Discord sends an autocomplete request on every keystroke and gives the bot 3 seconds to
// answer, so searches are cached, identical in-flight searches are shared, and a slow search
// returns an empty list instead of failing (its result is still cached for the next keystroke).

import { logger } from '../../utils/logger.js';

const MIN_QUERY_LENGTH = 2;
const MAX_CHOICES = 10;
const MAX_CHOICE_LENGTH = 100;
const RESULT_TTL_MS = 60 * 1000;
const RESULT_CACHE_MAX = 200;
const SUGGESTION_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 500;
const DEFAULT_TIMEOUT_MS = 2500;

export function truncate(text, max) {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, Math.max(max - 1, 0)).trimEnd()}…` : value;
}

/** 234000 -> "3:54", 3725000 -> "1:02:05", streams -> "LIVE". */
export function formatDuration(ms, isStream = false) {
    if (isStream) return 'LIVE';
    const total = Math.floor(Number(ms) / 1000);
    if (!Number.isFinite(total) || total < 0) return '--:--';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function trackLabel(info) {
    return info.author ? `${info.title} - ${info.author}` : String(info.title);
}

/** Display text for a track. The duration is always kept visible; the title is what gets shortened. */
export function trackChoiceName(info) {
    const suffix = ` - ${formatDuration(info.length, info.isStream)}`;
    const base = `🎵 ${trackLabel(info)}`;
    return base.length + suffix.length <= MAX_CHOICE_LENGTH
        ? `${base}${suffix}`
        : `${truncate(base, MAX_CHOICE_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Turns search results into Discord choices. The submitted `value` is the plain text
 * "Title - Artist", so it still works as a normal search if the exact track is no longer cached.
 * @returns {Array<{ choice: { name: string, value: string }, track: object }>}
 */
export function buildTrackEntries(tracks, limit = MAX_CHOICES) {
    const entries = [];
    const used = new Set();

    for (const track of tracks || []) {
        const info = track?.info;
        if (!info?.title) continue;

        let value = truncate(trackLabel(info), MAX_CHOICE_LENGTH);
        if (used.has(value)) {
            value = truncate(`${trackLabel(info)} (${formatDuration(info.length, info.isStream)})`, MAX_CHOICE_LENGTH);
            if (used.has(value)) continue;
        }
        used.add(value);
        entries.push({ choice: { name: trackChoiceName(info), value }, track });
        if (entries.length >= limit) break;
    }
    return entries;
}

export function buildPlaylistEntry(playlistInfo, trackCount, query) {
    if (query.length > MAX_CHOICE_LENGTH) return null;
    const name = playlistInfo?.name || 'Playlist';
    const count = `(${trackCount} track${trackCount === 1 ? '' : 's'})`;
    return { choice: { name: truncate(`📁 ${name} ${count}`, MAX_CHOICE_LENGTH), value: query }, track: null };
}

// ---- caches ----

const suggestions = new Map();
const results = new Map();
const inflight = new Map();

function setBounded(map, key, value, max) {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value);
}

export function rememberSuggestion(userId, value, track, now = Date.now()) {
    if (!track) return;
    setBounded(suggestions, `${userId}:${value}`, { track, expires: now + SUGGESTION_TTL_MS }, SUGGESTION_CACHE_MAX);
}

/** The exact track this person picked from the suggestions (once), or null. */
export function takeSuggestedTrack(userId, value, now = Date.now()) {
    const key = `${userId}:${value}`;
    const entry = suggestions.get(key);
    if (!entry) return null;
    suggestions.delete(key);
    return entry.expires > now ? entry.track : null;
}

export function resetPlayAutocompleteCaches() {
    suggestions.clear();
    results.clear();
    inflight.clear();
}

async function searchEntries(query, resolveFn) {
    const result = await resolveFn(query);
    const loadType = result?.loadType;
    const tracks = result?.tracks || [];

    if (loadType === 'playlist' || loadType === 'PLAYLIST_LOADED') {
        const entry = buildPlaylistEntry(result.playlistInfo, tracks.length, query);
        return entry ? [entry] : [];
    }
    if (['search', 'track', 'SEARCH_RESULT', 'TRACK_LOADED'].includes(loadType)) {
        return buildTrackEntries(tracks);
    }
    return [];
}

/**
 * Choices for the /play `query` box.
 * @param {object} client Discord client (needs `client.riffy`)
 * @param {{ id: string }} user the person typing
 * @param {string} rawQuery what they have typed so far
 * @param {object} [options] `resolveFn` and `timeoutMs` let tests control the search
 * @returns {Promise<Array<{ name: string, value: string }>>}
 */
export async function getPlayChoices(client, user, rawQuery, options = {}) {
    const { now = Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const resolveFn = options.resolveFn ?? ((query) => client.riffy.resolve({ query, requester: user }));

    const query = String(rawQuery ?? '').trim();
    if (query.length < MIN_QUERY_LENGTH) return [];

    if (/^https?:\/\//i.test(query)) {
        return query.length <= MAX_CHOICE_LENGTH ? [{ name: truncate(`🔗 ${query}`, MAX_CHOICE_LENGTH), value: query }] : [];
    }

    const key = query.toLowerCase();
    let entries;

    const cached = results.get(key);
    if (cached && now - cached.at < RESULT_TTL_MS) {
        entries = cached.entries;
    } else {
        let pending = inflight.get(key);
        if (!pending) {
            pending = searchEntries(query, resolveFn)
                .then((found) => {
                    setBounded(results, key, { at: Date.now(), entries: found }, RESULT_CACHE_MAX);
                    return found;
                })
                .finally(() => inflight.delete(key));
            inflight.set(key, pending);
        }

        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        try {
            entries = await Promise.race([pending, timeout]);
        } catch (error) {
            logger.debug('Play autocomplete search failed', { query, error: error?.message });
            return [];
        } finally {
            clearTimeout(timer);
        }
        // A slow search keeps running and lands in the cache; this keystroke just gets no suggestions.
        if (!entries) {
            pending.catch(() => {});
            return [];
        }
    }

    for (const entry of entries) {
        rememberSuggestion(user.id, entry.choice.value, entry.track, now);
    }
    return entries.map((entry) => entry.choice);
}
