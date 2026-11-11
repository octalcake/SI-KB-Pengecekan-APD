import { expect, test } from '@playwright/test';

const TEST_USERNAME = process.env.TEST_SEED_USERNAME ?? 'petugas';
const TEST_PASSWORD = process.env.TEST_SEED_PASSWORD ?? 'K3-Disp0sable-Test-Pass!2026';

test('officer login, explicit session bootstrap, distinct error recovery, readiness display, and logout', async ({
	page
}) => {
	// Delay the initial /auth/me check briefly so the explicit session-check loading state is observable.
	let delayInitialMe = true;
	await page.route('/api/v1/auth/me', async (route) => {
		if (delayInitialMe) {
			delayInitialMe = false;
			await new Promise((r) => setTimeout(r, 250));
		}
		await route.continue();
	});

	await page.goto('/');
	await expect(page.getByRole('status')).toContainText(/Memeriksa Sesi Petugas K3/i);
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();

	// 1. Distinct recovery message for incorrect credentials (401 INVALID_CREDENTIALS from Go)
	await page.getByLabel(/Username/i).fill(TEST_USERNAME);
	await page.getByLabel(/Password/i).fill('password-salah-123');
	await page.getByRole('button', { name: /Masuk/i }).click();
	const alertBox = page.getByRole('alert');
	await expect(alertBox).toHaveAttribute('data-error-kind', 'credentials');
	await expect(alertBox).toContainText(/Kredensial Tidak Valid/i);
	await expect(alertBox).toContainText(/Username atau password salah/i);

	// 2. Distinct recovery message when backend is unreachable
	await page.route('/api/v1/auth/login', async (route) => {
		await route.abort('failed');
	});
	await page.getByRole('button', { name: /Masuk/i }).click();
	await expect(alertBox).toHaveAttribute('data-error-kind', 'backend');
	await expect(alertBox).toContainText(/Layanan Backend Tidak Terjangkau/i);
	await page.unroute('/api/v1/auth/login');

	// 3. Keyboard-usable login with valid seeded credentials against real Go/SQLite
	await page.getByLabel(/Password/i).focus();
	await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
	await page.keyboard.press('Enter');

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('officer-identity')).toContainText('Petugas: Anisa');
	await expect(page.getByText(/NYATA/i).first()).toBeVisible();
	await expect(page.getByText(/Belum Siap/i).first()).toBeVisible();
	await expect(page.getByText(/Indikasi Tanpa Helm \(NO_HELMET\)/i)).toBeVisible();
	await expect(page.getByText(/Indikasi Tanpa Rompi \(NO_VEST\)/i)).toBeVisible();

	// Integrated Monitoring module is an active link; unintegrated modules remain explicitly disabled with a reason
	const monitoringNav = page.getByRole('link', { name: /Monitoring/i });
	await expect(monitoringNav).toHaveAttribute('href', '/monitoring');
	const reportsNav = page.getByRole('button', { name: /Laporan/i });
	await expect(reportsNav).toBeDisabled();

	// 4. Responsive layout on narrow viewport
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('navigation', { name: /Navigasi utama/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /Ruang Kerja Inspeksi K3/i })).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 800 });

	// 5. Session survives page reload via HttpOnly cookie and /api/v1/auth/me
	await page.reload();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('officer-identity')).toContainText('Petugas: Anisa');

	// 6. Logout sends CSRF, receives 204, clears protected UI, and invalidates subsequent API/evidence requests
	await page.getByRole('button', { name: /Keluar/i }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByTestId('officer-identity')).toHaveCount(0);

	const meAfterLogout = await page.evaluate(async () => {
		const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
		return res.status;
	});
	expect(meAfterLogout).toBe(401);

	const statusAfterLogout = await page.evaluate(async () => {
		const res = await fetch('/api/v1/system/status', { credentials: 'same-origin' });
		return res.status;
	});
	expect(statusAfterLogout).toBe(401);

	const evidenceAfterLogout = await page.evaluate(async () => {
		const res = await fetch('/api/v1/findings/1/evidence', { credentials: 'same-origin' });
		return res.status;
	});
	expect(evidenceAfterLogout).toBe(401);
});
