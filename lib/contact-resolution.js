function messageFor(error, fallback = "") {
  return error instanceof Error ? error.message : String(error || fallback);
}

function cleanEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function uniqueEmails(values = []) {
  return [...new Set(values.map(cleanEmail).filter(Boolean))];
}

function withoutEmail(values = [], email = "") {
  return uniqueEmails(values).filter((candidate) => candidate !== email);
}

export function rememberContactCandidate(contactDetails = {}, { email = "", source = "", status = "unverified", type = "other" } = {}) {
  const candidate = cleanEmail(email);
  if (!candidate) return contactDetails;
  const emailStatuses = { ...(contactDetails.emailStatuses || {}) };
  const normalizedStatus = String(emailStatuses[candidate] || status || "unverified").trim().toLowerCase();
  const verified = ["verified", "valid"].includes(normalizedStatus);
  const existingSources = Array.isArray(contactDetails.emailSources?.[candidate])
    ? contactDetails.emailSources[candidate]
    : [contactDetails.emailSources?.[candidate]].filter(Boolean);
  const nextSources = [...new Set([...existingSources, source].map((value) => String(value || "").trim()).filter(Boolean))];
  const next = {
    ...contactDetails,
    emails: uniqueEmails(contactDetails.emails || []),
    workEmails: uniqueEmails(contactDetails.workEmails || []),
    personalEmails: uniqueEmails(contactDetails.personalEmails || []),
    unverifiedEmails: uniqueEmails(contactDetails.unverifiedEmails || []),
    unverifiedWorkEmails: uniqueEmails(contactDetails.unverifiedWorkEmails || []),
    unverifiedPersonalEmails: uniqueEmails(contactDetails.unverifiedPersonalEmails || []),
    emailStatuses: { ...emailStatuses, [candidate]: normalizedStatus },
    emailSources: { ...(contactDetails.emailSources || {}), ...(nextSources.length ? { [candidate]: nextSources } : {}) },
  };

  if (verified) {
    next.emails = uniqueEmails([...next.emails, candidate]);
    next.unverifiedEmails = withoutEmail(next.unverifiedEmails, candidate);
    if (type === "work") {
      next.workEmails = uniqueEmails([...next.workEmails, candidate]);
      next.unverifiedWorkEmails = withoutEmail(next.unverifiedWorkEmails, candidate);
    } else if (type === "personal") {
      next.personalEmails = uniqueEmails([...next.personalEmails, candidate]);
      next.unverifiedPersonalEmails = withoutEmail(next.unverifiedPersonalEmails, candidate);
    }
  } else if (!next.emails.includes(candidate)) {
    next.unverifiedEmails = uniqueEmails([...next.unverifiedEmails, candidate]);
    if (type === "work") next.unverifiedWorkEmails = uniqueEmails([...next.unverifiedWorkEmails, candidate]);
    if (type === "personal") next.unverifiedPersonalEmails = uniqueEmails([...next.unverifiedPersonalEmails, candidate]);
  }

  return next;
}

export async function resolveContactEmail({ contactOutLookup, linkedInLookup } = {}) {
  let contactOutError = "";
  try {
    const contactOut = await contactOutLookup?.();
    if (contactOut?.email) return { email: contactOut.email, source: "contactout", strategy: "", contactOut, contactOutError: "", linkedInError: "" };
  } catch (error) {
    contactOutError = messageFor(error, "ContactOut lookup failed.");
  }

  try {
    const linkedIn = await linkedInLookup?.();
    if (linkedIn?.email) {
      return {
        email: linkedIn.email,
        source: "linkedin",
        strategy: linkedIn.strategy || "",
        contactOut: null,
        contactOutError,
        linkedInError: "",
      };
    }
    return {
      email: "",
      source: "none",
      strategy: linkedIn?.strategy || "",
      contactOut: null,
      contactOutError,
      linkedInError: linkedIn?.error || "LinkedIn Contact Info did not contain an email.",
    };
  } catch (error) {
    return {
      email: "",
      source: "none",
      strategy: "",
      contactOut: null,
      contactOutError,
      linkedInError: messageFor(error, "LinkedIn Contact Info lookup failed."),
    };
  }
}
