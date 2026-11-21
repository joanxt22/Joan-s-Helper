import { MessageFlags } from 'discord.js';

/** Nicest name we can show for a user without pinging them. */
export function nameOf(interaction, user) {
    const member = interaction.guild?.members?.cache?.get(user.id);
    return member?.displayName || user.globalName || user.username;
}

export function replyEphemeral(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export function clip(text, max) {
    const value = String(text);
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
