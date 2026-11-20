import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWithTakeover } from '../../src/lib/stream-takeover';

function conflict(id?: string) {
  return { response: { status: 409, data: {
    reason: 'video_session_conflict',
    activeSession: id ? { id, botId: 4, botName: 'Cinema' } : undefined,
  } } };
}

test('a changed occupant requires a new confirmation before any replacement', async () => {
  const requests: Array<string | undefined> = [];
  const prompts: string[] = [];
  const started = await startWithTakeover(async id => {
    requests.push(id);
    if (!id) throw conflict('first');
    if (id === 'first') throw conflict('second');
  }, async session => { prompts.push(session.id); return true; }, new AbortController().signal);
  assert.equal(started, true);
  assert.deepEqual(requests, [undefined, 'first', 'second']);
  assert.deepEqual(prompts, ['first', 'second']);
});

test('cancelling, changing selection, or a busy sidecar never retries the start', async () => {
  for (const reason of ['dismiss', 'selection change', 'busy']) {
    let requests = 0;
    let prompts = 0;
    const controller = new AbortController();
    const busy = conflict();
    const result = startWithTakeover(async () => {
      requests++;
      throw reason === 'busy' ? busy : conflict('first');
    }, async () => {
      prompts++;
      if (reason === 'selection change') controller.abort();
      return reason !== 'dismiss';
    }, controller.signal);
    if (reason === 'busy') await assert.rejects(result, e => e === busy);
    else assert.equal(await result, false);
    assert.equal(requests, 1);
    assert.equal(prompts, reason === 'busy' ? 0 : 1);
  }
});
