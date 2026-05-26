export { setExplainDb } from './db/client';
export {
  listGuildRoles,
  setGuildRole,
  removeGuildRole,
  type SetGuildRoleInput,
  type SetGuildRoleResult,
} from './db/roles';
export {
  listExplainChannels,
  isExplainAllowedInChannel,
  addExplainChannel,
  removeExplainChannel,
  type AddExplainChannelInput,
  type RemoveExplainChannelInput,
} from './db/channels';
export {
  getExplainMode,
  setExplainMode,
  shouldExplainExist,
  type SetExplainModeInput,
} from './db/settings';
export { runExplain, type ExplainInput } from './pipeline';
export type {
  ContextMessage,
  ExplainLanguage,
  ExplainOutput,
  ExplainPoint,
  ExplainTier,
  TaggedTier,
} from './types';
