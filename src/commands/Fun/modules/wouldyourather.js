import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { WOULD_YOU_RATHER } from '../../../config/fun/wouldYouRather.js';
import { pickRandom } from '../../../services/fun/gameLogic.js';
import { logger } from '../../../utils/logger.js';

const VOTE_MS = 120000;

function tally(votes) {
    let a = 0;
    let b = 0;
    for (const choice of votes.values()) {
        if (choice === 'a') a += 1;
        else b += 1;
    }
    return { a, b, total: a + b };
}

function percent(count, total) {
    return total === 0 ? 0 : Math.round((count / total) * 100);
}

export default {
    async execute(interaction) {
        const [optionA, optionB] = pickRandom(WOULD_YOU_RATHER);
        const idPrefix = `wyr_${interaction.id}`;
        const votes = new Map();

        const render = (final = false) => {
            const { a, b, total } = tally(votes);
            return new EmbedBuilder()
                .setColor(getColor('primary'))
                .setTitle(final ? '🤔 Would You Rather — results' : '🤔 Would You Rather...')
                .setDescription(
                    `🅰️ **${optionA}**\n${a} vote${a === 1 ? '' : 's'} (${percent(a, total)}%)\n\n` +
                    `🅱️ **${optionB}**\n${b} vote${b === 1 ? '' : 's'} (${percent(b, total)}%)`,
                )
                .setFooter({ text: final ? `${total} total vote${total === 1 ? '' : 's'}` : 'Vote below, you can change your mind!' });
        };

        const buttons = (disabled = false) => [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${idPrefix}_a`).setLabel('Option A').setEmoji('🅰️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
                new ButtonBuilder().setCustomId(`${idPrefix}_b`).setLabel('Option B').setEmoji('🅱️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
            ),
        ];

        await interaction.reply({ embeds: [render()], components: buttons() });
        const message = await interaction.fetchReply();

        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: VOTE_MS });

        collector.on('collect', async (click) => {
            try {
                const choice = click.customId.slice(idPrefix.length + 1);
                if (choice !== 'a' && choice !== 'b') {
                    return await click.deferUpdate();
                }
                votes.set(click.user.id, choice);
                return await click.update({ embeds: [render()], components: buttons() });
            } catch (error) {
                logger.error('Would You Rather interaction error:', error);
            }
        });

        collector.on('end', async () => {
            try {
                await message.edit({ embeds: [render(true)], components: buttons(true) });
            } catch (error) {
                logger.debug('Would You Rather: could not post final results', { error: error.message });
            }
        });
    },
};
