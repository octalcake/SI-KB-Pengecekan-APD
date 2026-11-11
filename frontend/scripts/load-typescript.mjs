import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const lib = fileURLToPath(new URL('../src/lib/', import.meta.url));
const cache = new Map();

// Execute the real application modules with Node, resolving the app's #lib alias
// and extensionless TS imports without a second build or test dependency.
export function loadTypescript(name) {
	function compile(filename) {
		filename = path.resolve(filename);
		if (cache.has(filename)) return cache.get(filename);
		const source = fs.readFileSync(filename, 'utf8');
		const result = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
			fileName: filename,
			transformers: { after: [(context) => (ast) => {
				function visit(node) {
					if (ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) {
						const target = node.text.startsWith('#lib/') ? path.join(lib, node.text.slice(5)) : path.resolve(path.dirname(filename), node.text);
						return ts.factory.createStringLiteral(compile(target.endsWith('.ts') ? target : `${target}.ts`));
					}
					return ts.visitEachChild(node, visit, context);
				}
				return ts.visitNode(ast, visit);
			}] }
		});
		const url = `data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`;
		cache.set(filename, url);
		return url;
	}
	return import(compile(path.join(lib, name)));
}
