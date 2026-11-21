import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import {
    RARITIES,
    CAT_TYPES,
    getCatConfig,
    saveCatConfig,
    getUserCats,
    getCatBoard,
    summarizeCats,
} from '../../services/cats/catLogic.js';
import { spawnCat } from '../../services/cats/catSpawner.js';

const ADMIN_SUBCOMMANDS = new Set(['setup', 'disable', 'spawn']);
const MEDALS = ['🥇', '🥈', '🥉'];

export default {
    slashOnly: true,
    category: 'Fun',
    data: new SlashCommandBuilder()
        .setName('cat')
        .setDescription('Catch cats that appear while you chat')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('setup').setDescription('Choose the channel where cats appear (Manage Server)')
                .addChannelOption((o) => o.setName('channel').setDescription('Cats will appear here as people chat')
                    .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((sub) => sub.setName('disable').setDescription('Stop cats from appearing (Manage Server)'))
        .addSubcommand((sub) => sub.setName('spawn').setDescription('Make a cat appear right now (Manage Server)'))
        .addSubcommand((sub) =>
            sub.setName('inventory').setDescription('See your cat collection')
                .addUserOption((o) => o.setName('user').setDescription('Whose collection to view (default: you)')))
        .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Who has caught the most cats')),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (ADMIN_SUBCOMMANDS.has(subcommand) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
            }

            const guildId = interaction.guildId;

            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel', true);
                const me = interaction.guild.members.me;
                const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
                if (!channel.permissionsFor(me)?.has(needed)) {
                    return await interaction.reply({ content: `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel} first.`, flags: MessageFlags.Ephemeral });
                }
                await saveCatConfig(client, guildId, { enabled: true, channelId: channel.id });
                return await interaction.reply({
                    content: `🐱 Cats will now appear in ${channel} as people chat (roughly every 25-60 messages). Use \`/cat spawn\` to test it.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (subcommand === 'disable') {
                const config = await getCatConfig(client, guildId);
                await saveCatConfig(client, guildId, { enabled: false, channelId: config.channelId });
                return await interaction.reply({ content: 'Cats will no longer appear. Everyone keeps their collection.', flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'spawn') {
                const config = await getCatConfig(client, guildId);
                const channel = config.channelId ? interaction.guild.channels.cache.get(config.channelId) : null;
                if (!config.enabled || !channel) {
                    return await interaction.reply({ content: 'Set a channel first with `/cat setup`.', flags: MessageFlags.Ephemeral });
                }
                const spawned = await spawnCat(client, channel);
                return await interaction.reply({
                    content: spawned ? `A cat is on its way to ${channel}!` : `There is already a cat waiting in ${channel}.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (subcommand === 'inventory') {
                const target = interaction.options.getUser('user') || interaction.user;
                const user = await getUserCats(client, guildId, target.id);
                const summary = summarizeCats(user);

                const embed = new EmbedBuilder()
                    .setColor(getColor('primary'))
                    .setTitle(`🐾 ${target.globalName || target.username}'s cats`);

                if (user.total === 0) {
                    embed.setDescription('No cats yet. Keep an eye on the cat channel!');
                } else {
                    const rarityLine = Object.entries(RARITIES)
                        .map(([key, rarity]) => `${rarity.label}: **${summary.byRarity[key]}**`)
                        .join(' • ');
                    const list = summary.owned
                        .map(({ cat, count }) => `${cat.emoji} ${cat.name} ×${count} *(${RARITIES[cat.rarity].label})*`)
                        .join('\n');
                    embed
                        .setDescription(`**${user.total}** caught • **${summary.uniqueOwned}/${CAT_TYPES.length}** kinds collected\n${rarityLine}`)
                        .addFields({ name: 'Collection', value: list });
                }
                return await interaction.reply({ embeds: [embed] });
            }

            if (subcommand === 'leaderboard') {
                const board = await getCatBoard(client, guildId, 10);
                const lines = board.map(([userId, total], index) => `${MEDALS[index] || `**${index + 1}.**`} <@${userId}> — ${total} cat${total === 1 ? '' : 's'}`);
                const embed = new EmbedBuilder()
                    .setColor(getColor('primary'))
                    .setTitle('🏆 Top Cat Catchers')
                    .setDescription(lines.length ? lines.join('\n') : 'Nobody has caught a cat yet!');
                return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            }

            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Unknown cat action.' });
        } catch (error) {
            logger.error('Cat command error:', error);
            const payload = { content: 'Something went wrong with the cats. Please try again.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
            else await interaction.reply(payload).catch(() => {});
        }
    },
};
