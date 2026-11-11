<script lang="ts">
	import { page } from '$app/state';
	import FindingDetailPage from '#lib/features/findings/presentation/FindingDetailPage.svelte';

	const findingId = $derived(Number.parseInt(page.params.id ?? '', 10));
</script>

<svelte:head>
	<title>Detail Temuan #{page.params.id ?? ''} — Inspeksi K3</title>
</svelte:head>

<FindingDetailPage {findingId} />
