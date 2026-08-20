import { getAdminSupabase } from './api-utils';
import type { School360View } from './school-360-service';

export interface PersonKpi {
  inProgress: number;
  tripsThisMonth: number;
  avgScore: number | null;
  overdueRate: number; // 0..1
}

export interface PersonBusinessPoint {
  name: string;
  bidding: number;
  demand: number;
  qiming: number;
  trip: number;
}

export interface PersonScorePoint {
  month: string; // YYYY-MM
  avgScore: number | null;
  count: number;
}

export interface PersonSchoolItem {
  schoolId: string;
  schoolName: string;
  bidding: number;
  demand: number;
  qiming: number;
  trip: number;
  lastVisit: string | null;
  lastEvent: string | null;
}

export interface Person360View {
  person: {
    id: string;
    name: string;
    department: string | null;
    title: string | null;
    email: string | null;
    pinyin: string | null;
    isLeader: boolean;
    isEnabled: boolean;
  } | null;
  kpi: PersonKpi;
  bySource: { bidding: number; demand: number; qiming: number; trip: number };
  monthlyBusiness: PersonBusinessPoint[];
  scoreTrend: PersonScorePoint[];
  topSchools: PersonSchoolItem[];
  recentItems: Array<{
    id: string;
    source: 'bidding' | 'demand' | 'qiming' | 'trip';
    title: string;
    school: string | null;
    date: string | null;
    status: string | null;
    url: string;
  }>;
}

function ym(date: string | null | undefined): string {
  if (!date) return '未知';
  const m = /^(\d{4}-\d{2})/.exec(date);
  return m ? m[1] : '未知';
}

function ymd(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date);
  return m ? m[1] : date.slice(0, 10);
}

function isOpenStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.trim().toLowerCase();
  if (!s) return true;
  return !['已完成', '已交付', '已结项', 'completed', 'done', 'closed'].some((k) => s.includes(k.toLowerCase()));
}

export class Person360Service {
  static async get(personId: string): Promise<Person360View | null> {
    const admin = getAdminSupabase();

    const { data: person } = await admin
      .from('team_members')
      .select('id, name, department, title, email, pinyin, is_leader, is_enabled')
      .eq('id', personId)
      .maybeSingle<{
        id: string;
        name: string;
        department: string | null;
        title: string | null;
        email: string | null;
        pinyin: string | null;
        is_leader: boolean | null;
        is_enabled: boolean | null;
      }>();

    if (!person) return null;

    const [biddingRows, demandRows, qimingRows, tripRows] = await Promise.all([
      admin
        .from('bidding_screenshots')
        .select('id, project_name, project_school, school_id, sales_manager_id, completion_status, due_delivery_date, submission_date, created_at, deleted_at')
        .eq('sales_manager_id', personId)
        .is('deleted_at', null)
        .limit(500),
      admin
        .from('project_demands')
        .select('id, other_delivery_content, demand_type, company, school_id, sales_manager_id, completion_status, required_finish_date, created_at, deleted_at')
        .eq('sales_manager_id', personId)
        .is('deleted_at', null)
        .limit(500),
      admin
        .from('qiming_construction')
        .select('id, project_name, school, school_id, sales_manager_id, project_status_feedback, project_delivery_time, created_at, deleted_at')
        .eq('sales_manager_id', personId)
        .is('deleted_at', null)
        .limit(500),
      admin
        .from('trip_requests')
        .select('id, trip_topic, school_name, school_id, sales_manager_id, trip_date, overall_score, is_completed, created_at, deleted_at')
        .eq('sales_manager_id', personId)
        .is('deleted_at', null)
        .limit(500),
    ]);

    const biddings = biddingRows.data ?? [];
    const demands = demandRows.data ?? [];
    const qimings = qimingRows.data ?? [];
    const trips = tripRows.data ?? [];

    const inProgress =
      biddings.filter((r) => isOpenStatus(r.completion_status as string | null)).length +
      demands.filter((r) => isOpenStatus(r.completion_status as string | null)).length +
      qimings.filter((r) => isOpenStatus(r.project_status_feedback as string | null)).length +
      (trips as Array<{ is_completed: boolean | null }>).filter((r) => !r.is_completed).length;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const tripsThisMonth = trips.filter((r) => {
      const d = r.trip_date ? new Date(String(r.trip_date)) : null;
      return d && d >= monthStart;
    }).length;

    const scores = trips.map((r) => r.overall_score).filter((v): v is number => typeof v === 'number' && v > 0);
    const avgScore = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;

    const openItems: Array<{ due: string | null }> = [
      ...biddings.map((r) => ({ due: r.due_delivery_date ? String(r.due_delivery_date) : null })),
      ...demands.map((r) => ({ due: r.required_finish_date ? String(r.required_finish_date) : null })),
      ...qimings.map((r) => ({ due: r.project_delivery_time ? String(r.project_delivery_time) : null })),
    ].filter((it) => isOpenStatus(null) && it.due);
    const overdueCount = openItems.filter((it) => {
      if (!it.due) return false;
      return new Date(it.due) < now;
    }).length;
    const overdueRate = openItems.length ? overdueCount / openItems.length : 0;

    // 月度业务量（近 6 个月）
    const monthBucket = new Map<string, PersonBusinessPoint>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBucket.set(key, { name: key.slice(5), bidding: 0, demand: 0, qiming: 0, trip: 0 });
    }
    for (const r of biddings) {
      const key = ym(r.created_at ? String(r.created_at) : null);
      const m = /^(\d{4}-\d{2})/.exec(key);
      if (!m) continue;
      const slot = monthBucket.get(m[1]);
      if (slot) slot.bidding += 1;
    }
    for (const r of demands) {
      const key = ym(r.created_at ? String(r.created_at) : null);
      const m = /^(\d{4}-\d{2})/.exec(key);
      if (!m) continue;
      const slot = monthBucket.get(m[1]);
      if (slot) slot.demand += 1;
    }
    for (const r of qimings) {
      const key = ym(r.created_at ? String(r.created_at) : null);
      const m = /^(\d{4}-\d{2})/.exec(key);
      if (!m) continue;
      const slot = monthBucket.get(m[1]);
      if (slot) slot.qiming += 1;
    }
    for (const r of trips) {
      const key = ym(r.trip_date ? String(r.trip_date) : null);
      const m = /^(\d{4}-\d{2})/.exec(key);
      if (!m) continue;
      const slot = monthBucket.get(m[1]);
      if (slot) slot.trip += 1;
    }

    // 评分趋势（近 6 个月）
    const scoreBucket = new Map<string, { total: number; count: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      scoreBucket.set(key, { total: 0, count: 0 });
    }
    for (const r of trips) {
      if (typeof r.overall_score !== 'number' || r.overall_score <= 0) continue;
      const key = ym(r.trip_date ? String(r.trip_date) : null);
      const m = /^(\d{4}-\d{2})/.exec(key);
      if (!m) continue;
      const slot = scoreBucket.get(m[1]);
      if (slot) {
        slot.total += r.overall_score;
        slot.count += 1;
      }
    }
    const scoreTrend: PersonScorePoint[] = [];
    for (const [key, v] of scoreBucket.entries()) {
      scoreTrend.push({
        month: key.slice(5),
        avgScore: v.count ? v.total / v.count : null,
        count: v.count,
      });
    }

    // Top 学校
    const schoolMap = new Map<string, PersonSchoolItem>();
    const ensure = (sid: string | null, sname: string | null): PersonSchoolItem | null => {
      if (!sid) return null;
      const cur = schoolMap.get(sid) || {
        schoolId: sid,
        schoolName: sname || '未命名学校',
        bidding: 0,
        demand: 0,
        qiming: 0,
        trip: 0,
        lastVisit: null,
        lastEvent: null,
      };
      if (sname && !cur.schoolName) cur.schoolName = sname;
      schoolMap.set(sid, cur);
      return cur;
    };
    for (const r of biddings) {
      const it = ensure(r.school_id as string | null, r.project_school as string | null);
      if (it) it.bidding += 1;
    }
    for (const r of demands) {
      const it = ensure(r.school_id as string | null, r.company as string | null);
      if (it) it.demand += 1;
    }
    for (const r of qimings) {
      const it = ensure(r.school_id as string | null, r.school as string | null);
      if (it) it.qiming += 1;
    }
    for (const r of trips) {
      const it = ensure(r.school_id as string | null, r.school_name as string | null);
      if (it) {
        it.trip += 1;
        const d = ymd(r.trip_date ? String(r.trip_date) : null);
        if (d && (!it.lastVisit || d > it.lastVisit)) {
          it.lastVisit = d;
          it.lastEvent = '项目外出';
        }
      }
    }
    const topSchools = Array.from(schoolMap.values())
      .map((s) => ({ ...s, total: s.bidding + s.demand + s.qiming + s.trip }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(({ total: _total, ...rest }) => rest);

    // 最近动态
    const recent = [
      ...biddings.map((r) => ({
        id: r.id as string,
        source: 'bidding' as const,
        title: (r.project_name as string) || '招投标',
        school: (r.project_school as string) || null,
        date: ymd(r.submission_date ? String(r.submission_date) : null),
        status: (r.completion_status as string) || null,
        url: `/bidding-screenshots?focus=${r.id}`,
      })),
      ...demands.map((r) => ({
        id: r.id as string,
        source: 'demand' as const,
        title: (r.other_delivery_content as string) || (r.demand_type as string) || '建设申请',
        school: (r.company as string) || null,
        date: ymd(r.required_finish_date ? String(r.required_finish_date) : null),
        status: (r.completion_status as string) || null,
        url: `/project-demands?focus=${r.id}`,
      })),
      ...qimings.map((r) => ({
        id: r.id as string,
        source: 'qiming' as const,
        title: (r.project_name as string) || '启明星',
        school: (r.school as string) || null,
        date: ymd(r.project_delivery_time ? String(r.project_delivery_time) : null),
        status: (r.project_status_feedback as string) || null,
        url: `/qiming-construction?focus=${r.id}`,
      })),
      ...trips.map((r) => ({
        id: r.id as string,
        source: 'trip' as const,
        title: (r.trip_topic as string) || '项目外出',
        school: (r.school_name as string) || null,
        date: ymd(r.trip_date ? String(r.trip_date) : null),
        status: (r.overall_score as number | null) != null ? `评分 ${(r as { overall_score: number }).overall_score}` : null,
        url: `/trips?focus=${r.id}`,
      })),
    ]
      .filter((it) => it.date)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))
      .slice(0, 10);

    return {
      person: {
        id: person.id,
        name: person.name,
        department: person.department,
        title: person.title,
        email: person.email,
        pinyin: person.pinyin,
        isLeader: !!person.is_leader,
        isEnabled: person.is_enabled !== false,
      },
      kpi: { inProgress, tripsThisMonth, avgScore, overdueRate },
      bySource: { bidding: biddings.length, demand: demands.length, qiming: qimings.length, trip: trips.length },
      monthlyBusiness: Array.from(monthBucket.values()),
      scoreTrend,
      topSchools,
      recentItems: recent,
    };
  }
}

export type { School360View };
