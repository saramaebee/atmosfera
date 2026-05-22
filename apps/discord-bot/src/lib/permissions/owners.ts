// Re-export from @atmosfera/config so the web app can share the same
// owner-check logic without depending on the bot.
export { isBotOwner, listBotOwnerIds } from '@atmosfera/config';
