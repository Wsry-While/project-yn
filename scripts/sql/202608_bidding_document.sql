-- 招投标截图交付文档生成 + 评分项持久化 + 督办任务
-- 2026-08

-- ============= 评分项 =============
CREATE TABLE IF NOT EXISTS bidding_score_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES bidding_screenshots(id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  requirement TEXT,
  score_value NUMERIC(6,2),
  category TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  -- matched: 已自动匹配到参考截图
  -- pending: 未匹配，待 PM 处理
  -- task_created: 已创建督办任务
  -- uploaded: PM 已手动上传截图
  -- na: 标记不适用
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('matched','pending','task_created','uploaded','na')),
  matched_example_id UUID REFERENCES bidding_screenshot_examples(id) ON DELETE SET NULL,
  matched_asset_id UUID REFERENCES external_file_assets(id) ON DELETE SET NULL,
  task_id UUID,
  delivery_asset_id UUID REFERENCES external_file_assets(id) ON DELETE SET NULL,
  delivery_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bidding_score_items_record
  ON bidding_score_items(record_id, order_index);
CREATE INDEX IF NOT EXISTS idx_bidding_score_items_status
  ON bidding_score_items(match_status) WHERE match_status <> 'matched';

-- ============= 文档生成记录 =============
CREATE TABLE IF NOT EXISTS bidding_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES bidding_screenshots(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','ready','failed')),
  docx_asset_id UUID REFERENCES external_file_assets(id) ON DELETE SET NULL,
  pdf_asset_id UUID REFERENCES external_file_assets(id) ON DELETE SET NULL,
  matched_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  generated_by UUID,
  generated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (record_id, version)
);

CREATE INDEX IF NOT EXISTS idx_bidding_documents_record
  ON bidding_documents(record_id, version DESC);

-- ============= 督办任务（独立轻量表，不进 tasks 主表） =============
-- 原因：tasks.project_id 强关联项目主表，督办任务跨团队、外部人，
-- 没有项目概念；独立表避免污染主看板。
CREATE TABLE IF NOT EXISTS bidding_followup_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES bidding_screenshots(id) ON DELETE CASCADE,
  score_item_id UUID REFERENCES bidding_score_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'p2'
    CHECK (priority IN ('p0','p1','p2','p3')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done','cancelled')),
  -- 内部负责人（team_members.id）
  assignee_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  -- 外部负责人（研发/供应商等不在系统里的人）
  external_assignee_name TEXT,
  external_assignee_contact TEXT,
  external_assignee_org TEXT,
  due_date DATE,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bidding_followup_tasks_record
  ON bidding_followup_tasks(record_id, status);
CREATE INDEX IF NOT EXISTS idx_bidding_followup_tasks_assignee
  ON bidding_followup_tasks(assignee_id) WHERE status IN ('todo','in_progress');
CREATE INDEX IF NOT EXISTS idx_bidding_followup_tasks_due
  ON bidding_followup_tasks(due_date) WHERE status IN ('todo','in_progress');

-- ============= RLS =============
ALTER TABLE bidding_score_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bidding_followup_tasks ENABLE ROW LEVEL SECURITY;

-- 业务接口走 admin 客户端 + 显式 requireUser，不开放直接 anon 访问
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bidding_score_items' AND policyname = 'bidding_score_items_auth_all'
  ) THEN
    CREATE POLICY bidding_score_items_auth_all ON bidding_score_items
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bidding_documents' AND policyname = 'bidding_documents_auth_all'
  ) THEN
    CREATE POLICY bidding_documents_auth_all ON bidding_documents
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bidding_followup_tasks' AND policyname = 'bidding_followup_tasks_auth_all'
  ) THEN
    CREATE POLICY bidding_followup_tasks_auth_all ON bidding_followup_tasks
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- updated_at 触发器
DROP TRIGGER IF EXISTS trg_bidding_score_items_updated ON bidding_score_items;
CREATE TRIGGER trg_bidding_score_items_updated BEFORE UPDATE ON bidding_score_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bidding_documents_updated ON bidding_documents;
CREATE TRIGGER trg_bidding_documents_updated BEFORE UPDATE ON bidding_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bidding_followup_tasks_updated ON bidding_followup_tasks;
CREATE TRIGGER trg_bidding_followup_tasks_updated BEFORE UPDATE ON bidding_followup_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
