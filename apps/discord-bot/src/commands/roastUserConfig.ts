import {
  clearBrutalOptin,
  getGuildConfig,
  getRoastOptoutState,
  hasBrutalOptin,
  OPTOUT_LOCK_MS,
  setBrutalOptin,
  setRoastOptedIn,
  setRoastOptedOut,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { sendConfirm } from '../lib/confirm';

export class RoastUserConfigCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'roast-user-config' });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('roast-user-config')
          .setDescription('Per-user roast settings: brutal-tone consent and overall participation.')
          .setDMPermission(false)
          .addSubcommand((sc) =>
            sc
              .setName('brutal')
              .setDescription('Opt in (or out) of receiving brutal-mode roasts of yourself.')
              .addBooleanOption((o) =>
                o
                  .setName('enable')
                  .setDescription('true to opt in, false to opt out. Default: true.')
                  .setRequired(false),
              ),
          )
          .addSubcommand((sc) =>
            sc
              .setName('participation')
              .setDescription("Opt out of roasting entirely (you also won't be able to roast others).")
              .addBooleanOption((o) =>
                o
                  .setName('enable')
                  .setDescription('true to participate (default), false to opt out.')
                  .setRequired(true),
              ),
          ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    if (sub === 'brutal') {
      await this.runBrutal(interaction);
    } else if (sub === 'participation') {
      await this.runParticipation(interaction);
    }
  }

  private async runBrutal(interaction: Command.ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const cfg = getGuildConfig(guildId);
    if (!cfg.brutal_allowed) {
      await interaction.reply({
        content:
          'This server has brutal mode disabled. Ask an admin to enable it via `/roast-config brutal_allowed:true`.',
        ephemeral: true,
      });
      return;
    }

    const enable = interaction.options.getBoolean('enable') ?? true;
    if (enable) {
      setBrutalOptin(interaction.user.id, guildId);
      await interaction.reply({
        content:
          "You've opted into brutal-mode roasts. Use `brutal:true` on `/roast user` to invoke. Opt out with `/roast-user-config brutal enable:false`.",
        ephemeral: true,
      });
    } else {
      clearBrutalOptin(interaction.user.id, guildId);
      await interaction.reply({ content: 'Brutal mode opt-out recorded.', ephemeral: true });
    }

    this.container.logger.info(
      `[roast-user-config:brutal] user=${interaction.user.id} guild=${guildId} brutal=${hasBrutalOptin(
        interaction.user.id,
        guildId,
      )}`,
    );
  }

  private async runParticipation(interaction: Command.ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const enable = interaction.options.getBoolean('enable', true);
    const state = getRoastOptoutState(userId, guildId);

    if (!enable) {
      if (state.optedOut) {
        await interaction.reply({
          content: "You're already opted out. Nothing changed.",
          ephemeral: true,
        });
        return;
      }
      if (state.lockedUntil && state.lockedUntil > Date.now()) {
        await interaction.reply({
          content: `Cold feet already? You signed the 30-day waiver. Door reopens <t:${Math.floor(
            state.lockedUntil / 1000,
          )}:R> — toughen up until then.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const outcome = await sendConfirm({
        interaction,
        title: 'Opt out of roasting?',
        body:
          "Heads up: opting out means **no one can roast you here**, but **you also won't be able to roast anyone else**. " +
          'Still want to do it?',
        confirmLabel: 'Yes, opt me out',
        cancelLabel: 'Never mind',
        customIdSuffix: `optout:${userId}:${guildId}`,
        onConfirmText: 'Opted out.',
        onCancelText: 'No changes — still opted in.',
      });

      if (outcome !== 'confirmed') {
        this.container.logger.info(
          `[roast-user-config:participation] user=${userId} guild=${guildId} optout_outcome=${outcome}`,
        );
        return;
      }

      setRoastOptedOut(userId, guildId);
      await interaction.followUp({
        content:
          "You're opted out. Re-enable with `/roast-user-config participation enable:true` (30-day lock-in).",
        ephemeral: true,
      });
      this.container.logger.info(
        `[roast-user-config:participation] user=${userId} guild=${guildId} opted_out=true`,
      );
      return;
    }

    if (!state.optedOut) {
      await interaction.reply({
        content: "You're already opted in — no changes needed.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const outcome = await sendConfirm({
      interaction,
      title: 'Opt back into roasting?',
      body:
        'Heads up: once you opt back in, you **cannot opt out again for 30 days**. ' +
        "Other users will be able to roast you, and you'll be able to roast them. " +
        'Are you sure?',
      confirmLabel: 'Yes, opt me back in',
      cancelLabel: 'Never mind',
      customIdSuffix: `optin:${userId}:${guildId}`,
      onConfirmText: 'Welcome back to the arena.',
      onCancelText: 'No changes — still opted out.',
    });

    if (outcome !== 'confirmed') {
      this.container.logger.info(
        `[roast-user-config:participation] user=${userId} guild=${guildId} optin_outcome=${outcome}`,
      );
      return;
    }

    setRoastOptedIn(userId, guildId, OPTOUT_LOCK_MS);
    const lockedUntil = Date.now() + OPTOUT_LOCK_MS;
    await interaction.followUp({
      content: `You're back in. You can't opt out again until <t:${Math.floor(lockedUntil / 1000)}:F>.`,
      ephemeral: true,
    });
    this.container.logger.info(
      `[roast-user-config:participation] user=${userId} guild=${guildId} opted_out=false locked_until=${lockedUntil}`,
    );
  }
}
