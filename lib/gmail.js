function stripHeader(value = "") {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64UrlEncode(value = "") {
  return bytesToBase64(new TextEncoder().encode(String(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeMimeHeader(value = "") {
  const clean = stripHeader(value);
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(clean))}?=`;
}

export function buildMimeMessage({ to = "", subject = "", body = "" } = {}) {
  const recipient = stripHeader(to);
  if (!recipient) throw new Error("A recipient email is required.");
  return [
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    String(body).replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
}

export function gmailDraftPayload(message = {}) {
  return { message: { raw: base64UrlEncode(buildMimeMessage(message)) } };
}
