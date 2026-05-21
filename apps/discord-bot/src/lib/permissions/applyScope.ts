import type { CommandScope } from './types';

interface ScopableBuilder {
  setDMPermission(enabled: boolean | null): unknown;
}

/**
 * Apply scope-derived defaults to the Discord-side slash command builder.
 *
 *  - baseline 'admin' → setDMPermission(false). We deliberately do NOT call
 *    setDefaultMemberPermissions because Discord treats that as an *invocation
 *    gate*, not just a picker hint — it'd block non-admins from running the
 *    command regardless of any bot-side RBAC `allow` rule. With it omitted,
 *    everyone sees admin commands in their picker; the AtmosferaScope
 *    precondition is the single source of truth for who can actually invoke.
 *    (Tracking a future Discord-side sync via OAuth in repo issues.)
 *  - baseline 'everyone' → no-op; the command author keeps control of
 *    setDMPermission.
 *
 * Idempotent. Returns the builder for chaining.
 */
export function applyScopeToBuilder<B extends ScopableBuilder>(builder: B, scope: CommandScope): B {
  if (scope.baseline === 'admin') {
    builder.setDMPermission(false);
  }
  return builder;
}
