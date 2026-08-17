import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripRequest } from '@/lib/domain/types';
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
}

export class TripService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: TripListFilter = {}): Promise<TripRequest[]> {
    let q = this.db.from('trip_requests').select('*').order('trip_date', { ascending: false });
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

  async create(
    input: Omit<TripRequest, 'id' | 'createdAt' | 'updatedAt' | 'derivedTaskId'>,
  ): Promise<TripRequest> {
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

  async stats(): Promise<{
    total: number;
    thisMonth: number;
    byType: Array<{ support_type: string; count: number }>;
    byYear: Array<{ year: number; count: number }>;
  }> {
    const { data, error } = await this.db
      .from('trip_requests')
      .select('support_type, year, trip_date');
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
