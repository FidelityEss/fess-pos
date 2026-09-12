import { expect, test } from '@playwright/test';
import { findAdminUser, signInAs } from './auth';

// Critical path: an authenticated (aal2) admin reaches the app shell and the dashboard; an aal1 session is sent to MFA.
test.describe('authenticated shell', () => {
  test('signed-out visitors are sent to sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('aal1 session is sent to MFA', async ({ page }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    await signInAs(page, admin!, 'aal1');
    await page.goto('/');
    await expect(page).toHaveURL(/\/mfa/);
  });

  test('aal2 admin sees the dashboard and navigation', async ({ page }) => {
    const admin = await findAdminUser();
    test.skip(!admin, 'no local admin — run scripts/bootstrap-admin.mjs');
    await signInAs(page, admin!);
    await page.goto('/');
    await expect(page.getByText(/local/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^jobs$/i }).first()).toBeVisible({ timeout: 15_000 });
    // dashboard status groups (docs/06 §1)
    for (const label of ['Pending', 'Assigned', 'In progress', 'Completed', 'Cancelled', 'Unable to complete']) {
      await expect(page.getByText(new RegExp(`^${label}$`, 'i')).first()).toBeVisible();
    }
  });
});
