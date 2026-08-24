-- 为 trip_requests.approval_status 增加 'revoked'（已撤销）取值。
-- 对应第三方 Excel 导出里审批状态为「已撤销」的历史记录。
--
-- 执行前先检查是否存在 CHECK 约束（Supabase 控制台建表通常不会自动加，
-- 此脚本做了 IF EXISTS 判断，可安全重复执行）。

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'trip_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%approval_status%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE trip_requests DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'revoked'));
