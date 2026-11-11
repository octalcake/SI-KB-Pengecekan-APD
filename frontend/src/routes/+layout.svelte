<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--bg-canvas: #f5f3ee;
		--bg-surface: #ffffff;
		--bg-subtle: #ece9e1;
		--border-strong: #c9c3b6;
		--border-default: #dcd7cb;
		--ink-primary: #1c1a17;
		--ink-secondary: #4a453d;
		--ink-muted: #655e53;
		--accent-primary: #9a3412;
		--accent-hover: #7c2d12;
		--accent-surface: #ffedd5;
		--accent-border: #fdba74;
		--status-ok-bg: #ecfdf5;
		--status-ok-ink: #065f46;
		--status-ok-border: #6ee7b7;
		--status-warn-bg: #fffbeb;
		--status-warn-ink: #92400e;
		--status-warn-border: #fcd34d;
		--status-err-bg: #fef2f2;
		--status-err-ink: #991b1b;
		--status-err-border: #fca5a5;
		--focus-ring: #b45309;
		color-scheme: light;
	}

	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(html) {
		font-family:
			'Segoe UI',
			-apple-system,
			BlinkMacSystemFont,
			Roboto,
			'Helvetica Neue',
			Arial,
			sans-serif;
		font-size: 16px;
		line-height: 1.5;
		color: var(--ink-primary);
		background-color: var(--bg-canvas);
		caret-color: var(--accent-primary);
		scrollbar-color: var(--border-strong) var(--bg-canvas);
		-webkit-font-smoothing: antialiased;
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		background-color: var(--bg-canvas);
		color: var(--ink-primary);
	}

	:global(::selection) {
		background-color: var(--accent-surface);
		color: var(--ink-primary);
	}

	:global(:focus-visible) {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}

	:global(a) {
		color: var(--accent-primary);
		text-underline-offset: 0.2em;
	}

	:global(h1),
	:global(h2),
	:global(h3) {
		letter-spacing: -0.025em;
		text-wrap: balance;
		line-height: 1.25;
		color: var(--ink-primary);
	}

	:global(p) {
		max-width: 70ch;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font: inherit;
		color: inherit;
		max-width: 100%;
	}

	:global(img),
	:global(video) {
		max-width: 100%;
		height: auto;
	}

	@media (max-width: 768px), (pointer: coarse) {
		:global(input:not([type='checkbox']):not([type='radio']):not([type='hidden'])),
		:global(select),
		:global(textarea) {
			font-size: 1rem !important;
			min-height: 2.75rem;
		}

		:global(button),
		:global(.nav-link) {
			min-height: 2.75rem;
		}

		:global(.open-detail-link),
		:global(.action-link),
		:global(.secondary-link) {
			min-height: 2.75rem;
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}
	}
</style>
