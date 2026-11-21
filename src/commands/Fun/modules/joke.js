import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { JOKES } from '../../../config/fun/jokes.js';
import { pickRandom } from '../../../services/fun/gameLogic.js';

export default {
    async execute(interaction) {
        const [setup, punchline] = pickRandom(JOKES);
        const embed = new EmbedBuilder()
            .setColor(getColor('yellow'))
            .setTitle('😂 Joke')
            .setDescription(`${setup}\n\n||${punchline}||`);
        await interaction.reply({ embeds: [embed] });
    },
};
