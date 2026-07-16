export const DATA_PAGE_SIZE = 100;

export function paginate(items = [], requestedPage = 1, pageSize = DATA_PAGE_SIZE) {
  const rows = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || DATA_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pageCount, Math.max(1, Number(requestedPage) || 1));
  const startIndex = (page - 1) * size;
  const endIndex = Math.min(rows.length, startIndex + size);
  return {
    items: rows.slice(startIndex, endIndex),
    page,
    pageCount,
    pageSize: size,
    total: rows.length,
    start: rows.length ? startIndex + 1 : 0,
    end: endIndex,
  };
}

export function paginationTokens(page = 1, pageCount = 1) {
  const total = Math.max(1, Number(pageCount) || 1);
  const current = Math.min(total, Math.max(1, Number(page) || 1));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const ordered = [...pages].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const tokens = [];
  ordered.forEach((value, index) => {
    if (index && value - ordered[index - 1] > 1) tokens.push(`ellipsis-${index}`);
    tokens.push(value);
  });
  return tokens;
}
