import type {
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from 'discord.js';

/**
 * Defer the reply only if the interaction hasn't been acknowledged yet.
 *
 * Discord rejects double-acks with code 40060 ("Interaction has already been
 * acknowledged"). The local `deferred` / `replied` booleans usually mirror
 * Discord's view, but cross-process races (e.g. bun --hot reloads, gateway
 * reconnects with overlapping sessions) can leave them inconsistent. Guarding
 * here keeps the handler going instead of throwing.
 */
export async function safeDeferReply(
  interaction: ChatInputCommandInteraction,
  options: { ephemeral?: boolean } = {},
): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply({ ephemeral: options.ephemeral });
  } catch (err) {
    // 40060 = already acknowledged — proceed to use editReply downstream.
    if (!is40060(err)) throw err;
  }
}

/**
 * Reply to the interaction using whichever method is valid for its current
 * state. Use this at the end of a handler when you've previously deferred (or
 * might have). Ephemerality is set by the initial ack — pass it on the reply
 * path; we ignore it on the edit path since Discord won't change it there.
 */
export async function safeRespond(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions & { ephemeral?: boolean },
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    const { ephemeral: _ignored, flags: _flags, ...editPayload } = payload;
    await interaction.editReply(editPayload as InteractionEditReplyOptions);
    return;
  }
  await interaction.reply(payload);
}

function is40060(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 40060
  );
}
