import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { progressBar } from '../../services/fun/gameLogic.js';
import {
    MAX_HEIGHT_CM,
    WATER_COOLDOWN_MS,
    getTree,
    waterTree,
    getTreeStage,
    getNextStage,
    topContributors,
    pickWaterFlavor,
} from '../../services/tree/treeLogic.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function describeProgress(height) {
    const next = getNextStage(height);
    const goal = next ? next.min : MAX_HEIGHT_CM;
    const label = next ? `${next.emoji} ${next.name}` : '🎉 a fully grown tree';
    const stageStart = getTreeStage(height).min;
    const fraction = (height - stageStart) / (goal - stageStart);
    return `\`${progressBar(fraction, 12)}\` **${height}/${goal} cm** to ${label}`;
}

export default {
    slashOnly: true,
    category: 'Fun',
    data: new SlashCommandBuilder()
        .setName('tree')
        .setDescription('Grow the server tree together')
        .setDMPermission(false)
        .addSubcommand((sub) => sub.setName('view').setDescription('See how tall the server tree is'))
        .addSubcommand((sub) => sub.setName('water').setDescription('Water the tree (once per hour each)'))
        .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Who has watered the tree the most')),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            if (subcommand === 'water') {
                const result = await waterTree(client, guildId, interaction.user.id);

                if (!result.ok) {
                    return await interaction.reply({
                        content: `💧 You already watered the tree. You can water it again <t:${Math.ceil(result.retryAt / 1000)}:R>.`,
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const lines = [`💧 ${interaction.user} watered the tree and it grew **+${result.growth} cm**. ${pickWaterFlavor()}`];
                lines.push(describeProgress(result.tree.height));
                if (result.stageChanged) lines.push(`${result.newStage.emoji} The tree is now a **${result.newStage.name}**!`);
                if (result.completed) {
                    lines.push(`🎉 **The tree reached ${MAX_HEIGHT_CM} cm and is fully grown!** A new seed has been planted. Trees grown so far: **${result.tree.treesGrown}**.`);
                }

                const embed = new EmbedBuilder()
                    .setColor(getColor(result.completed ? 'success' : 'green'))
                    .setDescription(lines.join('\n'))
                    .setFooter({ text: `You can water again in ${WATER_COOLDOWN_MS / 60000} minutes` });
                return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            }

            const tree = await getTree(client, guildId);

            if (subcommand === 'view') {
                const stage = getTreeStage(tree.height);
                const top = topContributors(tree, 3);
                const embed = new EmbedBuilder()
                    .setColor(getColor('green'))
                    .setTitle(`${stage.emoji} The ${interaction.guild.name} tree`)
                    .setDescription(`**${stage.name}**, **${tree.height} cm** tall\n${describeProgress(tree.height)}`)
                    .addFields(
                        { name: 'Trees fully grown', value: `${tree.treesGrown}`, inline: true },
                        { name: 'Times watered', value: `${tree.totalWaterings}`, inline: true },
                        { name: 'Top waterers', value: top.length ? top.map(([id, n], i) => `${MEDALS[i]} <@${id}> (${n})`).join('\n') : 'Nobody yet. Use `/tree water`!' },
                    );
                return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            }

            if (subcommand === 'leaderboard') {
                const top = topContributors(tree, 10);
                const embed = new EmbedBuilder()
                    .setColor(getColor('green'))
                    .setTitle('🌳 Top Tree Waterers')
                    .setDescription(top.length
                        ? top.map(([id, n], i) => `${MEDALS[i] || `**${i + 1}.**`} <@${id}> — ${n} time${n === 1 ? '' : 's'}`).join('\n')
                        : 'Nobody has watered the tree yet!');
                return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            }
        } catch (error) {
            logger.error('Tree command error:', error);
            const payload = { content: 'Something went wrong with the tree. Please try again.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
            else await interaction.reply(payload).catch(() => {});
        }
    },
};
