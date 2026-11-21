import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { RPS_CHOICES, rpsOutcome, pickRandom } from '../../../services/fun/gameLogic.js';

const EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RESULT = {
    win: { text: 'You win! 🎉', color: 'success' },
    lose: { text: 'I win! 😎', color: 'error' },
    tie: { text: "It's a tie! 🤝", color: 'warning' },
};

export default {
    async execute(interaction) {
        const player = interaction.options.getString('choice', true);
        const bot = pickRandom(RPS_CHOICES);
        const outcome = RESULT[rpsOutcome(player, bot)];

        const embed = new EmbedBuilder()
            .setColor(getColor(outcome.color))
            .setTitle('Rock Paper Scissors')
            .setDescription(`You chose ${EMOJI[player]} **${player}**\nI chose ${EMOJI[bot]} **${bot}**\n\n**${outcome.text}**`);
        await interaction.reply({ embeds: [embed] });
    },
};
