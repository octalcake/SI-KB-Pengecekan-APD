<script lang="ts">
	import { scaleNormalizedBBox } from './api.ts';
	import type { InferredSnapshot, PPEObservation, TrackView } from './types.ts';

	interface Props {
		snapshot: InferredSnapshot | null;
		nowMonotonicMs: number;
		sessionActive: boolean;
		modelReady: boolean;
	}

	let { snapshot, nowMonotonicMs, sessionActive, modelReady }: Props = $props();

	let showBoxes = $state(true);

	const resultAgeSec = $derived.by(() => {
		if (!snapshot) return null;
		const diffMs = Math.max(0, nowMonotonicMs - snapshot.completedAtMonotonicMs);
		return (diffMs / 1000).toFixed(1).replace('.', ',');
	});

	const isStaleResult = $derived.by(() => {
		if (!snapshot) return false;
		return nowMonotonicMs - snapshot.completedAtMonotonicMs >= 3000;
	});

	function formatModeLabel(mode: string): string {
		if (mode === 'real') return 'NYATA';
		if (mode === 'simulated') return 'SIMULASI';
		if (mode === 'manual') return 'MANUAL';
		return mode.toUpperCase();
	}

	function formatObservationLabel(obs: PPEObservation): string {
		const category = obs.type === 'NO_HELMET' ? 'Tanpa Helm' : 'Tanpa Rompi';
		if (obs.state === 'positive') {
			const score = obs.confidence !== null ? ` (${(obs.confidence * 100).toFixed(0)}%)` : '';
			return `Indikasi ${category}${score}`;
		}
		if (obs.state === 'negative') {
			return `APD Terlihat (${obs.type === 'NO_HELMET' ? 'Helm' : 'Rompi'})`;
		}
		return `${category}: Tidak Pasti (Unknown)`;
	}

	function getBoxStyle(bbox: [number, number, number, number]): string {
		const scaled = scaleNormalizedBBox(bbox, 100, 100);
		return `left:${scaled.left.toFixed(2)}%;top:${scaled.top.toFixed(2)}%;width:${scaled.width.toFixed(2)}%;height:${scaled.height.toFixed(2)}%;`;
	}

	function getTrackSummary(track: TrackView): string {
		const pos = track.observations.filter((o) => o.state === 'positive');
		const unk = track.observations.filter((o) => o.state === 'unknown');
		if (pos.length > 0) {
			return pos.map((o) => formatObservationLabel(o)).join(', ');
		}
		if (unk.length > 0) {
			return 'Observasi belum meyakinkan (unknown — bukan bukti pelanggaran maupun jaminan aman)';
		}
		return 'Tidak ada indikasi pelanggaran positif pada frame ini';
	}
</script>

<section class="snapshot-card" aria-labelledby="snapshot-heading">
	<div class="snapshot-header">
		<div>
			<h2 id="snapshot-heading">Snapshot Inferensi Terakhir</h2>
			<p class="snapshot-sub">
				Kotak deteksi digambar hanya pada foto JPEG asli yang diinferensi, terpisah dari video
				live.
			</p>
		</div>

		{#if snapshot}
			<div class="snapshot-controls">
				<label class="toggle-label">
					<input type="checkbox" bind:checked={showBoxes} />
					<span>Tampilkan Overlay BBox</span>
				</label>
			</div>
		{/if}
	</div>

	{#if !snapshot}
		<div class="snapshot-empty" role="status">
			{#if !modelReady}
				<p class="empty-title">Snapshot Inferensi Belum Tersedia (Model Belum Siap)</p>
				<p class="empty-desc">
					Layanan inferensi belum mengembalikan hasil. Kondisi ini bukan status lokasi aman.
				</p>
			{:else if sessionActive}
				<p class="empty-title">Menunggu Respons Inferensi Frame Pertama...</p>
				<p class="empty-desc">
					Sampel JPEG dikirim maksimum 1 frame per detik tanpa antrean frame lama.
				</p>
			{:else}
				<p class="empty-title">Belum Ada Snapshot Inferensi</p>
				<p class="empty-desc">
					Mulai sesi monitoring untuk melihat foto JPEG yang diinferensi beserta koordinat
					bounding box terverifikasi.
				</p>
			{/if}
		</div>
	{:else}
		<div class="snapshot-meta-bar" data-testid="snapshot-meta-bar">
			<span class="meta-chip">
				Sequence: <strong>#{snapshot.sequence}</strong>
			</span>
			<span class="meta-chip" data-stale={isStaleResult}>
				Usia hasil: <strong>{resultAgeSec} dtk</strong>
				{#if isStaleResult}
					<em class="stale-tag">(Hasil Tertunda)</em>
				{/if}
			</span>
			<span class="meta-chip">
				Latensi AI: <strong>{snapshot.inferenceMs} ms</strong>
			</span>
			<span class="meta-chip" data-mode={snapshot.mode}>
				Mode: <strong>{formatModeLabel(snapshot.mode)}</strong>
			</span>
			<span class="meta-chip">
				Model: <strong>{snapshot.modelVersion}</strong> ({snapshot.width}×{snapshot.height})
			</span>
		</div>

		<div
			class="snapshot-stage-wrapper"
			style={`aspect-ratio: ${snapshot.width} / ${snapshot.height};`}
		>
			<div class="snapshot-stage" data-testid="inference-snapshot-stage">
				<img
					src={snapshot.jpegUrl}
					alt={`Snapshot JPEG inferensi sequence ${snapshot.sequence}`}
					width={snapshot.width}
					height={snapshot.height}
					class="snapshot-img"
				/>

				{#if showBoxes}
					<div class="overlay-layer" aria-hidden="true" data-testid="snapshot-overlay-layer">
						{#each snapshot.tracks as track (track.track_key)}
							<div
								class="bbox person-bbox"
								style={getBoxStyle(track.person_bbox)}
								data-track-key={track.track_key}
							>
								<span class="bbox-tag person-tag">
									Track sementara {track.track_key} ({(track.person_confidence * 100).toFixed(0)}%)
								</span>
							</div>

							{#each track.observations as obs, idx (`${track.track_key}-${obs.type}-${idx}`)}
								{#if obs.bbox}
									<div
										class="bbox obs-bbox"
										data-state={obs.state}
										style={getBoxStyle(obs.bbox)}
									>
										<span class="bbox-tag obs-tag" data-state={obs.state}>
											{formatObservationLabel(obs)}
										</span>
									</div>
								{/if}
							{/each}
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="tracks-summary" aria-label="Ringkasan observasi frame">
			<h3>Observasi pada Frame #{snapshot.sequence}</h3>
			{#if snapshot.tracks.length === 0}
				<p class="no-tracks-note">
					Tidak ada objek Person terdeteksi pada frame ini. Hasil kosong bukan jaminan kepatuhan
					K3 menyeluruh.
				</p>
			{:else}
				<ul class="track-list">
					{#each snapshot.tracks as track (track.track_key)}
						<li class="track-item">
							<div class="track-id-group">
								<span class="track-badge">Track sementara {track.track_key}</span>
								<span class="track-conf">
									Skor Person: {(track.person_confidence * 100).toFixed(0)}%
								</span>
							</div>
							<p class="track-obs-text">{getTrackSummary(track)}</p>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="disclaimer-note">
				ID track hanya referensi episode sementara (bukan identitas pekerja). Skor confidence
				adalah keluaran model, bukan bukti pelanggaran final sebelum diverifikasi petugas.
			</p>
		</div>
	{/if}
</section>

<style>
	.snapshot-card {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #dcd7cb);
		border-radius: 10px;
		padding: 1.125rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
	}

	.snapshot-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.snapshot-header h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.snapshot-sub {
		margin: 0.2rem 0 0 0;
		font-size: 0.8125rem;
		color: var(--ink-secondary, #4a453d);
	}

	.toggle-label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.35rem 0.65rem;
		border-radius: 6px;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.snapshot-empty {
		border: 1px dashed var(--border-strong, #c9c3b6);
		border-radius: 8px;
		padding: 1.5rem 1rem;
		background: var(--bg-canvas, #f5f3ee);
	}

	.empty-title {
		margin: 0 0 0.35rem 0;
		font-weight: 700;
		font-size: 0.925rem;
		color: var(--ink-primary, #1c1a17);
	}

	.empty-desc {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink-secondary, #4a453d);
	}

	.snapshot-meta-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.meta-chip {
		font-size: 0.78rem;
		padding: 0.25rem 0.55rem;
		border-radius: 6px;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-default, #dcd7cb);
		color: var(--ink-primary, #1c1a17);
		overflow-wrap: anywhere;
	}

	.meta-chip[data-stale='true'] {
		background: var(--status-warn-bg, #fffbeb);
		border-color: var(--status-warn-border, #fcd34d);
		color: var(--status-warn-ink, #92400e);
	}

	.meta-chip[data-mode='simulated'] {
		background: var(--status-warn-bg, #fffbeb);
		border-color: var(--status-warn-border, #fcd34d);
		color: var(--status-warn-ink, #92400e);
	}

	.stale-tag {
		font-style: normal;
		font-weight: 700;
		margin-left: 0.25rem;
	}

	.snapshot-stage-wrapper {
		width: 100%;
		max-width: 640px;
		background: #141311;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.snapshot-stage {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.snapshot-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: fill;
	}

	.overlay-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.bbox {
		position: absolute;
		border: 2px solid #38bdf8;
		border-radius: 3px;
	}

	.person-bbox {
		border-color: #0284c7;
		background: rgba(2, 132, 199, 0.08);
	}

	.obs-bbox[data-state='positive'] {
		border-color: #dc2626;
		background: rgba(220, 38, 38, 0.14);
	}

	.obs-bbox[data-state='negative'] {
		border-color: #059669;
		background: rgba(5, 150, 105, 0.1);
	}

	.obs-bbox[data-state='unknown'] {
		border-color: #d97706;
		border-style: dashed;
		background: rgba(217, 119, 6, 0.1);
	}

	.bbox-tag {
		position: absolute;
		left: 0;
		top: 0;
		transform: translateY(-100%);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.2;
		padding: 0.15rem 0.35rem;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #ffffff;
		background: #0369a1;
		border-radius: 3px 3px 0 0;
	}

	.obs-tag[data-state='positive'] {
		background: #b91c1c;
	}

	.obs-tag[data-state='negative'] {
		background: #047857;
	}

	.obs-tag[data-state='unknown'] {
		background: #b45309;
	}

	.tracks-summary {
		border-top: 1px solid var(--border-default, #dcd7cb);
		padding-top: 0.75rem;
	}

	.tracks-summary h3 {
		margin: 0 0 0.45rem 0;
		font-size: 0.875rem;
	}

	.no-tracks-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--ink-secondary, #4a453d);
	}

	.track-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.track-item {
		padding: 0.5rem 0.65rem;
		border-radius: 6px;
		background: var(--bg-canvas, #f5f3ee);
		border: 1px solid var(--border-default, #dcd7cb);
	}

	.track-id-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.2rem;
	}

	.track-badge {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.track-conf {
		font-size: 0.75rem;
		color: var(--ink-secondary, #4a453d);
	}

	.track-obs-text {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.disclaimer-note {
		margin: 0.6rem 0 0 0;
		font-size: 0.75rem;
		color: var(--ink-muted, #655e53);
	}

	@media (max-width: 640px) {
		.snapshot-card {
			padding: 0.9rem;
		}

		.toggle-label {
			width: 100%;
		}
	}
</style>
