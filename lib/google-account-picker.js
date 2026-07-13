import { listGoogleAccounts } from "./gmail.js";

export async function pickGoogleAccount(identity, { dialog, list, knownAccounts = {} } = {}) {
  if (!dialog || !list) throw new Error("The Google account chooser is unavailable.");
  const accounts = await listGoogleAccounts(identity);
  list.replaceChildren();
  for (const account of accounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "google-account-option";
    const label = document.createElement("strong");
    label.textContent = knownAccounts[account.id] || account.label;
    const detail = document.createElement("span");
    detail.textContent = account.primary ? "Primary Chrome account" : "Signed in to this Chrome profile";
    button.append(label, detail);
    button.addEventListener("click", () => dialog.close(account.id), { once: true });
    list.append(button);
  }
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(accounts.find((account) => account.id === dialog.returnValue) || null), { once: true });
  });
}
