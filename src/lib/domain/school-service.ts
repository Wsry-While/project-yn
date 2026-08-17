import type { SupabaseClient } from '@supabase/supabase-js';
import type { School, SchoolDepartment, SchoolWithDepartments } from '@/lib/domain/types';
import { mapSchool, mapDepartment, type SchoolRow, type DepartmentRow } from '@/lib/domain/mappers';

export class SchoolService {
  constructor(private readonly db: SupabaseClient) {}

  async list(opts?: { search?: string; salesOwner?: string; limit?: number }): Promise<School[]> {
    let q = this.db.from('schools').select('*').order('name');
    if (opts?.search) {
      q = q.ilike('name', `%${opts.search}%`);
    }
    if (opts?.limit) {
      q = q.limit(opts.limit);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data as SchoolRow[]).map(mapSchool);
  }

  async listWithDepartments(opts?: {
    search?: string;
    salesOwner?: string;
    limit?: number;
  }): Promise<SchoolWithDepartments[]> {
    const schools = await this.list(opts);
    if (schools.length === 0) return [];
    const ids = schools.map((s) => s.id);
    const { data, error } = await this.db
      .from('school_departments')
      .select('*')
      .in('school_id', ids)
      .order('name');
    if (error) throw error;
    const depsBySchool = new Map<string, SchoolDepartment[]>();
    for (const row of data as DepartmentRow[]) {
      const d = mapDepartment(row);
      const arr = depsBySchool.get(d.schoolId) ?? [];
      arr.push(d);
      depsBySchool.set(d.schoolId, arr);
    }
    return schools.map((s) => ({ ...s, departments: depsBySchool.get(s.id) ?? [] }));
  }

  async getById(id: string): Promise<SchoolWithDepartments | null> {
    const { data, error } = await this.db
      .from('schools')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const school = mapSchool(data as SchoolRow);
    const { data: deps, error: derr } = await this.db
      .from('school_departments')
      .select('*')
      .eq('school_id', id)
      .order('name');
    if (derr) throw derr;
    return { ...school, departments: (deps as DepartmentRow[]).map(mapDepartment) };
  }

  async listDepartmentsBySchool(schoolId: string): Promise<SchoolDepartment[]> {
    const { data, error } = await this.db
      .from('school_departments')
      .select('*')
      .eq('school_id', schoolId)
      .order('name');
    if (error) throw error;
    return (data as DepartmentRow[]).map(mapDepartment);
  }

  async listSalesOwners(): Promise<string[]> {
    const { data, error } = await this.db
      .from('school_departments')
      .select('sales_owner')
      .not('sales_owner', 'is', null);
    if (error) throw error;
    const set = new Set<string>();
    for (const row of data as Array<{ sales_owner: string | null }>) {
      if (row.sales_owner) set.add(row.sales_owner);
    }
    return Array.from(set).sort();
  }
}
