export function aiDraftDeliveryReady({ writerLoading = false, aiDraftReady = false, subject = "", body = "" } = {}) {
  return !writerLoading && aiDraftReady && Boolean(String(subject).trim()) && Boolean(String(body).trim());
}

export async function runAutomaticProfileWorkflow({
  researchEnabled = false,
  hasVerifiedEmail = false,
  research = async () => {},
  write = async () => {},
} = {}) {
  if (researchEnabled && !hasVerifiedEmail) {
    await Promise.resolve().then(research).catch(() => undefined);
  }
  return Promise.resolve().then(write);
}
