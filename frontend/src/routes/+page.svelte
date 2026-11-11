<script lang="ts">
	import { onMount } from 'svelte';

	let status = $state('memeriksa...');

	onMount(async () => {
		try {
			const res = await fetch('/api/v1/health', { credentials: 'same-origin' });
			status = (await res.json()).data?.status ?? `HTTP ${res.status}`;
		} catch {
			status = 'backend tidak terjangkau';
		}
	});
</script>

<h1>Sistem Inspeksi K3 Konstruksi</h1>
<p>Status backend: <strong>{status}</strong></p>
