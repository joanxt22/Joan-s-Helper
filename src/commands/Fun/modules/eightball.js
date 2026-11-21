import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { EIGHT_BALL_ANSWERS, pickRandom } from '../../../services/fun/gameLogic.js';
import { clip } from './shared.js';

export default {
    async execute(interaction) {
        const question = interaction.options.getString('question', true);
        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle('🎱 Magic 8-Ball')
            .addFields(
                { name: 'Question', value: clip(question, 1000) },
                { name: 'Answer', value: `**${pickRandom(EIGHT_BALL_ANSWERS)}**` },
            );
        await interaction.reply({ embeds: [embed] });
    },
};
