import type { ThemeName } from '@atmosfera/charts';
import type { City } from '@atmosfera/db';
import type { GeocodeCandidate } from '@atmosfera/geocode';
import type { CommandKind, CompareChartChoice, RadarMode } from './charts';

/**
 * One position in the original query list. If a position needs disambiguation,
 * `candidates` is set and `city` is null. Once resolved (either from the
 * geocoder dominance check or from a menu pick), `city` is set and
 * `candidates` is null. Positions are processed in order.
 */
export interface QuerySlot {
  query: string;
  city: City | null;
  candidates: GeocodeCandidate[] | null;
}

export interface DisambigSession {
  command: CommandKind;
  slots: QuerySlot[];
  /** Only meaningful for command='compare'. */
  chart?: CompareChartChoice;
  /** Only meaningful for command='radar'. */
  radarMode?: RadarMode;
  /** Chart color theme; omitted means dark. */
  theme?: ThemeName;
  /** Attach the wet-bulb embed when rendering resumes after disambiguation. */
  wetBulb?: boolean;
  userId: string;
  guildId?: string;
  createdAt: number;
  /** Whether the next selection should be persisted as a user-scoped alias. Toggleable per session. */
  saveAlias: boolean;
}

const TTL_MS = 5 * 60 * 1000;
const sessions = new Map<string, DisambigSession>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function newId(): string {
  // 6-char random base36 id. Custom_id has 100 char limit; we want short.
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function createSession(session: DisambigSession): string {
  const id = newId();
  sessions.set(id, session);
  const t = setTimeout(() => {
    sessions.delete(id);
    timers.delete(id);
  }, TTL_MS);
  timers.set(id, t);
  return id;
}

export function getSession(id: string): DisambigSession | null {
  return sessions.get(id) ?? null;
}

export function updateSession(id: string, session: DisambigSession): void {
  if (!sessions.has(id)) return;
  sessions.set(id, session);
}

export function deleteSession(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  sessions.delete(id);
}

/** Index of the next slot that still needs a menu pick (city===null). null if all resolved. */
export function nextPendingSlot(session: DisambigSession): number | null {
  for (let i = 0; i < session.slots.length; i++) {
    if (session.slots[i]!.city === null) return i;
  }
  return null;
}
