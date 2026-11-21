// Fetching and storing news. No Discord objects in here; HTTP is injectable for tests.

import axios from 'axios';
import { logger } from '../../utils/logger.js';
import { sourceKey } from '../../config/news/sources.js';
import { parseFeed, normalizeXTimeline } from './feedParser.js';

export const LATEST_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;

/** Error whose `userMessage` is safe to show to the person running the command. */
export class NewsError extends Error {
    constructor(message, userMessage = message) {
        super(message);
        this.name = 'NewsError';
        this.userMessage = userMessage;
    }
}

export const getXToken = () => (process.env.X_BEARER_TOKEN || '').trim() || null;
const getXBase = () => (process.env.X_API_BASE || 'https://api.x.com/2').replace(/\/+$/, '');

/** A source can be fetched right now (X sources need a token, feeds always can). */
export const isSourceConfigured = (source) => source.type !== 'x' || getXToken() !== null;

const userIdCache = new Map();
const rateLimitedUntil = new Map();
const itemCache = new Map();

export function resetNewsCaches() {
    userIdCache.clear();
    rateLimitedUntil.clear();
    itemCache.clear();
}

async function xGet(path, params, { http, token, key, now }) {
    try {
        const response = await http.get(`${getXBase()}${path}`, {
            params,
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000,
        });
        return response.data;
    } catch (error) {
        const status = error?.response?.status;
        if (status === 429) {
            const reset = Number(error.response.headers?.['x-rate-limit-reset']);
            rateLimitedUntil.set(key, Number.isFinite(reset) && reset > 0 ? reset * 1000 : now + DEFAULT_RATE_LIMIT_PAUSE_MS);
            throw new NewsError('X rate limited', 'X is rate limiting this source right now. Try again in a bit.');
        }
        if (status === 401 || status === 403) {
            throw new NewsError('X auth failed', 'X rejected the bot\'s access. Check X_BEARER_TOKEN and that your X API plan allows reading posts.');
        }
        if (status === 404) {
            throw new NewsError('X not found', 'That X account could not be found.');
        }
        logger.warn('X API request failed', { path, status, error: error?.message });
        throw new NewsError('X request failed', 'Could not reach X right now. Try again later.');
    }
}

export async function fetchXPosts(handle, { http = axios, token = getXToken(), now = Date.now() } = {}) {
    if (!token) {
        throw new NewsError('Missing X token', 'X news is not set up yet. The bot owner needs to add X_BEARER_TOKEN.');
    }

    const key = sourceKey({ type: 'x', handle });
    if ((rateLimitedUntil.get(key) || 0) > now) {
        throw new NewsError('X rate limited', 'X is rate limiting this source right now. Try again in a bit.');
    }

    const context = { http, token, key, now };
    const cacheKey = handle.toLowerCase();
    let userId = userIdCache.get(cacheKey);
    if (!userId) {
        const user = await xGet(`/users/by/username/${encodeURIComponent(handle)}`, {}, context);
        userId = user?.data?.id;
        if (!userId) {
            throw new NewsError('X user missing', `Could not find the X account @${handle}.`);
        }
        userIdCache.set(cacheKey, userId);
    }

    const timeline = await xGet(
        `/users/${userId}/tweets`,
        { max_results: 5, exclude: 'retweets,replies', 'tweet.fields': 'created_at' },
        context,
    );
    return normalizeXTimeline(timeline, handle);
}

export async function fetchFeedItems(url, { http = axios } = {}) {
    try {
        const response = await http.get(url, {
            responseType: 'text',
            timeout: 10000,
            maxContentLength: MAX_FEED_BYTES,
            maxRedirects: 3,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; DiscordNewsBot/1.0)',
                Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            },
        });
        return parseFeed(response.data);
    } catch (error) {
        logger.warn('Feed request failed', { url, error: error?.message });
        throw new NewsError('Feed request failed', 'Could not load that news feed right now.');
    }
}

/** Items for one source, cached for LATEST_CACHE_MS unless `force` is set. */
export async function fetchSourceItems(source, { force = false, now = Date.now(), http = axios, token } = {}) {
    const key = sourceKey(source);
    const cached = itemCache.get(key);
    if (!force && cached && now - cached.at < LATEST_CACHE_MS) {
        return cached.items;
    }

    const items = source.type === 'x'
        ? await fetchXPosts(source.handle, { http, now, ...(token !== undefined ? { token } : {}) })
        : await fetchFeedItems(source.url, { http });

    itemCache.set(key, { at: now, items });
    return items;
}

// ---- per-server storage ----

const configKey = (guildId) => `guild:${guildId}:news:config`;
const stateKey = (guildId) => `guild:${guildId}:news:state`;

export async function getNewsConfig(client, guildId) {
    const stored = await client.db.get(configKey(guildId), null);
    return {
        enabled: Boolean(stored?.enabled),
        channelId: stored?.channelId || null,
        games: Array.isArray(stored?.games) ? stored.games : [],
    };
}

export async function saveNewsConfig(client, guildId, config) {
    const value = { enabled: Boolean(config.enabled), channelId: config.channelId || null, games: config.games || [] };
    await client.db.set(configKey(guildId), value);
    return value;
}

/** @returns {Promise<{ seen: Record<string, string[]> }>} */
export async function getNewsState(client, guildId) {
    const stored = await client.db.get(stateKey(guildId), null);
    return { seen: stored && typeof stored.seen === 'object' && stored.seen ? stored.seen : {} };
}

export async function saveNewsState(client, guildId, state) {
    await client.db.set(stateKey(guildId), state);
}
