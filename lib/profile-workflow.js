export async function runAutomaticProfileWorkflow({
  researchEnabled = false,
  hasVerifiedEmail = false,
  research = async () => {},
  write = async () => {},
} = {}) {
  if (researchEnabled && !hasVerifiedEmail) {
    try {
      await research();
    } catch {
      // Contact lookup is best-effort; it must never prevent profile writing.
    }
  }
  return write();
}
