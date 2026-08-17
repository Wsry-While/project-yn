import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripApprovalStatus, TripRequest } from '@/lib/domain/types';
import { mapTrip, type TripRow } from '@/lib/domain/mappers';

export interface TripListFilter {
  schoolId?: string;
  projectId?: string;
  supportType?: string;
  year?: number;
  salesManager?: string;
  from?: string;
  to?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export interface TripExternalInput {
  schoolName: string;
  schoolId?: string | null;
  department?: string | null;
  industry?: string | null;
  supportType: string;
  supportTypeOther?: string | null;
  products?: string[];
  detail: string;
  tripDate: string;
  startTime?: string | null;
  endTime?: string | null;
  salesManager?: string | null;
  projectManager?: string | null;
  initiator?: string | null;
  isCompleted?: string | null;
  reportConsistent?: string | null;
  serviceSummary?: string | null;
  salesLate?: string | null;
  salesScore?: number | null;
  serviceLate?: string | null;
  overallScore?: number | null;
  overallFeedback?: string | null;
  externalId: string;
  externalSource: string;
  externalUuid?: string | null;
  externalOperator?: string | null;
  externalOriginOperator?: string | null;
  auditStatus?: number | null;
  approvalStatus?: TripApprovalStatus;
  rawPayload?: Record<string, unknown>;
}

export class TripService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: TripListFilter = {}): Promise<TripRequest[]> {
    let q = this.db.from('trip_requests').select('*').order('trip_date', { ascending: false });
    if (!filter.includeDeleted) q = q.is('deleted_at', null);
    if (filter.schoolId) q = q.eq('school_id', filter.schoolId);
    if (filter.projectId) q = q.eq('project_id', filter.projectId);
    if (filter.supportType) q = q.eq('support_type', filter.supportType);
    if (filter.year) q = q.eq('year', filter.year);
    if (filter.salesManager) q = q.eq('sales_manager', filter.salesManager);
    if (filter.from) q = q.gte('trip_date', filter.from);
    if (filter.to) q = q.lte('trip_date', filter.to);
    if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw error;
    return (data as TripRow[]).map(mapTrip);
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

  async create(input: Omit<TripRequest, 'id' | 'createdAt' | 'updatedAt' | 'derivedTaskId'>): Promise<TripRequest> {
    const row = {
      project_id: input.projectId,
      school_id: input.schoolId,
      school_name: input.schoolName,
      department: input.department,
      industry: input.industry,
      year: input.year,
      support_type: input.supportType,
      support_type_other: input.supportTypeOther,
      products: input.products,
      detail: input.detail,
      trip_date: input.tripDate,
      start_time: input.startTime,
      end_time: input.endTime,
      weekday: input.weekday,
      sales_manager: input.salesManager,
      project_manager: input.projectManager,
      initiator: input.initiator,
      initiated_at: input.initiatedAt,
      approval_status: input.approvalStatus,
      is_completed: input.isCompleted,
      report_consistent: input.reportConsistent,
      service_summary: input.serviceSummary,
      sales_late: input.salesLate,
      sales_score: input.salesScore,
      service_late: input.serviceLate,
      overall_score: input.overallScore,
      overall_feedback: input.overallFeedback,
      external_id: input.externalId,
      external_source: input.externalSource,
      external_uuid: input.externalUuid ?? null,
      external_operator: input.externalOperator ?? null,
      external_origin_operator: input.externalOriginOperator ?? null,
      audit_status: input.auditStatus ?? null,
      deleted_at: input.deletedAt ?? null,
      raw_payload: (input as { rawPayload?: Record<string, unknown> | null }).rawPayload ?? null,
    };
    const { data, error } = await this.db
      .from('trip_requests')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return mapTrip(data as TripRow);
  }

  async update(
    id: string,
    patch: Partial<Omit<TripRequest, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<TripRequest> {
    const row: Record<string, unknown> = {};
    const map: Record<string, string> = {
      projectId: 'project_id',
      schoolId: 'school_id',
      schoolName: 'school_name',
      department: 'department',
      industry: 'industry',
      year: 'year',
      supportType: 'support_type',
      supportTypeOther: 'support_type_other',
      products: 'products',
      detail: 'detail',
      tripDate: 'trip_date',
      startTime: 'start_time',
      endTime: 'end_time',
      weekday: 'weekday',
      salesManager: 'sales_manager',
      projectManager: 'project_manager',
      initiator: 'initiator',
      initiatedAt: 'initiated_at',
      approvalStatus: 'approval_status',
      isCompleted: 'is_completed',
      reportConsistent: 'report_consistent',
      serviceSummary: 'service_summary',
      salesLate: 'sales_late',
      salesScore: 'sales_score',
      serviceLate: 'service_late',
      overallScore: 'overall_score',
      overallFeedback: 'overall_feedback',
      derivedTaskId: 'derived_task_id',
      externalUuid: 'external_uuid',
      externalOperator: 'external_operator',
      externalOriginOperator: 'external_origin_operator',
      auditStatus: 'audit_status',
      deletedAt: 'deleted_at',
      rawPayload: 'raw_payload',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (map[k]) row[map[k]] = v;
    }
    const { data, error } = await this.db
      .from('trip_requests')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapTrip(data as TripRow);
  }

  /**
   * 第三方推送 upsert。
   * 按 (external_source, external_id) 幂等：存在则更新，不存在则创建。
   */
  async upsertFromExternal(
    input: TripExternalInput,
    schoolId: string | null,
  ): Promise<{ row: TripRequest; created: boolean }> {
    const existing = await this.findByExternalId(input.externalSource, input.externalId);
    const tripDate = input.tripDate.slice(0, 10);
    const d = new Date(`${tripDate}T00:00:00Z`);
    const year = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getUTCFullYear();
    const weekday = Number.isNaN(d.getTime())
      ? null
      : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];

    const baseFields = {
      school_id: schoolId,
      school_name: input.schoolName.slice(0, 200),
      department: input.department ?? null,
      industry: input.industry ?? null,
      year,
      support_type: input.supportType.slice(0, 60),
      support_type_other: input.supportTypeOther ?? null,
      products: input.products ?? [],
      detail: input.detail,
      trip_date: tripDate,
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      weekday,
      sales_manager: input.salesManager ?? null,
      project_manager: input.projectManager ?? null,
      initiator: input.initiator ?? null,
      initiated_at: new Date().toISOString(),
      is_completed: input.isCompleted ?? null,
      report_consistent: input.reportConsistent ?? null,
      service_summary: input.serviceSummary ?? null,
      sales_late: input.salesLate ?? null,
      sales_score: input.salesScore ?? null,
      service_late: input.serviceLate ?? null,
      overall_score: input.overallScore ?? null,
      overall_feedback: input.overallFeedback ?? null,
      external_uuid: input.externalUuid ?? null,
      external_operator: input.externalOperator ?? null,
      external_origin_operator: input.externalOriginOperator ?? null,
      audit_status: input.auditStatus ?? null,
      approval_status:
        input.approvalStatus ??
        (input.auditStatus === 1
          ? 'approved'
          : input.auditStatus === 2
            ? 'rejected'
            : 'pending'),
      raw_payload: input.rawPayload ?? null,
      external_id: input.externalId,
      external_source: input.externalSource,
      deleted_at: null,
    };

    if (existing) {
      const { data, error } = await this.db
        .from('trip_requests')
        .update(baseFields)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return { row: mapTrip(data as TripRow), created: false };
    }

    try {
      const { data, error } = await this.db
        .from('trip_requests')
        .insert(baseFields)
        .select()
        .single();
      if (error) throw error;
      return { row: mapTrip(data as TripRow), created: true };
    } catch (err) {
      // 并发重试时可能由另一个请求抢先插入
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const retry = await this.findByExternalId(input.externalSource, input.externalId);
        if (retry) {
          const { data, error } = await this.db
            .from('trip_requests')
            .update(baseFields)
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
    byType: Array<{ support_type: string; count: number }>;
    byYear: Array<{ year: number; count: number }>;
  }> {
    const { data, error } = await this.db
      .from('trip_requests')
      .select('support_type, year, trip_date')
      .is('deleted_at', null);
    if (error) throw error;
    const rows = data as Array<{ support_type: string; year: number | null; trip_date: string }>;
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const byType = new Map<string, number>();
    const byYear = new Map<number, number>();
    let thisMonth = 0;
    for (const r of rows) {
      byType.set(r.support_type, (byType.get(r.support_type) ?? 0) + 1);
      if (r.year) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
      if (r.trip_date?.slice(0, 7) === ym) thisMonth++;
    }
    return {
      total: rows.length,
      thisMonth,
      byType: Array.from(byType.entries())
        .map(([support_type, count]) => ({ support_type, count }))
        .sort((a, b) => b.count - a.count),
      byYear: Array.from(byYear.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => b.year - a.year),
    };
  }
}
