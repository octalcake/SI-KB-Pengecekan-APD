<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import {
		apiBlob,
		apiData,
		apiList,
		authSession,
		isApiError,
		type SystemMode,
		type SystemStatus,
		type ViolationType
	} from '#lib';
	import SnapshotOverlay from './SnapshotOverlay.svelte';
	import {
		classifyMonitoringError,
		createMonitoringApi,
		type MonitoringApi,
		type MonitoringHttpClient
	} from './api.ts';
	import {
		createCaptureLoop,
		DEFAULT_CAMERA_CONSTRAINTS,
		JPEG_QUALITY,
		MAX_JPEG_HEIGHT,
		MAX_JPEG_WIDTH,
		releaseMediaStream,
		requestUserCameraStream,
		sampleVideoElementJpeg,
		SERVER_IDLE_TIMEOUT_SECONDS,
		TARGET_SAMPLE_FPS,
		type CaptureLoopState
	} from './capture.ts';
	import type {
		CapturedEventItem,
		InferredSnapshot,
		MonitoringErrorState,
		MonitoringProject,
		MonitoringSession,
		MonitoringZone
	} from './types.ts';

	const httpClient: MonitoringHttpClient = {
		apiData: (path, options) => apiData(path, options),
		apiList: (path, options) => apiList(path, options)
	};

	const monitoringApi: MonitoringApi = createMonitoringApi(httpClient);

	// Master data selection state
	let projects = $state<MonitoringProject[]>([]);
	let zones = $state<MonitoringZone[]>([]);
	let selectedProjectId = $state<number>(0);
	let selectedZoneId = $state<number>(0);
	let loadingProjects = $state(false);
	let loadingZones = $state(false);
	let lookupError = $state<string | null>(null);

	// System readiness state (from shared authSession)
	let localSystemStatus = $state<SystemStatus | null>(null);
	let loadingSystemStatus = $state(false);
	let systemStatusError = $state<string | null>(null);

	// Session & capture state
	let activeSession = $state<MonitoringSession | null>(null);
	let recentSessions = $state<MonitoringSession[]>([]);
	let loadingSessions = $state(false);
	let startingSession = $state(false);
	let stoppingSession = $state(false);
	let startSequenceToken = 0;

	let mediaStream = $state<MediaStream | null>(null);
	let videoElement = $state<HTMLVideoElement | null>(null);
	let samplingCanvas: HTMLCanvasElement | null = null;
	let mirrorPreview = $state(false);

	let captureController: ReturnType<typeof createCaptureLoop> | null = null;
	let captureState = $state<CaptureLoopState | null>(null);
	let latestSnapshot = $state<InferredSnapshot | null>(null);
	let capturedEvents = $state<CapturedEventItem[]>([]);
	let errorState = $state<MonitoringErrorState | null>(null);
	let statusBannerMessage = $state<string | null>(null);

	// Protected evidence thumbnail state per captured finding
	type CaptureThumbState =
		| { state: 'loading' }
		| { state: 'ready'; objectUrl: string }
		| {
				state: 'error';
				code: string;
				message: string;
				isMissingEvidence: boolean;
				isUnauthorized: boolean;
				isForbidden: boolean;
				isNetworkError: boolean;
		  };

	let thumbStates = $state<Record<number, CaptureThumbState>>({});
	const thumbControllers = new Map<number, AbortController>();
	const thumbObjectUrls = new Map<number, string>();

	function revokeAllThumbUrls() {
		for (const ctrl of thumbControllers.values()) {
			ctrl.abort();
		}
		thumbControllers.clear();
		for (const objUrl of thumbObjectUrls.values()) {
			try {
				URL.revokeObjectURL(objUrl);
			} catch {
				// ignore revoke errors
			}
		}
		thumbObjectUrls.clear();
		thumbStates = {};
	}

	async function loadCaptureThumb(item: CapturedEventItem) {
		const id = item.findingId;
		if (thumbStates[id] || thumbControllers.has(id)) return;

		const ctrl = new AbortController();
		thumbControllers.set(id, ctrl);
		thumbStates[id] = { state: 'loading' };

		try {
			const targetUrl = item.evidenceUrl || `/api/v1/findings/${id}/evidence`;
			const { blob } = await apiBlob(targetUrl, {
				method: 'GET',
				cache: 'no-store',
				signal: ctrl.signal
			});
			if (ctrl.signal.aborted) return;
			const objUrl = URL.createObjectURL(blob);
			thumbObjectUrls.set(id, objUrl);
			thumbStates[id] = {
				state: 'ready',
				objectUrl: objUrl
			};
		} catch (err) {
			if (ctrl.signal.aborted) return;
			const code = isApiError(err) ? err.code || `HTTP_${err.status}` : 'UNKNOWN_ERROR';
			const status = isApiError(err) ? err.status : 0;
			const message = isApiError(err) ? err.message : 'Gagal memuat foto bukti.';
			thumbStates[id] = {
				state: 'error',
				code,
				message,
				isMissingEvidence: status === 410 || code === 'EVIDENCE_MISSING',
				isUnauthorized: status === 401,
				isForbidden: status === 403,
				isNetworkError: Boolean(isApiError(err) && (err.isNetworkError || status === 0))
			};
		} finally {
			if (thumbControllers.get(id) === ctrl) {
				thumbControllers.delete(id);
			}
		}
	}

	let nowMonotonicMs = $state(0);
	let ageTicker: ReturnType<typeof setInterval> | null = null;

	const effectiveSystemStatus = $derived<SystemStatus | null>(
		authSession.systemStatus ?? localSystemStatus
	);

	const modeLabel = $derived.by(() => {
		const mode: SystemMode | undefined = activeSession?.mode ?? effectiveSystemStatus?.mode;
		if (mode === 'real') return 'NYATA';
		if (mode === 'simulated') return 'SIMULASI';
		if (mode === 'manual') return 'MANUAL';
		return 'MEMERIKSA';
	});

	const supportedCategories = $derived<ViolationType[]>(
		activeSession?.supported_violations ??
			activeSession?.config?.supported_violations ??
			effectiveSystemStatus?.supported_violations ??
			[]
	);

	const isHelmetSupported = $derived(supportedCategories.includes('NO_HELMET'));
	const isVestSupported = $derived(supportedCategories.includes('NO_VEST'));

	const isSessionActive = $derived(
		Boolean(activeSession && activeSession.status === 'active' && captureState?.active)
	);

	const canStartMonitoring = $derived(
		!isSessionActive &&
			!startingSession &&
			!stoppingSession &&
			selectedProjectId > 0 &&
			selectedZoneId > 0
	);

	async function loadSystemReadiness() {
		loadingSystemStatus = true;
		systemStatusError = null;
		try {
			const st = await authSession.refreshSystemStatus();
			if (st) {
				localSystemStatus = st;
			}
		} catch (err) {
			const classified = classifyMonitoringError(err);
			systemStatusError = classified.message;
		} finally {
			loadingSystemStatus = false;
		}
	}

	async function loadProjects() {
		loadingProjects = true;
		lookupError = null;
		try {
			const list = await monitoringApi.listActiveProjects();
			projects = list;
			if (list.length > 0 && !list.some((p) => p.id === selectedProjectId)) {
				selectedProjectId = list[0].id;
				await loadZonesForProject(selectedProjectId);
			} else if (list.length === 0) {
				selectedProjectId = 0;
				zones = [];
				selectedZoneId = 0;
			}
		} catch (err) {
			lookupError = classifyMonitoringError(err).message;
		} finally {
			loadingProjects = false;
		}
	}

	async function loadZonesForProject(projectId: number) {
		if (!projectId || projectId <= 0) {
			zones = [];
			selectedZoneId = 0;
			return;
		}
		loadingZones = true;
		lookupError = null;
		try {
			const list = await monitoringApi.listActiveZones(projectId);
			zones = list;
			if (list.length > 0 && !list.some((z) => z.id === selectedZoneId)) {
				selectedZoneId = list[0].id;
			} else if (list.length === 0) {
				selectedZoneId = 0;
			}
		} catch (err) {
			lookupError = classifyMonitoringError(err).message;
			zones = [];
			selectedZoneId = 0;
		} finally {
			loadingZones = false;
		}
	}

	async function loadRecentSessions() {
		if (authSession.status !== 'authenticated') return;
		loadingSessions = true;
		try {
			const res = await monitoringApi.listSessions({
				projectId: selectedProjectId > 0 ? selectedProjectId : undefined,
				page: 1,
				pageSize: 10
			});
			recentSessions = res.data;
		} catch {
			// keep existing session list if refresh fails
		} finally {
			loadingSessions = false;
		}
	}

	async function handleProjectChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const nextId = Number(target.value) || 0;
		selectedProjectId = nextId;
		selectedZoneId = 0;
		await loadZonesForProject(nextId);
		await loadRecentSessions();
	}

	function attachTrackEndedListeners(stream: MediaStream) {
		for (const track of stream.getVideoTracks()) {
			track.addEventListener(
				'ended',
				() => {
					if (captureController && captureController.getState().active) {
						errorState = {
							code: 'CAMERA_DISCONNECTED',
							title: 'Perangkat Kamera Terputus',
							message: 'Aliran video webcam berhenti atau perangkat kamera dicabut.',
							status: 0,
							requestId: null,
							retryAfterSec: null,
							terminal: true,
							recoveryHint:
								'Sampling telah dihentikan dan sesi ditutup. Sambungkan kembali kamera lalu mulai sesi baru.'
						};
						void stopMonitoringSession('user_stop', true);
					}
				},
				{ once: true }
			);
		}
	}

	async function handleStartMonitoring() {
		if (!canStartMonitoring) return;
		const myStartToken = ++startSequenceToken;
		startingSession = true;
		errorState = null;
		statusBannerMessage = null;

		const currentMode = effectiveSystemStatus?.mode ?? 'real';

		// In manual fallback mode (SRS §9.5), startSession creates a closed manual_entry session without webcam streaming
		if (currentMode === 'manual') {
			try {
				const session = await monitoringApi.startSession({
					project_id: selectedProjectId,
					zone_id: selectedZoneId,
					source: 'manual_entry'
				});
				if (myStartToken !== startSequenceToken) return;
				activeSession = session;
				statusBannerMessage = `Sesi pencatatan manual #${session.id} berhasil dibuat (status: ${session.status}). Gunakan halaman Temuan untuk mengunggah foto bukti manual.`;
				await loadRecentSessions();
			} catch (err) {
				if (myStartToken !== startSequenceToken) return;
				errorState = classifyMonitoringError(err);
			} finally {
				if (myStartToken === startSequenceToken) {
					startingSession = false;
				}
			}
			return;
		}

		let stream: MediaStream | null = null;
		try {
			// 1. User-initiated getUserMedia (video-only, no audio) BEFORE creating active server session (SRS §5.4)
			stream = await requestUserCameraStream();
			if (myStartToken !== startSequenceToken) {
				releaseMediaStream(stream, videoElement);
				return;
			}
			mediaStream = stream;

			if (videoElement) {
				videoElement.srcObject = stream;
				try {
					await videoElement.play();
				} catch {
					// Autoplay after user gesture usually succeeds; ignore play promise warning in headless environments
				}
			}

			// 2. Request Go backend to start the monitoring session
			const session = await monitoringApi.startSession({
				project_id: selectedProjectId,
				zone_id: selectedZoneId,
				source: 'browser_webcam'
			});

			if (myStartToken !== startSequenceToken) {
				releaseMediaStream(stream, videoElement);
				mediaStream = null;
				if (session.status === 'active') {
					try {
						await monitoringApi.stopSession(session.id, 'user_stop');
					} catch {
						// ignore best-effort stop
					}
				}
				return;
			}

			activeSession = session;
			revokeAllThumbUrls();
			capturedEvents = [];
			latestSnapshot = null;
			attachTrackEndedListeners(stream);

			if (!samplingCanvas && typeof document !== 'undefined') {
				samplingCanvas = document.createElement('canvas');
			}

			const loop = createCaptureLoop({
				sessionId: session.id,
				stream,
				videoEl: videoElement,
				targetFps: session.config?.sample_fps ?? TARGET_SAMPLE_FPS,
				sampleJpeg: async () => {
					if (!videoElement) {
						throw {
							status: 0,
							code: 'VIDEO_ELEMENT_MISSING',
							message: 'Elemen video pratinjau tidak tersedia.'
						};
					}
					return sampleVideoElementJpeg(videoElement, samplingCanvas ?? undefined);
				},
				sendFrame: (input) => monitoringApi.sendFrame(input),
				stopSession: (sessionId, reason) => monitoringApi.stopSession(sessionId, reason),
				onStateChange: (nextState) => {
					captureState = nextState;
					if (nextState.lastError) {
						errorState = nextState.lastError;
					}
				},
				onSnapshot: (snapshot) => {
					latestSnapshot = snapshot;
				},
				onEvents: (newItems) => {
					if (captureController) {
						capturedEvents = captureController.getState().capturedEvents;
					}
					for (const item of newItems) {
						void loadCaptureThumb(item);
					}
				},
				onTerminalStop: (_code, terminalErr) => {
					if (terminalErr) {
						errorState = terminalErr;
					}
					mediaStream = null;
					if (activeSession) {
						activeSession = { ...activeSession, status: 'interrupted' };
					}
					void loadRecentSessions();
					void loadSystemReadiness();
				}
			});

			captureController = loop;
			captureState = loop.getState();
			loop.startTimer();
			await loadRecentSessions();
		} catch (err) {
			// Release camera immediately if backend rejected start (e.g. 503 MODEL_NOT_READY or 409 CAMERA_BUSY)
			releaseMediaStream(stream, videoElement);
			mediaStream = null;
			if (myStartToken === startSequenceToken) {
				errorState = classifyMonitoringError(err);
				await loadSystemReadiness();
			}
		} finally {
			if (myStartToken === startSequenceToken) {
				startingSession = false;
			}
		}
	}

	async function stopMonitoringSession(
		reason: 'user_stop' | 'page_hidden' = 'user_stop',
		keepError = false,
		skipRefresh = false
	) {
		// Invalidate any pending start sequence
		startSequenceToken += 1;
		startingSession = false;

		if (!captureController && (!activeSession || activeSession.status !== 'active')) {
			releaseMediaStream(mediaStream, videoElement);
			mediaStream = null;
			return;
		}

		stoppingSession = true;
		if (!keepError) {
			statusBannerMessage =
				reason === 'page_hidden'
					? 'Monitoring dihentikan otomatis karena tab disembunyikan atau halaman ditinggalkan (sampling latar belakang tidak didukung).'
					: 'Sesi monitoring telah dihentikan dan kamera dilepaskan.';
		}

		try {
			if (captureController) {
				await captureController.stop(reason, true);
			} else if (activeSession && activeSession.status === 'active') {
				releaseMediaStream(mediaStream, videoElement);
				await monitoringApi.stopSession(activeSession.id, reason);
			}
			if (activeSession) {
				activeSession = {
					...activeSession,
					status: 'stopped',
					end_reason: reason
				};
			}
		} catch (err) {
			if (!keepError) {
				errorState = classifyMonitoringError(err);
			}
		} finally {
			releaseMediaStream(mediaStream, videoElement);
			mediaStream = null;
			stoppingSession = false;
			if (!skipRefresh && authSession.status === 'authenticated') {
				await loadRecentSessions();
			}
		}
	}

	function formatJakartaTime(utcIso: string | null | undefined): string {
		if (!utcIso) return '-';
		const d = new Date(utcIso);
		if (Number.isNaN(d.getTime())) return utcIso;
		return (
			new Intl.DateTimeFormat('id-ID', {
				timeZone: 'Asia/Jakarta',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false
			}).format(d) + ' WIB'
		);
	}

	// React to unexpected unauthenticated transition (e.g. 401 session expiry during capture)
	$effect(() => {
		const authStatus = authSession.status;
		if (authStatus === 'unauthenticated' && (captureController?.getState().active || mediaStream)) {
			startSequenceToken += 1;
			startingSession = false;
			if (captureController) {
				void captureController.stop('user_stop', false);
			} else {
				releaseMediaStream(mediaStream, videoElement);
			}
			mediaStream = null;
		}
	});

	beforeNavigate(() => {
		if (captureController?.getState().active || mediaStream || startingSession) {
			void stopMonitoringSession('page_hidden', true, true);
		}
	});

	onMount(() => {
		nowMonotonicMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		ageTicker = setInterval(() => {
			nowMonotonicMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		}, 200);

		void loadSystemReadiness();
		void loadProjects();
		void loadRecentSessions();

		const unregisterBeforeLogout = authSession.registerBeforeLogout(async () => {
			if (
				captureController?.getState().active ||
				(activeSession && activeSession.status === 'active') ||
				mediaStream ||
				startingSession
			) {
				await stopMonitoringSession('user_stop', true, true);
			}
		});

		const handleVisibilityChange = () => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
				if (captureController?.getState().active || mediaStream || startingSession) {
					void stopMonitoringSession('page_hidden', false);
				}
			}
		};

		const handlePageHide = () => {
			if (captureController?.getState().active || mediaStream || startingSession) {
				void stopMonitoringSession('page_hidden', true, true);
			}
		};

		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleVisibilityChange);
		}
		if (typeof window !== 'undefined') {
			window.addEventListener('pagehide', handlePageHide);
		}

		return () => {
			unregisterBeforeLogout();
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', handleVisibilityChange);
			}
			if (typeof window !== 'undefined') {
				window.removeEventListener('pagehide', handlePageHide);
			}
		};
	});

	onDestroy(() => {
		startSequenceToken += 1;
		if (ageTicker) {
			clearInterval(ageTicker);
			ageTicker = null;
		}
		revokeAllThumbUrls();
		if (captureController) {
			void captureController.stop('page_hidden', true);
			captureController.destroy();
		} else {
			releaseMediaStream(mediaStream, videoElement);
		}
	});
</script>

<div class="monitoring-workspace" data-testid="monitoring-workspace">
	<header class="workspace-header">
		<div class="title-block">
			<p class="eyebrow">MODUL MONITORING & BUKTI OTOMATIS</p>
			<h1>Monitoring Kamera & Sesi Inspeksi</h1>
			<p class="subtitle">
				Pilih proyek dan zona aktif, jalankan pratinjau video tanpa audio, dan kirim sampel JPEG
				(maks. {MAX_JPEG_WIDTH}×{MAX_JPEG_HEIGHT}, kualitas {JPEG_QUALITY}, target {TARGET_SAMPLE_FPS}
				FPS) untuk evaluasi konfirmasi temporal 2-dari-3 di Go.
			</p>
		</div>

		<div class="header-actions">
			<button
				type="button"
				class="secondary-btn"
				onclick={() => {
					void loadSystemReadiness();
					void loadProjects();
					void loadRecentSessions();
				}}
				disabled={loadingSystemStatus || loadingProjects}
			>
				Segarkan Status & Master
			</button>
		</div>
	</header>

	{#if effectiveSystemStatus?.mode === 'simulated' || activeSession?.mode === 'simulated'}
		<section class="provenance-banner simulated" role="status" data-testid="simulated-mode-banner">
			<strong>MODE SIMULASI AKTIF</strong> — Seluruh observasi dan temuan pada sesi ini berasal
			dari fixture deterministik simulasi dan diberi label permanen <code>simulated</code>. Hasil
			ini tidak membuktikan kesiapan inferensi model nyata.
		</section>
	{:else if effectiveSystemStatus?.mode === 'manual' || activeSession?.mode === 'manual'}
		<section class="provenance-banner manual" role="status" data-testid="manual-mode-banner">
			<strong>MODE PENCATATAN MANUAL AKTIF</strong> — Server dikonfigurasi pada mode
			<code>manual</code> tanpa inferensi webcam otomatis. Anda dapat membuat sesi manual tertutup
			lalu mengunggah bukti foto manual pada halaman Temuan.
		</section>
	{/if}

	{#if effectiveSystemStatus && !effectiveSystemStatus.ai_ready && effectiveSystemStatus.mode !== 'manual'}
		<section
			class="readiness-warning-banner"
			role="alert"
			data-testid="ai-not-ready-banner"
		>
			<h2>Layanan AI / Model Belum Siap ({modeLabel})</h2>
			<p>
				Endpoint kesiapan server (<code>/api/v1/system/status</code>) melaporkan
				<code>ai_reachable={String(effectiveSystemStatus.ai_reachable)}</code> dan
				<code>ai_ready={String(effectiveSystemStatus.ai_ready)}</code>. Memulai sesi monitoring
				pada mode <strong>{modeLabel}</strong> akan ditolak oleh server (HTTP 503
				<code>AI_UNAVAILABLE</code> / <code>MODEL_NOT_READY</code>) dan aplikasi tidak akan
				beralih diam-diam ke mode simulasi. Kondisi ini bukan indikasi lokasi aman.
			</p>
		</section>
	{/if}

	{#if errorState}
		<section
			class="error-alert"
			role="alert"
			data-testid="monitoring-error-alert"
			data-error-code={errorState.code}
		>
			<div class="error-header">
				<h2>{errorState.title}</h2>
				<span class="error-code-badge">
					Kode: {errorState.code}
					{#if errorState.status > 0}
						(HTTP {errorState.status})
					{/if}
				</span>
			</div>
			<p class="error-msg">{errorState.message}</p>
			<p class="error-hint">{errorState.recoveryHint}</p>
			{#if errorState.requestId}
				<p class="error-req-id">ID Permintaan: <code>{errorState.requestId}</code></p>
			{/if}
		</section>
	{/if}

	{#if statusBannerMessage}
		<section class="info-banner" role="status" data-testid="monitoring-status-banner">
			<p>{statusBannerMessage}</p>
		</section>
	{/if}

	<!-- Readiness and Capabilities Strip -->
	<section class="readiness-strip" aria-label="Status kesiapan model dan cakupan APD">
		<div class="stat-box">
			<span class="stat-label">Mode Operasi Server</span>
			<strong class="stat-value" data-testid="monitoring-mode-value">{modeLabel}</strong>
		</div>

		<div class="stat-box">
			<span class="stat-label">Kesiapan AI & Model</span>
			<strong
				class="stat-value"
				data-ready={effectiveSystemStatus?.ai_ready ?? false}
				data-testid="monitoring-readiness-value"
			>
				{#if loadingSystemStatus && !effectiveSystemStatus}
					Memeriksa...
				{:else if systemStatusError && !effectiveSystemStatus}
					Gagal Memuat Status
				{:else if effectiveSystemStatus?.ai_ready}
					Siap ({effectiveSystemStatus.model_version ?? 'Mode Manual'})
				{:else}
					Belum Siap ({effectiveSystemStatus?.model_version ?? 'Model tidak aktif'})
				{/if}
			</strong>
		</div>

		<div class="stat-box">
			<span class="stat-label">Cakupan Deteksi Otomatis</span>
			<div class="category-pills" data-testid="supported-categories-list">
				<span
					class="cat-pill"
					data-supported={isHelmetSupported}
					data-testid="category-no-helmet"
				>
					NO_HELMET: {isHelmetSupported ? 'Didukung' : 'Tidak Aktif'}
				</span>
				<span
					class="cat-pill"
					data-supported={isVestSupported}
					data-testid="category-no-vest"
				>
					NO_VEST: {isVestSupported ? 'Didukung' : 'Tidak Aktif'}
				</span>
			</div>
		</div>

		<div class="stat-box">
			<span class="stat-label">Sampling & Transport</span>
			<strong class="stat-value" data-testid="sampling-metrics-value">
				Target {activeSession?.config?.sample_fps ?? TARGET_SAMPLE_FPS} FPS • Efektif
				{(captureState?.effectiveFps ?? 0).toFixed(2).replace('.', ',')} FPS
			</strong>
			<span class="stat-note">
				1 in-flight maks • Dilewati sibuk: {captureState?.skippedBusyTicks ?? 0} • Backstop idle:
				{SERVER_IDLE_TIMEOUT_SECONDS} dtk
			</span>
		</div>
	</section>

	<!-- Control Bar: Project & Zone Selection + Start/Stop -->
	<section class="control-card" aria-labelledby="session-control-heading">
		<h2 id="session-control-heading" class="sr-only">Kontrol Sesi Monitoring</h2>

		{#if lookupError}
			<p class="lookup-error" role="alert">{lookupError}</p>
		{/if}

		<form
			class="control-form"
			onsubmit={(e) => {
				e.preventDefault();
				void handleStartMonitoring();
			}}
		>
			<div class="field-group">
				<label for="monitoring-project-select">Proyek Aktif</label>
				<select
					id="monitoring-project-select"
					value={selectedProjectId}
					onchange={handleProjectChange}
					disabled={isSessionActive || loadingProjects || startingSession}
					required
				>
					{#if projects.length === 0}
						<option value={0}>
							{loadingProjects ? 'Memuat daftar proyek...' : 'Belum ada proyek aktif'}
						</option>
					{:else}
						{#each projects as proj (proj.id)}
							<option value={proj.id}>{proj.name} ({proj.location || 'Tanpa lokasi'})</option>
						{/each}
					{/if}
				</select>
			</div>

			<div class="field-group">
				<label for="monitoring-zone-select">Zona Inspeksi Aktif</label>
				<select
					id="monitoring-zone-select"
					bind:value={selectedZoneId}
					disabled={isSessionActive || loadingZones || startingSession || zones.length === 0}
					required
				>
					{#if zones.length === 0}
						<option value={0}>
							{loadingZones
								? 'Memuat daftar zona...'
								: 'Belum ada zona aktif pada proyek ini'}
						</option>
					{:else}
						{#each zones as z (z.id)}
							<option value={z.id}>{z.name}</option>
						{/each}
					{/if}
				</select>
			</div>

			<div class="action-group">
				{#if !isSessionActive}
					<button
						type="submit"
						class="primary-btn"
						data-testid="start-monitoring-btn"
						disabled={!canStartMonitoring}
					>
						{#if startingSession}
							Meminta Kamera & Memulai...
						{:else if effectiveSystemStatus?.mode === 'manual'}
							Buat Sesi Manual
						{:else}
							Mulai Monitoring
						{/if}
					</button>
				{:else}
					<button
						type="button"
						class="stop-btn"
						data-testid="stop-monitoring-btn"
						onclick={() => void stopMonitoringSession('user_stop', false)}
						disabled={stoppingSession}
					>
						{stoppingSession ? 'Menghentikan...' : 'Hentikan Monitoring'}
					</button>
				{/if}
			</div>
		</form>

		<p class="control-footnote">
			Izin kamera diminta setelah Anda menekan tombol mulai (hanya video
			<code>audio: {String(DEFAULT_CAMERA_CONSTRAINTS.audio)}</code>). Mengganti proyek, zona,
			atau kamera memerlukan penghentian sesi aktif terlebih dahulu.
		</p>
	</section>

	<!-- Two-column Main Monitoring Grid: Left (Live Preview + Snapshot Overlay), Right (Recent Captures + Session History) -->
	<div class="monitoring-grid">
		<div class="left-column">
			<!-- Live Browser Video Preview (NO stale bounding boxes on live video per SRS §8.3) -->
			<section class="preview-card" aria-labelledby="live-preview-heading">
				<div class="preview-header">
					<div>
						<h2 id="live-preview-heading">Pratinjau Video Browser (Live)</h2>
						<p class="preview-sub">
							Aliran langsung dari kamera tanpa kotak overlay tertunda. Hanya foto saat event
							terkonfirmasi yang disimpan ke server.
						</p>
					</div>

					<label class="mirror-toggle">
						<input type="checkbox" bind:checked={mirrorPreview} />
						<span>Cerminkan Pratinjau (Tidak Mengubah Bukti JPEG)</span>
					</label>
				</div>

				<div class="video-container" data-active={isSessionActive}>
					<video
						bind:this={videoElement}
						class="live-video"
						class:mirrored={mirrorPreview}
						autoplay
						playsinline
						muted
						data-testid="live-preview-video"
					></video>

					{#if !isSessionActive}
						<div class="video-placeholder">
							<p class="placeholder-title">Kamera Tidak Aktif</p>
							<p class="placeholder-desc">
								Pilih proyek serta zona aktif, lalu klik <strong>Mulai Monitoring</strong> untuk
								mengaktifkan webcam.
							</p>
						</div>
					{/if}
				</div>

				<div class="preview-status-bar">
					<span class="status-indicator" data-active={isSessionActive}>
						{isSessionActive ? 'Kamera Aktif (1 FPS JPEG)' : 'Kamera Dilepaskan'}
					</span>
					{#if activeSession}
						<span class="session-chip" data-testid="active-session-badge">
							Sesi #{activeSession.id} • Status: <strong>{activeSession.status}</strong> •
							Sequence terkirim: <strong>{captureState?.sequence ?? 0}</strong>
						</span>
					{/if}
				</div>
			</section>

			<!-- Separate Inferred Snapshot Panel with Normalized Bounding Box Overlays -->
			<SnapshotOverlay
				snapshot={latestSnapshot}
				{nowMonotonicMs}
				sessionActive={isSessionActive}
				modelReady={effectiveSystemStatus?.ai_ready ?? false}
			/>
		</div>

		<aside class="right-column" aria-label="Capture temuan terbaru dan riwayat sesi">
			<!-- Captured Events & Evidence Links -->
			<section class="captures-card" aria-labelledby="captures-heading">
				<div class="captures-header">
					<h2 id="captures-heading">Capture Temuan Terbaru</h2>
					<span class="count-pill" data-testid="captured-events-count">
						{capturedEvents.length} temuan
					</span>
				</div>
				<p class="captures-sub">
					Temuan dibuat otomatis oleh Go ketika aturan konfirmasi temporal (minimal 2 positif
					dari 3 frame valid dalam 2 detik) terpenuhi. Status awal selalu
					<code>pending</code> hingga diverifikasi petugas.
				</p>

				{#if capturedEvents.length === 0}
					<div class="empty-captures" data-testid="empty-captures-state">
						<p>Belum ada event temuan yang terekam pada sesi ini.</p>
					</div>
				{:else}
					<ul class="capture-list" data-testid="captured-events-list">
						{#each capturedEvents as item (item.findingId)}
							{@const thumb = thumbStates[item.findingId]}
							<li class="capture-item" data-testid={`captured-finding-${item.findingId}`}>
								<div class="capture-thumb-wrap" data-testid={`capture-thumb-wrap-${item.findingId}`}>
									{#if !thumb || thumb.state === 'loading'}
										<div
											class="capture-thumb-status"
											data-testid={`capture-thumb-loading-${item.findingId}`}
										>
											Memuat bukti...
										</div>
									{:else if thumb.state === 'error'}
										<div
											class="capture-thumb-status capture-thumb-status--error"
											data-testid={`capture-thumb-error-${item.findingId}`}
											data-error-code={thumb.code}
										>
											{#if thumb.isMissingEvidence}
												Bukti hilang (410 EVIDENCE_MISSING)
											{:else if thumb.isUnauthorized}
												Sesi berakhir (401)
											{:else if thumb.isForbidden}
												Akses ditolak (403)
											{:else}
												{thumb.message}
											{/if}
										</div>
									{:else}
										<img
											src={thumb.objectUrl}
											alt={`Bukti JPEG temuan #${item.findingId}`}
											class="capture-thumb"
											data-testid={`capture-thumb-img-${item.findingId}`}
											loading="lazy"
										/>
									{/if}
								</div>
								<div class="capture-details">
									<div class="capture-top-row">
										<strong>Temuan #{item.findingId}</strong>
										<span class="verif-badge" data-status={item.verificationStatus}>
											Menunggu Verifikasi ({item.verificationStatus})
										</span>
									</div>
									<p class="capture-meta">
										Seq #{item.sequence} • Mode: <strong>{item.mode.toUpperCase()}</strong> • Detail
										kategori &amp; track tersedia pada halaman temuan
									</p>
									<p class="capture-time">
										Waktu capture: {formatJakartaTime(item.capturedAtUtc)}
									</p>
									<div class="capture-links">
										<a
											href={`/findings/${item.findingId}`}
											class="finding-link"
											data-testid={`open-finding-link-${item.findingId}`}
										>
											Buka Temuan #{item.findingId}
										</a>
										<a
											href={item.evidenceUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="evidence-link"
										>
											Lihat Foto Bukti Asli
										</a>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Recent Monitoring Sessions -->
			<section class="sessions-card" aria-labelledby="sessions-history-heading">
				<div class="captures-header">
					<h2 id="sessions-history-heading">Riwayat Sesi Monitoring</h2>
					{#if loadingSessions}
						<span class="loading-tag">Memuat...</span>
					{/if}
				</div>

				{#if recentSessions.length === 0}
					<p class="empty-sessions">Belum ada riwayat sesi pada proyek ini.</p>
				{:else}
					<ul class="session-history-list" data-testid="session-history-list">
						{#each recentSessions as sess (sess.id)}
							<li class="session-history-item">
								<div class="sess-row">
									<strong>Sesi #{sess.id}</strong>
									<span class="sess-status-pill" data-status={sess.status}>
										{sess.status}
									</span>
								</div>
								<p class="sess-meta">
									Mode: <strong>{sess.mode.toUpperCase()}</strong> • Sumber:
									<code>{sess.source}</code>
									{#if sess.end_reason}
										• Alasan selesai: <code>{sess.end_reason}</code>
									{/if}
								</p>
								<p class="sess-time">
									Mulai: {formatJakartaTime(sess.started_at)}
								</p>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</aside>
	</div>
</div>

<style>
	.monitoring-workspace {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
		max-width: 1360px;
		margin: 0 auto;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.workspace-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.25rem 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--accent-primary, #9a3412);
	}

	.workspace-header h1 {
		margin: 0 0 0.35rem 0;
		font-size: 1.5rem;
	}

	.subtitle {
		margin: 0;
		font-size: 0.9rem;
		color: var(--ink-secondary, #4a453d);
	}

	.provenance-banner {
		padding: 0.875rem 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
		line-height: 1.45;
	}

	.provenance-banner.simulated {
		background: var(--status-warn-bg, #fffbeb);
		border: 2px solid var(--status-warn-border, #fcd34d);
		color: var(--status-warn-ink, #92400e);
	}

	.provenance-banner.manual {
		background: var(--accent-surface, #ffedd5);
		border: 2px solid var(--accent-border, #fdba74);
		color: var(--ink-primary, #1c1a17);
	}

	.readiness-warning-banner {
		background: var(--status-warn-bg, #fffbeb);
		border: 1px solid var(--status-warn-border, #fcd34d);
		color: var(--status-warn-ink, #92400e);
		border-radius: 10px;
		padding: 1rem 1.125rem;
	}

	.readiness-warning-banner h2 {
		margin: 0 0 0.35rem 0;
		font-size: 1rem;
		color: var(--status-warn-ink, #92400e);
	}

	.readiness-warning-banner p {
		margin: 0;
		font-size: 0.875rem;
	}

	.error-alert {
		background: var(--status-err-bg, #fef2f2);
		border: 1px solid var(--status-err-border, #fca5a5);
		color: var(--status-err-ink, #991b1b);
		border-radius: 10px;
		padding: 1rem 1.125rem;
	}

	.error-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.error-header h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--status-err-ink, #991b1b);
	}

	.error-code-badge {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		background: rgba(153, 27, 27, 0.1);
	}

	.error-msg {
		margin: 0 0 0.3rem 0;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.error-hint {
		margin: 0;
		font-size: 0.825rem;
	}

	.error-req-id {
		margin: 0.4rem 0 0 0;
		font-size: 0.75rem;
	}

	.info-banner {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
	}

	.info-banner p {
		margin: 0;
	}

	.readiness-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 0.75rem;
	}

	.stat-box {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #dcd7cb);
		border-radius: 8px;
		padding: 0.75rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.stat-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ink-muted, #655e53);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.stat-value {
		font-size: 0.95rem;
		color: var(--ink-primary, #1c1a17);
		overflow-wrap: anywhere;
	}

	.stat-value[data-ready='true'] {
		color: var(--status-ok-ink, #065f46);
	}

	.stat-value[data-ready='false'] {
		color: var(--status-warn-ink, #92400e);
	}

	.stat-note {
		font-size: 0.75rem;
		color: var(--ink-secondary, #4a453d);
		overflow-wrap: anywhere;
	}

	.category-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.cat-pill {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-secondary, #4a453d);
	}

	.cat-pill[data-supported='true'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
		border: 1px solid var(--status-ok-border, #6ee7b7);
	}

	.control-card {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 10px;
		padding: 1rem 1.125rem;
		min-width: 0;
	}

	.lookup-error {
		margin: 0 0 0.75rem 0;
		color: var(--status-err-ink, #991b1b);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.control-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: 0.875rem;
		align-items: end;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.field-group label {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--ink-primary, #1c1a17);
	}

	.field-group select {
		width: 100%;
		min-width: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 7px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		font-size: 0.9rem;
	}

	.field-group select:disabled {
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-muted, #655e53);
		cursor: not-allowed;
	}

	.primary-btn,
	.stop-btn,
	.secondary-btn {
		padding: 0.6rem 1.1rem;
		border-radius: 7px;
		font-weight: 700;
		font-size: 0.9rem;
		cursor: pointer;
		border: 1px solid transparent;
	}

	.primary-btn {
		background: var(--accent-primary, #9a3412);
		color: #ffffff;
	}

	.primary-btn:hover:not(:disabled) {
		background: var(--accent-hover, #7c2d12);
	}

	.primary-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.stop-btn {
		background: #991b1b;
		color: #ffffff;
	}

	.stop-btn:hover:not(:disabled) {
		background: #7f1d1d;
	}

	.secondary-btn {
		background: var(--bg-surface, #ffffff);
		border-color: var(--border-strong, #c9c3b6);
		color: var(--ink-primary, #1c1a17);
		font-size: 0.825rem;
		padding: 0.45rem 0.85rem;
	}

	.control-footnote {
		margin: 0.65rem 0 0 0;
		font-size: 0.78rem;
		color: var(--ink-muted, #655e53);
	}

	.monitoring-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.95fr);
		gap: 1.125rem;
		align-items: start;
	}

	.left-column,
	.right-column {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
		min-width: 0;
	}

	.preview-card,
	.captures-card,
	.sessions-card {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #dcd7cb);
		border-radius: 10px;
		padding: 1.125rem;
		min-width: 0;
	}

	.preview-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.preview-header h2,
	.captures-header h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.preview-sub,
	.captures-sub {
		margin: 0.25rem 0 0 0;
		font-size: 0.8125rem;
		color: var(--ink-secondary, #4a453d);
	}

	.mirror-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.35rem 0.65rem;
		border-radius: 6px;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.video-container {
		position: relative;
		width: 100%;
		max-width: 640px;
		aspect-ratio: 4 / 3;
		background: #141311;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.live-video {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: contain;
	}

	.live-video.mirrored {
		transform: scaleX(-1);
	}

	.video-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		text-align: center;
		background: rgba(20, 19, 17, 0.88);
		color: #f5f3ee;
	}

	.placeholder-title {
		margin: 0 0 0.35rem 0;
		font-weight: 700;
		font-size: 1rem;
	}

	.placeholder-desc {
		margin: 0;
		font-size: 0.85rem;
		color: #d6d1c7;
	}

	.preview-status-bar {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
	}

	.status-indicator {
		font-weight: 700;
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-secondary, #4a453d);
	}

	.status-indicator[data-active='true'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
		border: 1px solid var(--status-ok-border, #6ee7b7);
	}

	.captures-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.count-pill {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-surface, #ffedd5);
		color: var(--accent-primary, #9a3412);
		border: 1px solid var(--accent-border, #fdba74);
	}

	.empty-captures,
	.empty-sessions {
		margin-top: 0.75rem;
		padding: 1rem;
		border-radius: 7px;
		background: var(--bg-canvas, #f5f3ee);
		border: 1px dashed var(--border-strong, #c9c3b6);
		font-size: 0.85rem;
		color: var(--ink-secondary, #4a453d);
	}

	.capture-list,
	.session-history-list {
		list-style: none;
		padding: 0;
		margin: 0.85rem 0 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.capture-item {
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.65rem;
		border-radius: 8px;
		background: var(--bg-canvas, #f5f3ee);
		border: 1px solid var(--border-default, #dcd7cb);
		min-width: 0;
	}

	.capture-details {
		min-width: 0;
	}

	.capture-thumb-wrap {
		width: 112px;
		height: 84px;
		border-radius: 6px;
		overflow: hidden;
		background: #141311;
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.capture-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.capture-thumb-status {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0.35rem;
		font-size: 0.68rem;
		line-height: 1.25;
		color: #e5e0d8;
		background: #1f1d1a;
		box-sizing: border-box;
	}

	.capture-thumb-status--error {
		color: #fecaca;
		background: #451a1a;
		font-weight: 600;
	}

	.capture-top-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	.verif-badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border: 1px solid var(--status-warn-border, #fcd34d);
	}

	.capture-meta,
	.capture-time {
		margin: 0.2rem 0 0 0;
		font-size: 0.76rem;
		color: var(--ink-secondary, #4a453d);
		overflow-wrap: anywhere;
	}

	.capture-links {
		margin-top: 0.45rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.finding-link,
	.evidence-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.35rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		text-decoration: none;
	}

	.session-history-item {
		padding: 0.6rem 0.75rem;
		border-radius: 7px;
		background: var(--bg-canvas, #f5f3ee);
		border: 1px solid var(--border-default, #dcd7cb);
		min-width: 0;
	}

	.sess-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	.sess-status-pill {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 4px;
		background: var(--bg-subtle, #ece9e1);
	}

	.sess-status-pill[data-status='active'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
	}

	.sess-status-pill[data-status='interrupted'] {
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
	}

	.sess-meta,
	.sess-time {
		margin: 0.2rem 0 0 0;
		font-size: 0.76rem;
		color: var(--ink-secondary, #4a453d);
		overflow-wrap: anywhere;
	}

	@media (max-width: 980px) {
		.control-form {
			grid-template-columns: minmax(0, 1fr);
		}

		.monitoring-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 640px) {
		.control-card,
		.preview-card,
		.captures-card,
		.sessions-card {
			padding: 0.9rem;
		}

		.action-group {
			width: 100%;
		}

		.action-group > button {
			width: 100%;
			min-height: 2.75rem;
		}

		.mirror-toggle {
			width: 100%;
		}

		.video-placeholder {
			padding: 0.85rem;
		}

		.capture-item {
			grid-template-columns: minmax(0, 1fr);
		}

		.capture-thumb-wrap {
			width: 100%;
			height: auto;
			aspect-ratio: 4 / 3;
			max-height: 180px;
		}

		.capture-links > a {
			flex: 1 1 140px;
			justify-content: center;
			text-align: center;
		}
	}
</style>
