import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';

const TEST_USERNAME = process.env.TEST_SEED_USERNAME ?? 'petugas';
const TEST_PASSWORD = process.env.TEST_SEED_PASSWORD ?? 'K3-Disp0sable-Test-Pass!2026';

function findDisposableTestDbByProjectName(projectName: string): string {
	const tmpDir = os.tmpdir();
	const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('k3-p0-01-')) continue;
		const candidate = path.join(tmpDir, entry.name, 'k3.sqlite');
		if (!fs.existsSync(candidate)) continue;
		try {
			const db = new DatabaseSync(candidate, { open: true });
			const row = db
				.prepare('SELECT id FROM projects WHERE name = ? LIMIT 1')
				.get(projectName) as { id?: number } | undefined;
			db.close();
			if (row?.id) {
				return candidate;
			}
		} catch {
			// Ignore locked or unrelated databases
		}
	}
	throw new Error(`Could not locate disposable SQLite DB for project: ${projectName}`);
}

test('P0-02 master data CRUD, conflict recovery, and mode-separated dashboard summary', async ({
	page
}) => {
	// 1. Sign in as seeded officer
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await page.getByLabel(/Username/i).fill(TEST_USERNAME);
	await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
	await page.getByRole('button', { name: /Masuk/i }).click();
	await expect(page).toHaveURL(/\/$/);

	// 2. Navigate to Proyek & Zona via AppShell navigation link
	const projectsNavLink = page
		.getByRole('navigation', { name: /Navigasi utama/i })
		.getByRole('link', { name: 'Proyek & Zona' });
	await expect(projectsNavLink).toBeVisible();
	await projectsNavLink.click();
	await expect(page).toHaveURL(/\/projects$/);
	await expect(page.getByRole('heading', { name: /Manajemen Proyek & Zona/i })).toBeVisible();

	// 3. Create projects and verify validation + persistence after reload
	const uniqueSuffix = Date.now().toString().slice(-6);
	const projectAName = `Gedung Utama ${uniqueSuffix}`;
	const projectBName = `Gudang Logistik ${uniqueSuffix}`;

	const projectACard = page.locator('[data-testid="project-item"]', { hasText: projectAName });
	const projectBCard = page.locator('[data-testid="project-item"]', { hasText: projectBName });

	await page.getByLabel(/^Nama Proyek/i).fill(projectAName);
	await page.getByLabel(/Lokasi/i).fill('Malang');
	await page.getByLabel(/Deskripsi Proyek/i).fill('Proyek konstruksi gedung utama 5 lantai.');
	await page.getByRole('button', { name: /Tambah Proyek/i }).click();

	await expect(projectACard).toBeVisible();

	await page.getByLabel(/^Nama Proyek/i).fill(projectBName);
	await page.getByLabel(/Lokasi/i).fill('Surabaya');
	await page.getByLabel(/Deskripsi Proyek/i).fill('Proyek gudang penyimpanan peralatan.');
	await page.getByRole('button', { name: /Tambah Proyek/i }).click();

	await expect(projectBCard).toBeVisible();

	// Reload and verify persisted projects remain
	await page.reload();
	await expect(projectACard).toBeVisible();
	await expect(projectBCard).toBeVisible();

	// Search filter
	await page.getByLabel(/Cari Nama Proyek/i).fill('Gudang Logistik');
	await page.getByRole('button', { name: /Terapkan Filter/i }).click();
	await expect(projectBCard).toBeVisible();
	await expect(projectACard).toHaveCount(0);

	// Reset search filter
	await page.getByRole('button', { name: /Reset Filter/i }).click();
	await expect(projectACard).toBeVisible();
	await expect(projectBCard).toBeVisible();

	// Unused project B can be hard-deleted
	await projectBCard.getByRole('button', { name: /^Hapus$/i }).click();
	await projectBCard.getByRole('button', { name: /Konfirmasi Hapus/i }).click();
	await expect(projectBCard).toHaveCount(0);

	// 4. Open Project A detail and create zones
	await projectACard.getByRole('link', { name: /Kelola Zona|Detail/i }).click();
	await expect(page).toHaveURL(/\/projects\/\d+$/);
	await expect(page.getByRole('heading', { name: projectAName })).toBeVisible();

	const zone1Name = 'Area Scaffolding Timur';
	const zone2Name = 'Lantai 2 Struktur';
	const zone1Card = page.locator('[data-testid="zone-item"]', { hasText: zone1Name });
	const zone2Card = page.locator('[data-testid="zone-item"]', { hasText: zone2Name });

	await page.getByLabel(/^Nama Zona/i).fill(zone1Name);
	await page.getByLabel(/Deskripsi Zona/i).fill('Area pemasangan perancah sisi timur.');
	await page.getByRole('button', { name: /Tambah Zona/i }).click();
	await expect(zone1Card).toBeVisible();

	await page.getByLabel(/^Nama Zona/i).fill(zone2Name);
	await page.getByLabel(/Deskripsi Zona/i).fill('Area pengecoran lantai 2.');
	await page.getByRole('button', { name: /Tambah Zona/i }).click();
	await expect(zone2Card).toBeVisible();

	// Reload detail page and verify zones persist
	await page.reload();
	await expect(zone1Card).toBeVisible();
	await expect(zone2Card).toBeVisible();

	// Unused zone2 can be deleted
	await zone2Card.getByRole('button', { name: /^Hapus Zona$/i }).click();
	await zone2Card.getByRole('button', { name: /Konfirmasi Hapus/i }).click();
	await expect(zone2Card).toHaveCount(0);

	// 5. Attempting to delete Project A (which now has zone1) returns 409 PROJECT_IN_USE and explains archival
	await page.getByRole('button', { name: /Hapus Proyek/i }).click();
	await page.getByRole('button', { name: /Konfirmasi Hapus Proyek/i }).click();
	const projectConflictAlert = page.locator('[data-error-kind="reference-conflict"]');
	await expect(projectConflictAlert).toBeVisible();
	await expect(projectConflictAlert).toContainText(/Proyek masih memiliki zona/i);
	await expect(projectConflictAlert).toContainText(/Arsipkan proyek sebagai gantinya/i);

	// 6. Version conflict (409 VERSION_CONFLICT) preserves unsaved input and offers reload
	await page.getByRole('button', { name: /Edit Proyek/i }).click();
	const editNameInput = page.getByLabel(/Edit Nama Proyek/i);
	const editLocationInput = page.getByLabel(/Edit Lokasi Proyek/i);
	const unsavedLocation = 'Malang - Sektor Barat (Draft Petugas)';
	await editLocationInput.fill(unsavedLocation);

	// Simulate another tab updating Project A to bump its version on the server
	const dbPath = findDisposableTestDbByProjectName(projectAName);
	const db = new DatabaseSync(dbPath);
	const projRow = db
		.prepare('SELECT id, version FROM projects WHERE name = ?')
		.get(projectAName) as { id: number; version: number };
	const zoneRow = db
		.prepare('SELECT id, version FROM zones WHERE project_id = ? AND name = ?')
		.get(projRow.id, zone1Name) as { id: number; version: number };

	db.prepare('UPDATE projects SET version = version + 1, location = ? WHERE id = ?').run(
		'Malang - Update Paralel',
		projRow.id
	);

	// Officer clicks save -> 409 VERSION_CONFLICT
	await page.getByRole('button', { name: /Simpan Perubahan Proyek/i }).click();
	const versionAlert = page.locator('[data-error-kind="version-conflict"]');
	await expect(versionAlert).toBeVisible();
	await expect(versionAlert).toContainText(/Data telah diubah oleh proses lain/i);
	// Unsaved input is still preserved in the input!
	await expect(editLocationInput).toHaveValue(unsavedLocation);
	await expect(editNameInput).toHaveValue(projectAName);

	// Reload latest version while preserving unsaved input, then save successfully
	await versionAlert.getByRole('button', { name: /Muat Ulang Data Terbaru/i }).click();
	await expect(editLocationInput).toHaveValue(unsavedLocation);
	await page.getByRole('button', { name: /Simpan Perubahan Proyek/i }).click();
	await expect(page.getByText(unsavedLocation)).toBeVisible();

	// 7. Active session blocks archiving zone & project (409 SESSION_ACTIVE), and referenced zone blocks hard delete (409 ZONE_IN_USE)
	db.prepare(
		`INSERT INTO monitoring_sessions (session_key, zone_id, started_by, source, mode, status, config_json, started_at)
		 VALUES (?, ?, 1, 'browser_webcam', 'real', 'active', '{"sample_fps":1,"confirm_hits":2,"confirm_max_frames":3,"confirm_window_ms":2000,"track_timeout_ms":5000}', '2026-11-11T02:00:00.000Z')`
	).run(`sess-active-${uniqueSuffix}`, zoneRow.id);

	// Try archiving Project A while session is active -> 409 SESSION_ACTIVE
	await page.getByRole('button', { name: /Arsipkan Proyek/i }).click();
	const activeSessionAlert = page.locator('[data-error-kind="session-active-conflict"]');
	await expect(activeSessionAlert).toBeVisible();
	await expect(activeSessionAlert).toContainText(
		/Tidak dapat diarsipkan saat sesi monitoring aktif/i
	);

	// Try deleting Zone 1 (which has a session) -> 409 ZONE_IN_USE explains archival
	await zone1Card.getByRole('button', { name: /^Hapus Zona$/i }).click();
	await zone1Card.getByRole('button', { name: /Konfirmasi Hapus/i }).click();
	await expect(page.locator('[data-error-kind="reference-conflict"]')).toContainText(
		/Zona sudah dipakai sesi monitoring\. Arsipkan zona sebagai gantinya/i
	);

	// Stop the active session in DB and add simulated/manual sessions + findings to verify dashboard summary & archive
	db.prepare(
		`UPDATE monitoring_sessions SET status = 'stopped', ended_at = '2026-11-11T02:30:00.000Z', end_reason = 'user_stop'
		 WHERE session_key = ?`
	).run(`sess-active-${uniqueSuffix}`);

	const realSession = db
		.prepare('SELECT id FROM monitoring_sessions WHERE session_key = ?')
		.get(`sess-active-${uniqueSuffix}`) as { id: number };

	// Insert findings into the real session (1 pending, 2 confirmed [1 open action, 1 completed action], 1 rejected)
	const insertFinding = db.prepare(
		`INSERT INTO findings (
			session_id, source, track_id, track_key, detected_violation, violation_type, confidence,
			frame_sequence, frame_width, frame_height, model_version, evidence_path, evidence_sha256,
			captured_at, received_at, verification_status, verified_by, verified_at, notes, action_status, action_notes, created_at, updated_at
		) VALUES (?, 'auto', ?, ?, 'NO_HELMET', 'NO_HELMET', 0.91, ?, 640, 480, 'ppe-demo-v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const sha = 'a'.repeat(64);
	// Finding 1: pending on 2026-11-11 09:05 WIB (02:05 UTC)
	insertFinding.run(
		realSession.id,
		1,
		'1:1',
		1,
		`ev-1-${uniqueSuffix}.jpg`,
		sha,
		'2026-11-11T02:05:00.000Z',
		'2026-11-11T02:05:00.100Z',
		'pending',
		null,
		null,
		'',
		'pending',
		'',
		'2026-11-11T02:05:00.100Z',
		'2026-11-11T02:05:00.100Z'
	);
	// Finding 2: confirmed with open action (pending) on 2026-11-11 09:10 WIB (02:10 UTC)
	insertFinding.run(
		realSession.id,
		2,
		'2:1',
		2,
		`ev-2-${uniqueSuffix}.jpg`,
		sha,
		'2026-11-11T02:10:00.000Z',
		'2026-11-11T02:10:00.100Z',
		'confirmed',
		1,
		'2026-11-11T02:12:00.000Z',
		'Terlihat tanpa helm',
		'in_progress',
		'Sedang ditindaklanjuti',
		'2026-11-11T02:10:00.100Z',
		'2026-11-11T02:12:00.000Z'
	);
	// Finding 3: confirmed with completed action on 2026-11-11 09:15 WIB (02:15 UTC)
	insertFinding.run(
		realSession.id,
		3,
		'3:1',
		3,
		`ev-3-${uniqueSuffix}.jpg`,
		sha,
		'2026-11-11T02:15:00.000Z',
		'2026-11-11T02:15:00.100Z',
		'confirmed',
		1,
		'2026-11-11T02:16:00.000Z',
		'Terlihat tanpa rompi',
		'completed',
		'Sudah memakai APD lengkap',
		'2026-11-11T02:15:00.100Z',
		'2026-11-11T02:16:00.000Z'
	);
	// Finding 4: rejected on 2026-11-11 09:20 WIB (02:20 UTC)
	insertFinding.run(
		realSession.id,
		4,
		'4:1',
		4,
		`ev-4-${uniqueSuffix}.jpg`,
		sha,
		'2026-11-11T02:20:00.000Z',
		'2026-11-11T02:20:00.100Z',
		'rejected',
		1,
		'2026-11-11T02:21:00.000Z',
		'Tertutup bayangan, helm terpakai',
		'pending',
		'',
		'2026-11-11T02:20:00.100Z',
		'2026-11-11T02:21:00.000Z'
	);

	// Insert a simulated session & 1 pending finding to verify mode separation
	db.prepare(
		`INSERT INTO monitoring_sessions (session_key, zone_id, started_by, source, mode, status, config_json, started_at, ended_at, end_reason)
		 VALUES (?, ?, 1, 'browser_webcam', 'simulated', 'stopped', '{"sample_fps":1,"confirm_hits":2,"confirm_max_frames":3,"confirm_window_ms":2000,"track_timeout_ms":5000}', '2026-11-11T03:00:00.000Z', '2026-11-11T03:10:00.000Z', 'user_stop')`
	).run(`sess-sim-${uniqueSuffix}`, zoneRow.id);
	const simSession = db
		.prepare('SELECT id FROM monitoring_sessions WHERE session_key = ?')
		.get(`sess-sim-${uniqueSuffix}`) as { id: number };
	insertFinding.run(
		simSession.id,
		10,
		'10:1',
		1,
		`ev-sim-${uniqueSuffix}.jpg`,
		sha,
		'2026-11-11T03:05:00.000Z',
		'2026-11-11T03:05:00.100Z',
		'pending',
		null,
		null,
		'',
		'pending',
		'',
		'2026-11-11T03:05:00.100Z',
		'2026-11-11T03:05:00.100Z'
	);
	db.close();

	// Now archiving Zone 1 succeeds since no session is active
	await page.locator('[data-error-kind="reference-conflict"]').getByRole('button', { name: /Arsipkan Sekarang/i }).click();
	await expect(zone1Card).toContainText(/Diarsipkan/i);

	// 8. Navigate to Dashboard ('/') and verify mode-separated counts, filters, timezone, and finding count unit
	await page.getByRole('link', { name: /^Dashboard$/i }).click();
	await expect(page).toHaveURL(/\/$/);

	await expect(page.getByTestId('metric-sessions')).toHaveText('1');
	await expect(page.getByTestId('metric-findings-pending')).toHaveText('1');
	await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('2');
	await expect(page.getByTestId('metric-findings-rejected')).toHaveText('1');
	await expect(page.getByTestId('metric-actions-open')).toHaveText('1');

	// Verify count unit and timezone disclosure
	await expect(page.getByTestId('dashboard-summary-meta')).toContainText(/Asia\/Jakarta/i);
	await expect(page.getByTestId('dashboard-summary-meta')).toContainText(/bukan jumlah pekerja/i);

	// Switch mode to 'simulated' -> shows simulated counts separately, never mixed with real
	await page.getByLabel(/Mode Data/i).selectOption('simulated');
	await expect(page.getByTestId('metric-sessions')).toHaveText('1');
	await expect(page.getByTestId('metric-findings-pending')).toHaveText('1');
	await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('0');

	// Switch mode to 'manual' -> 0 sessions, 0 findings
	await page.getByLabel(/Mode Data/i).selectOption('manual');
	await expect(page.getByTestId('metric-sessions')).toHaveText('0');
	await expect(page.getByTestId('metric-findings-pending')).toHaveText('0');

	// Switch back to 'real' and filter by Project A + Zone 1 + local date 2026-11-11
	await page.getByLabel(/Mode Data/i).selectOption('real');
	await page.getByLabel(/Filter Proyek/i).selectOption(String(projRow.id));
	await page.getByLabel(/Filter Zona/i).selectOption(String(zoneRow.id));
	await page.getByLabel(/Dari Tanggal/i).fill('2026-11-11');
	await page.getByLabel(/Sampai Tanggal/i).fill('2026-11-11');
	await expect(page.getByTestId('metric-sessions')).toHaveText('1');
	await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('2');

	// Filter to a different date (2026-11-12) -> 0 counts
	await page.getByLabel(/Dari Tanggal/i).fill('2026-11-12');
	await page.getByLabel(/Sampai Tanggal/i).fill('2026-11-12');
	await expect(page.getByTestId('metric-sessions')).toHaveText('0');
	await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('0');

	// Date validation error state (fromDate > toDate)
	await page.getByLabel(/Dari Tanggal/i).fill('2026-11-15');
	await page.getByLabel(/Sampai Tanggal/i).fill('2026-11-11');
	await expect(page.locator('[data-error-kind="validation"]')).toContainText(
		/Tanggal mulai tidak boleh melebihi tanggal akhir/i
	);

	// Distinct backend failure state on dashboard summary with working retry recovery
	await page.route('/api/v1/dashboard/summary*', async (route) => {
		await route.abort('failed');
	});
	await page.getByRole('button', { name: /Reset Filter/i }).click();
	const summaryBackendErr = page.locator('[data-error-kind="backend"]');
	await expect(summaryBackendErr).toBeVisible();
	await expect(summaryBackendErr).toContainText(/Gagal Memuat Ringkasan Dashboard/i);

	await page.unroute('/api/v1/dashboard/summary*');
	await summaryBackendErr.getByRole('button', { name: /Coba Lagi/i }).click();
	await expect(page.getByTestId('metric-sessions')).toHaveText('1');

	// Active/Archive status filters on /projects
	await page
		.getByRole('navigation', { name: /Navigasi utama/i })
		.getByRole('link', { name: 'Proyek & Zona' })
		.click();
	await expect(page).toHaveURL(/\/projects$/);

	// Field validation error when submitting empty project name
	await page.getByLabel(/^Nama Proyek/i).fill('   ');
	await page.getByRole('button', { name: /Tambah Proyek/i }).click();
	await expect(page.getByText(/Nama wajib diisi/i)).toBeVisible();

	// Archive Project A from list and filter by status 'archived' vs 'active'
	const projACardInList = page.locator('[data-testid="project-item"]', { hasText: projectAName });
	await projACardInList.getByRole('button', { name: /^Arsipkan$/i }).click();
	await expect(projACardInList).toContainText(/Diarsipkan/i);

	await page.getByLabel(/Status Proyek/i).selectOption('active');
	await expect(projACardInList).toHaveCount(0);

	await page.getByLabel(/Status Proyek/i).selectOption('archived');
	await expect(projACardInList).toBeVisible();

	// 9. Standards #B regression: delayed dashboard summary & project->zones lookup responses do not overwrite latest filter selection
	await page.getByLabel(/Status Proyek/i).selectOption('');
	const projectCName = `Menara Inspeksi ${uniqueSuffix}`;
	await page.getByLabel(/^Nama Proyek/i).fill(projectCName);
	await page.getByLabel(/Lokasi/i).fill('Sidoarjo');
	await page.getByLabel(/Deskripsi Proyek/i).fill('Proyek kedua untuk uji transisi rute dan filter.');
	await page.getByRole('button', { name: /Tambah Proyek/i }).click();
	const projectCCard = page.locator('[data-testid="project-item"]', { hasText: projectCName });
	await expect(projectCCard).toBeVisible();

	const dbForC = new DatabaseSync(dbPath);
	const projCRow = dbForC
		.prepare('SELECT id FROM projects WHERE name = ?')
		.get(projectCName) as { id: number };
	dbForC.close();

	await page.getByRole('link', { name: /^Dashboard$/i }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('metric-sessions')).toHaveText('1');

	// Delay real-mode summary and Project A zones lookup so they resolve AFTER switching to manual mode and clearing project filter
	await page.route('/api/v1/dashboard/summary*', async (route) => {
		const reqUrl = route.request().url();
		if (reqUrl.includes('mode=simulated')) {
			await new Promise((r) => setTimeout(r, 350));
		}
		await route.continue();
	});
	await page.route(`/api/v1/projects/${projRow.id}/zones*`, async (route) => {
		await new Promise((r) => setTimeout(r, 350));
		await route.continue();
	});

	// Trigger simulated summary (delayed) then immediately switch to manual (fast, 0 sessions/0 findings)
	await page.getByLabel(/Mode Data/i).selectOption('simulated');
	await page.getByLabel(/Mode Data/i).selectOption('manual');

	// Trigger Project A zones lookup (delayed) then immediately clear back to Semua Proyek ('')
	await page.getByLabel(/Filter Proyek/i).selectOption(String(projRow.id));
	await page.getByLabel(/Filter Proyek/i).selectOption('');

	// Wait longer than the 350ms delay and verify the delayed simulated summary & Project A zones did NOT overwrite the latest selection
	await new Promise((r) => setTimeout(r, 500));
	await expect(page.getByLabel(/Mode Data/i)).toHaveValue('manual');
	await expect(page.getByTestId('metric-sessions')).toHaveText('0');
	await expect(page.getByTestId('metric-findings-pending')).toHaveText('0');
	await expect(page.getByLabel(/Filter Zona/i)).toBeDisabled();

	await page.unroute('/api/v1/dashboard/summary*');
	await page.unroute(`/api/v1/projects/${projRow.id}/zones*`);

	// 10. Standards #B regression: navigating from /projects/A (with open edit form) to /projects/C clears Project A's editable form immediately and ignores delayed Project A responses
	await page.goto(`/projects/${projRow.id}`);
	await expect(page.getByRole('heading', { name: projectAName })).toBeVisible();
	await page.getByRole('button', { name: /Edit Proyek/i }).click();
	await expect(page.getByLabel(/Edit Nama Proyek/i)).toHaveValue(projectAName);

	// Delay Project C load slightly and also trigger a delayed Project A reload before navigating to Project C
	await page.route(`/api/v1/projects/${projRow.id}*`, async (route) => {
		await new Promise((r) => setTimeout(r, 400));
		await route.continue();
	});
	await page.route(`/api/v1/projects/${projCRow.id}`, async (route) => {
		await new Promise((r) => setTimeout(r, 150));
		await route.continue();
	});

	// Navigate client-side to Project C while Project A's edit form was open
	await page.evaluate((targetUrl) => {
		window.history.pushState({}, '', targetUrl);
		window.dispatchEvent(new PopStateEvent('popstate'));
	}, `/projects/${projCRow.id}`);
	await page.goto(`/projects/${projCRow.id}`);

	await expect(page.getByRole('heading', { name: projectCName })).toBeVisible();
	await expect(page.getByLabel(/Edit Nama Proyek/i)).toHaveCount(0);
	await new Promise((r) => setTimeout(r, 450));
	await expect(page.getByRole('heading', { name: projectCName })).toBeVisible();

	await page.unroute(`/api/v1/projects/${projRow.id}*`);
	await page.unroute(`/api/v1/projects/${projCRow.id}`);
});

