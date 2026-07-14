import {
  applyTemplate,
  isEmail,
  outreachTemplate,
  templateVariables,
} from "./message.js";
import { QUEUE_STATUS } from "./queue.js";

export const MAIL_MERGE_HEADERS = Object.freeze([
  "First Name",
  "Last Name",
  "Note about work",
  "Recipient",
  "Email Sent",
  "Subject",
  "Message",
]);

export const IMPORT_FIELDS = Object.freeze([
  { value: "skip", label: "Skip column" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "workNote", label: "Note about work" },
  { value: "email", label: "Recipient email" },
  { value: "linkedInUrl", label: "LinkedIn URL" },
  { value: "company", label: "Company" },
  { value: "role", label: "Role" },
  { value: "emailSentAt", label: "Email sent" },
  { value: "subject", label: "Subject" },
  { value: "body", label: "Message" },
]);

const HEADER_ALIASES = new Map([
  ["firstname", "firstName"], ["first", "firstName"], ["givenname", "firstName"],
  ["lastname", "lastName"], ["last", "lastName"], ["surname", "lastName"],
  ["noteaboutwork", "workNote"], ["personalizationnote", "workNote"], ["worknote", "workNote"], ["personalizedpart", "workNote"],
  ["recipient", "email"], ["email", "email"], ["emailaddress", "email"], ["workemail", "email"],
  ["linkedinurl", "linkedInUrl"], ["linkedin", "linkedInUrl"], ["profileurl", "linkedInUrl"],
  ["company", "company"], ["companyname", "company"],
  ["role", "role"], ["title", "role"], ["jobtitle", "role"],
  ["emailsent", "emailSentAt"], ["sentat", "emailSentAt"], ["sentdate", "emailSentAt"],
  ["subject", "subject"], ["emailsubject", "subject"],
  ["message", "body"], ["body", "body"], ["emailbody", "body"],
]);

function normalizedHeader(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function guessColumnMapping(headers = []) {
  const claimed = new Set();
  return headers.map((header) => {
    const field = HEADER_ALIASES.get(normalizedHeader(header)) || "skip";
    if (field === "skip" || claimed.has(field)) return "skip";
    claimed.add(field);
    return field;
  });
}

export function readSpreadsheet(arrayBuffer, xlsx = globalThis.XLSX) {
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) throw new Error("Spreadsheet support did not load. Reload Vela GTM and try again.");
  const workbook = xlsx.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", blankrows: false });
    return rows.some((row) => row.some((cell) => String(cell ?? "").trim()));
  });
  if (!sheetName) throw new Error("The spreadsheet does not contain any rows.");
  const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false, raw: true });
  const headers = (matrix.shift() || []).map((value, index) => String(value || `Column ${index + 1}`).trim());
  return { sheetName, headers, rows: matrix.filter((row) => row.some((cell) => String(cell ?? "").trim())), mapping: guessColumnMapping(headers) };
}

function isoDate(value, xlsx = globalThis.XLSX) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && xlsx?.SSF?.parse_date_code) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.round(parsed.S || 0))).toISOString();
  }
  if (!String(value ?? "").trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function mappedRowsToProspects({ rows = [], mapping = [], settings = {}, source = "Spreadsheet import", xlsx = globalThis.XLSX } = {}) {
  const now = new Date().toISOString();
  const prospects = [];
  const rejected = [];
  rows.forEach((row, rowIndex) => {
    const values = {};
    mapping.forEach((field, columnIndex) => {
      if (field && field !== "skip") values[field] = row[columnIndex];
    });
    const firstName = String(values.firstName || "").trim();
    const lastName = String(values.lastName || "").trim();
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const email = String(values.email || "").trim().toLowerCase();
    const url = String(values.linkedInUrl || "").trim();
    if (!isEmail(email) && !/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url)) {
      rejected.push({ row: rowIndex + 2, reason: "Add a recipient email or LinkedIn URL." });
      return;
    }
    const company = String(values.company || "").trim();
    const role = String(values.role || "").trim();
    const profile = {
      name: name || email.split("@")[0],
      headline: [role, company].filter(Boolean).join(" at "),
      experiences: role || company ? [{ title: role, company }] : [],
      url,
    };
    const workNote = String(values.workNote || "").trim() || (role && company ? `your work as ${role} at ${company}` : company ? `your work at ${company}` : "the work you are doing in energy and infrastructure");
    const emailSentAt = isoDate(values.emailSentAt, xlsx);
    const draft = applyTemplate(outreachTemplate(settings), templateVariables(profile, settings, workNote));
    prospects.push({
      url,
      name: profile.name,
      headline: profile.headline,
      email: isEmail(email) ? email : "",
      emailSource: isEmail(email) ? source : "",
      workNote,
      subject: String(values.subject || "").trim() || draft.subject,
      body: String(values.body || "").trim() || draft.body,
      status: emailSentAt ? QUEUE_STATUS.SENT : isEmail(email) ? QUEUE_STATUS.READY : QUEUE_STATUS.NEW,
      profile,
      source,
      importedAt: now,
      emailSentAt,
      activity: [{ type: "imported", detail: source, at: now }, ...(emailSentAt ? [{ type: "sent", detail: "Imported from Email Sent", at: emailSentAt }] : [])],
    });
  });
  return { prospects, rejected };
}

export function mailMergeRows(items = []) {
  return items.map((prospect) => {
    const parts = String(prospect.name || "").trim().split(/\s+/).filter(Boolean);
    return [
      parts[0] || "",
      parts.slice(1).join(" "),
      prospect.workNote || "",
      prospect.email || "",
      prospect.emailSentAt ? new Date(prospect.emailSentAt) : "",
      prospect.subject || "",
      prospect.body || "",
    ];
  });
}

export function exportMailMergeWorkbook(items = [], filename = "Vela-MailMerge.xlsx", xlsx = globalThis.XLSX) {
  if (!xlsx?.utils?.aoa_to_sheet || !xlsx?.writeFileXLSX) throw new Error("Spreadsheet support did not load. Reload Vela GTM and try again.");
  const worksheet = xlsx.utils.aoa_to_sheet([MAIL_MERGE_HEADERS, ...mailMergeRows(items)], { cellDates: true });
  worksheet["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 72 }, { wch: 34 }, { wch: 22 }, { wch: 52 }, { wch: 96 }];
  worksheet["!autofilter"] = { ref: `A1:G${Math.max(1, items.length + 1)}` };
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Mail Merge");
  xlsx.writeFileXLSX(workbook, filename, { cellDates: true, compression: true });
}
