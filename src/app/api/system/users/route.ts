import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

interface TeamMemberRow {
  id: string;
  puid: string | null;
  name: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean;
  team_id: string | null;
}

interface UserRoleRow {
  team_member_id: string;
  scope: string;
  app_roles: { id: string; code: string; name: string } | null;
}

/**
 * GET /api/system/users?search=&page=1&pageSize=20
 * 返回团队成员及其系统角色。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const authed = await requirePermission(request, 'user:manage');
    if ('status' in authed) return authed;

    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') ?? '20', 10) || 20);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = getAdminSupabase()
      .from('team_members')
      .select(
        'id,puid,name,display_name,email,phone,role,active,team_id',
        { count: 'exact' },
      )
      .order('display_name', { ascending: true })
      .range(from, to);

    if (search) {
      q = q.or(`name.ilike.%${search}%,display_name.ilike.%${search}%,puid.ilike.%${search}%`);
    }
    const { data, count, error } = await q;
    if (error) throw error;

    const rows = (data ?? []) as unknown as TeamMemberRow[];
    const ids = rows.map((r) => r.id);
    const { data: userRoles, error: urErr } = await getAdminSupabase()
      .from('app_user_roles')
      .select('team_member_id, scope, app_roles(id, code, name)')
      .in('team_member_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

    const roleMap = new Map<string, Array<{ id: string; code: string; name: string; scope: string }>>();
    for (const ur of (userRoles ?? []) as unknown as UserRoleRow[]) {
      if (!ur.app_roles) continue;
      const list = roleMap.get(ur.team_member_id) ?? [];
      list.push({ ...ur.app_roles, scope: ur.scope });
      roleMap.set(ur.team_member_id, list);
    }

    return ok({
      rows: rows.map((r) => ({
        id: r.id,
        puid: r.puid,
        name: r.name,
        displayName: r.display_name ?? r.name,
        email: r.email,
        phone: r.phone,
        bizRole: r.role,
        active: r.active,
        teamId: r.team_id,
        roles: roleMap.get(r.id) ?? [],
      })),
      total: count ?? 0,
      page,
      pageSize,
    });
  });
}
