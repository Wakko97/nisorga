import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `e2e-qc-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

test("capture an idea, convert to task, and mark it waiting", async ({ page }) => {
  const email = uniqueEmail();
  const title = `Idee ${Date.now()}`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Capture Tester");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("supersecret123");
  await page.getByRole("button", { name: "Registrieren" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  const captureInput = page.getByPlaceholder(/Neue Idee oder Aufgabe erfassen/i);
  await captureInput.fill(title);
  await captureInput.press("Enter");

  const itemLink = page.getByRole("link", { name: title });
  await expect(itemLink).toBeVisible();
  await itemLink.click();

  await expect(page).toHaveURL(/\/items\//);

  await page.getByRole("button", { name: "zu Aufgabe konvertieren" }).click();
  await expect(page.getByText("Aufgabe", { exact: true })).toBeVisible();

  await page.getByLabel("Status").selectOption("WAITING");

  await expect(page.getByText(/Wartet seit/)).toBeVisible();
});
