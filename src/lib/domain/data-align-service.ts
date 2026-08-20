import { getAdminSupabase } from './api-utils';

export type AlignStatus = 'pending' | 'resolved' | 'ignored';

export interface AlignQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  rawValue: string | null;
  reason: string;
  suggestionId: string | null;
  status: AlignStatus;
  resolutionNote: string | null;
  createdAt: string;
}

export interface AlignSummary {
  total: number;
  pending: number;
  resolved: number;
  ignored: number;
  byEntityType: Array<{ entityType: string; pending: number }>;
  items: AlignQueueItem[];
}

export class DataAlignService {
  static async list(filter: { status?: AlignStatus; entityType?: string; limit?: number } = {}): Promise<AlignSummary> {
    const admin = getAdminSupabase();

    const countAll = admin
      .from('data_align_queue')
      .select('id, entity_type, status', { count: 'exact', head: false })
      .limit(1000);
    const { data: allRows } = await countAll;

    let q = admin
      .from('data_align_queue')
      .select(
        'id, entity_type, entity_id, field, raw_value, reason, suggestion_id, status, resolution_note, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(filter.limit ?? 100);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.entityType) q = q.eq('entity_type', filter.entityType);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (allRows ?? []) as Array<{ status: string; entity_type: string }>;
    const items = (data ?? []) as Array<Record<string, unknown>>;
    const entityTypeMap = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== 'pending') continue;
      entityTypeMap.set(r.entity_type, (entityTypeMap.get(r.entity_type) ?? 0) + 1);
    }

    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      resolved: rows.filter((r) => r.status === 'resolved').length,
      ignored: rows.filter((r) => r.status === 'ignored').length,
      byEntityType: Array.from(entityTypeMap.entries())
        .map(([entityType, pending]) => ({ entityType, pending }))
        .sort((a, b) => b.pending - a.pending),
      items: items.map((r) => ({
        id: r.id as string,
        entityType: r.entity_type as string,
        entityId: r.entity_id as string,
        field: r.field as string,
        rawValue: (r.raw_value as string) ?? null,
        reason: r.reason as string,
        suggestionId: (r.suggestion_id as string) ?? null,
        status: r.status as AlignStatus,
        resolutionNote: (r.resolution_note as string) ?? null,
        createdAt: r.created_at as string,
      })),
    };
  }

  static async updateStatus(
    id: string,
    status: AlignStatus,
    note: string | null,
    _user: { id: string },
  ): Promise<AlignQueueItem | null> {
    const admin = getAdminSupabase();
    const { data, error } = await admin
      .from('data_align_queue')
      .update({
        status,
        resolution_note: note,
      })
      .eq('id', id)
      .select(
        'id, entity_type, entity_id, field, raw_value, reason, suggestion_id, status, resolution_note, created_at',
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      id: r.id as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      field: r.field as string,
      rawValue: (r.raw_value as string) ?? null,
      reason: r.reason as string,
      suggestionId: (r.suggestion_id as string) ?? null,
      status: r.status as AlignStatus,
      resolutionNote: (r.resolution_note as string) ?? null,
      createdAt: r.created_at as string,
    };
  }
}
