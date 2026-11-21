import { SlashCommandBuilder } from 'discord.js';
import { RPS_CHOICES, ACTIONS } from '../../services/fun/gameLogic.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import eightball from './modules/eightball.js';
import rps from './modules/rps.js';
import tictactoe from './modules/tictactoe.js';
import trivia from './modules/trivia.js';
import wouldyourather from './modules/wouldyourather.js';
import ship from './modules/ship.js';
import action from './modules/action.js';
import joke from './modules/joke.js';
import choose from './modules/choose.js';
import rate from './modules/rate.js';

const HANDLERS = {
    '8ball': eightball,
    rps,
    tictactoe,
    trivia,
    wouldyourather,
    ship,
    action,
    joke,
    choose,
    rate,
};

export default {
    slashOnly: true,
    category: 'Fun',
    data: new SlashCommandBuilder()
        .setName('fun')
        .setDescription('Games and fun things to do')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('8ball').setDescription('Ask the magic 8-ball a question')
                .addStringOption((o) => o.setName('question').setDescription('Your yes/no question').setMaxLength(200).setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('rps').setDescription('Play rock paper scissors against me')
                .addStringOption((o) => o.setName('choice').setDescription('Your move').setRequired(true)
                    .addChoices(...RPS_CHOICES.map((value) => ({ name: value, value })))))
        .addSubcommand((sub) =>
            sub.setName('tictactoe').setDescription('Challenge someone to Tic-Tac-Toe')
                .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true)))
        .addSubcommand((sub) => sub.setName('trivia').setDescription('A trivia question, first correct answer wins'))
        .addSubcommand((sub) => sub.setName('wouldyourather').setDescription('Vote on a would-you-rather'))
        .addSubcommand((sub) =>
            sub.setName('ship').setDescription('Check how compatible two people are')
                .addUserOption((o) => o.setName('user1').setDescription('First person').setRequired(true))
                .addUserOption((o) => o.setName('user2').setDescription('Second person (default: you)')))
        .addSubcommand((sub) =>
            sub.setName('action').setDescription('Hug, pat, boop or high five someone')
                .addStringOption((o) => o.setName('type').setDescription('What to do').setRequired(true)
                    .addChoices(...Object.entries(ACTIONS).map(([value, config]) => ({ name: config.label, value }))))
                .addUserOption((o) => o.setName('user').setDescription('Who to do it to').setRequired(true)))
        .addSubcommand((sub) => sub.setName('joke').setDescription('Hear a joke'))
        .addSubcommand((sub) =>
            sub.setName('choose').setDescription('Let me pick for you')
                .addStringOption((o) => o.setName('options').setDescription('Options separated by commas, e.g. pizza, tacos, sushi').setMaxLength(500).setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('rate').setDescription('I will rate anything out of 10')
                .addStringOption((o) => o.setName('thing').setDescription('What should I rate?').setMaxLength(200).setRequired(true))),

    async execute(interaction) {
        const handler = HANDLERS[interaction.options.getSubcommand()];
        if (!handler) {
            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Unknown fun command.' });
        }
        return await handler.execute(interaction);
    },
};
