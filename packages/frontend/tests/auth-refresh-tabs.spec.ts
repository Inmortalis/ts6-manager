import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function accessToken(revision: number): string {
  const payload = { id: 1, exp: Math.floor(Date.now() / 1000) + 3600, revision };
  return `test.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test`;
}

test('two tabs retry their protected requests with one rotated session', async ({ page, context, request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/auth?on&role=admin');
  const previous = accessToken(1);
  const next = accessToken(2);
  const user = { id: 1, username: 'admin', displayName: 'Administrator', role: 'admin' };
  await context.route('**/api/auth/login', (route) => route.fulfill({
    json: { user, accessToken: previous, refreshToken: 'original-refresh' },
  }));
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText(user.displayName, { exact: true })).toBeVisible();

  const peer = await context.newPage();
  const waiting = new Set<Page>();
  let release!: () => void;
  const bothRequested = new Promise<void>((resolve) => { release = resolve; });
  await context.route('**/api/auth/me', async (route) => {
    const bearer = route.request().headers().authorization;
    if (bearer === `Bearer ${previous}`) {
      // Neither tab may begin rotation before both have presented the original credential.
      waiting.add(route.request().frame().page());
      if (waiting.size === 2) release();
      await bothRequested;
      await route.fulfill({ status: 401, json: { error: 'Access token expired' } });
      return;
    }
    expect(bearer).toBe(`Bearer ${next}`);
    await route.fulfill({ json: { user: { ...user, displayName: 'Session refreshed' } } });
  });

  const presentations: string[] = [];
  await context.route('**/api/auth/refresh', async (route) => {
    const { refreshToken } = route.request().postDataJSON();
    presentations.push(refreshToken);
    if (presentations.length === 1 && refreshToken === 'original-refresh') {
      await route.fulfill({ json: { accessToken: next, refreshToken: 'rotated-refresh' } });
    } else {
      await route.fulfill({ status: 401, json: { error: 'Refresh token already rotated' } });
    }
  });

  await Promise.all([page.reload(), peer.goto('/dashboard')]);
  for (const tab of [page, peer]) {
    await expect(tab.getByText('Session refreshed', { exact: true })).toBeVisible();
  }
  expect(presentations).toEqual(['original-refresh']);
});
