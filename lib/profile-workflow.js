export async function runAutomaticProfileWorkflow({
  researchEnabled = false,
  hasVerifiedEmail = false,
  research = async () => {},
  write = async () => {},
} = {}) {
  const writing = Promise.resolve().then(write);
  const researching = researchEnabled && !hasVerifiedEmail
    ? Promise.resolve().then(research).catch(() => undefined)
    : Promise.resolve();
  const [result] = await Promise.all([writing, researching]);
  return result;
}
