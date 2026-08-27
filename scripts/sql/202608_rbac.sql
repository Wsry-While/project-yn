-- RBAC 权限体系：角色 / 权限 / 角色-权限 / 用户-角色 / 团队分组。
-- 幂等：可重复执行，使用 ON CONFLICT 保留内置数据。
--
-- 三级角色：
--   super_admin  超级管理员（全部权限，含系统管理、只读业务表强制编辑）
--   team_leader  团队负责人（本团队数据可写，无系统管理）
--   team_member  团队成员（仅自己负责的数据可写，不可删除）
--
-- 超管判定：登录用户 chaoxing.uid 命中环境变量 SUPERADMIN_PUIDS 即视为 super_admin，
-- 与本表 app_user_roles 取并集，保证跨环境（开发/生产）无需逐库写死 uuid。

-- ========== 1. 团队分组 ==========
CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  leader_id   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- team_members 增加 team_id 列（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='team_members' AND column_name='team_id'
  ) THEN
    ALTER TABLE team_members ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);

-- ========== 2. 角色 ==========
CREATE TABLE IF NOT EXISTS app_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_builtin  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_roles (code, name, description, is_builtin) VALUES
  ('super_admin',  '超级管理员', '全部数据与系统管理权限', true),
  ('team_leader',  '团队负责人', '本团队数据读写，无系统管理', true),
  ('team_member',  '团队成员',   '本人数据读写，不可删除', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_builtin = EXCLUDED.is_builtin;

-- ========== 3. 权限点 ==========
CREATE TABLE IF NOT EXISTS app_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  module      text NOT NULL,
  action      text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 权限点种子（module:action）
INSERT INTO app_permissions (code, name, module, action, description) VALUES
  -- 仪表盘 / 通用视图
  ('dashboard:view',    '查看仪表盘', 'dashboard', 'view',  '访问仪表盘'),
  ('workbench:view',    '查看我的工作台', 'workbench', 'view', '访问我的工作台'),
  ('risk:view',         '查看风险中心', 'risk', 'view', '访问风险中心'),
  ('analytics:view',    '查看多维分析', 'analytics', 'view', '访问多维分析台'),
  ('report:generate',   '生成 AI 周报', 'report', 'generate', '生成与导出周报'),
  ('data-align:list',   '查看数据对齐', 'data-align', 'list', '查看数据对齐队列'),
  ('data-align:resolve','处理数据对齐', 'data-align', 'resolve', '标记已处理/忽略'),
  ('dict:list',         '查看字典', 'dict', 'list', '查看字典管理'),
  ('dict:manage',       '管理字典', 'dict', 'manage', '新增/编辑/合并字典'),
  ('team:list',         '查看团队', 'team', 'list', '查看团队成员'),
  ('team:manage',       '管理团队', 'team', 'manage', '编辑成员/分组'),
  -- 学校
  ('school:list',   '查看学校', 'school', 'list',   '学校档案列表'),
  ('school:create', '新增学校', 'school', 'create', '新建学校/院系'),
  ('school:update', '编辑学校', 'school', 'update', '编辑学校/院系'),
  ('school:delete', '删除学校', 'school', 'delete', '删除学校/院系'),
  -- 项目 / 任务 / 里程碑
  ('project:list',   '查看项目', 'project', 'list',   '项目列表'),
  ('project:create', '新增项目', 'project', 'create', '新建项目'),
  ('project:update', '编辑项目', 'project', 'update', '编辑项目'),
  ('project:delete', '删除项目', 'project', 'delete', '删除项目'),
  ('task:list',   '查看任务', 'task', 'list',   '任务看板'),
  ('task:create', '新建任务', 'task', 'create', '新建任务'),
  ('task:update', '更新任务', 'task', 'update', '拖拽/编辑任务'),
  ('task:delete', '删除任务', 'task', 'delete', '删除任务'),
  ('milestone:create', '新建里程碑', 'milestone', 'create', '新建里程碑'),
  ('milestone:update', '编辑里程碑', 'milestone', 'update', '编辑里程碑'),
  ('milestone:delete', '删除里程碑', 'milestone', 'delete', '删除里程碑'),
  -- 只读业务表（系统内只读，超管可强制编辑）
  ('trip:list',   '查看项目外出', 'trip', 'list', '项目外出列表'),
  ('trip:export', '导出项目外出', 'trip', 'export', '导出 CSV'),
  ('trip:edit',   '编辑项目外出', 'trip', 'edit', '强制编辑超星推送数据（超管）'),
  ('bidding:list',   '查看招投标截图', 'bidding', 'list', '招投标截图列表'),
  ('bidding:export', '导出招投标截图', 'bidding', 'export', '导出 CSV'),
  ('bidding:edit',   '编辑招投标截图', 'bidding', 'edit', '强制编辑（超管）'),
  ('demand:list', '查看项目建设申请', 'demand', 'list', '建设申请列表'),
  ('demand:edit', '编辑项目建设申请', 'demand', 'edit', '强制编辑（超管）'),
  ('qiming:list', '查看启明星建设', 'qiming', 'list', '启明星建设列表'),
  ('qiming:edit', '编辑启明星建设', 'qiming', 'edit', '强制编辑（超管）'),
  -- 系统管理（仅超管）
  ('user:manage',       '用户管理', 'system', 'user',       '分配角色/团队/禁用'),
  ('role:manage',       '角色管理', 'system', 'role',       '角色与权限分配'),
  ('permission:manage', '权限管理', 'system', 'permission', '维护权限点'),
  ('setting:manage',    '系统设置', 'system', 'setting',    '项目与系统设置')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, module = EXCLUDED.module,
      action = EXCLUDED.action, description = EXCLUDED.description;

-- ========== 4. 角色-权限关联 ==========
CREATE TABLE IF NOT EXISTS app_role_permissions (
  role_id       uuid NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES app_permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

-- super_admin 拥有全部权限
INSERT INTO app_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- team_leader：全部读权限 + 业务写权限（项目/任务/里程碑/学校）+ 数据对齐处理 + 周报
INSERT INTO app_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM app_roles r
JOIN app_permissions p ON p.code IN (
  'dashboard:view','workbench:view','risk:view','analytics:view','report:generate',
  'data-align:list','data-align:resolve','dict:list','team:list','team:manage',
  'school:list','school:create','school:update',
  'project:list','project:create','project:update',
  'task:list','task:create','task:update',
  'milestone:create','milestone:update',
  'trip:list','trip:export','bidding:list','bidding:export','demand:list','qiming:list'
)
WHERE r.code = 'team_leader'
ON CONFLICT DO NOTHING;

-- team_member：全部读 + 自己数据的创建/编辑（无删除、无管理）
INSERT INTO app_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM app_roles r
JOIN app_permissions p ON p.code IN (
  'dashboard:view','workbench:view','risk:view','analytics:view','report:generate',
  'data-align:list','dict:list','team:list',
  'school:list','school:create','school:update',
  'project:list','project:create','project:update',
  'task:list','task:create','task:update',
  'milestone:create','milestone:update',
  'trip:list','trip:export','bidding:list','bidding:export','demand:list','qiming:list'
)
WHERE r.code = 'team_member'
ON CONFLICT DO NOTHING;

-- ========== 5. 用户-角色关联 ==========
-- user_id 为早期按 auth.users 分配的键（可空），team_member_id 为通过系统管理 UI 分配的键；
-- 授权时对两者取并集。
CREATE TABLE IF NOT EXISTS app_user_roles (
  user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_member_id uuid REFERENCES team_members(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
  scope          text NOT NULL DEFAULT 'self',  -- all / team / self
  team_id        uuid REFERENCES teams(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_roles_owner_check CHECK (user_id IS NOT NULL OR team_member_id IS NOT NULL),
  CONSTRAINT app_user_roles_scope_check CHECK (scope IN ('all','team','self'))
);

CREATE INDEX IF NOT EXISTS idx_app_user_roles_role ON app_user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_app_user_roles_team ON app_user_roles(team_id);
CREATE INDEX IF NOT EXISTS idx_app_user_roles_team_member ON app_user_roles(team_member_id);

-- 兼容历史环境：如果旧表 user_id 是 NOT NULL，放开它并补 team_member_id。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='app_user_roles' AND column_name='user_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE app_user_roles ALTER COLUMN user_id DROP NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='app_user_roles' AND column_name='team_member_id'
  ) THEN
    ALTER TABLE app_user_roles ADD COLUMN team_member_id uuid REFERENCES team_members(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_app_user_roles_team_member ON app_user_roles(team_member_id);
  END IF;
END $$;

-- ========== 6. updated_at 触发器（teams / app_roles） ==========
-- set_updated_at() 函数已在项目早期迁移中创建，这里仅在缺失时兜底创建。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema='public' AND routine_name='set_updated_at'
  ) THEN
    EXECUTE 'CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN NEW.updated_at = now(); RETURN NEW; END $f$';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_teams_updated ON teams;
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_roles_updated ON app_roles;
CREATE TRIGGER trg_app_roles_updated BEFORE UPDATE ON app_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== 7. RLS ==========
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user_roles ENABLE ROW LEVEL SECURITY;

-- 业务接口统一使用 service role（admin 客户端），这里的 RLS 仅作防御纵深；
-- 认证用户只读权限元数据，写入一律走后端 service role。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_roles' AND policyname='auth_read_roles') THEN
    CREATE POLICY auth_read_roles ON app_roles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_permissions' AND policyname='auth_read_perms') THEN
    CREATE POLICY auth_read_perms ON app_permissions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
