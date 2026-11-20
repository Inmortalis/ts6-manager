import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { VoiceBot } from './voice-bot.js';
import { SidecarClient } from './streaming/sidecar-client.js';
import type { QueueItem } from './playlist/queue.js';
import { musicBotRoutes } from '../routes/music-bots.routes.js';

function bot(id = 1): VoiceBot {
  return new VoiceBot({ id, name: `Bot ${id}`, serverConfigId: id, nickname: 'Music', serverHost: 'localhost',
    serverPort: 9987, volume: 50, autoStopEmptySeconds: 0 });
}

test('queue controls leave stopped, starting and failed bots available for a real connection', () => {
  const player = bot();
  for (const status of ['stopped', 'starting', 'error']) {
    (player as any)._status = status;
    assert.throws(() => player.skip(), /not connected/);
    assert.throws(() => player.previous(), /not connected/);
    assert.equal(player.status, status);
  }
});

test('seek waits for the decoder and routes a failure after restoring idle playback state', async () => {
  const player = bot();
  const internals = player as any;
  internals._status = 'playing';
  internals._fileStreamActive = true;
  internals._nowPlaying = { id: 'old', filePath: 'old.ogg', duration: 120 };
  internals.fileInput = 'old.ogg';
  let rejectOpen!: (err: Error) => void;
  internals.pipeline.toPcmFileStream = () => new Promise((_resolve, reject) => { rejectOpen = reject; });

  const handler = (musicBotRoutes as any).stack.find((entry: any) => entry.route?.path === '/:id/seek').route.stack[0].handle;
  let response: unknown;
  let error: unknown;
  const complete = handler(
    { app: { locals: { voiceBotManager: { getBot: () => player } } }, params: { id: '1' }, body: { seconds: 50 } },
    { json: (result: unknown) => { response = result; } },
    (err: unknown) => { error = err; },
  );
  assert.equal(response, undefined);
  const failure = new Error('decoder could not be opened');
  rejectOpen(failure);
  await complete;
  assert.equal(error, failure);
  assert.equal(response, undefined);
  assert.equal(player.status, 'connected');
  assert.equal(player.nowPlaying, null);
  assert.equal(player.canSeek, false);
});

test('finite YouTube streams use the queue clock and honor track repeat followed by next', async (t) => {
  const player = bot();
  const internal = player as any;
  internal._status = 'connected';
  const direct = 'https://media.example/audio';
  const mockSpawn = t.mock.method(childProcess, 'spawn', () => {
    const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    queueMicrotask(() => {
      process.stdout.end(JSON.stringify({ id: 'abcdefghijk', title: 'Test', duration: 25, url: direct }));
      process.emit('close', 0);
    });
    return process as any;
  });
  syncBuiltinESMExports();
  t.after(() => { mockSpawn.mock.restore(); syncBuiltinESMExports(); player.clearPlayback(); });

  const inputs: string[] = [];
  let decoder: EventEmitter;
  internal.pipeline.toPcmFileStream = async (input: string) => {
    inputs.push(input);
    decoder = new EventEmitter();
    return { stdout: new PassThrough(), process: decoder, kill() {} };
  };
  const first: QueueItem = { id: '1', source: 'youtube', title: 'One', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', filePath: '' };
  const next: QueueItem = { id: '2', source: 'local', title: 'Two', filePath: 'two.ogg' };
  internal.ensurePlayableFile = async (item: QueueItem) => item.filePath;
  player.queue.addMany([first, next]);
  player.queue.playAt(0);
  player.queue.setRepeat('track');
  await player.play(first);
  assert.equal(player.canSeek, true);
  assert.equal(player.isStreaming, false);
  const endTrack = async () => {
    clearTimeout(internal.playbackTimer);
    decoder!.emit('close', 0);
    internal.fileNextDue = 0;
    internal.fileTick();
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  await endTrack();
  assert.equal(player.nowPlaying, first);
  assert.deepEqual(inputs, [direct, direct]);
  player.queue.setRepeat('off');
  await endTrack();
  assert.equal(player.nowPlaying, next);
  assert.equal(player.queue.current, next);
  assert.deepEqual(inputs, [direct, direct, 'two.ogg']);
});

test('a shared video endpoint rejects parallel starts, draining source changes before a new owner', async (t) => {
  const saved = process.env.SIDECAR_URL;
  process.env.SIDECAR_URL = 'http://test-sidecar:9800';
  t.after(() => {
    if (saved == null) delete process.env.SIDECAR_URL;
    else process.env.SIDECAR_URL = saved;
  });
  const a = bot(1), b = bot(2);
  for (const [i, player] of [a, b].entries()) {
    const internal = player as any;
    internal._status = 'connected';
    internal.client.getClientId = () => i + 1;
    internal.client.sendCommand = (command: string) => {
      if (command.startsWith('setupstream ')) {
        internal.client.emit('command', { name: 'notifystreamstarted', params: { clid: String(i + 1), id: 'video' } });
      }
    };
    internal.resolveStreamSource = async (path: string) => ({ path, loop: true });
  }
  const sources: string[] = [];
  let finishChange!: () => void;
  let beginChange!: () => void;
  const changeStarted = new Promise<void>(resolve => { beginChange = resolve; });
  t.mock.method(SidecarClient.prototype, 'waitHealthy', async () => {});
  t.mock.method(SidecarClient.prototype, 'setSource', async (source: string) => {
    if (source === 'new') {
      beginChange();
      await new Promise<void>(resolve => { finishChange = resolve; });
    }
    sources.push(source);
  });
  t.mock.method(SidecarClient.prototype, 'stopSource', async () => { sources.push('stop'); });
  t.mock.method(SidecarClient.prototype, 'closePeer', async () => {});
  const starting = a.startVideoStream('first');
  await assert.rejects(b.startVideoStream('other'), { statusCode: 409 });
  await starting;
  await assert.rejects(b.startVideoStream('other'), { statusCode: 409 });
  const change = a.setVideoSource('new');
  await changeStarted;
  const stopping = a.stopVideoStream();
  await assert.rejects(b.startVideoStream('other'), { statusCode: 409 });
  finishChange();
  await Promise.all([change, stopping]);
  await b.startVideoStream('other');
  await b.stopVideoStream();
  assert.deepEqual(sources, ['first', 'new', 'stop', 'other', 'stop']);

  t.mock.method(SidecarClient.prototype, 'waitHealthy', async () => { throw new Error('unavailable'); }, { times: 1 });
  await assert.rejects(a.startVideoStream('bad'), /unavailable/);
  await b.startVideoStream('retry');

  const takeover = (target: VoiceBot, source: string, id?: string) =>
    target.startVideoStream(source, undefined, undefined, undefined, undefined, id);
  let oldSession = '';
  await assert.rejects(a.startVideoStream('unconfirmed'), (error: any) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.activeSession.botId, b.id);
    oldSession = error.activeSession.id;
    return true;
  });
  assert.ok(oldSession);
  const failure = t.mock.method(SidecarClient.prototype, 'stopSource', async () => { throw new Error('unreachable'); });
  await assert.rejects(takeover(a, 'failed-handover', oldSession), { statusCode: 502 });
  failure.mock.restore();
  assert.equal(b.videoStreaming, true);
  await assert.rejects(a.startVideoStream('unconfirmed'), (err: any) => err.activeSession.id === oldSession);
  const switching = takeover(a, 'confirmed', oldSession);
  await assert.rejects(takeover(b, 'competing', oldSession), (err: any) => err.statusCode === 409 && !err.activeSession);
  await switching;
  assert.equal(b.videoStreaming, false);
  assert.equal(a.videoStreamStatus.source, 'confirmed');
  let currentSession = '';
  await assert.rejects(takeover(b, 'stale', oldSession), (err: any) => {
    currentSession = err.activeSession.id;
    return err.statusCode === 409 && currentSession !== oldSession && err.activeSession.botId === a.id;
  });
  assert.equal(a.videoStreamStatus.source, 'confirmed');
  await takeover(a, 'same-owner', currentSession);
  assert.equal(a.videoStreamStatus.source, 'same-owner');
  await a.stopVideoStream();
  await assert.rejects(takeover(b, 'expired', oldSession), (err: any) => err.statusCode === 409 && !err.activeSession);
  assert.ok(!sources.includes('stale') && !sources.includes('expired') && !sources.includes('competing'));
});
