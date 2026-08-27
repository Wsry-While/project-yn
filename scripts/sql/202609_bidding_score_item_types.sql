-- 招投标评分项分类字段 + 真实招标文件结构学习表
-- 2026-09
-- 说明：item_type / delivery_method / source_section 先在开发库直接加过，
-- 这里用 IF NOT EXISTS 形式补齐，保证其他环境可重放。

-- ============= 评分项分类字段（两阶段抽取后新增） =============
ALTER TABLE bidding_score_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'general'
    CHECK (item_type IN ('key','general','demo','document','unknown'));

ALTER TABLE bidding_score_items
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'screenshot'
    CHECK (delivery_method IN ('screenshot','demo','document','na'));

ALTER TABLE bidding_score_items
  ADD COLUMN IF NOT EXISTS source_section TEXT;

-- ============= 招标文件结构批量学习结果 =============
-- 由 scripts/analyze-tender-structure.ts 写入，用于迭代章节定位与抽取规则。
CREATE TABLE IF NOT EXISTS tender_structure_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES bidding_screenshots(id) ON DELETE CASCADE,
  file_name TEXT,
  file_kind TEXT,
  file_length INTEGER,
  chapters JSONB,
  scoring_section JSONB,
  requirements_section JSONB,
  anchors JSONB,
  notes TEXT,
  raw_response TEXT,
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok','parse_failed','llm_failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tender_structure_record
  ON tender_structure_analysis(record_id);
CREATE INDEX IF NOT EXISTS idx_tender_structure_status
  ON tender_structure_analysis(status);
