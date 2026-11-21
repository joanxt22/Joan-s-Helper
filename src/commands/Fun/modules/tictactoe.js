import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { getTicTacToeResult } from '../../../services/fun/gameLogic.js';
import { logger } from '../../../utils/logger.js';
import { nameOf, replyEphemeral } from './shared.js';

const IDLE_MS = 120000;
const NO_PINGS = { parse: [] };

export function buildBoard(board, { idPrefix, winLine = null, disabled = false }) {
    const rows = [];
    for (let r = 0; r < 3; r += 1) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 3; c += 1) {
            const index = r * 3 + c;
            const cell = board[index];
            const button = new ButtonBuilder()
                .setCustomId(`${idPrefix}_${index}`)
                .setDisabled(disabled || Boolean(cell));
            if (!cell) {
                button.setEmoji('⬜').setStyle(ButtonStyle.Secondary);
            } else {
                const style = winLine?.includes(index)
                    ? ButtonStyle.Success
                    : (cell === 'X' ? ButtonStyle.Danger : ButtonStyle.Primary);
                button.setEmoji(cell === 'X' ? '❌' : '⭕').setStyle(style);
            }
            row.addComponents(button);
        }
        rows.push(row);
    }
    return rows;
}

export default {
    async execute(interaction) {
        const challenger = interaction.user;
        const opponent = interaction.options.getUser('opponent', true);

        if (opponent.bot) return replyEphemeral(interaction, 'Bots cannot play Tic-Tac-Toe. Challenge a person!');
        if (opponent.id === challenger.id) return replyEphemeral(interaction, 'You cannot challenge yourself.');

        const names = { X: nameOf(interaction, challenger), O: nameOf(interaction, opponent) };
        const players = { X: challenger, O: opponent };
        const idPrefix = `ttt_${interaction.id}`;

        const challengeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${idPrefix}_accept`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${idPrefix}_decline`).setLabel('Decline').setStyle(ButtonStyle.Danger),
        );

        await interaction.reply({
            content: `${opponent}, **${names.X}** challenged you to Tic-Tac-Toe! Do you accept?`,
            components: [challengeRow],
            allowedMentions: { users: [opponent.id] },
        });
        const message = await interaction.fetchReply();

        const board = Array(9).fill(null);
        let phase = 'challenge';
        let turn = 'X';
        const turnText = () => `❌ **${names.X}**  vs  ⭕ **${names.O}**\nIt is **${names[turn]}**'s turn (${turn === 'X' ? '❌' : '⭕'}).`;

        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: IDLE_MS });

        collector.on('collect', async (click) => {
            try {
                if (phase === 'challenge') {
                    if (click.user.id !== opponent.id) {
                        return await replyEphemeral(click, `Only ${names.O} can answer this challenge.`);
                    }
                    if (click.customId === `${idPrefix}_decline`) {
                        phase = 'done';
                        collector.stop('declined');
                        return await click.update({ content: `**${names.O}** declined the challenge.`, components: [], allowedMentions: NO_PINGS });
                    }
                    if (click.customId === `${idPrefix}_accept`) {
                        phase = 'playing';
                        return await click.update({ content: turnText(), components: buildBoard(board, { idPrefix }), allowedMentions: NO_PINGS });
                    }
                    return await click.deferUpdate();
                }

                if (phase !== 'playing' || !click.customId.startsWith(`${idPrefix}_`)) {
                    return await click.deferUpdate();
                }

                if (click.user.id !== players.X.id && click.user.id !== players.O.id) {
                    return await replyEphemeral(click, 'You are not in this game.');
                }
                if (click.user.id !== players[turn].id) {
                    return await replyEphemeral(click, "It's not your turn.");
                }

                const index = Number(click.customId.slice(idPrefix.length + 1));
                if (!Number.isInteger(index) || index < 0 || index > 8 || board[index]) {
                    return await click.deferUpdate();
                }

                board[index] = turn;
                const result = getTicTacToeResult(board);

                if (result.winner || result.draw) {
                    phase = 'done';
                    collector.stop('finished');
                    const content = result.winner
                        ? `🏆 **${names[result.winner]}** wins!`
                        : "🤝 It's a draw!";
                    return await click.update({
                        content,
                        components: buildBoard(board, { idPrefix, winLine: result.line, disabled: true }),
                        allowedMentions: NO_PINGS,
                    });
                }

                turn = turn === 'X' ? 'O' : 'X';
                return await click.update({ content: turnText(), components: buildBoard(board, { idPrefix }), allowedMentions: NO_PINGS });
            } catch (error) {
                logger.error('Tic-Tac-Toe interaction error:', error);
            }
        });

        collector.on('end', async (_collected, reason) => {
            if (phase === 'done') return;
            try {
                await message.edit({
                    content: reason === 'idle' ? '⌛ The game timed out.' : 'The game ended.',
                    components: [],
                    allowedMentions: NO_PINGS,
                });
            } catch (error) {
                logger.debug('Tic-Tac-Toe: could not close the game message', { error: error.message });
            }
        });
    },
};
