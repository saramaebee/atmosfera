import {
  type ContextMenuCommandDeniedPayload,
  Events,
  Listener,
  type UserError,
} from '@sapphire/framework';
import { respondToDenial } from '../lib/commandDenied';

/**
 * Without this, a precondition denial on a context-menu command (e.g. the
 * Explain command when the bot is missing a required channel permission) never
 * acknowledges the interaction — the user just sees "The application did not
 * respond". Mirrors ChatInputCommandDeniedListener.
 */
export class ContextMenuCommandDeniedListener extends Listener<
  typeof Events.ContextMenuCommandDenied
> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ContextMenuCommandDenied });
  }

  public override async run(
    error: UserError,
    payload: ContextMenuCommandDeniedPayload,
  ): Promise<void> {
    await respondToDenial(payload.interaction, error);
  }
}
