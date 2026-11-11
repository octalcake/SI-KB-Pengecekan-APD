import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.TEST_WEB_PORT ?? '15173');

export default defineConfig({
	testDir: './tests',
	timeout: 30_000,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	use: {
		baseURL: `http://localhost:${webPort}`,
		headless: true,
		viewport: { width: 1280, height: 800 }
	},
	webServer: {
		command: 'node ./tests/start-test-stack.mjs',
		url: `http://localhost:${webPort}/api/v1/health`,
		timeout: 60_000,
		reuseExistingServer: false
	}
});
