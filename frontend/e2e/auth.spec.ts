import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

test("register, logout, login again", async ({ page }) => {
  const email = uniqueEmail();
  const password = "supersecret123";

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Registrieren" }).click();

  await expect(page).toHaveURL(/\/inbox$/);

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page).toHaveURL(/\/inbox$/);
});

test("wrong login credentials show an error message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(uniqueEmail());
  await page.getByLabel("Passwort").fill("wrong-password");
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page.getByText(/fehlgeschlagen|Invalid/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
