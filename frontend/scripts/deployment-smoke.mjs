import { chromium } from '@playwright/test';

const origin = 'https://sibk.hailmary.my.id';
const revision = process.env.REVISION;
if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw new Error('REVISION must be a full commit SHA');

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const deadline = Date.now() + 5 * 60_000;
	let active = false;
	while (Date.now() < deadline) {
		const response = await page.request.get(`${origin}/deployment.json?check=${Date.now()}`);
		if (response.ok() && (await response.json()).revision === revision) {
			active = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}
	if (!active) throw new Error('Host did not activate the published revision within five minutes');
	for (const route of ['/', '/login']) {
		await page.goto(`${origin}${route}`);
		await page.waitForURL('**/login');
		await page.getByRole('button', { name: 'Masuk', exact: true }).waitFor();
		await page.waitForTimeout(8_000);
		if (!(await page.locator('form.login-form').isVisible())) {
			throw new Error(`Login disappeared after hydration from ${route}`);
		}
		const developmentResources = await page.evaluate(() => performance.getEntriesByType('resource')
			.map((resource) => resource.name)
			.filter((url) => /\/@vite\/client|\/src\/|\/generated\/dev\//.test(url)));
		if (developmentResources.length) throw new Error('Host is serving development client resources');
		if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
	}
	console.log(`Public login remained visible after hydration; compiled release ${revision}`);
} finally {
	await browser.close();
}
