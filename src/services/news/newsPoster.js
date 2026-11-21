import { EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { NEWS_GAMES, sourceKey } from '../../config/news/sources.js';
import { selectNewItems, mergeSeen } from './feedParser.js';
import {
    NewsError,
    isSourceConfigured,
    fetchSourceItems,
    getNewsConfig,
    getNewsState,
    saveNewsState,
} from './newsService.js';

const MAX_POSTS_PER_SOURCE_PER_RUN = 3;
let polling = false;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const isHttpUrl = (value) => /^https?:\/\//i.test(value || '');

export function buildNewsEmbed(game, source, item) {
    const embed = new EmbedBuilder()
        .setColor(game.color)
        .setAuthor({ name: `${game.emoji} ${source.label || game.label}` })
        .setFooter({ text: `Source: ${source.label || game.label}` });

    if (item.title) {
        embed.setTitle(clip(item.title, 256));
        if (isHttpUrl(item.url)) embed.setURL(item.url);
        if (item.summary) embed.setDescription(clip(item.summary, 1500));
    } else {
        const link = isHttpUrl(item.url) ? `\n\n[Open post](${item.url})` : '';
        embed.setDescription(`${clip(item.summary, 3500)}${link}`);
    }

    if (item.publishedAt) embed.setTimestamp(item.publishedAt);
    return embed;
}

/**
 * Checks every source that at least one server follows (once per source, shared by all servers)
 * and posts stories each server has not seen yet. The first run for a source only records what
 * already exists so enabling news never floods the channel.
 */
export async function pollNews(client) {
    if (polling) return;
    polling = true;

    try {
        const subscriptions = [];
        for (const guild of client.guilds.cache.values()) {
            const config = await getNewsConfig(client, guild.id);
            if (config.enabled && config.channelId && config.games.length > 0) {
                subscriptions.push({ guild, config });
            }
        }
        if (subscriptions.length === 0) return;

        const wantedGames = new Set(subscriptions.flatMap(({ config }) => config.games));
        const fetched = new Map();

        for (const gameKey of wantedGames) {
            for (const source of NEWS_GAMES[gameKey]?.sources || []) {
                const key = sourceKey(source);
                if (fetched.has(key) || !isSourceConfigured(source)) continue;
                try {
                    fetched.set(key, await fetchSourceItems(source, { force: true }));
                } catch (error) {
                    if (error instanceof NewsError) logger.warn(`News source ${key} skipped: ${error.message}`);
                    else logger.error(`News source ${key} failed:`, error);
                }
            }
        }

        for (const { guild, config } of subscriptions) {
            const channel = guild.channels.cache.get(config.channelId);
            const me = guild.members.me;
            if (!channel?.isTextBased() || !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                logger.debug(`News: cannot post in channel ${config.channelId} of guild ${guild.id}`);
                continue;
            }

            const state = await getNewsState(client, guild.id);
            let changed = false;

            for (const gameKey of config.games) {
                const game = NEWS_GAMES[gameKey];
                if (!game) continue;

                for (const source of game.sources) {
                    const key = sourceKey(source);
                    const items = fetched.get(key);
                    if (!items) continue;

                    const seen = state.seen[key];
                    const fresh = selectNewItems(items, seen || [], { baseline: seen === undefined, limit: MAX_POSTS_PER_SOURCE_PER_RUN });
                    for (const item of fresh) {
                        try {
                            await channel.send({ embeds: [buildNewsEmbed(game, source, item)], allowedMentions: { parse: [] } });
                        } catch (error) {
                            logger.warn(`News: failed to post in guild ${guild.id}`, { error: error.message });
                        }
                    }

                    state.seen[key] = mergeSeen(seen || [], items);
                    changed = true;
                }
            }

            if (changed) await saveNewsState(client, guild.id, state);
        }
    } finally {
        polling = false;
    }
}
