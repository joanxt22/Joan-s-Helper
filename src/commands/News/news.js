import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { NEWS_GAMES, NEWS_GAME_KEYS } from '../../config/news/sources.js';
import {
    NewsError,
    fetchSourceItems,
    getXToken,
    getNewsConfig,
    saveNewsConfig,
} from '../../services/news/newsService.js';

const ADMIN_SUBCOMMANDS = new Set(['setup', 'disable']);
const ITEMS_PER_SOURCE = 3;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function describeItem(item) {
    const label = item.title ? `**${clip(item.title, 120)}**` : clip(item.summary.replace(/\s+/g, ' '), 180);
    const link = /^https?:\/\//i.test(item.url) ? ` — [open](${item.url})` : '';
    const when = item.publishedAt ? ` <t:${Math.floor(item.publishedAt / 1000)}:R>` : '';
    return `• ${label}${link}${when}`;
}

async function buildGameEmbed(gameKey) {
    const game = NEWS_GAMES[gameKey];
    const lines = [];
    const problems = new Set();

    for (const source of game.sources) {
        try {
            const items = await fetchSourceItems(source);
            lines.push(...items.slice(0, ITEMS_PER_SOURCE).map(describeItem));
        } catch (error) {
            if (error instanceof NewsError) {
                problems.add(error.userMessage);
            } else {
                logger.error(`News fetch failed for ${gameKey}:`, error);
                problems.add('Something went wrong loading this news.');
            }
        }
    }

    const description = lines.length > 0
        ? lines.join('\n')
        : [...problems].join('\n') || 'No recent posts found.';

    return new EmbedBuilder()
        .setColor(game.color)
        .setTitle(`${game.emoji} ${game.label} news`)
        .setDescription(clip(description, 4000));
}

export default {
    slashOnly: true,
    category: 'News',
    data: new SlashCommandBuilder()
        .setName('news')
        .setDescription('Fortnite, Roblox and Minecraft news from official sources')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('latest').setDescription('Show the latest news')
                .addStringOption((o) => o.setName('game').setDescription('Which game (default: all)')
                    .addChoices(...NEWS_GAME_KEYS.map((value) => ({ name: NEWS_GAMES[value].label, value })))))
        .addSubcommand((sub) =>
            sub.setName('setup').setDescription('Post new stories automatically in a channel (Manage Server)')
                .addChannelOption((o) => o.setName('channel').setDescription('Where to post the news')
                    .addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addBooleanOption((o) => o.setName('fortnite').setDescription('Follow Fortnite (default: yes)'))
                .addBooleanOption((o) => o.setName('roblox').setDescription('Follow Roblox (default: yes)'))
                .addBooleanOption((o) => o.setName('minecraft').setDescription('Follow Minecraft (default: yes)')))
        .addSubcommand((sub) => sub.setName('disable').setDescription('Stop automatic news posts (Manage Server)')),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (ADMIN_SUBCOMMANDS.has(subcommand) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'latest') {
                await interaction.deferReply();
                const chosen = interaction.options.getString('game');
                const keys = chosen ? [chosen] : NEWS_GAME_KEYS;
                const embeds = [];
                for (const key of keys) embeds.push(await buildGameEmbed(key));
                return await interaction.editReply({ embeds, allowedMentions: { parse: [] } });
            }

            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel', true);
                const me = interaction.guild.members.me;
                if (!channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                    return await interaction.reply({ content: `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel} first.`, flags: MessageFlags.Ephemeral });
                }

                const picked = NEWS_GAME_KEYS.filter((key) => interaction.options.getBoolean(key));
                const games = picked.length > 0
                    ? picked
                    : NEWS_GAME_KEYS.filter((key) => interaction.options.getBoolean(key) !== false);
                if (games.length === 0) {
                    return await interaction.reply({ content: 'Pick at least one game to follow.', flags: MessageFlags.Ephemeral });
                }

                await saveNewsConfig(client, interaction.guildId, { enabled: true, channelId: channel.id, games });

                const lines = [
                    `📰 New **${games.map((key) => NEWS_GAMES[key].label).join(', ')}** stories will be posted in ${channel} (checked every 30 minutes).`,
                    'Only stories published from now on are posted. Use `/news latest` to see recent ones.',
                ];
                const needsX = games.some((key) => NEWS_GAMES[key].sources.some((source) => source.type === 'x'));
                if (needsX && !getXToken()) {
                    lines.push('⚠️ `X_BEARER_TOKEN` is not set on the bot yet, so X sources cannot be read until the bot owner adds it.');
                }
                return await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'disable') {
                const config = await getNewsConfig(client, interaction.guildId);
                await saveNewsConfig(client, interaction.guildId, { ...config, enabled: false });
                return await interaction.reply({ content: 'Automatic news posts are off.', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            logger.error('News command error:', error);
            const payload = { content: 'Something went wrong with the news command. Please try again.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
            else await interaction.reply(payload).catch(() => {});
        }
    },
};
