import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
	{ ignores: ['.svelte-kit/**', 'build/**', 'test-results/**', 'playwright-report/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.base,
	{ languageOptions: { globals: { ...globals.browser, ...globals.node } } },
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: { parserOptions: { parser: ts.parser, svelteFeatures: { runes: true } } },
		rules: {
			'svelte/no-at-html-tags': 'error',
			'svelte/no-dupe-else-if-blocks': 'error',
			'svelte/no-dupe-on-directives': 'error',
			'svelte/no-not-function-handler': 'error',
			'svelte/no-store-async': 'error',
			'svelte/require-each-key': 'error',
			'svelte/valid-each-key': 'error'
		}
	}
);
