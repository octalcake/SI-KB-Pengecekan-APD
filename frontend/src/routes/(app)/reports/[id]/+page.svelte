<script lang="ts">
	import { page } from '$app/state';
	import ReportDetailPage from '#lib/features/reports/presentation/ReportDetailPage.svelte';

	const reportId = $derived(Number.parseInt(page.params.id ?? '', 10));
</script>

<svelte:head>
	<title>Detail Laporan #{page.params.id ?? ''} — Inspeksi K3</title>
</svelte:head>

<ReportDetailPage {reportId} />
