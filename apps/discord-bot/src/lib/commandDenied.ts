import type { UserError } from '@sapphire/framework';
import {
  type ChatInputCommandInteraction,
  type ContextMenuCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { ATMOSFERA_SCOPE_IDENTIFIERS } from '../preconditions/AtmosferaScope';

/**
 * Friendly ephemeral text for the precondition denials we care about. Shared by
 * the chat-input and context-menu denied listeners so both surfaces explain a
 * rejection the same way.
 *  - AtmosferaScope.* — RBAC / scope rejections from our precondition.
 *  - preconditionClientPermissions — Sapphire's built-in "bot is missing perm X".
 * Anything else falls through with Sapphire's bare message so we don't swallow
 * useful diagnostics for unfamiliar denials.
 */
export function formatDenialMessage(error: UserError): string {
  switch (error.identifier) {
    case ATMOSFERA_SCOPE_IDENTIFIERS.Admin:
      return '🔒 You need the **Manage Server** permission, or a role/user grant via `/permissions grant`, to run that.';
    case ATMOSFERA_SCOPE_IDENTIFIERS.DeniedRule:
      return "🚫 A server admin has blocked this command for you here. Talk to them if you think that's a mistake.";
    case ATMOSFERA_SCOPE_IDENTIFIERS.ServerOnly:
      return '📍 That command only works inside a server.';
    case 'preconditionClientPermissions':
    case 'preconditionClientPermissionsNoPermissions':
      return `🤖 I can't run this here — ${error.message}. Ask an admin to grant me the missing permission(s) in this channel.`;
    case 'preconditionClientPermissionsNoClient':
      return '🤖 I lost track of my own client identity while checking permissions. Try again in a moment.';
    default:
      return error.message || "You can't run that here.";
  }
}

/** Reply to a denied interaction with an ephemeral explanation (best-effort). */
export async function respondToDenial(
  interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
  error: UserError,
): Promise<void> {
  const content = formatDenialMessage(error);
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
}
