import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripApprovalStatus, TripContact, TripRequest, TripRichText } from '@/lib/domain/types';
import { mapTrip, type TripRow } from '@/lib/domain/mappers';
import { sanitizeRichText } from '@/lib/domain/sanitize';
import { OptionDictionaryService } from '@/lib/domain/trip-option-service';
import { parseSort } from '@/lib/domain/sort';

/** 项目外出可排序列（前端 sortBy key → 数据库列），白名单防注入 */
const TRIP_SORTABLE: Record<string, string> = {
  school: 'school_name',
  supportType: 'support_type',
  tripDate: 'trip_date',
  sales: 'sales_manager_name',
  year: 'year',
  score: 'overall_score',
  synced: 'synced_at',
};

export interface TripListFilter {
  search?: string;
  supportType?: string;
  year?: number;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: string;
}

export interface TripExternalInput {
  serialNo?: string | null;
  year?: number | null;
  schoolName: string;
  industry?: string | null;
  supportType: string;
  supportTypeOther?: string | null;
  products: string[];
  detail: TripRichText | null;
  tripDate: string;
  startAt?: string | null;
  endAt?: string | null;
  weekday?: number | null;
  salesManager: TripContact | null;
  projectManager: TripContact | null;
  isCompleted: boolean;
  reportConsistent: boolean | null;
  serviceSummary: TripRichText | null;
  salesLate: boolean | null;
  salesScore?: number | null;
  serviceLate: boolean | null;
  overallScore?: number | null;
  overallFeedback: TripRichText | null;
  externalId: string;
  externalSource: string;
  externalUuid?: string | null;
  externalOp?: string | null;
  externalOperator?: string | null;
  externalOperatorName?: string | null;
  externalOriginOperator?: string | null;
  auditStatus?: number | null;
  approvalStatus?: TripApprovalStatus;
  salesManagerId?: string | null;
  projectManagerId?: string | null;
  supportTypeNorm?: string | null;
  industryNorm?: string | null;
  productsNorm?: string[] | null;
  rawPayload?: unknown;
  rawMeta?: Record<string, unknown> | null;
}

function contactRow(prefix: 'sales_manager' | 'project_manager', c: TripContact | null) {
  if (!c) {
    return {
      [`${prefix}_name`]: null,
      [`${prefix}_puid`]: null,
      [`${prefix}_enc`]: null,
    };
  }
  return {
    [`${prefix}_name`]: c.name?.slice(0, 100) ?? null,
    [`${prefix}_puid`]: c.puid ?? null,
    [`${prefix}_enc`]: c.enc ?? null,
  };
}

function richTextToRow(prefix: 'detail' | 'service_summary' | 'overall_feedback', rt: TripRichText | null) {
  const clean = sanitizeRichText({ html: rt?.html, text: rt?.text });
  return {
    [`${prefix}_html`]: clean.html,
    [`${prefix}_text`]: clean.text,
  };
}

function approvalStatusFrom(auditStatus: number | null, fallback?: TripApprovalStatus): TripApprovalStatus {
  if (fallback) return fallback;
  if (auditStatus === 1) return 'approved';
  if (auditStatus === 2) return 'rejected';
  return 'pending';
}

export class TripService {
  readonly options: OptionDictionaryService;
  constructor(private readonly db: SupabaseClient) {
    this.options = new OptionDictionaryService(db);
  }

  async list(filter: TripListFilter = {}): Promise<{ rows: TripRequest[]; total: number }> {
    let q = this.db
      .from('trip_requests')
      .select('*', { count: 'exact' });

    // 列头排序：白名单命中则用指定列；否则默认按外出日期、同步时间倒序
    const sort = parseSort(filter.sortBy, filter.sortDir, TRIP_SORTABLE);
    if (sort) {
      q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
    } else {
      q = q.order('trip_date', { ascending: false }).order('synced_at', { ascending: false });
    }

    if (!filter.includeDeleted) q = q.is('deleted_at', null);
    if (filter.supportType) q = q.eq('support_type', filter.supportType);
    if (filter.year) q = q.eq('year', filter.year);
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      q = q.or(`school_name.ilike.${pattern},sales_manager_name.ilike.${pattern},project_manager_name.ilike.${pattern},support_type.ilike.${pattern}`);
    }
    if (filter.limit) q = q.range(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;
    return {
      rows: (data as TripRow[]).map(mapTrip),
      total: count ?? 0,
    };
  }

  async getById(id: string): Promise<TripRequest | null> {
    const { data, error } = await this.db
      .from('trip_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTrip(data as TripRow) : null;
  }

  async findByExternalId(
    source: string,
    externalId: string,
    includeDeleted = true,
  ): Promise<TripRequest | null> {
    let q = this.db
      .from('trip_requests')
      .select('*')
      .eq('external_source', source)
      .eq('external_id', externalId);
    if (!includeDeleted) q = q.is('deleted_at', null);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? mapTrip(data as TripRow) : null;
  }

  private buildUpsertRow(input: TripExternalInput): Record<string, unknown> {
    const tripDate = input.tripDate.slice(0, 10);
    const year = input.year ?? (() => {
      const d = new Date(`${tripDate}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
    })();
    const completedAt = input.isCompleted ? new Date().toISOString() : null;
    const approvalStatus = approvalStatusFrom(input.auditStatus ?? null, input.approvalStatus);
    return {
      external_id: input.externalId,
      external_source: input.externalSource,
      external_uuid: input.externalUuid ?? null,
      external_serial: input.serialNo ?? null,
      external_op: input.externalOp ?? null,
      external_operator: input.externalOperator ?? null,
      external_operator_name: input.externalOperatorName ?? null,
      external_origin_operator: input.externalOriginOperator ?? null,
      audit_status: input.auditStatus ?? null,
      approval_status: approvalStatus,
      raw_payload: (input.rawPayload ?? null) as Record<string, unknown> | null,
      raw_meta: (input.rawMeta ?? null) as Record<string, unknown> | null,
      synced_at: new Date().toISOString(),
      deleted_at: null,

      year,
      school_name: input.schoolName.trim().slice(0, 200),
      school_id: null,
      industry: input.industry?.trim() || null,
      industry_norm: input.industryNorm ?? null,
      support_type: input.supportType.trim().slice(0, 80),
      support_type_norm: input.supportTypeNorm ?? null,
      support_type_other:
        input.supportType === '其他' ? input.supportTypeOther?.trim() || null : null,
      products: input.products,
      products_norm: input.productsNorm ?? null,
      ...richTextToRow('detail', input.detail),
      trip_date: tripDate,
      start_at: input.startAt ?? null,
      end_at: input.endAt ?? null,
      weekday: input.weekday ?? null,
      ...contactRow('sales_manager', input.salesManager),
      ...contactRow('project_manager', input.projectManager),
      sales_manager_id: input.salesManagerId ?? null,
      project_manager_id: input.projectManagerId ?? null,

      is_completed: input.isCompleted,
      report_consistent: input.reportConsistent,
      ...richTextToRow('service_summary', input.serviceSummary),
      sales_late: input.salesLate,
      sales_score: input.salesScore ?? null,
      service_late: input.serviceLate,
      overall_score: input.overallScore ?? null,
      ...richTextToRow('overall_feedback', input.overallFeedback),
      completed_at: completedAt,
    };
  }

  async upsertFromExternal(input: TripExternalInput, schoolId: string | null): Promise<{ row: TripRequest; created: boolean }> {
    await this.options.ensure('support_type', input.supportType);
    if (input.industry) await this.options.ensure('industry', input.industry);
    if (input.products.length) await this.options.ensureMany('product', input.products);

    const existing = await this.findByExternalId(input.externalSource, input.externalId);
    const row = {
      ...this.buildUpsertRow(input),
      school_id: schoolId,
      completed_at: existing?.completedAt ?? (input.isCompleted ? new Date().toISOString() : null),
    };

    if (existing) {
      const { data, error } = await this.db
        .from('trip_requests')
        .update(row)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return { row: mapTrip(data as TripRow), created: false };
    }

    try {
      const { data, error } = await this.db
        .from('trip_requests')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return { row: mapTrip(data as TripRow), created: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const retry = await this.findByExternalId(input.externalSource, input.externalId);
        if (retry) {
          const { data, error } = await this.db
            .from('trip_requests')
            .update(row)
            .eq('id', retry.id)
            .select()
            .single();
          if (error) throw error;
          return { row: mapTrip(data as TripRow), created: false };
        }
      }
      throw err;
    }
  }

  async softDeleteByExternal(source: string, externalId: string): Promise<TripRequest | null> {
    const existing = await this.findByExternalId(source, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('trip_requests')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapTrip(data as TripRow);
  }

  async recoverByExternal(source: string, externalId: string): Promise<TripRequest | null> {
    const existing = await this.findByExternalId(source, externalId);
    if (!existing) return null;
    const { data, error } = await this.db
      .from('trip_requests')
      .update({ deleted_at: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapTrip(data as TripRow);
  }

  async stats(): Promise<{
    total: number;
    thisMonth: number;
    completed: number;
    byType: Array<{ support_type: string; count: number }>;
  }> {
    const { data, error } = await this.db
      .from('trip_requests')
      .select('support_type, trip_date, is_completed')
      .is('deleted_at', null);
    if (error) throw error;
    const rows = data as Array<{ support_type: string; trip_date: string; is_completed: boolean }>;
    const ym = new Date().toISOString().slice(0, 7);
    const byType = new Map<string, number>();
    let thisMonth = 0;
    let completed = 0;
    for (const r of rows) {
      byType.set(r.support_type, (byType.get(r.support_type) ?? 0) + 1);
      if (r.trip_date?.slice(0, 7) === ym) thisMonth++;
      if (r.is_completed) completed++;
    }
    return {
      total: rows.length,
      thisMonth,
      completed,
      byType: Array.from(byType.entries())
        .map(([support_type, count]) => ({ support_type, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
