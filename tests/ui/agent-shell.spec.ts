import { expect, test, type Page } from '@playwright/test';

const bootstrap = {
  ok: true,
  fetched_at: Date.now(),
  me: {
    user: { id: 'usr_test', name: 'Sam Primeaux', email: 'sam@example.com', avatar_url: null },
    workspace: { id: 'ws_test', name: 'AgentSamRemix', slug: 'agentsamremix' },
    capabilities: { canRunPty: true, canRunMcp: true, canDeploy: false },
  },
  identity: {
    workspace_id: 'ws_test',
    tenant_id: 'tenant_test',
    github_repo: 'SamPrimeaux/AgentSamRemix',
    capabilities: { canRunPty: true, canRunMcp: true, canDeploy: false },
  },
  workspaces: {
    data: [{ id: 'ws_test', name: 'AgentSamRemix', slug: 'agentsamremix', github_repo: 'SamPrimeaux/AgentSamRemix' }],
    current: 'ws_test',
  },
  status: {
    health: { status: 'ok' },
    sandbox: { ok: true },
    git: { branch: 'feat/ui-ux-transplant-from-inneranimalmedia', repo_full_name: 'SamPrimeaux/AgentSamRemix' },
    terminal: { ready: true, lane: 'local', status: 'ready', can_run_pty: true },
  },
  feature_flags: {},
};

async function mockAuthenticatedShell(page: Page) {
  await page.route(new RegExp('^https?://[^/]+/api/dashboard/bootstrap'), (route) => route.fulfill({ json: bootstrap }));
  await page.route(new RegExp('^https?://[^/]+/api/auth/me'), (route) => route.fulfill({ json: bootstrap.me }));
  await page.route(new RegExp('^https?://[^/]+/api/agent/scene'), (route) => route.fulfill({ json: { ok: true } }));
  await page.route(new RegExp('^https?://[^/]+/api/'), (route) =>
    route.fulfill({ json: { ok: true, data: [], sessions: [], projects: [], workspaces: [] } }),
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedShell(page);
});

test('calm Agent home keeps the real composer inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-393', 'desktop calm-chat contract');
  await page.goto('/dashboard/agent');
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Quick modes' })).toBeVisible();
  await expect(page.locator('.iam-chat-composer-shell')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const composer = await page.locator('.iam-chat-composer-shell').boundingBox();
  expect(composer).not.toBeNull();
  expect(composer!.x).toBeGreaterThanOrEqual(0);
  expect(composer!.x + composer!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width + 1);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(testInfo.project.use.viewport!.height + 1);
});

test('desktop editor exposes the full terminal chrome and plus menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone-393', 'desktop IDE contract');
  await page.goto('/dashboard/agent/editor');
  await expect(page.locator('.iam-chrome-sidebar')).toBeVisible();
  await page.waitForTimeout(750);
  await page.getByTitle('Terminal (Cmd+J)').first().click();

  const terminalChrome = page.locator('.iam-terminal-chrome-row');
  await expect(terminalChrome).toBeVisible();
  await expect(terminalChrome.getByRole('button', { name: /terminal/i }).first()).toBeVisible();
  await expect(terminalChrome.getByRole('button', { name: /output/i })).toBeVisible();
  await expect(terminalChrome.getByRole('button', { name: /problems/i })).toBeVisible();

  await page.getByTitle('Terminal menu (shell, split, settings)').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Local/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('iPhone uses the dedicated mobile navigation and bounded terminal sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-393', 'mobile-only interaction contract');
  await page.goto('/dashboard/agent');

  const navButton = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(navButton).toBeVisible();
  await navButton.click();
  const closeNav = page.locator('.iam-mobile-nav-hamburger[aria-label="Close navigation menu"]');
  await expect(closeNav).toBeVisible();
  await closeNav.click();

  await page.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminalChrome = page.locator('.iam-terminal-chrome-row');
  await expect(terminalChrome).toBeVisible();
  await expect(terminalChrome.getByRole('button', { name: /output/i })).toBeVisible();
  await expect(terminalChrome.getByRole('button', { name: /problems/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const box = await terminalChrome.locator('..').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width + 1);
});
