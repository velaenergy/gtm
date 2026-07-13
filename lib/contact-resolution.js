function messageFor(error, fallback = "") {
  return error instanceof Error ? error.message : String(error || fallback);
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
