import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'svelte/compiler';

const normalize = (name) => name.replaceAll('\\', '/');
const browserGlobals = new Set([
	'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'performance',
	'fetch', 'XMLHttpRequest', 'WebSocket', 'MediaStream', 'MediaDevices',
	'HTMLVideoElement', 'HTMLCanvasElement', 'requestAnimationFrame', 'cancelAnimationFrame',
	'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'crypto', 'URL',
	'globalThis', 'self', 'location', 'history'
]);
const browserConstructors = new Set(['Blob', 'File', 'FormData', 'AbortController', 'URLSearchParams']);
const httpGlobals = new Set(['fetch', 'XMLHttpRequest', 'WebSocket']);
const publicContract = (name) => /^features\/[^/]+\/(domain|application)\.ts$/.test(name);

function inType(node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (ts.isTypeNode(parent)) return true;
		if (ts.isStatement(parent)) break;
	}
	return false;
}

function scripts(name, source) {
	if (!name.endsWith('.svelte')) return [source];
	const ast = parse(source, { modern: true });
	return [ast.instance, ast.module].filter(Boolean).map((script) =>
		source.slice(script.content.start, script.content.end));
}

function imports(node) {
	if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
	if (ts.isImportTypeNode(node)) return node.argument.literal;
	if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
		return node.moduleReference.expression;
	}
	if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
		(ts.isIdentifier(node.expression) && node.expression.text === 'require'))) return node.arguments[0];
}

function location(name) {
	const parts = name.split('/');
	return { feature: parts[1], layer: parts[2], shared: parts[0] === 'shared', app: parts[0] === 'app' };
}

// The same resolver and policy run against the repository and synthetic fixture trees.
export function checkArchitecture(inputFiles) {
	const files = new Map([...inputFiles].map(([name, source]) => [normalize(name), source]));
	const failures = [];
	const edges = new Map();
	const runtime = new Set();
	const add = (file, reason) => failures.push(`${file}: ${reason}`);
	const resolve = (file, specifier) => {
		let target;
		if (specifier.startsWith('#lib/')) target = specifier.slice(5);
		else if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
		else return null;
		return [target, `${target}.ts`, `${target}.js`, `${target}/index.ts`, target.replace(/\.js$/, '.ts')]
			.find((candidate) => files.has(candidate)) ?? target;
	};
	for (const [name, source] of files) {
		edges.set(name, []);
		const here = location(name);
		const inner = name.startsWith('features/') && (['domain', 'application'].includes(here.layer) || publicContract(name));
		for (const script of scripts(name, source)) {
			const ast = ts.createSourceFile(name + '.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			function visit(node) {
				const specifier = imports(node);
				if (specifier) {
					if (!ts.isStringLiteralLike(specifier)) add(name, 'nonliteral module dependency cannot be checked');
					else {
						const spec = specifier.text;
						const target = resolve(name, spec);
						if (target) {
							edges.get(name).push(target);
							const there = location(target);
							if (!files.has(target)) add(name, `unresolved dependency ${spec}`);
							if (here.shared && (target.startsWith('features/') || there.app)) add(name, `shared imports ${target}`);
							if (name.startsWith('features/') && target.startsWith('features/') && here.feature !== there.feature &&
								!/^features\/[^/]+\/(domain|application)\.ts$/.test(target)) add(name, `foreign private dependency ${target}`);
							if (inner && (there.app || ['infrastructure', 'presentation'].includes(there.layer) || target.startsWith('shared/http/'))) add(name, `outward dependency ${target}`);
							if (inner && here.layer === 'domain' && (there.layer === 'application' || target.endsWith('/application.ts'))) add(name, `domain imports application ${target}`);
							if (here.layer === 'presentation' && (there.layer === 'infrastructure' || target.startsWith('shared/http/'))) add(name, `presentation imports transport ${target}`);
							if (/^features\/[^/]+\/(domain|application)\.ts$/.test(name) &&
								(!['domain', ...(name.endsWith('/application.ts') ? ['application'] : [])].includes(there.layer) || here.feature !== there.feature)) add(name, `public contract exports non-inner dependency ${target}`);
						} else {
							runtime.add(name);
							if (inner) add(name, `external dependency ${spec}`);
						}
					}
				}
				if (ts.isIdentifier(node) && browserGlobals.has(node.text)) {
					// Property names are allowed; using browser objects through globalThis is not.
					const access = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
					const property = access || ((ts.isPropertySignature(node.parent) || ts.isPropertyAssignment(node.parent) ||
						ts.isPropertyDeclaration(node.parent) || ts.isMethodSignature(node.parent)) && node.parent.name === node);
					const qualifiedGlobal = access && ['globalThis', 'window', 'self'].includes(node.parent.expression.getText(ast));
					if (inner && (!property || qualifiedGlobal)) add(name, `forbidden browser/runtime dependency ${node.text}`);
					if (!property || qualifiedGlobal) runtime.add(name);
					if (here.layer === 'presentation' && httpGlobals.has(node.text) && (!property || qualifiedGlobal)) add(name, `presentation calls ${node.text}`);
				}
				if (ts.isIdentifier(node) && browserConstructors.has(node.text) && !inType(node)) {
					runtime.add(name);
					if (inner) add(name, `forbidden browser/runtime constructor ${node.text}`);
				}
				if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) &&
					browserGlobals.has(node.argumentExpression.text) && ['globalThis', 'window', 'self'].includes(node.expression.getText(ast))) {
					runtime.add(name);
					if (inner) add(name, `forbidden browser/runtime dependency ${node.argumentExpression.text}`);
					if (here.layer === 'presentation' && httpGlobals.has(node.argumentExpression.text)) add(name, `presentation calls ${node.argumentExpression.text}`);
				}
				ts.forEachChild(node, visit);
			}
			visit(ast);
		}
	}
	// Pure shared helpers and public contracts cannot hide an outward dependency.
	for (const name of files.keys()) {
		const here = location(name);
		if (!name.startsWith('features/') || (!['domain', 'application'].includes(here.layer) && !publicContract(name))) continue;
		const seen = new Set([name]);
		function walk(current) {
			for (const target of edges.get(current) ?? []) {
				if (seen.has(target)) continue;
				seen.add(target);
				const there = location(target);
				if (runtime.has(target) || there.app || ['presentation', 'infrastructure'].includes(there.layer) || target.startsWith('shared/http/')) add(name, `transitive outward dependency ${target}`);
				walk(target);
			}
		}
		walk(name);
	}
	return [...new Set(failures)];
}

export function readTree(directory, prefix = '') {
	const files = new Map();
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const name = `${prefix}${entry.name}`;
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) for (const item of readTree(full, `${name}/`)) files.set(...item);
		else if (/\.(ts|js|svelte)$/.test(name)) files.set(name, fs.readFileSync(full, 'utf8'));
	}
	return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const files = readTree(fileURLToPath(new URL('../src/lib', import.meta.url)));
	const errors = checkArchitecture(files);
	if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
	else console.log(`Architecture: ${files.size} source files checked`);
}
