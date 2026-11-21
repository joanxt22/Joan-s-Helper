import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { ratingFor, progressBar } from '../../../services/fun/gameLogic.js';
import { clip } from './shared.js';

export default {
    async execute(interaction) {
        const thing = clip(interaction.options.getString('thing', true).trim(), 200);
        const rating = ratingFor(thing);
        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle('⭐ Official Rating')
            .setDescription(`I rate **${thing}** a **${rating}/10**\n\`${progressBar(rating / 10)}\``);
        await interaction.reply({ embeds: [embed] });
    },
};
