-- 截图知识库 1.0：参数↔图片映射 + 知识库版本管理
-- 2026-09
-- 在 bidding_screenshot_examples（单图维度：模块/页面/要素/tags）之上，
-- 新增参数级映射，把"这张图能证明哪个技术参数"沉淀为可检索关系，
-- 用于生成「截图作业指导书」时按参数召回参考图。

-- ============= 参数↔图片映射 =============
CREATE TABLE IF NOT EXISTS screenshot_parameter_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  example_id UUID NOT NULL REFERENCES bidding_screenshot_examples(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES external_file_assets(id) ON DELETE SET NULL,
  source_record_id UUID REFERENCES bidding_screenshots(id) ON DELETE SET NULL,

  -- 参数归一化键（去 ▲★/标点/空白后的稳定标识，用于跨项目匹配）
  parameter_key TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  system_module TEXT,
  -- 视觉理解：这张图如何证明该参数
  vision_note TEXT,
  -- 图中能证明该参数的关键要素/界面区域
  evidence_elements TEXT[] NOT NULL DEFAULT '{}',

  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  kb_version TEXT NOT NULL DEFAULT '1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同一示例图 + 同一参数键幂等
  CONSTRAINT screenshot_parameter_mappings_unique UNIQUE (example_id, parameter_key)
);

CREATE INDEX IF NOT EXISTS idx_spm_parameter_key
  ON screenshot_parameter_mappings(parameter_key);
CREATE INDEX IF NOT EXISTS idx_spm_system_module
  ON screenshot_parameter_mappings(system_module);
CREATE INDEX IF NOT EXISTS idx_spm_source_record
  ON screenshot_parameter_mappings(source_record_id);
CREATE INDEX IF NOT EXISTS idx_spm_version
  ON screenshot_parameter_mappings(kb_version);

-- ============= 知识库版本 =============
CREATE TABLE IF NOT EXISTS knowledge_base_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'learning'
    CHECK (status IN ('learning','ready','failed')),
  total_records INTEGER NOT NULL DEFAULT 0,
  total_images INTEGER NOT NULL DEFAULT 0,
  total_mappings INTEGER NOT NULL DEFAULT 0,
  failed_images INTEGER NOT NULL DEFAULT 0,
  learned_by UUID,
  learned_by_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_versions_status
  ON knowledge_base_versions(status);

-- updated_at 触发器（若已存在同名触发器则跳过）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_kb_versions') THEN
    CREATE TRIGGER set_updated_at_kb_versions
      BEFORE UPDATE ON knowledge_base_versions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_spm') THEN
    CREATE TRIGGER set_updated_at_spm
      BEFORE UPDATE ON screenshot_parameter_mappings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
