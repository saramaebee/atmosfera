import {
  type ChatInputCommandDeniedPayload,
  Events,
  Listener,
  type UserError,
} from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { ATMOSFERA_SCOPE_IDENTIFIERS } from '../preconditions/AtmosferaScope';

/**
 * Friendly ephemeral replies for the precondition denials we care about.
 *  - AtmosferaScope.* identifiers — RBAC / scope rejections from our precondition.
 *  - preconditionClientPermissions — Sapphire's built-in "bot is missing perm X" rejection.
 *
 * Anything else falls through with the bare error message from Sapphire so we
 * don't accidentally swallow useful diagnostic output for unfamiliar denials.
 */
export class ChatInputCommandDeniedListener extends Listener<typeof Events.ChatInputCommandDenied> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandDenied });
  }

  public override async run(
    error: UserError,
    payload: ChatInputCommandDeniedPayload,
  ): Promise<void> {
    const { interaction } = payload;
    const content = formatMessage(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

function formatMessage(error: UserError): string {
  switch (error.identifier) {
    case ATMOSFERA_SCOPE_IDENTIFIERS.Admin:
      return '🔒 You need the **Manage Server** permission, or a role/user grant via `/permissions grant`, to run that.';
    case ATMOSFERA_SCOPE_IDENTIFIERS.DeniedRule:
      return "🚫 A server admin has blocked this command for you here. Talk to them if you think that's a mistake.";
    case ATMOSFERA_SCOPE_IDENTIFIERS.OwnerOnly:
      return '🔐 That command is restricted to the bot owner.';
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
