import assert from "node:assert/strict";
import test from "node:test";

import { DATA_PAGE_SIZE, paginate, paginationTokens } from "../lib/pagination.js";

test("[V32] data tables expose exactly 100 rows per page without losing totals", () => {
  const rows = Array.from({ length: 243 }, (_, index) => index + 1);
  const first = paginate(rows, 1);
  const third = paginate(rows, 3);
  assert.equal(DATA_PAGE_SIZE, 100);
  assert.equal(first.items.length, 100);
  assert.deepEqual([first.start, first.end, first.total, first.pageCount], [1, 100, 243, 3]);
  assert.equal(third.items.length, 43);
  assert.deepEqual([third.start, third.end], [201, 243]);
});

test("[V32] pagination clamps stale pages and keeps first/current/last navigation", () => {
  const info = paginate(Array.from({ length: 850 }), 99);
  assert.equal(info.page, 9);
  assert.deepEqual(paginationTokens(5, 12), [1, "ellipsis-1", 4, 5, 6, "ellipsis-4", 12]);
});
