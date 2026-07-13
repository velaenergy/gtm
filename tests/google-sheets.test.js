import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_SHEETS_API_URL,
  GoogleSheetsApiError,
  createGoogleSpreadsheet,
  spreadsheetPayload,
} from "../lib/google-sheets.js";

test("builds a mail-merge spreadsheet with a frozen header", () => {
  const payload = spreadsheetPayload("Vela mail merge", [["Name", "Email"], ["Ada", "ada@example.com"]]);
  assert.equal(payload.properties.title, "Vela mail merge");
  assert.equal(payload.sheets[0].properties.title, "Mail merge");
  assert.equal(payload.sheets[0].properties.gridProperties.frozenRowCount, 1);
  assert.equal(payload.sheets[0].data[0].rowData[1].values[1].userEnteredValue.stringValue, "ada@example.com");
});

test("creates a Google Sheet and returns its review URL", async () => {
  const calls = [];
  const spreadsheet = await createGoogleSpreadsheet("google-token", { title: "Export", rows: [["Name"], ["Ada"]] }, {
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { spreadsheetId: "sheet-123" }; } };
    },
  });
  assert.equal(calls[0].url, GOOGLE_SHEETS_API_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer google-token");
  assert.equal(JSON.parse(calls[0].options.body).properties.title, "Export");
  assert.equal(spreadsheet.url, "https://docs.google.com/spreadsheets/d/sheet-123/edit");
});

test("surfaces Google Sheets API failures", async () => {
  await assert.rejects(
    createGoogleSpreadsheet("google-token", { rows: [] }, { async fetchImpl() {
      return { ok: false, status: 403, async json() { return { error: { message: "Sheets API disabled" } }; } };
    } }),
    (error) => error instanceof GoogleSheetsApiError && error.status === 403 && error.message === "Sheets API disabled",
  );
});
