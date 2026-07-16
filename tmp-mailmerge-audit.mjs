import { FileBlob, SpreadsheetFile } from "/Users/riddhiman.rana/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbookPath = "/Users/riddhiman.rana/Downloads/Email GTM (MailMerge).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));

const inspection = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 4_000,
});

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";

const sheets = inspection.ndjson.trim().split("\n").map((line) => JSON.parse(line));
const summaries = sheets.map((sheetInfo, index) => {
  const sheet = workbook.worksheets.getItemAt(index);
  const values = sheet.getUsedRange(true)?.values ?? [];
  const headers = (values[0] ?? []).map((value) => String(value ?? "").trim());
  const normalizedHeaders = headers.map(normalize);
  const columnIndex = (...names) => normalizedHeaders.findIndex((header) => names.map(normalize).includes(header));
  const emailIndex = columnIndex("Email", "Email Address", "Recipient Email", "Recipient");
  const sentIndex = columnIndex("Email Sent", "Sent", "Sent At", "Sent Date", "Date Sent");
  const subjectIndex = columnIndex("Subject", "Email Subject");
  const rows = values.slice(1).filter((row) => row.some((value) => String(value ?? "").trim()));
  const eligibleRows = emailIndex >= 0 && sentIndex >= 0
    ? rows.filter((row) => present(row[emailIndex]) && present(row[sentIndex]))
    : [];
  const uniqueEmails = new Set(eligibleRows.map((row) => String(row[emailIndex]).trim().toLowerCase()));

  return {
    sheetName: sheet.name,
    usedRange: sheetInfo.range,
    usedRowsIncludingHeader: values.length,
    headers,
    emailColumn: emailIndex + 1,
    sentColumn: sentIndex + 1,
    subjectColumn: subjectIndex + 1,
    nonblankDataRows: rows.length,
    historicalSendRows: eligibleRows.length,
    uniqueHistoricalRecipients: uniqueEmails.size,
    firstEligibleRow: eligibleRows.length ? rows.indexOf(eligibleRows[0]) + 2 : null,
    lastEligibleRow: eligibleRows.length ? rows.indexOf(eligibleRows.at(-1)) + 2 : null,
  };
});

console.log(JSON.stringify({
  summaries,
  totalHistoricalSendRows: summaries.reduce((total, summary) => total + summary.historicalSendRows, 0),
}, null, 2));
