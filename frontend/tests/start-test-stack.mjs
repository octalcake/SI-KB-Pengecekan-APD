import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(frontendDir, '..', 'backend');

const apiPort = Number(process.env.TEST_API_PORT ?? '18080');
const webPort = Number(process.env.TEST_WEB_PORT ?? '15173');
const testUsername = process.env.TEST_SEED_USERNAME ?? 'petugas';
const testDisplayName = process.env.TEST_SEED_DISPLAY_NAME ?? 'Anisa';
const testPassword = process.env.TEST_SEED_PASSWORD ?? 'K3-Disp0sable-Test-Pass!2026';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-p0-01-'));
const dbPath = path.join(tempRoot, 'k3.sqlite');
const evidenceDir = path.join(tempRoot, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const exeExt = process.platform === 'win32' ? '.exe' : '';
const seedBin = path.join(tempRoot, `seed${exeExt}`);
const apiBin = path.join(tempRoot, `api${exeExt}`);

const migrationSql = fs.readFileSync(
	path.join(backendDir, 'migrations', '001_init.sql'),
	'utf8'
);
const [upSql] = migrationSql.split('-- migrate:down');
const db = new DatabaseSync(dbPath);
db.exec(upSql);
db.close();

const goEnv = {
	...process.env,
	APP_ENV: 'test',
	HTTP_ADDR: `127.0.0.1:${apiPort}`,
	ALLOWED_HOSTS: `localhost:${webPort},localhost:${apiPort},127.0.0.1:${apiPort}`,
	ALLOWED_ORIGINS: `http://localhost:${webPort},http://localhost:${apiPort}`,
	DB_PATH: dbPath,
	EVIDENCE_DIR: evidenceDir,
	AUTH_COOKIE_NAME: 'k3_session',
	AUTH_TTL_HOURS: '8',
	AUTH_COOKIE_SECURE: 'false',
	SEED_USERNAME: testUsername,
	SEED_DISPLAY_NAME: testDisplayName,
	SEED_PASSWORD: testPassword,
	AI_BASE_URL: 'http://127.0.0.1:18000',
	AI_INTERNAL_TOKEN: 'test-internal-token-p0-01-disposable',
	AI_TIMEOUT_MS: '500',
	FRAME_TOTAL_DEADLINE_MS: '1500',
	FRAME_MAX_BYTES: '1048576',
	FRAME_MAX_PIXELS: '1000000',
	FRAME_TARGET_FPS: '1',
	CONFIRM_HITS: '2',
	CONFIRM_MAX_FRAMES: '3',
	CONFIRM_WINDOW_MS: '2000',
	TRACK_TIMEOUT_MS: '5000',
	SESSION_IDLE_TIMEOUT_MS: '15000',
	AI_MODE: 'real',
	ALLOW_MANUAL_FALLBACK: 'false',
	GEMINI_ENABLED: 'false',
	GEMINI_MODEL: 'gemini-3.5-flash-lite',
	GEMINI_API_VERSION: 'v1',
	GEMINI_TIMEOUT_MS: '30000',
	GEMINI_MAX_ATTEMPTS: '2',
	GEMINI_STORE: 'false',
	REPORT_PROMPT_VERSION: 'k3-report-v1',
	DISPLAY_TIMEZONE: 'Asia/Jakarta'
};

execFileSync('go', ['build', '-o', seedBin, './cmd/seed'], {
	cwd: backendDir,
	env: goEnv,
	stdio: 'inherit'
});
execFileSync('go', ['build', '-o', apiBin, './cmd/api'], {
	cwd: backendDir,
	env: goEnv,
	stdio: 'inherit'
});
execFileSync(seedBin, [], {
	cwd: backendDir,
	env: goEnv,
	stdio: 'inherit'
});

const runtimeEnv = { ...goEnv };
delete runtimeEnv.SEED_PASSWORD;

const apiProc = spawn(apiBin, [], {
	cwd: backendDir,
	env: runtimeEnv,
	stdio: 'inherit'
});

const viteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const webProc = spawn(
	process.execPath,
	[viteCli, 'dev', '--host', 'localhost', '--port', String(webPort), '--strictPort'],
	{
		cwd: frontendDir,
		env: {
			...process.env,
			API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`
		},
		stdio: 'inherit'
	}
);

let shuttingDown = false;
function cleanup() {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const proc of [webProc, apiProc]) {
		if (proc && !proc.killed) {
			try {
				proc.kill();
			} catch {
				// ignore
			}
		}
	}
	setTimeout(() => {
		try {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		} catch {
			// ignore
		}
		process.exit(0);
	}, 200);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
	for (const proc of [webProc, apiProc]) {
		if (proc && !proc.killed) {
			try {
				proc.kill();
			} catch {
				// ignore
			}
		}
	}
});

apiProc.on('exit', (code) => {
	if (!shuttingDown && code !== 0) {
		cleanup();
	}
});
webProc.on('exit', (code) => {
	if (!shuttingDown && code !== 0) {
		cleanup();
	}
});
