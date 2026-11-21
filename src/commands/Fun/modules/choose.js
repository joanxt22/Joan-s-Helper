import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { parseChoices, pickRandom } from '../../../services/fun/gameLogic.js';
import { replyEphemeral } from './shared.js';

export default {
    async execute(interaction) {
        const options = parseChoices(interaction.options.getString('options', true));
        if (options.length < 2) {
            return replyEphemeral(interaction, 'Give me at least two options, separated by commas. Example: `pizza, tacos, sushi`');
        }
        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle('🤔 I choose...')
            .setDescription(`**${pickRandom(options)}**`)
            .setFooter({ text: `Picked from ${options.length} options` });
        await interaction.reply({ embeds: [embed] });
    },
};
