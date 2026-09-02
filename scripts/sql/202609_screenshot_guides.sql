-- 截图作业指导书：按招投标记录持久化生成结果与人工勾选
-- 2026-09
-- 一份招投标记录（bidding_screenshots）对应一份指导书：
--   guide_payload    机器生成的完整指导书（评分项、参考来源候选池、AI 说明）
--   item_selections  人工决策：每项状态 + 跨组勾选的图片（有序）+ 手工说明
-- 首次打开全量召回并落库；再次打开直接复用；「重新匹配知识库」重算召回但保留人工勾选。

CREATE TABLE IF NOT EXISTS screenshot_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL UNIQUE REFERENCES bidding_screenshots(id) ON DELETE CASCADE,

  -- 本次召回使用的知识库版本（仅展示，不强制过滤）
  kb_version TEXT,
  -- 机器生成的完整指导书 ScreenshotGuide（含 referenceSources 候选池）
  guide_payload JSONB NOT NULL,
  -- 人工决策：{ [itemId]: { status, selectedAssetIds: string[], instructionOverride? } }
  -- selectedAssetIds 为有序数组，支持跨图组多选与用户排序，导出即按此顺序取图
  item_selections JSONB NOT NULL DEFAULT '{}'::jsonb,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_by_name TEXT,
  updated_by UUID,
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screenshot_guides_record ON screenshot_guides(record_id);

-- RLS：业务接口走 admin 客户端 + 显式 requireUser，不开放 anon
ALTER TABLE screenshot_guides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screenshot_guides' AND policyname = 'screenshot_guides_auth_all'
  ) THEN
    CREATE POLICY screenshot_guides_auth_all ON screenshot_guides
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_screenshot_guides_updated ON screenshot_guides;
CREATE TRIGGER trg_screenshot_guides_updated BEFORE UPDATE ON screenshot_guides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
