import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArchitecture } from './check-architecture.mjs';

const check = (entries) => checkArchitecture(new Map(Object.entries(entries)));
test('allows inward dependencies and intentional public domain/application contracts', () => {
	assert.deepEqual(check({
		'features/a/application/work.ts': "import type { Model } from '#lib/features/b/domain';",
		'features/b/domain.ts': "export type { Model } from './domain/model';",
		'features/b/domain/model.ts': 'export type Model = number;'
	}), []);
});
test('rejects outward static imports, exports, dynamic imports, require and import types', () => {
	for (const syntax of [
		"import { x } from '../infrastructure/http';", "export * from '../infrastructure/http';",
		"const x = import( '../infrastructure/http' );", "const x = require('../infrastructure/http');",
		"type X = import('../infrastructure/http').X;", "import x = require('../infrastructure/http');"
	]) assert.match(check({ 'features/a/application/work.ts': syntax, 'features/a/infrastructure/http.ts': 'export const x = 1;' }).join(), /outward/);
});
test('resolves relative cross-feature private access and catches UI-bearing barrels', () => {
	assert.match(check({ 'features/a/application/work.ts': "import '../../b/application/private';", 'features/b/application/private.ts': '' }).join(), /foreign private/);
	assert.match(check({ 'features/b/domain.ts': "export * from './presentation/view';", 'features/b/presentation/view.ts': '' }).join(), /public contract/);
});
test('forbids frameworks, browser runtime, HTTP and shared-to-feature imports', () => {
	for (const source of ["import { onMount } from 'svelte';", "import { page } from '$app/state';", 'navigator.mediaDevices;', 'globalThis.fetch("/api/v1");', 'URL.createObjectURL(blob);']) {
		assert.notEqual(check({ 'features/a/application/work.ts': source }).length, 0);
	}
	assert.match(check({ 'shared/helper.ts': "export * from '../features/a/domain';", 'features/a/domain.ts': '' }).join(), /shared imports/);
	assert.match(check({ 'features/a/presentation/view.svelte': '<script lang="ts">import { apiData } from "#lib/shared/http/client";</script>', 'shared/http/client.ts': '' }).join(), /presentation imports transport/);
});
test('does not inspect comments/strings as dependencies, and rejects computed dynamic imports', () => {
	assert.deepEqual(check({ 'features/a/domain/model.ts': '// import x from "svelte"\nconst text = "navigator.fetch";' }), []);
	assert.match(check({ 'features/a/application/work.ts': 'import(target);' }).join(), /nonliteral/);
});
test('rejects transitive outward dependencies and computed browser access', () => {
	assert.match(check({
		'features/a/application/work.ts': "import '#lib/shared/helper';",
		'shared/helper.ts': "export * from './http/client';", 'shared/http/client.ts': ''
	}).join(), /transitive outward/);
	assert.match(check({ 'features/a/domain/model.ts': 'globalThis["fetch"]("/api/v1");' }).join(), /forbidden browser/);
	assert.match(check({ 'features/a/application/work.ts': 'const browser = globalThis; browser.fetch("/api/v1");' }).join(), /forbidden browser/);
	assert.match(check({ 'features/a/application/work.ts': 'new AbortController();' }).join(), /constructor/);
	assert.deepEqual(check({ 'features/a/application/work.ts': 'interface Input { signal: AbortSignal; jpeg: Blob; }' }), []);
	assert.deepEqual(check({ 'features/a/domain/model.ts': 'interface Project { location: string; } const project = { location: "Site" }; project.location;' }), []);
	assert.match(check({ 'features/a/domain.ts': 'export type { Component } from "svelte";' }).join(), /external dependency/);
	assert.match(check({ 'features/a/presentation/view.ts': 'globalThis["fetch"]("/api/v1");' }).join(), /presentation calls/);
});
