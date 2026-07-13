export const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export class GoogleSheetsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GoogleSheetsApiError";
    this.status = status;
  }
}

export function spreadsheetPayload(title, rows = []) {
  const values = rows.map((row) => row.map((value) => String(value ?? "")));
  return {
    properties: { title: String(title || "Vela GTM mail merge").trim() || "Vela GTM mail merge" },
    sheets: [{
      properties: { title: "Mail merge", gridProperties: { frozenRowCount: 1 } },
      data: values.length ? [{ startRow: 0, startColumn: 0, rowData: values.map((row) => ({ values: row.map((value) => ({ userEnteredValue: { stringValue: value } })) })) }] : [],
    }],
  };
}

export async function createGoogleSpreadsheet(token, { title, rows } = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error("A Google access token is required.");
  if (typeof fetchImpl !== "function") throw new Error("Google Sheets requests are unavailable.");
  const response = await fetchImpl(GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(spreadsheetPayload(title, rows)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleSheetsApiError(payload.error?.message || `Google Sheets returned ${response.status}.`, response.status);
  if (!payload.spreadsheetId) throw new GoogleSheetsApiError("Google Sheets did not return a spreadsheet ID.", response.status);
  return {
    id: payload.spreadsheetId,
    url: payload.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(payload.spreadsheetId)}/edit`,
  };
}
