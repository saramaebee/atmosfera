import { and, desc, eq, gte, like } from 'drizzle-orm';
import type { Db } from './client';
import { type AuditLogRow, auditLog } from './schema';

export interface RecordAuditEventInput {
  guildId: string | null;
  actorId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

export function recordAuditEvent(db: Db, input: RecordAuditEventInput): AuditLogRow {
  const inserted = db
    .insert(auditLog)
    .values({
      guildId: input.guildId,
      actorId: input.actorId,
      eventType: input.eventType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  if (!inserted) throw new Error('recordAuditEvent: insert returned no row');
  return inserted;
}

export interface ListAuditEventsFilter {
  guildId?: string;
  /** Exact eventType, or a SQL `LIKE` pattern (e.g. `permission.%`) if `eventTypePattern` is set. */
  eventType?: string;
  eventTypePattern?: string;
  since?: number;
  limit?: number;
  offset?: number;
}

export function listAuditEvents(db: Db, filter: ListAuditEventsFilter): AuditLogRow[] {
  const conditions = [];
  if (filter.guildId !== undefined) conditions.push(eq(auditLog.guildId, filter.guildId));
  if (filter.eventType !== undefined) conditions.push(eq(auditLog.eventType, filter.eventType));
  if (filter.eventTypePattern !== undefined)
    conditions.push(like(auditLog.eventType, filter.eventTypePattern));
  if (filter.since !== undefined) conditions.push(gte(auditLog.createdAt, filter.since));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0)
    .all();
}

export function parseAuditMetadata(row: AuditLogRow): Record<string, unknown> | null {
  if (!row.metadata) return null;
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
