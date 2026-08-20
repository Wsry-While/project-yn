import { getAdminSupabase } from './api-utils';

export type AnalyticsDimension = 'school' | 'industry' | 'sales' | 'product' | 'year';
export type AnalyticsMetric = 'volume' | 'ontime' | 'score' | 'trips';

export interface AnalyticsRow {
  key: string;
  label: string;
  total: number;
  onTimeRate: number | null; // 0..1
  avgScore: number | null;
  tripCount: number;
  trend: number; // 环比增长率，百分比
}

export interface AnalyticsResult {
  dimension: AnalyticsDimension;
  metric: AnalyticsMetric;
  rows: AnalyticsRow[];
}

export interface SchoolHealth {
  schoolId: string;
  schoolName: string;
  score: number; // 0..100
  dimensions: {
    activity: number; // 0..100
    satisfaction: number;
    conversion: number;
    onTime: number;
    contract: number;
  };
  metrics: {
    trips180d: number;
    avgScore: number | null;
    hasBidding: boolean;
    hasQiming: boolean;
    hasDemand: boolean;
    overdueOpen: number;
    openProjects: number;
    unsignedQiming: number;
  };
  lastVisit: string | null;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export class AnalyticsService {
  static async dimension(input: {
    dimension?: AnalyticsDimension;
    metric?: AnalyticsMetric;
    limit?: number;
  }): Promise<AnalyticsResult> {
    const admin = getAdminSupabase();
    const dimension = input.dimension ?? 'school';
    const metric = input.metric ?? 'volume';
    const limit = input.limit ?? 20;

    // 以 trip 为主源，联表补齐其他维度字段
    const { data: trips } = await admin
      .from('trip_requests')
      .select(
        'id, school_id, school_name, support_type, industry_norm, products_norm, trip_year, overall_score, trip_date, is_completed, project_manager_id',
      )
      .is('deleted_at', null)
      .limit(2000);
    const { data: biddings } = await admin
      .from('bidding_screenshots')
      .select('id, school_id, project_school, project_category_norm, project_year, completion_status, due_delivery_date')
      .is('deleted_at', null)
      .limit(2000);
    const { data: demands } = await admin
      .from('project_demands')
      .select('id, school_id, company, demand_type_norm, project_year, completion_status, required_finish_date')
      .is('deleted_at', null)
      .limit(2000);
    const { data: qimings } = await admin
      .from('qiming_construction')
      .select('id, school_id, school, build_major_norm, project_year, is_sign_contract, project_delivery_time, project_status_feedback')
      .is('deleted_at', null)
      .limit(2000);

    const groups = new Map<string, AnalyticsRow & {
      scores: number[];
      completedOnTime: number;
      openTotal: number;
      biddingCount: number;
      demandCount: number;
      qimingCount: number;
      tripCount: number;
    }>();

    const getGroup = (key: string, label: string) => {
      const g = groups.get(key) ?? {
        key,
        label,
        total: 0,
        onTimeRate: null,
        avgScore: null,
        tripCount: 0,
        trend: 0,
        scores: [],
        completedOnTime: 0,
        openTotal: 0,
        biddingCount: 0,
        demandCount: 0,
        qimingCount: 0,
      };
      groups.set(key, g);
      return g;
    };

    const tripByKey = (r: Record<string, unknown>): string => {
      switch (dimension) {
        case 'industry':
          return (r.industry_norm as string) || '未分类';
        case 'product': {
          const products = (r.products_norm as string[] | null) ?? [];
          return products[0] || '未分类';
        }
        case 'year':
          return (r.trip_year as string) || '未填';
        case 'sales':
          return (r.project_manager_id as string) || '未分配';
        case 'school':
        default:
          return (r.school_id as string) || (r.school_name as string) || '未关联';
      }
    };
    const labelForKey = (key: string, fallback: string): string => {
      if (dimension === 'school' && key && key !== '未关联') {
        // 用最新 trip 的 school_name
        const t = (trips ?? []).find((r) => (r as Record<string, unknown>).school_id === key);
        return ((t as Record<string, unknown> | undefined)?.school_name as string) || fallback;
      }
      if (dimension === 'sales' && key && key !== '未分配') {
        // 暂时显示 key 末 6 位，前端可后续 join team_members
        return `成员 ${key.slice(0, 8)}`;
      }
      return fallback;
    };

    for (const r of trips ?? []) {
      const rec = r as Record<string, unknown>;
      const key = tripByKey(rec);
      const g = getGroup(key, labelForKey(key, key));
      g.total += 1;
      g.tripCount += 1;
      if (typeof rec.overall_score === 'number' && rec.overall_score > 0) g.scores.push(rec.overall_score);
      if (rec.is_completed) g.completedOnTime += 1;
    }
    for (const r of biddings ?? []) {
      const rec = r as Record<string, unknown>;
      const key = dimension === 'school'
        ? ((rec.school_id as string) || (rec.project_school as string) || '未关联')
        : dimension === 'year'
          ? ((rec.project_year as string) || '未填')
          : dimension === 'product'
            ? (((rec.project_category_norm as string[] | null) ?? [])[0] || '未分类')
            : 'all';
      if (!key) continue;
      const g = getGroup(key, labelForKey(key, key));
      g.total += 1;
      g.biddingCount += 1;
    }
    for (const r of demands ?? []) {
      const rec = r as Record<string, unknown>;
      const key = dimension === 'school'
        ? ((rec.school_id as string) || (rec.company as string) || '未关联')
        : dimension === 'year'
          ? ((rec.project_year as string) || '未填')
          : dimension === 'product'
            ? ((rec.demand_type_norm as string) || '未分类')
            : 'all';
      if (!key) continue;
      const g = getGroup(key, labelForKey(key, key));
      g.total += 1;
      g.demandCount += 1;
    }
    for (const r of qimings ?? []) {
      const rec = r as Record<string, unknown>;
      const key = dimension === 'school'
        ? ((rec.school_id as string) || (rec.school as string) || '未关联')
        : dimension === 'year'
          ? ((rec.project_year as string) || '未填')
          : dimension === 'product'
            ? ((rec.build_major_norm as string) || '未分类')
            : 'all';
      if (!key) continue;
      const g = getGroup(key, labelForKey(key, key));
      g.total += 1;
      g.qimingCount += 1;
    }

    const rows: AnalyticsRow[] = [];
    for (const g of groups.values()) {
      g.avgScore = g.scores.length ? g.scores.reduce((s, v) => s + v, 0) / g.scores.length : null;
      g.onTimeRate = g.tripCount > 0 ? g.completedOnTime / g.tripCount : null;
      const { scores: _s, completedOnTime: _c, openTotal: _o, biddingCount: _b, demandCount: _d, qimingCount: _q, ...clean } = g;
      rows.push(clean);
    }

    rows.sort((a, b) => {
      if (metric === 'ontime') return (b.onTimeRate ?? 0) - (a.onTimeRate ?? 0);
      if (metric === 'score') return (b.avgScore ?? 0) - (a.avgScore ?? 0);
      if (metric === 'trips') return b.tripCount - a.tripCount;
      return b.total - a.total;
    });

    return { dimension, metric, rows: rows.slice(0, limit) };
  }

  static async schoolHealth(limit = 20): Promise<SchoolHealth[]> {
    const admin = getAdminSupabase();
    const { data: schools } = await admin
      .from('schools')
      .select('id, name')
      .limit(500);
    const safeSchools = schools ?? [];

    const since180 = new Date(Date.now() - 180 * 86400000).toISOString();
    const [trips, biddings, demands, qimings] = await Promise.all([
      admin.from('trip_requests').select('school_id, school_name, trip_date, overall_score, is_completed').is('deleted_at', null).gte('trip_date', since180).limit(2000),
      admin.from('bidding_screenshots').select('school_id, completion_status, due_delivery_date').is('deleted_at', null).limit(2000),
      admin.from('project_demands').select('school_id, completion_status, required_finish_date').is('deleted_at', null).limit(2000),
      admin.from('qiming_construction').select('school_id, is_sign_contract, project_delivery_time, project_status_feedback').is('deleted_at', null).limit(2000),
    ]);

    const map = new Map<string, SchoolHealth>();
    const ensure = (sid: string | null, sname: string | null): SchoolHealth | null => {
      if (!sid) return null;
      const cur = map.get(sid) ?? {
        schoolId: sid,
        schoolName: sname || '未命名',
        score: 0,
        dimensions: { activity: 0, satisfaction: 0, conversion: 0, onTime: 0, contract: 0 },
        metrics: {
          trips180d: 0,
          avgScore: null,
          hasBidding: false,
          hasDemand: false,
          hasQiming: false,
          overdueOpen: 0,
          openProjects: 0,
          unsignedQiming: 0,
        },
        lastVisit: null,
      };
      if (sname && !cur.schoolName) cur.schoolName = sname;
      map.set(sid, cur);
      return cur;
    };

    const isOpen = (status: string | null): boolean => {
      if (!status) return true;
      return !['已完成', '已交付', '已结项'].some((k) => status.includes(k));
    };

    for (const t of trips.data ?? []) {
      const rec = t as Record<string, unknown>;
      const h = ensure(rec.school_id as string, rec.school_name as string);
      if (!h) continue;
      h.metrics.trips180d += 1;
      if (typeof rec.overall_score === 'number' && rec.overall_score > 0) {
        h.dimensions.satisfaction = (h.dimensions.satisfaction + rec.overall_score * 20) / 2;
      }
      const d = rec.trip_date ? String(rec.trip_date).slice(0, 10) : null;
      if (d && (!h.lastVisit || d > h.lastVisit)) h.lastVisit = d;
    }
    for (const b of biddings.data ?? []) {
      const rec = b as Record<string, unknown>;
      const h = ensure(rec.school_id as string, null);
      if (!h) continue;
      h.metrics.hasBidding = true;
      if (isOpen((rec.completion_status as string) ?? null)) {
        h.metrics.openProjects += 1;
        if (rec.due_delivery_date && new Date(String(rec.due_delivery_date)) < new Date()) h.metrics.overdueOpen += 1;
      }
    }
    for (const d of demands.data ?? []) {
      const rec = d as Record<string, unknown>;
      const h = ensure(rec.school_id as string, null);
      if (!h) continue;
      h.metrics.hasDemand = true;
      if (isOpen((rec.completion_status as string) ?? null)) {
        h.metrics.openProjects += 1;
        if (rec.required_finish_date && new Date(String(rec.required_finish_date)) < new Date()) h.metrics.overdueOpen += 1;
      }
    }
    for (const q of qimings.data ?? []) {
      const rec = q as Record<string, unknown>;
      const h = ensure(rec.school_id as string, null);
      if (!h) continue;
      h.metrics.hasQiming = true;
      if (rec.is_sign_contract === false) {
        h.metrics.unsignedQiming += 1;
      } else if (rec.is_sign_contract === true) {
        h.dimensions.contract = 100;
      }
      if (isOpen((rec.project_status_feedback as string) ?? null)) h.metrics.openProjects += 1;
    }

    for (const h of map.values()) {
      // 维度得分归一化
      h.dimensions.activity = clamp(h.metrics.trips180d * 20); // 5 次 = 100
      if (h.dimensions.satisfaction === 0 && h.metrics.avgScore == null) {
        h.dimensions.satisfaction = 60; // 无评分给中性分
      } else if (h.metrics.avgScore == null) {
        // keep existing accumulated
      }
      h.metrics.avgScore = null; // trips 已合并到 satisfaction
      const projectsCount =
        Number(h.metrics.hasBidding) + Number(h.metrics.hasDemand) + Number(h.metrics.hasQiming);
      h.dimensions.conversion = clamp(projectsCount * 33);
      h.dimensions.onTime = h.metrics.openProjects === 0 ? 100 : clamp(100 - (h.metrics.overdueOpen / h.metrics.openProjects) * 100);
      if (h.metrics.unsignedQiming > 0) h.dimensions.contract = clamp(h.dimensions.contract - h.metrics.unsignedQiming * 20);
      h.score = Math.round(
        h.dimensions.activity * 0.2 +
          h.dimensions.satisfaction * 0.25 +
          h.dimensions.conversion * 0.2 +
          h.dimensions.onTime * 0.2 +
          h.dimensions.contract * 0.15,
      );
    }

    // 把没有任何业务记录的学校补 0
    for (const s of safeSchools) {
      const rec = s as { id: string; name: string };
      if (!map.has(rec.id)) {
        map.set(rec.id, {
          schoolId: rec.id,
          schoolName: rec.name,
          score: 0,
          dimensions: { activity: 0, satisfaction: 60, conversion: 0, onTime: 100, contract: 0 },
          metrics: {
            trips180d: 0,
            avgScore: null,
            hasBidding: false,
            hasDemand: false,
            hasQiming: false,
            overdueOpen: 0,
            openProjects: 0,
            unsignedQiming: 0,
          },
          lastVisit: null,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
