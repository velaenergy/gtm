(() => {
  const cleanText = (value = "") => String(value).replace(/\s+/g, " ").trim();

  function uniqueLines(lines = []) {
    const result = [];
    for (const value of lines) {
      const line = cleanText(value);
      if (line && result.at(-1) !== line) result.push(line);
    }
    return result;
  }

  function emailFromMailto(href = "") {
    const value = cleanText(href);
    if (!/^mailto:/i.test(value)) return "";
    let email = value.replace(/^mailto:/i, "").split("?")[0];
    try {
      email = decodeURIComponent(email);
    } catch {
      return "";
    }
    email = cleanText(email).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  function emailFromFlightResponse(value = "") {
    const mailto = String(value).match(/mailto:([^\"\\\s,}\]]+)/i)?.[1] || "";
    return emailFromMailto(`mailto:${mailto}`);
  }

  function isControlLine(line = "") {
    return /^(?:contact info|message|connect|follow|more|see more|show all(?: experiences?)?|experience|logo)$/i.test(
      cleanText(line),
    );
  }

  function isPronounOrDegree(line = "") {
    const value = cleanText(line);
    return /^(?:(?:she|he|they|ze|xe|hir|per)\s*\/\s*(?:her|him|them|zir|xem|pers))(?:\s*·.*)?$/i.test(value) ||
      /^(?:·\s*)?(?:1st|2nd|3rd)(?:\s*(?:degree)?(?: connection)?)?$/i.test(value);
  }

  function isSocialCount(line = "") {
    return /\b(?:connections?|followers?|mutual connections?)\b/i.test(line) || /^\d[\d,.]*\+?$/.test(line);
  }

  function isLocationLine(line = "") {
    const value = cleanText(line);
    return /^(?:remote|hybrid|on-site)$/i.test(value) ||
      /\b(?:area|region|metro(?:politan)?|district|united states|united kingdom|canada|australia|india|remote|hybrid|on-site)\b/i.test(
        value,
      ) ||
      (value.split(",").length >= 2 && value.length < 120);
  }

  function parseTopCardLines(lines = [], explicitName = "") {
    const normalized = uniqueLines(lines);
    const name = cleanText(explicitName || normalized.find((line) => !isControlLine(line)) || "");
    const candidates = normalized.filter(
      (line) =>
        line !== name &&
        !isControlLine(line) &&
        !isPronounOrDegree(line) &&
        !isSocialCount(line) &&
        !/^open to work$/i.test(line),
    );

    const location = candidates.find(isLocationLine) || "";
    const headline = candidates.find((line) => line !== location && line.length > 3) || "";
    return { name, headline, location };
  }

  function isDateLine(line = "") {
    const value = cleanText(line);
    return /(?:\b(?:19|20)\d{2}\b|\bpresent\b)/i.test(value) && /(?:-|–|—|present|\b\d+\s+(?:yr|mo))/i.test(value);
  }

  function isExperienceNoise(line = "") {
    const value = cleanText(line);
    return !value ||
      isControlLine(value) ||
      /^(?:company|organization) logo$/i.test(value) ||
      /^(?:full-time|part-time|contract|freelance|internship|self-employed)$/i.test(value) ||
      /^skills?:/i.test(value);
  }

  function companyName(line = "") {
    return cleanText(line)
      .split(/\s+·\s+(?=(?:full-time|part-time|contract|freelance|internship|self-employed|temporary|seasonal)\b)/i)[0]
      .trim();
  }

  function parseExperienceLines(lines = []) {
    const normalized = uniqueLines(lines).filter((line) => !isExperienceNoise(line));
    const dateIndexes = normalized.flatMap((line, index) => (isDateLine(line) ? [index] : []));
    const experiences = dateIndexes.map((dateIndex) => {
      const before = normalized.slice(0, dateIndex).filter((line) => !isDateLine(line) && !isLocationLine(line));
      const title = before.at(-2) || before.at(-1) || "";
      const company = before.length > 1 ? companyName(before.at(-1)) : "";
      const afterDate = normalized[dateIndex + 1] || "";
      return {
        title,
        company,
        dates: normalized[dateIndex],
        location: isLocationLine(afterDate) ? afterDate : "",
        details: "",
      };
    });

    return experiences
      .filter((item) => item.title || item.company)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.title === item.title && candidate.company === item.company && candidate.dates === item.dates,
          ) === index,
      )
      .slice(0, 4);
  }

  globalThis.VelaLinkedInParser = Object.freeze({
    cleanText,
    emailFromFlightResponse,
    emailFromMailto,
    isLocationLine,
    parseExperienceLines,
    parseTopCardLines,
    uniqueLines,
  });
})();
