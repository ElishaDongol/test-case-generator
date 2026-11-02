import * as XLSX from "xlsx";

export function exportToExcel(jsonText: string): Buffer {
  let data: Record<string, string>[];
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON for Excel export");
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Test Cases");

  // Auto-column widths
  const colWidths = Object.keys(data[0] ?? {}).map((key) => ({
    wch: Math.max(key.length, 20),
  }));
  ws["!cols"] = colWidths;

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
