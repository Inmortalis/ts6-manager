import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const pageName of ['video', 'iptv'] as const) {
  test(`${pageName} replaces only the stream named in the confirmation`, async ({ page, request }) => {
    await request.post('/__test/reset');
    await request.post('/__test/auth?on');
    await request.post('/__test/docs?on');
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL('/dashboard');

    const bodies: Record<string, unknown>[] = [];
    const endpoint = pageName === 'video' ? '**/api/music-bots/7/stream/start' : '**/api/iptv/stream';
    await page.route(endpoint, async route => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      if (body.replaceSessionId === 'current') {
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ status: 409, json: {
          error: 'Another video session is active', reason: 'video_session_conflict',
          activeSession: { id: 'current', botId: 8, botName: 'Cinema' },
        } });
      }
    });

    let start;
    if (pageName === 'video') {
      await page.route('**/api/music-bots/7/stream/status', route => route.fulfill({ json: { streaming: false } }));
      await page.goto('/music-bots');
      await page.getByRole('tab', { name: 'Video', exact: true }).click();
      await page.getByPlaceholder('https://youtube.com/watch?v=... or direct video URL').fill('https://example.test/movie.mp4');
      start = page.getByRole('button', { name: 'Start Stream' });
    } else {
      await page.goto('/iptv');
      start = page.getByRole('button', { name: 'Stream Community News', exact: true });
    }

    await start.click();
    const dialog = page.getByRole('dialog', { name: 'Replace the active video stream?' });
    await expect(dialog).toContainText('Cinema (#8)');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(bodies).toHaveLength(1);

    await start.click();
    await dialog.getByRole('button', { name: 'Replace stream' }).click();
    await expect.poll(() => bodies.length).toBe(3);
    expect(bodies[0]).not.toHaveProperty('replaceSessionId');
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual({ ...bodies[0], replaceSessionId: 'current' });
    await expect(dialog).toBeHidden();
  });
}
