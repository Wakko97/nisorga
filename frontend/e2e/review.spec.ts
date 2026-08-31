import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `e2e-review-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

test("a freshly captured inbox item shows up in the weekly review", async ({ page }) => {
  const email = uniqueEmail();
  const title = `Review-Idee ${Date.now()}`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Review Tester");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("supersecret123");
  await page.getByRole("button", { name: "Registrieren" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  const captureInput = page.getByPlaceholder(/Neue Idee oder Aufgabe erfassen/i);
  await captureInput.fill(title);
  await captureInput.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  await page.getByRole("link", { name: "Wochenrückblick" }).click();
  await expect(page).toHaveURL(/\/review$/);

  await expect(page.getByRole("heading", { name: /Offene Inbox-Punkte/ })).toBeVisible();
  const section = page.locator("section", { hasText: "Offene Inbox-Punkte" });
  await expect(section.getByRole("link", { name: title })).toBeVisible();
});
