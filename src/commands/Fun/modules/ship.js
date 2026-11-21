import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { shipPercent, shipVerdict, progressBar, blendNames } from '../../../services/fun/gameLogic.js';
import { nameOf, replyEphemeral } from './shared.js';

export default {
    async execute(interaction) {
        const first = interaction.options.getUser('user1', true);
        const second = interaction.options.getUser('user2') || interaction.user;

        if (first.id === second.id) {
            return replyEphemeral(interaction, 'Pick two different people to ship!');
        }

        const percent = shipPercent(first.id, second.id);
        const nameA = nameOf(interaction, first);
        const nameB = nameOf(interaction, second);

        const embed = new EmbedBuilder()
            .setColor(getColor('fuchsia'))
            .setTitle('💘 Compatibility')
            .setDescription(
                `**${nameA}** + **${nameB}**\nShip name: **${blendNames(nameA, nameB)}**\n\n` +
                `\`${progressBar(percent / 100, 20)}\` **${percent}%**\n${shipVerdict(percent)}`,
            );
        await interaction.reply({ embeds: [embed] });
    },
};
