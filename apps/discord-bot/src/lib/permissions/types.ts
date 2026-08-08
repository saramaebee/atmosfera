/**
 * Compiled-in command scope. One of these is registered per slash command via
 * `registerScope(name, scope)` at module load. Read by the AtmosferaScope
 * precondition (for runtime access checks) and by applyScopeToBuilder (for
 * Discord-side picker defaults).
 */
export type CommandScope = {
  /**
   * The default user gate when no per-guild RBAC rules apply.
   *  - 'everyone': anyone can run the command.
   *  - 'admin': requires ManageGuild (configurable per-guild via /permissions).
   */
  baseline: 'admin' | 'everyone';
  /**
   * When true, users in DISCORD_OWNER_IDS bypass the user-scope check.
   * Does NOT bypass requiredClientPermissions or `protected` rules.
   */
  ownerOverride?: boolean;
  /**
   * When true, ONLY users in DISCORD_OWNER_IDS may run the command. Checked
   * before all guild/RBAC/baseline logic — per-guild rules have no effect,
   * so ownerOnly commands are excluded from the /permissions picker.
   */
  ownerOnly?: boolean;
  /**
   * When true, restrictive per-guild rules (denies, allowlist exclusions) have
   * no effect — users can always run the command. Server staff can still
   * expand access on protected commands; they just can't restrict it.
   */
  protected?: boolean;
};
