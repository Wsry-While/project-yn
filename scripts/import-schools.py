#!/usr/bin/env python3
"""从 assets/学校信息汇总表.xlsx 导入学校与部门到 Supabase。

用法： python scripts/import-schools.py
幂等：按 (school_name, department_name, sales_owner) upsert。
"""
import os
import sys
from pathlib import Path
from datetime import datetime

from openpyxl import load_workbook
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "assets" / "学校信息汇总表.xlsx"


def parse_dt(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def main():
    url = os.environ.get("COZE_SUPABASE_URL")
    key = os.environ.get("COZE_SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("missing COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(2)
    if not XLSX.exists():
        print(f"missing file: {XLSX}", file=sys.stderr)
        sys.exit(2)

    sb = create_client(url, key)
    wb = load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb.active

    school_cache: dict[str, str] = {}

    def get_or_create_school(name: str) -> str | None:
        if not name:
            return None
        if name in school_cache:
            return school_cache[name]
        existing = (
            sb.table("schools")
            .select("id,name")
            .eq("name", name)
            .limit(1)
            .execute()
        )
        if existing.data:
            sid = existing.data[0]["id"]
        else:
            created = (
                sb.table("schools")
                .insert({
                    "name": name,
                    "province": "云南",
                    "external_source": "excel",
                })
                .execute()
            )
            sid = created.data[0]["id"]
        school_cache[name] = sid
        return sid

    count = 0
    dept_count = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        school = (row[0] or "").strip() if isinstance(row[0], str) else row[0]
        department = (row[1] or "").strip() if isinstance(row[1], str) else (row[1] or "")
        sales = (row[2] or "").strip() if isinstance(row[2], str) else (row[2] or "")
        submitter = (row[3] or "").strip() if isinstance(row[3], str) else (row[3] or "")
        submit_time = parse_dt(row[4])
        uid = str(row[5]).strip() if row[5] is not None else None
        sales_team = (row[6] or "").strip() if isinstance(row[6], str) else (row[6] or "")
        mobile = (row[7] or "").strip() if isinstance(row[7], str) else (row[7] or "")
        staff_no = (row[8] or "").strip() if isinstance(row[8], str) else (row[8] or "")
        updated = parse_dt(row[9]) or submit_time

        if not school:
            continue
        count += 1
        sid = get_or_create_school(school)
        # 部门以 学校+部门+负责销售 作为唯一键；空部门用 '_'
        dept_name = department or "(未指定部门)"
        payload = {
            "school_id": sid,
            "name": dept_name,
            "sales_owner": sales or None,
            "submitter": submitter or None,
            "submitter_uid": uid,
            "sales_team": sales_team or None,
            "mobile": mobile or None,
            "staff_no": staff_no or None,
            "external_source": "excel",
            "external_updated_at": updated,
            "raw_payload": {
                "school": school,
                "department": department,
                "salesOwner": sales,
                "submitter": submitter,
                "submitTime": submit_time,
                "uid": uid,
                "salesTeam": sales_team,
                "mobile": mobile,
                "staffNo": staff_no,
                "updatedAt": updated,
            },
        }
        sb.table("school_departments").upsert(
            payload, on_conflict="school_id,name,sales_owner"
        ).execute()
        dept_count += 1

    print(f"schools rows read: {count}, departments upserted: {dept_count}, unique schools: {len(school_cache)}")


if __name__ == "__main__":
    main()
