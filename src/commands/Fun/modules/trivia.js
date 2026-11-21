import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { TRIVIA_QUESTIONS } from '../../../config/fun/triviaQuestions.js';
import { pickRandom, shuffled } from '../../../services/fun/gameLogic.js';
import { logger } from '../../../utils/logger.js';
import { clip, replyEphemeral } from './shared.js';

const ROUND_MS = 20000;
const LETTERS = ['A', 'B', 'C', 'D'];

function buildButtons(options, idPrefix, { reveal = false, correctIndex = -1 } = {}) {
    const row = new ActionRowBuilder();
    options.forEach((option, index) => {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${idPrefix}_${index}`)
                .setLabel(clip(`${LETTERS[index]}. ${option}`, 80))
                .setStyle(reveal && index === correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(reveal),
        );
    });
    return [row];
}

export default {
    async execute(interaction) {
        const entry = pickRandom(TRIVIA_QUESTIONS);
        const options = shuffled([entry.a, ...entry.wrong]);
        const correctIndex = options.indexOf(entry.a);
        const idPrefix = `trivia_${interaction.id}`;

        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle(`🧠 Trivia • ${entry.category}`)
            .setDescription(`**${entry.q}**\n\nFirst correct answer wins. One guess each, ${ROUND_MS / 1000} seconds!`);

        await interaction.reply({ embeds: [embed], components: buildButtons(options, idPrefix) });
        const message = await interaction.fetchReply();

        const answered = new Set();
        let winner = null;
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ROUND_MS });

        collector.on('collect', async (click) => {
            try {
                const index = Number(click.customId.slice(idPrefix.length + 1));
                if (!Number.isInteger(index) || index < 0 || index >= options.length) {
                    return await click.deferUpdate();
                }
                if (answered.has(click.user.id)) {
                    return await replyEphemeral(click, 'You already used your guess this round.');
                }
                answered.add(click.user.id);

                if (index === correctIndex) {
                    winner = click.user;
                    collector.stop('winner');
                    return await click.deferUpdate();
                }
                return await replyEphemeral(click, '❌ Not quite! You are out for this round.');
            } catch (error) {
                logger.error('Trivia interaction error:', error);
            }
        });

        collector.on('end', async () => {
            const result = new EmbedBuilder()
                .setColor(getColor(winner ? 'success' : 'error'))
                .setTitle(`🧠 Trivia • ${entry.category}`)
                .setDescription(
                    `**${entry.q}**\n\n✅ Answer: **${entry.a}**\n\n` +
                    (winner ? `🏆 ${winner} got it first!` : "⌛ Time's up, nobody got it."),
                );
            try {
                await message.edit({
                    embeds: [result],
                    components: buildButtons(options, idPrefix, { reveal: true, correctIndex }),
                    allowedMentions: { parse: [] },
                });
            } catch (error) {
                logger.debug('Trivia: could not post the result', { error: error.message });
            }
        });
    },
};
