import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeamMember, TeamMemberInput } from './types';

export type TeamMemberRow = {
  id: string;
  puid: string | null;
  name: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean;
  synced_from: string;
  contact_raw: unknown;
  created_at: string;
  updated_at: string;
};

export function mapTeamMember(row: TeamMemberRow): TeamMember {
  return {
    id: row.id,
    puid: row.puid,
    name: row.name,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    active: row.active,
    syncedFrom: row.synced_from,
    contactRaw: (row.contact_raw ?? null) as Record<string, unknown> | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 规范化姓名：去掉空白、全角空格、括号备注，用于匹配 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * 从超星 contact 对象里提取最有用的字段。
 * 兼容数组（多联系人）、单对象、字符串姓名三种形态。
 */
export function extractContact(
  value: unknown,
): { name: string | null; puid: string | null; enc: string | null; raw: unknown } {
  if (!value) return { name: null, puid: null, enc: null, raw: null };
  if (typeof value === 'string') {
    return { name: value.trim() || null, puid: null, enc: null, raw: value };
  }
  if (Array.isArray(value)) {
    // 多 contact：取第一个有名字的；多值分别用 batch 处理，这里只兜底
    for (const item of value) {
      const c = extractContact(item);
      if (c.name) return c;
    }
    return { name: null, puid: null, enc: null, raw: value };
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const name =
      (typeof obj.uname === 'string' && obj.uname) ||
      (typeof obj.name === 'string' && obj.name) ||
      (typeof obj.val === 'string' && obj.val) ||
      (typeof obj.value === 'string' && obj.value) ||
      null;
    const puid =
      (typeof obj.puid === 'string' && obj.puid) ||
      (typeof obj.uid === 'string' && obj.uid) ||
      null;
    const enc = (typeof obj.enc === 'string' && obj.enc) || null;
    return { name: name ? name.trim() : null, puid, enc, raw: value };
  }
  return { name: null, puid: null, enc: null, raw: value };
}

export class TeamMemberService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: { search?: string; includeInactive?: boolean; role?: string } = {}): Promise<TeamMember[]> {
    let q = this.db.from('team_members').select('*');
    if (!filter.includeInactive) q = q.eq('active', true);
    if (filter.role) q = q.eq('role', filter.role);
    if (filter.search) {
      const k = `%${filter.search}%`;
      q = q.or(`name.ilike.${k},display_name.ilike.${k},email.ilike.${k},puid.ilike.${k}`);
    }
    const { data, error } = await q.order('name');
    if (error) throw new Error(`查询员工失败: ${error.message}`);
    return (data as TeamMemberRow[]).map(mapTeamMember);
  }

  async getById(id: string): Promise<TeamMember | null> {
    const { data, error } = await this.db
      .from('team_members')
      .select('*')
      .eq('id', id)
      .maybeSingle<TeamMemberRow>();
    if (error) throw new Error(`查询员工失败: ${error.message}`);
    return data ? mapTeamMember(data) : null;
  }

  async findByPuid(puid: string): Promise<TeamMember | null> {
    if (!puid) return null;
    const { data, error } = await this.db
      .from('team_members')
      .select('*')
      .eq('puid', puid)
      .maybeSingle<TeamMemberRow>();
    if (error) throw new Error(`按 puid 查询员工失败: ${error.message}`);
    return data ? mapTeamMember(data) : null;
  }

  async findByName(name: string): Promise<TeamMember | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    // 先精确匹配
    const { data: exact } = await this.db
      .from('team_members')
      .select('*')
      .eq('name', trimmed)
      .maybeSingle<TeamMemberRow>();
    if (exact) return mapTeamMember(exact);
    // 再规范化匹配（去空格、去括号）
    const norm = normalizeName(trimmed);
    if (!norm) return null;
    const { data } = await this.db.from('team_members').select('*').eq('active', true).limit(50);
    if (!data) return null;
    const hit = (data as TeamMemberRow[]).find((r) => normalizeName(r.name) === norm);
    return hit ? mapTeamMember(hit) : null;
  }

  /**
   * 按超星 contact 结构 upsert。优先按 puid，其次按 name。
   * 返回 TeamMember。多 contact 场景请使用 upsertManyByContacts。
   */
  async upsertByContact(
    contact: unknown,
    role?: 'sales' | 'pm' | string | null,
  ): Promise<TeamMember | null> {
    const info = extractContact(contact);
    if (!info.name) return null;
    return this.upsert({
      puid: info.puid,
      name: info.name,
      role: role ?? null,
      contactRaw: (info.raw as Record<string, unknown>) ?? null,
      syncedFrom: 'chaoxing',
    });
  }

  async upsert(input: TeamMemberInput): Promise<TeamMember> {
    const name = input.name.trim();
    if (!name) throw new Error('员工姓名不能为空');
    // 优先按 puid 找
    if (input.puid) {
      const existing = await this.findByPuid(input.puid);
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (input.name !== existing.name) patch.name = input.name;
        if (input.displayName !== undefined) patch.display_name = input.displayName;
        if (input.email !== undefined && input.email !== existing.email) patch.email = input.email;
        if (input.phone !== undefined && input.phone !== existing.phone) patch.phone = input.phone;
        if (input.role !== undefined && input.role !== existing.role) patch.role = input.role;
        if (input.active !== undefined) patch.active = input.active;
        if (input.contactRaw !== undefined) patch.contact_raw = input.contactRaw;
        if (Object.keys(patch).length > 0) {
          const { data, error } = await this.db
            .from('team_members')
            .update(patch)
            .eq('id', existing.id)
            .select()
            .single<TeamMemberRow>();
          if (error) throw new Error(`更新员工失败: ${error.message}`);
          return mapTeamMember(data);
        }
        return existing;
      }
    }
    // 再按 name 找
    const byName = await this.findByName(name);
    if (byName) {
      const patch: Record<string, unknown> = {};
      if (input.puid && !byName.puid) patch.puid = input.puid;
      if (input.displayName !== undefined) patch.display_name = input.displayName;
      if (input.email !== undefined && input.email !== byName.email) patch.email = input.email;
      if (input.phone !== undefined && input.phone !== byName.phone) patch.phone = input.phone;
      if (input.role !== undefined && input.role) patch.role = input.role;
      if (input.contactRaw !== undefined) patch.contact_raw = input.contactRaw;
      if (Object.keys(patch).length > 0) {
        const { data, error } = await this.db
          .from('team_members')
          .update(patch)
          .eq('id', byName.id)
          .select()
          .single<TeamMemberRow>();
        if (error) throw new Error(`更新员工失败: ${error.message}`);
        return mapTeamMember(data);
      }
      return byName;
    }
    // 新建
    const { data, error } = await this.db
      .from('team_members')
      .insert({
        puid: input.puid ?? null,
        name,
        display_name: input.displayName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        role: input.role ?? null,
        active: input.active ?? true,
        synced_from: input.syncedFrom ?? 'chaoxing',
        contact_raw: (input.contactRaw ?? null) as Record<string, unknown> | null,
      })
      .select()
      .single<TeamMemberRow>();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const { data: raced } = await this.db
          .from('team_members')
          .select('*')
          .or(`puid.eq.${input.puid ?? ''},name.eq.${name}`)
          .maybeSingle<TeamMemberRow>();
        if (raced) return mapTeamMember(raced);
      }
      throw new Error(`创建员工失败: ${error.message}`);
    }
    return mapTeamMember(data);
  }

  async upsertManyByContacts(
    contacts: unknown,
    role?: 'sales' | 'pm' | string | null,
  ): Promise<TeamMember[]> {
    if (!contacts) return [];
    const arr = Array.isArray(contacts) ? contacts : [contacts];
    const out: TeamMember[] = [];
    for (const c of arr) {
      const m = await this.upsertByContact(c, role);
      if (m) out.push(m);
    }
    return out;
  }

  async update(id: string, patch: Partial<TeamMemberInput>): Promise<TeamMember> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.puid !== undefined) dbPatch.puid = patch.puid;
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    if (patch.active !== undefined) dbPatch.active = patch.active;
    if (patch.contactRaw !== undefined) dbPatch.contact_raw = patch.contactRaw;
    const { data, error } = await this.db
      .from('team_members')
      .update(dbPatch)
      .eq('id', id)
      .select()
      .single<TeamMemberRow>();
    if (error) throw new Error(`更新员工失败: ${error.message}`);
    return mapTeamMember(data);
  }

  async merge(memberIds: string[], targetId: string): Promise<void> {
    if (memberIds.length < 2 || !memberIds.includes(targetId)) {
      throw new Error('合并失败：必须指定至少两个员工并包含目标');
    }
    const sourceIds = memberIds.filter((id) => id !== targetId);
    // 把所有引用迁移到目标
    await this.db.rpc('merge_team_member_refs', { source_ids: sourceIds, target_id: targetId });
    // 删除/停用源员工
    await this.db.from('team_members').update({ active: false }).in('id', sourceIds);
  }
}
