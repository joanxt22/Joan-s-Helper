import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { ACTIONS, renderAction } from '../../../services/fun/gameLogic.js';
import { nameOf, replyEphemeral } from './shared.js';

export default {
    async execute(interaction) {
        const type = interaction.options.getString('type', true);
        const target = interaction.options.getUser('user', true);
        const action = ACTIONS[type];
        if (!action) {
            return replyEphemeral(interaction, 'That action does not exist.');
        }

        const text = renderAction(type, `**${nameOf(interaction, interaction.user)}**`, `**${nameOf(interaction, target)}**`, target.id === interaction.user.id);
        const embed = new EmbedBuilder()
            .setColor(getColor('fuchsia'))
            .setDescription(`${action.emoji} ${text}`);
        await interaction.reply({ embeds: [embed] });
    },
};
