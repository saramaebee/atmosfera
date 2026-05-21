import { getEnv } from '@atmosfera/config';
import { getDb } from './client';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeStats {
  activityRecent: number;
  activityHourly: number;
  interactions: number;
  roastHistory: number;
}

export function purgeOldRows(now: number = Date.now()): PurgeStats {
  const db = getDb();
  const env = getEnv();

  const recentCutoff = now - env.ACTIVITY_RECENT_RETENTION_DAYS * DAY_MS;
  const hourlyCutoff = now - env.ACTIVITY_HOURLY_RETENTION_DAYS * DAY_MS;
  const interactionsCutoff = now - env.INTERACTIONS_RETENTION_DAYS * DAY_MS;
  const roastHistoryCutoff = now - env.ROAST_HISTORY_RETENTION_DAYS * DAY_MS;

  const recent = db.prepare('DELETE FROM activity_recent WHERE created_at < ?').run(recentCutoff);

  const hourly = db.prepare('DELETE FROM activity_hourly WHERE hour_bucket < ?').run(hourlyCutoff);

  const interactions = db
    .prepare('DELETE FROM interactions WHERE created_at < ?')
    .run(interactionsCutoff);

  const roastHistory = db
    .prepare('DELETE FROM roast_history WHERE created_at < ?')
    .run(roastHistoryCutoff);

  return {
    activityRecent: recent.changes,
    activityHourly: hourly.changes,
    interactions: interactions.changes,
    roastHistory: roastHistory.changes,
  };
}

export function schedulePurge(intervalMs: number = DAY_MS): NodeJS.Timeout {
  const run = () => {
    try {
      const stats = purgeOldRows();
      console.log(
        `[purge] activity_recent=${stats.activityRecent} activity_hourly=${stats.activityHourly} interactions=${stats.interactions} roast_history=${stats.roastHistory}`,
      );
    } catch (err) {
      console.error('[purge] failed:', err);
    }
  };
  run();
  return setInterval(run, intervalMs);
}
