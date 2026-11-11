<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fetchProtectedEvidenceBlob } from '#lib/app/findings';
	import type { EvidenceLoadStatus } from './evidence-state';
	import {
		bboxToPercentStyle,
		formatViolationShortLabel,
		normalizeBBox,
		parseFindingApiError
	} from './format';
	import type { Finding } from '../domain/types';

	interface Props {
		finding: Finding;
		compact?: boolean;
		defaultShowOverlay?: boolean;
	}

	let { finding, compact = false, defaultShowOverlay = true }: Props = $props();

	let loadStatus = $state<EvidenceLoadStatus>({ state: 'loading' });
	let showOverlay = $state(true);
	let enlarged = $state(false);
	let activeObjectUrl: string | null = null;
	let abortController: AbortController | null = null;

	$effect(() => {
		showOverlay = defaultShowOverlay;
	});

	const personBox = $derived(normalizeBBox(finding.person_bbox));
	const violationBox = $derived(normalizeBBox(finding.violation_bbox));
	const hasAnyBox = $derived(Boolean(personBox || violationBox));
	const aspectRatioStyle = $derived(
		finding.frame_width > 0 && finding.frame_height > 0
			? `aspect-ratio: ${finding.frame_width} / ${finding.frame_height};`
			: 'aspect-ratio: 4 / 3;'
	);

	function revokeCurrentUrl() {
		if(activeObjectUrl) {
			URL.revokeObjectURL(activeObjectUrl);
			activeObjectUrl = null;
		}
	}

	async function loadEvidence(url: string) {
		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		revokeCurrentUrl();
		loadStatus = { state: 'loading' };

		try {
			const { blob } = await fetchProtectedEvidenceBlob(url, controller.signal);
			if(controller.signal.aborted) return;
			const objUrl = URL.createObjectURL(blob);
			activeObjectUrl = objUrl;
			loadStatus = {
				state: 'ready',
				objectUrl: objUrl,
				byteLength: blob.size
			};
		} catch(err) {
			if(controller.signal.aborted) return;
			const parsed = parseFindingApiError(err, 'Gagal memuat foto bukti asli.');
			loadStatus = {
				state: 'error',
				status: parsed.status,
				code: parsed.code,
				message: parsed.message,
				requestId: parsed.requestId,
				isMissingEvidence: parsed.isEvidenceMissing,
				isUnauthorized: parsed.isUnauthorized,
				isForbidden: parsed.isForbidden,
				isNetworkError: parsed.isNetworkError
			};
		}
	}

	$effect(() => {
		const targetUrl = finding.evidence_url || `/api/v1/findings/${finding.id}/evidence`;
		void loadEvidence(targetUrl);
	});

	onDestroy(() => {
		abortController?.abort();
		revokeCurrentUrl();
	});

	function handleKeydown(event: KeyboardEvent) {
		if(enlarged && event.key === 'Escape') {
			event.preventDefault();
			enlarged = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="evidence-viewer" class:compact>
	<div
		class="frame-stage"
		style={aspectRatioStyle}
		data-testid={compact ? `finding-thumb-${finding.id}` : 'finding-evidence-stage'}
	>
		{#if loadStatus.state === 'loading'}
			<div class="stage-state loading" role="status" aria-live="polite">
				<span class="state-title">Memuat foto bukti asli...</span>
				<span class="state-sub">Mengambil frame terproteksi #{finding.id}</span>
			</div>
		{:else if loadStatus.state === 'error'}
			<div
				class="stage-state error"
				class:missing={loadStatus.isMissingEvidence}
				role="alert"
				data-testid="evidence-error-state"
				data-error-code={loadStatus.code}
			>
				{#if loadStatus.isMissingEvidence}
					<strong class="state-title">File Bukti Asli Hilang (410 EVIDENCE_MISSING)</strong>
					<p class="state-desc">
						{loadStatus.message} Sistem tidak menampilkan foto pengganti agar integritas bukti tetap jujur.
					</p>
				{:else if loadStatus.isUnauthorized}
					<strong class="state-title">Sesi Berakhir (401)</strong>
					<p class="state-desc">
						Foto bukti memerlukan sesi petugas aktif. Silakan masuk kembali untuk mengakses bukti.
					</p>
				{:else if loadStatus.isForbidden}
					<strong class="state-title">Akses Bukti Ditolak (403)</strong>
					<p class="state-desc">{loadStatus.message}</p>
				{:else if loadStatus.isNetworkError}
					<strong class="state-title">Backend Tidak Terjangkau</strong>
					<p class="state-desc">{loadStatus.message}</p>
				{:else}
					<strong class="state-title">Gagal Memuat Foto Bukti ({loadStatus.code})</strong>
					<p class="state-desc">{loadStatus.message}</p>
				{/if}

				{#if !compact}
					<button
						type="button"
						class="stage-retry-btn"
						onclick={() => loadEvidence(finding.evidence_url)}
					>
						Muat Ulang Bukti
					</button>
				{/if}
			</div>
		{:else}
			<img
				src={loadStatus.objectUrl}
				alt={`Foto bukti asli temuan #${finding.id} (${formatViolationShortLabel(finding.violation_type)})`}
				class="evidence-img"
				data-testid={compact ? `finding-thumb-img-${finding.id}` : 'finding-evidence-img'}
			/>

			{#if showOverlay && hasAnyBox}
				<div
					class="bbox-overlay-layer"
					data-testid={compact ? `finding-thumb-overlay-${finding.id}` : 'finding-bbox-overlay'}
					aria-label="Overlay kotak deteksi model pada frame asli"
				>
					{#if personBox}
						<div
							class="bbox person-box"
							style={bboxToPercentStyle(personBox)}
							data-testid="person-bbox"
						>
							<span class="bbox-tag person-tag">
								Person {finding.track_key ? `(${finding.track_key})` : ''}
							</span>
						</div>
					{/if}
					{#if violationBox}
						<div
							class="bbox violation-box"
							style={bboxToPercentStyle(violationBox)}
							data-testid="violation-bbox"
						>
							<span class="bbox-tag violation-tag">
								{finding.detected_violation ?? finding.violation_type}
								{#if finding.confidence !== null && finding.confidence !== undefined}
									({(finding.confidence * 100).toFixed(0)}%)
								{/if}
							</span>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	{#if !compact}
		<div class="viewer-toolbar">
			<div class="toolbar-meta">
				<span class="meta-chip">
					Resolusi Asli: <strong>{finding.frame_width} × {finding.frame_height} px</strong>
				</span>
				{#if finding.frame_sequence !== null}
					<span class="meta-chip">
						Sequence Frame: <strong>#{finding.frame_sequence}</strong>
					</span>
				{/if}
				{#if !hasAnyBox}
					<span class="meta-chip muted">
						Tanpa koordinat bbox model (pencatatan manual / non-bbox)
					</span>
				{/if}
			</div>

			<div class="toolbar-actions">
				{#if hasAnyBox}
					<button
						type="button"
						class="tool-btn"
						aria-pressed={showOverlay}
						onclick={() => (showOverlay = !showOverlay)}
					>
						{showOverlay ? 'Sembunyikan Overlay' : 'Tampilkan Overlay'}
					</button>
				{/if}
				<button
					type="button"
					class="tool-btn primary"
					disabled={loadStatus.state !== 'ready'}
					onclick={() => (enlarged = true)}
				>
					Perbesar Bukti
				</button>
			</div>
		</div>
	{/if}
</div>

{#if enlarged && loadStatus.state === 'ready'}
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Pratinjau Penuh Foto Bukti"
	>
		<div class="modal-panel">
			<header class="modal-header">
				<div>
					<h2 class="modal-title">
						Pratinjau Penuh Foto Bukti Asli — Temuan #{finding.id}
					</h2>
					<p class="modal-subtitle">
						Frame asli {finding.frame_width}×{finding.frame_height} px • SHA-256:
						<code>{finding.evidence_sha256.slice(0, 16)}…</code>
					</p>
				</div>
				<div class="modal-controls">
					{#if hasAnyBox}
						<button
							type="button"
							class="tool-btn"
							aria-pressed={showOverlay}
							onclick={() => (showOverlay = !showOverlay)}
						>
							{showOverlay ? 'Sembunyikan Overlay' : 'Tampilkan Overlay'}
						</button>
					{/if}
					<button
						type="button"
						class="tool-btn close-btn"
						onclick={() => (enlarged = false)}
					>
						Tutup Pratinjau
					</button>
				</div>
			</header>

			<div class="modal-stage-wrap">
				<div class="frame-stage enlarged-stage" style={aspectRatioStyle}>
					<img
						src={loadStatus.objectUrl}
						alt={`Pratinjau penuh bukti asli temuan #${finding.id}`}
						class="evidence-img"
					/>
					{#if showOverlay && hasAnyBox}
						<div class="bbox-overlay-layer" data-testid="enlarged-bbox-overlay">
							{#if personBox}
								<div class="bbox person-box" style={bboxToPercentStyle(personBox)}>
									<span class="bbox-tag person-tag">
										Person {finding.track_key ? `(${finding.track_key})` : ''}
									</span>
								</div>
							{/if}
							{#if violationBox}
								<div class="bbox violation-box" style={bboxToPercentStyle(violationBox)}>
									<span class="bbox-tag violation-tag">
										{finding.detected_violation ?? finding.violation_type}
										{#if finding.confidence !== null && finding.confidence !== undefined}
											({(finding.confidence * 100).toFixed(0)}%)
										{/if}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.evidence-viewer {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.frame-stage {
		position: relative;
		width: 100%;
		background: #181614;
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.evidence-viewer.compact .frame-stage {
		border-radius: 6px;
	}

	.evidence-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: fill;
		user-select: none;
	}

	.bbox-overlay-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.bbox {
		position: absolute;
		border-radius: 3px;
	}

	.person-box {
		border: 2px solid #38bdf8;
		background: rgba(56, 189, 248, 0.08);
	}

	.violation-box {
		border: 2px solid #ef4444;
		background: rgba(239, 68, 68, 0.14);
	}

	.bbox-tag {
		position: absolute;
		top: -1.4rem;
		left: -2px;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		padding: 0.15rem 0.35rem;
		border-radius: 3px;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.person-tag {
		background: #0284c7;
		color: #ffffff;
	}

	.violation-tag {
		background: #b91c1c;
		color: #ffffff;
	}

	.stage-state {
		padding: 1rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		width: 100%;
		height: 100%;
	}

	.stage-state.loading {
		color: #e7e5e4;
		background: #26231f;
	}

	.stage-state.error {
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
	}

	.stage-state.error.missing {
		background: #fffbeb;
		color: #92400e;
	}

	.state-title {
		font-size: 0.875rem;
		font-weight: 700;
	}

	.state-sub,
	.state-desc {
		margin: 0;
		font-size: 0.8125rem;
		max-width: 48ch;
	}

	.stage-retry-btn {
		margin-top: 0.4rem;
		padding: 0.35rem 0.7rem;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: 6px;
		border: 1px solid currentColor;
		background: #ffffff;
		color: inherit;
		cursor: pointer;
	}

	.viewer-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.65rem 0.85rem;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-default, #dcd7cb);
		border-radius: 8px;
	}

	.toolbar-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.8125rem;
		color: var(--ink-secondary, #4a453d);
	}

	.meta-chip {
		padding: 0.15rem 0.45rem;
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #dcd7cb);
		border-radius: 4px;
	}

	.meta-chip.muted {
		color: var(--ink-muted, #655e53);
	}

	.toolbar-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tool-btn {
		padding: 0.42rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		color: var(--ink-primary, #1c1a17);
		cursor: pointer;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--bg-subtle, #ece9e1);
	}

	.tool-btn.primary {
		background: var(--accent-primary, #9a3412);
		border-color: var(--accent-primary, #9a3412);
		color: #ffffff;
	}

	.tool-btn.primary:hover:not(:disabled) {
		background: var(--accent-hover, #7c2d12);
	}

	.tool-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(20, 18, 15, 0.82);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
			max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
	}

	.modal-panel {
		width: 100%;
		max-width: 1040px;
		max-height: calc(100dvh - 1.5rem);
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		flex-shrink: 0;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--border-default, #dcd7cb);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.modal-title {
		margin: 0;
		font-size: 1rem;
	}

	.modal-subtitle {
		margin: 0.2rem 0 0 0;
		font-size: 0.8125rem;
		color: var(--ink-secondary, #4a453d);
		overflow-wrap: anywhere;
	}

	.modal-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.modal-stage-wrap {
		padding: 0.75rem;
		background: #141210;
		overflow: auto;
		display: block;
		flex: 1;
		min-height: 0;
	}

	.enlarged-stage {
		max-width: 920px;
		margin-inline: auto;
	}

	.enlarged-stage > .evidence-img {
		position: absolute;
		inset: 0;
	}

	@media (max-width: 640px) {
		.toolbar-actions,
		.modal-controls {
			width: 100%;
		}

		.toolbar-actions > button,
		.modal-controls > button {
			flex: 1 1 130px;
			min-height: 2.75rem;
		}
	}

	@media (max-height: 500px) {
		.modal-header {
			padding: 0.5rem 0.85rem;
		}

		.modal-stage-wrap {
			padding: 0.5rem;
		}

	}
</style>
