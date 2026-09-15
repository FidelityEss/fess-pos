import { expect, test } from '@playwright/test';
import { findAdminUser, signInAs } from './auth';

// Critical path: a signed-in admin reaches the app shell and Home. Since D-96 there is no authenticator step: a
// password-only (aal1) session is let in (the server still refuses it while admin.require_mfa is on).
test.describe('authenticated shell', () => {
  test('signed-out visitors are sent to sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('a password-only (aal1) session is not sent to an authenticator step', async ({ page }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    await signInAs(page, admin!, 'aal1');
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/(sign-in|mfa)/);
  });

  test('aal2 admin sees Home, its to-do list and the menu', async ({ page }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    await signInAs(page, admin!);
    await page.goto('/');
    await expect(page.getByText(/local/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /^home$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /^to do$/i })).toBeVisible();
    for (const name of [/^home$/i, /^jobs$/i, /^to review$/i, /^inspection set-up$/i, /^banks$/i, /^people$/i]) {
      await expect(page.getByRole('link', { name }).first()).toBeVisible();
    }
    // the six report groups banks use (docs/06 §1) — their names are contractual
    for (const label of ['Pending', 'Assigned', 'In progress', 'Completed', 'Cancelled', 'Unable to complete']) {
      await expect(page.getByText(new RegExp(`^${label}$`, 'i')).first()).toBeVisible();
    }
  });

  test('Help and glossary opens from the header', async ({ page }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    await signInAs(page, admin!);
    await page.goto('/');
    await page.getByRole('link', { name: /help and glossary/i }).first().click();
    await expect(page).toHaveURL(/\/help/);
    await expect(page.getByRole('heading', { name: /words you’ll see/i })).toBeVisible();
    await expect(page.getByText(/^site area$/i).first()).toBeVisible();
  });
});
