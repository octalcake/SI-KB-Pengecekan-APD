<script lang="ts">
	let { name, size = 20 }: { name: string; size?: number } = $props();
	const paths: Record<string, string> = {
		dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
		projects: 'M3 21h18 M5 21V5l9-2v18 M14 9h5v12 M8 7h3 M8 11h3 M8 15h3 M8 19h3',
		camera:
			'M14 8l7-4v16l-7-4 M3 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
		findings:
			'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4 M9 3v4h8V3H9z M8 12h5 M8 16h3 M16 12l2 2 4-4',
		reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
		arrow: 'M5 12h14 M13 6l6 6-6 6',
		chevron: 'M9 5l7 7-7 7',
		plus: 'M12 5v14 M5 12h14',
		refresh: 'M20 7v5h-5 M4 17v-5h5 M6.1 6.1A8 8 0 0 1 19.4 9 M4.6 15a8 8 0 0 0 13.3 2.9',
		logout: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4 M14 8l4 4-4 4 M8 12h13',
		shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
		filter: 'M4 6h16 M7 12h10 M10 18h4 M8 4v4 M16 10v4 M12 16v4',
		info: 'M12 8h.01 M12 11v6 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
		check: 'M5 12l4 4L19 6',
		clock: 'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
		image:
			'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M3 16l6-6 6 6 3-3 3 3 M16 7h.01'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.65"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={paths[name] ?? paths.info} />
</svg>
