import { inflateSync } from "node:zlib";

export const TENCENT_WELDING_SOURCE_URL = "https://docs.qq.com/sheet/DU1pUYVV6QkJaVnZK?tab=000001";
const DOCUMENT_ID = "DU1pUYVV6QkJaVnZK";
const SHEET_ID = "000001";

function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buffer.length && shift <= 63n) {
    const byte = BigInt(buffer[offset++]);
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) return { value, offset };
    shift += 7n;
  }
  throw new Error("Invalid Tencent Docs protobuf varint");
}

function parseMessage(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (!field || wire === 3 || wire === 4 || wire > 5) throw new Error("Invalid Tencent Docs protobuf field");
    if (wire === 0) {
      const item = readVarint(buffer, offset);
      fields.push({ field, wire, value: item.value });
      offset = item.offset;
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new Error("Truncated Tencent Docs fixed64 field");
      fields.push({ field, wire, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) throw new Error("Truncated Tencent Docs bytes field");
      fields.push({ field, wire, value: buffer.subarray(offset, end) });
      offset = end;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new Error("Truncated Tencent Docs fixed32 field");
      fields.push({ field, wire, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
    }
  }
  return fields;
}

function items(message, field, wire = null) {
  return message.filter((item) => item.field === field && (wire === null || item.wire === wire));
}

function childMessages(message, field) {
  return items(message, field, 2).map((item) => parseMessage(item.value));
}

function firstVarint(message, field, fallback = 0) {
  const item = items(message, field, 0)[0];
  return item ? Number(item.value) : fallback;
}

function firstBytes(message, field) {
  return items(message, field, 2)[0]?.value || null;
}

function decodeDictionaryEntry(message) {
  const textBytes = firstBytes(message, 1);
  return textBytes ? new TextDecoder().decode(textBytes) : "";
}

function decodeNumberEntry(message) {
  const fixed64 = items(message, 1, 1)[0]?.value;
  if (fixed64) return fixed64.readDoubleLE(0);
  const fixed32 = items(message, 1, 5)[0]?.value;
  if (fixed32) return fixed32.readFloatLE(0);
  return firstVarint(message, 1, 0);
}

function decodeCellValue(cell, strings, numbers) {
  const valueBytes = firstBytes(cell, 3);
  if (!valueBytes) return null;
  const value = parseMessage(valueBytes);
  const kind = firstVarint(value, 1, 0);
  const payloadBytes = firstBytes(value, 2);
  if (!payloadBytes) return null;
  const reference = firstVarint(parseMessage(payloadBytes), 1, 0);
  if (kind === 4) return strings[reference] ?? "";
  if (kind === 2) return reference <= 128 ? reference : numbers[reference - 129] ?? null;
  return null;
}

function decodeSheetBlock(encoded) {
  const decoded = inflateSync(Buffer.from(encoded, "base64"));
  const root = childMessages(parseMessage(decoded), 1)[0];
  if (!root) throw new Error("Tencent Docs workbook root is missing");
  const sheetSection = childMessages(root, 5).find((section) => items(section, 19, 2).length > 0);
  if (!sheetSection) throw new Error("Tencent Docs sheet section is missing");
  const sheet = childMessages(sheetSection, 19)[0];
  const dictionary = childMessages(sheet, 5)[0];
  if (!dictionary) throw new Error("Tencent Docs cell dictionary is missing");
  const strings = childMessages(dictionary, 1).map(decodeDictionaryEntry);
  const numbers = childMessages(dictionary, 3).map(decodeNumberEntry);
  const rows = new Map();
  for (const cell of childMessages(sheet, 6)) {
    const rowIndex = firstVarint(cell, 1, 0);
    const columnIndex = firstVarint(cell, 2, 0);
    if (![0, 1, 14].includes(columnIndex)) continue;
    if (!rows.has(rowIndex)) rows.set(rowIndex, new Map());
    rows.get(rowIndex).set(columnIndex, decodeCellValue(cell, strings, numbers));
  }
  return rows;
}

function cookiesFrom(response) {
  const values = response.headers.getSetCookie?.() || [];
  if (values.length) return values.map((value) => value.split(";", 1)[0]).join("; ");
  const combined = response.headers.get("set-cookie") || "";
  return combined.split(/,(?=[^;,]+=)/).map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function normalizeDataKey(value) {
  return String(value ?? "").replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
}

function normalizeWeldNumber(value) {
  const text = normalizeDataKey(value);
  return /^\d+\.0$/.test(text) ? text.slice(0, -2) : text;
}

function recordKey(lineNumber, weldNumber) {
  return `${normalizeDataKey(lineNumber)}\u0000${normalizeWeldNumber(weldNumber)}`;
}

function excelSerialToDate(value) {
  const milliseconds = Math.round(value * 86400000);
  return new Date(Date.UTC(1899, 11, 30) + milliseconds).toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return excelSerialToDate(value);
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[\/.年-](\d{1,2})[\/.月-](\d{1,2})日?$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return text;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Tencent Docs request failed: HTTP ${response.status}`);
  return { response, text: await response.text() };
}

export async function syncTencentWeldingDates(seedPayload) {
  const seedRecords = seedPayload.records || [];
  if (!seedRecords.length) throw new Error("Welding seed records are empty");
  const sourceRows = seedRecords.map((record) => Number(record.sourceRow)).filter(Number.isFinite);
  const startRow = Math.min(...sourceRows) - 1;
  const endRow = Math.max(...sourceRows) - 1;

  const page = await fetchText(`${TENCENT_WELDING_SOURCE_URL}&sync=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "Mozilla/5.0" }
  });
  const cookies = cookiesFrom(page.response);
  const preload = page.text.match(/href="(\/\/docs\.qq\.com\/dop-api\/opendoc\?[^\"]+)"/);
  if (!preload) throw new Error("Tencent Docs preload endpoint was not found");
  const openUrl = `https:${preload[1].replaceAll("&amp;", "&")}`;
  const commonHeaders = {
    "Cache-Control": "no-cache",
    Cookie: cookies,
    Referer: TENCENT_WELDING_SOURCE_URL,
    "User-Agent": "Mozilla/5.0"
  };
  const open = await fetchText(openUrl, { headers: commonHeaders });
  const openData = JSON.parse(open.text.replace(/^clientVarsCallback\(/, "").replace(/\);?\s*$/, ""));
  const collab = openData.clientVars.collab_client_vars;
  const sheetUrl = new URL("https://docs.qq.com/dop-api/get/sheet");
  for (const [key, value] of Object.entries({
    tab: SHEET_ID,
    padId: collab.globalPadId,
    subId: SHEET_ID,
    outformat: "1",
    startrow: String(startRow),
    endrow: String(endRow),
    normal: "1",
    preview_token: "",
    nowb: "1",
    rev: String(collab.rev)
  })) sheetUrl.searchParams.set(key, value);
  const sheet = await fetchText(sheetUrl, { headers: commonHeaders });
  const sheetData = JSON.parse(sheet.text);
  const encoded = sheetData.data?.initialAttributedText?.text?.[0]?.related_sheet;
  if (!encoded) throw new Error("Tencent Docs cell block is missing");
  const rows = decodeSheetBlock(encoded);
  const liveByKey = new Map();
  for (const [rowIndex, columns] of rows) {
    const lineNumber = columns.get(0);
    const weldNumber = columns.get(1);
    if (lineNumber === null || lineNumber === undefined || weldNumber === null || weldNumber === undefined) continue;
    liveByKey.set(recordKey(lineNumber, weldNumber), {
      lineNumber: normalizeDataKey(lineNumber),
      weldNumber: normalizeWeldNumber(weldNumber),
      weldingDate: normalizeDate(columns.get(14)),
      sourceRow: rowIndex + 1,
      virtual: false
    });
  }

  const matched = seedRecords.map((seed) => liveByKey.get(recordKey(seed.lineNumber, seed.weldNumber))).filter(Boolean);
  const liveDateCount = matched.filter((record) => record.weldingDate).length;
  const records = seedRecords.map((seed) => liveByKey.get(recordKey(seed.lineNumber, seed.weldNumber)) || {
    ...seed,
    weldingDate: null,
    virtual: false
  });

  return {
    schemaVersion: 2,
    source: "腾讯文档",
    sourceTitle: openData.clientVars.title || seedPayload.sourceTitle,
    sourceUrl: TENCENT_WELDING_SOURCE_URL,
    sheetName: seedPayload.sheetName,
    keyFields: ["管线号", "焊点编号"],
    dateField: "焊接日期",
    syncedAt: new Date().toISOString(),
    sourceLastModifyTime: openData.clientVars.lastModifyTime || null,
    syncMode: "cloud-live",
    recordCount: records.length,
    matchedRecordCount: matched.length,
    liveDateCount,
    records
  };
}

export const __test = { decodeSheetBlock, normalizeDate, recordKey };
