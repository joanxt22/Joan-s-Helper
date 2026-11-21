import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getGuildGiveaways, isGiveawayEnded } from '../../../utils/giveaways.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';

const MAX_LISTED = 10;

export default {
    async execute(interaction) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        if (!interaction.inGuild()) {
            throw new TitanBotError(
                'Giveaway command used outside guild',
                ErrorTypes.VALIDATION,
                'This command can only be used in a server.',
                { userId: interaction.user.id },
            );
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            throw new TitanBotError(
                'User lacks ManageGuild permission',
                ErrorTypes.PERMISSION,
                "You need the 'Manage Server' permission to view giveaways.",
                { userId: interaction.user.id, guildId: interaction.guildId },
            );
        }

        const all = await getGuildGiveaways(interaction.client, interaction.guildId);
        const active = all
            .filter((giveaway) => !giveaway.ended && !giveaway.isEnded && !isGiveawayEnded(giveaway))
            .sort((a, b) => (a.endsAt || a.endTime) - (b.endsAt || b.endTime));

        const lines = active.slice(0, MAX_LISTED).map((giveaway) => {
            const endsAt = Math.floor((giveaway.endsAt || giveaway.endTime) / 1000);
            const link = `https://discord.com/channels/${interaction.guildId}/${giveaway.channelId}/${giveaway.messageId}`;
            const entries = giveaway.participants?.length ?? 0;
            return `🎁 **[${giveaway.prize}](${link})**\nEnds <t:${endsAt}:R> • ${entries} ${entries === 1 ? 'entry' : 'entries'} • ${giveaway.winnerCount} ${giveaway.winnerCount === 1 ? 'winner' : 'winners'}\nMessage ID: \`${giveaway.messageId}\``;
        });

        const description = lines.length > 0
            ? lines.join('\n\n')
            : 'There are no active giveaways. Start one with `/giveaway start`.';

        const footer = active.length > MAX_LISTED ? `Showing ${MAX_LISTED} of ${active.length} active giveaways` : undefined;

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                createEmbed({
                    title: 'Active Giveaways',
                    description,
                    color: 'primary',
                    ...(footer ? { footer: { text: footer } } : {}),
                }),
            ],
        });
    },
};
