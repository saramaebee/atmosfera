import { type ChatInputCommandErrorPayload, Events, Listener } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';

const FRIENDLY_MESSAGE = 'Something went wrong running that command. Try again in a few minutes.';

/**
 * Every chart command defers, then fetches over the network — a throw after
 * deferReply would otherwise leave the interaction on "thinking…" forever.
 * Log the real error with the command name; tell the user something friendly
 * that doesn't guess at a cause.
 */
export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandError });
  }

  public override async run(error: unknown, payload: ChatInputCommandErrorPayload): Promise<void> {
    const { interaction, command } = payload;
    this.container.logger.error(`chatInputCommandError: /${command.name} threw`, error);

    // The send itself can fail (expired token, revoked perms) — never let the
    // error handler become a second unhandled error.
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: FRIENDLY_MESSAGE });
      } else if (interaction.replied) {
        await interaction.followUp({ content: FRIENDLY_MESSAGE, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: FRIENDLY_MESSAGE, flags: MessageFlags.Ephemeral });
      }
    } catch (replyErr) {
      this.container.logger.error('chatInputCommandError: failed to notify user', replyErr);
    }
  }
}
