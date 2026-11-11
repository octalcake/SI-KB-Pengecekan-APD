import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescript } from './load-typescript.mjs';

const { ApiError } = await loadTypescript('shared/errors.ts');
const error = (status, code) => new ApiError({ status, code, message: code });
const list = (data) => ({ data, meta: { page: 1, page_size: 100, total: data.length } });

test('shared transport preserves JSON/binary, cookies/CSRF, blob errors and central 401 invalidation', async () => {
	const client = await loadTypescript('shared/http/client.ts');
	const original = globalThis.fetch;
	let response = new Response(JSON.stringify({ data: { ok: true } }), { headers: { 'Content-Type': 'application/json' } });
	const calls = [];
	let invalidations = 0;
	globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response; };
	client.setCsrfToken('csrf');
	client.onUnauthorized(() => { invalidations++; });
	try {
		assert.deepEqual(await client.apiData('/projects', { method: 'POST', body: { name: 'Site' } }), { ok: true });
		assert.equal(calls[0].url, '/api/v1/projects');
		assert.equal(calls[0].options.credentials, 'same-origin');
		assert.equal(calls[0].options.headers.get('X-CSRF-Token'), 'csrf');
		assert.equal(calls[0].options.body, '{"name":"Site"}');
		const jpeg = new Blob(['original'], { type: 'image/jpeg' });
		response = new Response('', { status: 200 });
		await client.apiBlob('/findings/1/evidence', { method: 'POST', body: jpeg });
		assert.equal(calls[1].options.body, jpeg);
		for (const status of [410, 403, 401]) {
			response = new Response(JSON.stringify({ error: { code: status === 410 ? 'EVIDENCE_MISSING' : 'DENIED', message: 'denied' } }), { status, headers: { 'X-Request-ID': 'req-1' } });
			await assert.rejects(client.apiBlob('/findings/1/evidence'), (e) => e.status === status && e.requestId === 'req-1');
		}
		assert.equal(invalidations, 1);
		assert.equal(client.getCsrfToken(), null);
	} finally { globalThis.fetch = original; client.onUnauthorized(null); client.setCsrfToken(null); }
});

test('auth cleanup precedes logout; non-401 failure retains credentials; 401 clears them', async () => {
	const { createAuthWorkflow } = await loadTypescript('features/auth/application/auth-workflow.ts');
	const events = [];
	let token = 'csrf';
	let failure = error(503, 'BACKEND_UNREACHABLE');
	const workflow = createAuthWorkflow({ logout: async () => { events.push('logout'); throw failure; } }, {
		setCsrfToken: (value) => { token = value; }, onUnauthorized: () => {}
	});
	const cleanup = async () => { events.push('release-camera'); events.push('stop-session'); throw Error('stop failed'); };
	assert.equal((await workflow.runLogout(cleanup)).cleared, false);
	assert.equal(token, 'csrf');
	assert.deepEqual(events, ['release-camera', 'stop-session', 'logout']);
	failure = error(401, 'UNAUTHORIZED');
	assert.equal((await workflow.runLogout(cleanup)).cleared, true);
	assert.equal(token, null);
});

test('projects normalize text while preserving optimistic version and archive intent', async () => {
	const { createProjectsWorkflow } = await loadTypescript('features/projects/application/projects-workflow.ts');
	const calls = [];
	const workflow = createProjectsWorkflow({
		createProject: async (value) => { calls.push(value); return value; },
		updateZone: async (id, value) => { calls.push([id, value]); return value; }
	});
	await workflow.createProject({ name: ' Site ', location: ' North ', description: ' Notes ' });
	await workflow.updateZone(4, { name: ' Zone ', version: 7, status: 'archived' });
	assert.deepEqual(calls, [{ name: 'Site', location: 'North', description: 'Notes' }, [4, { name: 'Zone', description: undefined, version: 7, status: 'archived' }]]);
});

test('dashboard normalizes date interval and IDs through the injected summary interface', async () => {
	const { createDashboardWorkflow } = await loadTypescript('features/dashboard/application/dashboard-workflow.ts');
	let query;
	const workflow = createDashboardWorkflow({ getSummary: async (filter) => { query = filter; return {}; } }, {});
	await workflow.fetchSummary({ mode: 'simulated', projectId: '3', zoneId: '-1', fromDate: '2026-11-11', toDate: '2026-11-11' });
	assert.deepEqual(query, { mode: 'simulated', project_id: 3, zone_id: undefined, from: '2026-11-10T17:00:00.000Z', to: '2026-11-11T17:00:00.000Z' });
});

test('finding context tolerates missing lookup, gallery retains other projects on zone failure', async () => {
	const { createFindingsWorkflow } = await loadTypescript('features/findings/application/findings-workflow.ts');
	const workflow = createFindingsWorkflow({
		getProjectLookup: async (id) => ({ id }), getZoneLookup: async () => { throw error(404, 'NOT_FOUND'); }, getSessionLookup: async (id) => ({ id }),
		listProjectsLookup: async () => list([{ id: 1 }, { id: 2 }]), listSessionsLookup: async () => list([{ id: 8 }]),
		listZonesLookup: async (id) => { if (id === 2) throw error(403, 'FORBIDDEN'); return list([{ id: 4 }]); }
	});
	assert.deepEqual(await workflow.loadFindingContextLookups({ project_id: 1, zone_id: 4, session_id: 8 }), { projectLookup: { id: 1 }, zoneLookup: null, sessionLookup: { id: 8 } });
	assert.deepEqual((await workflow.loadGalleryLookups()).zonesByProject, { 1: [{ id: 4 }], 2: [] });
});

test('report requests retain keys across lost responses, isolate version/identity, and gate approval', async () => {
	const { createReportRequests, canApproveReport } = await loadTypescript('features/reports/application/report-requests.ts');
	let key = 0;
	let failure = error(0, 'BACKEND_UNREACHABLE');
	const calls = [];
	const requests = createReportRequests({
		generate: async (input) => { calls.push(input); throw failure; },
		regenerate: async (id, input) => { calls.push([id, input]); throw failure; },
		approve: async (id, input) => { calls.push([id, input]); return { id }; }
	}, () => `key-${++key}`);
	await assert.rejects(requests.generate(3));
	await assert.rejects(requests.generate(3));
	assert.equal(calls[0].request_key, calls[1].request_key);
	await assert.rejects(requests.generate(4));
	assert.notEqual(calls[1].request_key, calls[2].request_key);
	const oldKey = requests.generateKey(4);
	assert.notEqual(requests.generateKey(4, true), oldKey);
	const report = { id: 2, version: 7, status: 'draft', is_stale: false };
	await assert.rejects(requests.regenerate(report));
	await assert.rejects(requests.regenerate(report));
	assert.deepEqual(calls[3], calls[4]);
	await assert.rejects(requests.regenerate({ ...report, version: 8 }));
	assert.notEqual(calls[4][1].request_key, calls[5][1].request_key);
	failure = error(409, 'SOURCE_CHANGED');
	await assert.rejects(requests.regenerate(report));
	assert.notEqual(requests.regenerateKey(2, 7), calls[6][1].request_key);
	assert.equal(canApproveReport({ ...report, is_stale: true }, true), false);
	assert.equal(await requests.approve(report, false), null);
	assert.equal(await requests.approve({ ...report, is_stale: true }, true), null);
	assert.deepEqual(await requests.approve(report, true), { id: 2 });
	assert.deepEqual(calls.at(-1), [2, { version: 7, review_acknowledged: true }]);
});

test('capture honors Retry-After without queueing and terminal failure releases camera', async () => {
	const { createCaptureLoop } = await loadTypescript('features/monitoring/application/capture-workflow.ts');
	let now = 1000;
	let attempts = 0;
	let terminal = false;
	let released = 0;
	const revoked = [];
	const loop = createCaptureLoop({
		sessionId: 1, nowMonotonicMs: () => now, nowUtcIso: () => '2026-11-11T00:00:00Z',
		sampleJpeg: async () => ({ blob: new Blob(), width: 640, height: 480, objectUrl: 'blob:sample' }),
		sendFrame: async () => { attempts++; throw Error('fixture'); },
		stopSession: async () => {}, releaseCamera: () => { released++; }, revokeObjectUrl: (url) => revoked.push(url),
		classifyError: () => ({ code: terminal ? 'TRACKER_RESET' : 'FRAME_TOO_FAST', terminal, retryAfterSec: terminal ? null : 2 }),
		createAbortController: () => new AbortController(), schedule: () => () => {}
	});
	await loop.tick();
	now = 2000;
	assert.equal((await loop.tick()).skippedBackoff, true);
	assert.equal(attempts, 1);
	now = 3000;
	terminal = true;
	await loop.tick();
	assert.equal(attempts, 2);
	assert.equal(loop.getState().active, false);
	assert.equal(released, 1);
	assert.deepEqual(revoked, ['blob:sample', 'blob:sample']);
});

test('report context excludes active, empty and already-reported sessions, tolerating lookup failures', async () => {
	const { createReportContext } = await loadTypescript('features/reports/application/report-context.ts');
	const load = createReportContext({
		listProjectsLookupApi: async () => list([{ id: 1 }]),
		listSessionsLookupApi: async () => list([{ id: 1, status: 'active' }, { id: 2, status: 'stopped' }, { id: 3, status: 'stopped' }, { id: 4, status: 'interrupted' }]),
		listReportsApi: async () => list([{ id: 20, session_id: 3 }]),
		listZonesLookupApi: async () => { throw Error('offline'); },
		countConfirmedFindingsForSessionApi: async (id) => { if (id === 2) throw Error('offline'); return 1; }
	});
	const result = await load();
	assert.equal(result.firstEligibleSessionId, 4);
	assert.deepEqual(result.zonesByProject, { 1: [] });
	assert.equal(result.confirmedCountsBySession[2], 0);
});

test('capture skips busy ticks, releases camera before stop, discards canceled samples and revokes URLs', async () => {
	const { createCaptureLoop } = await loadTypescript('features/monitoring/application/capture-workflow.ts');
	const events = [];
	let finishSample;
	const loop = createCaptureLoop({
		sessionId: 1, nowMonotonicMs: () => 1000, nowUtcIso: () => '2026-11-11T00:00:00Z',
		sampleJpeg: () => new Promise((resolve) => { finishSample = resolve; }),
		sendFrame: async () => { throw Error('canceled sample must not be sent'); },
		stopSession: async () => events.push('stop'), releaseCamera: () => events.push('release'),
		revokeObjectUrl: (url) => events.push(url), classifyError: () => { throw Error('not expected'); },
		createAbortController: () => new AbortController(), schedule: () => () => {}
	});
	const pending = loop.tick();
	assert.equal((await loop.tick()).skippedBusy, true);
	await loop.stop();
	finishSample({ objectUrl: 'blob:canceled', blob: new Blob(), width: 1, height: 1 });
	assert.equal((await pending).stopped, true);
	assert.deepEqual(events, ['release', 'stop', 'blob:canceled']);
	assert.equal(loop.getState().active, false);
});

test('capture still discards a canceled sample when URL cleanup fails', async () => {
	const { createCaptureLoop } = await loadTypescript('features/monitoring/application/capture-workflow.ts');
	let finishSample;
	let revocations = 0;
	let stops = 0;
	const loop = createCaptureLoop({
		sessionId: 1, nowMonotonicMs: () => 1000, nowUtcIso: () => '2026-11-11T00:00:00Z',
		sampleJpeg: () => new Promise((resolve) => { finishSample = resolve; }),
		sendFrame: async () => { throw Error('canceled sample must not be sent'); },
		stopSession: async () => { stops++; }, releaseCamera: () => {},
		revokeObjectUrl: () => { revocations++; throw Error('URL cleanup failed'); },
		classifyError: () => { throw Error('canceled sample must not become an inference error'); },
		createAbortController: () => new AbortController(), schedule: () => () => {}
	});
	const pending = loop.tick();
	await loop.stop();
	finishSample({ objectUrl: 'blob:canceled', blob: new Blob(), width: 1, height: 1 });
	assert.deepEqual(await pending, { skippedBusy: false, stopped: true });
	assert.equal(revocations, 1);
	assert.equal(stops, 1);
});
