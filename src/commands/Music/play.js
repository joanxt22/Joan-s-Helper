import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { playQuery, replyMusicSuccess } from '../../services/music/musicActions.js';
import { getPlayChoices } from '../../services/music/playAutocomplete.js';
import { logger } from '../../utils/logger.js';

export default {
    slashOnly: true,
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or add it to the queue')
        .addStringOption((opt) =>
            opt.setName('query')
                .setDescription('Type a song name (suggestions appear as you type) or paste a link')
                .setAutocomplete(true)
                .setRequired(true),
        ),

    async autocomplete(interaction, client) {
        let choices = [];
        try {
            choices = await getPlayChoices(client, interaction.user, interaction.options.getFocused());
        } catch (error) {
            logger.debug('Play autocomplete failed', { error: error.message });
        }
        // Discord drops the request after ~3 seconds; ignore the error if we were too late.
        await interaction.respond(choices).catch(() => {});
    },

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        const result = await playQuery(client, interaction, interaction.options.getString('query'));
        await replyMusicSuccess(interaction, result.embed);
    },
};
