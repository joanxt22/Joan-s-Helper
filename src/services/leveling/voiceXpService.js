// Voice (call) XP: once a minute everyone sitting in a voice channel earns XP.
//
// No session tracking is needed. A minute-by-minute check survives restarts and reconnects
// and can't be gamed by rapidly joining and leaving. The rules live in small pure functions
// so they can be tested without Discord (see tests/voiceXp.test.js).

import { logger } from '../../utils/logger.js';

export const DEFAULT_VOICE_XP = Object.freeze({
    enabled: true,
    xpPerMinute: Object.freeze({ min: 8, max: 12 }),
    requireOthers: true,
    ignoredChannels: Object.freeze([]),
});

const MAX_XP_PER_MINUTE = 500;

function clampInt(value, min, max, fallback) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, min), max);
}

/** Reads the `voiceXp` block of the leveling config and fills in safe defaults. */
export function getVoiceXpSettings(levelingConfig) {
    const raw = levelingConfig?.voiceXp || {};
    const min = clampInt(raw.xpPerMinute?.min, 1, MAX_XP_PER_MINUTE, DEFAULT_VOICE_XP.xpPerMinute.min);
    const max = clampInt(raw.xpPerMinute?.max, min, MAX_XP_PER_MINUTE, Math.max(min, DEFAULT_VOICE_XP.xpPerMinute.max));

    return {
        enabled: raw.enabled !== false,
        xpPerMinute: { min, max },
        requireOthers: raw.requireOthers !== false,
        ignoredChannels: Array.isArray(raw.ignoredChannels) ? raw.ignoredChannels.map(String) : [],
    };
}

/** XP for one minute in a call, with the server's XP multiplier applied. */
export function rollVoiceXp(settings, multiplier = 1, rng = Math.random) {
    const { min, max } = settings.xpPerMinute;
    const base = min + Math.min(Math.floor(rng() * (max - min + 1)), max - min);
    const factor = Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 1;
    return Math.floor(base * factor);
}

/** A person actually taking part: a real member, in a channel, not deafened. Muted is fine (listening counts). */
export function isEligibleVoiceState(state) {
    return Boolean(
        state?.member
        && !state.member.user?.bot
        && state.channelId
        && !state.selfDeaf
        && !state.serverDeaf,
    );
}

/** @returns {Map<string, Array>} channelId -> members who could earn XP there */
export function groupEligibleByChannel(voiceStates, { afkChannelId = null, ignoredChannelIds = new Set() } = {}) {
    const groups = new Map();
    for (const state of voiceStates) {
        if (!isEligibleVoiceState(state)) continue;
        if (state.channelId === afkChannelId || ignoredChannelIds.has(state.channelId)) continue;
        if (!groups.has(state.channelId)) groups.set(state.channelId, []);
        groups.get(state.channelId).push(state.member);
    }
    return groups;
}

/** Applies the per-person rules (and "needs company") and returns who earns XP this minute. */
export function pickXpRecipients(groups, { requireOthers = true, ignoredRoles = [], blacklistedUsers = [] } = {}) {
    const blocked = new Set(blacklistedUsers.map(String));
    const recipients = [];

    for (const members of groups.values()) {
        // Company counts everyone who is really there, even people who are ignored for XP.
        if (requireOthers && members.length < 2) continue;

        for (const member of members) {
            if (blocked.has(member.user.id)) continue;
            if (ignoredRoles.length > 0 && member.roles?.cache?.some((role) => ignoredRoles.includes(role.id))) continue;
            recipients.push(member);
        }
    }
    return recipients;
}

let running = false;

/**
 * Gives one minute of XP to everyone currently eligible in every server.
 * `deps` lets tests replace the XP/config functions.
 */
export async function awardVoiceXp(client, deps = {}) {
    // Loaded on first use so the pure rules above can be imported (and tested) without
    // pulling in the database layer.
    const addXpFn = deps.addXpFn ?? (await import('./xpSystem.js')).addXp;
    const getConfigFn = deps.getConfigFn ?? (await import('./leveling.js')).getLevelingConfig;
    const rng = deps.rng ?? Math.random;
    const summary = { guilds: 0, awarded: 0, failed: 0, skipped: false };

    if (running) {
        summary.skipped = true;
        return summary;
    }
    running = true;

    try {
        for (const guild of client.guilds.cache.values()) {
            if (guild.voiceStates.cache.size === 0) continue;

            let config;
            try {
                config = await getConfigFn(client, guild.id);
            } catch (error) {
                logger.warn(`Voice XP: could not load leveling config for guild ${guild.id}`, { error: error.message });
                continue;
            }
            if (!config?.enabled) continue;

            const settings = getVoiceXpSettings(config);
            if (!settings.enabled) continue;

            const ignoredChannelIds = new Set([...(config.ignoredChannels || []), ...settings.ignoredChannels].map(String));
            const groups = groupEligibleByChannel(guild.voiceStates.cache.values(), {
                afkChannelId: guild.afkChannelId,
                ignoredChannelIds,
            });
            const recipients = pickXpRecipients(groups, {
                requireOthers: settings.requireOthers,
                ignoredRoles: config.ignoredRoles || [],
                blacklistedUsers: config.blacklistedUsers || [],
            });
            if (recipients.length === 0) continue;

            summary.guilds += 1;
            for (const member of recipients) {
                try {
                    await addXpFn(client, guild, member, rollVoiceXp(settings, config.xpMultiplier, rng), { source: 'voice' });
                    summary.awarded += 1;
                } catch (error) {
                    summary.failed += 1;
                    logger.warn(`Voice XP: failed to award ${member.user.id} in guild ${guild.id}`, { error: error.message });
                }
            }
        }
        return summary;
    } finally {
        running = false;
    }
}
