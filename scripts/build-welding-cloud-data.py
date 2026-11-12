from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
INPUT_XLSX = ROOT / "动力站焊接数据库.xlsx"
MODEL_INDEX = ROOT / "动力站管道模型和属性文件" / "model-index.json"
OUTPUT_DIR = ROOT / "outputs" / "welding-cloud-sync"
OUTPUT_XLSX = OUTPUT_DIR / "动力站焊接数据库_含虚拟焊接日期.xlsx"
OUTPUT_JSON = ROOT / "动力站管道模型和属性文件" / "welding-dates.json"
SOURCE_URL = "https://docs.qq.com/sheet/DU1pUYVV6QkJaVnZK?tab=000001"


def normalize_weld_number(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def virtual_date(line_number: str, weld_number: str) -> date:
    digest = hashlib.sha256(f"{line_number}\0{weld_number}".encode("utf-8")).digest()
    day_offset = int.from_bytes(digest[:4], "big") % 214
    return date(2026, 3, 1) + timedelta(days=day_offset)


model_index = json.loads(MODEL_INDEX.read_text(encoding="utf-8"))
model_weld_keys: set[tuple[str, str]] = set()
for node in model_index.get("nodes", []):
    properties = node.get("properties") or {}
    line_number = str(properties.get("EP3D_管 线 号", "")).strip()
    weld_value = properties.get("EP3D_焊点编号")
    if line_number and weld_value not in (None, ""):
        model_weld_keys.add((line_number, normalize_weld_number(weld_value)))

workbook = load_workbook(INPUT_XLSX)
worksheet = workbook[workbook.sheetnames[0]]
headers = {cell.value: cell.column for cell in worksheet[1]}
line_column = headers["管线号"]
weld_column = headers["焊点编号"]
date_column = headers["焊接日期"]

records: list[dict[str, object]] = []
for row_index in range(2, worksheet.max_row + 1):
    line_value = worksheet.cell(row_index, line_column).value
    weld_value = worksheet.cell(row_index, weld_column).value
    if line_value in (None, "") or weld_value in (None, ""):
        continue
    key = (str(line_value).strip(), normalize_weld_number(weld_value))
    if key not in model_weld_keys:
        continue
    generated_date = virtual_date(*key)
    target_cell = worksheet.cell(row_index, date_column)
    target_cell.value = generated_date
    target_cell.number_format = "yyyy-mm-dd"
    records.append(
        {
            "lineNumber": key[0],
            "weldNumber": key[1],
            "weldingDate": generated_date.isoformat(),
            "sourceRow": row_index,
            "virtual": True,
        }
    )

if len(records) != len(model_weld_keys):
    missing = len(model_weld_keys) - len(records)
    raise RuntimeError(f"模型焊点匹配不完整，缺少 {missing} 条")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
workbook.save(OUTPUT_XLSX)

payload = {
    "schemaVersion": 1,
    "source": "腾讯文档",
    "sourceTitle": "动力站焊接数据库",
    "sourceUrl": SOURCE_URL,
    "sheetName": worksheet.title,
    "keyFields": ["管线号", "焊点编号"],
    "dateField": "焊接日期",
    "isVirtual": True,
    "recordCount": len(records),
    "records": sorted(records, key=lambda item: (str(item["lineNumber"]), str(item["weldNumber"]).zfill(12))),
}
OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

print(
    json.dumps(
        {
            "outputWorkbook": str(OUTPUT_XLSX),
            "outputJson": str(OUTPUT_JSON),
            "recordCount": len(records),
            "sheetName": worksheet.title,
        },
        ensure_ascii=False,
    )
)
