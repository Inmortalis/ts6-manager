import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PrismaClient } from '../../generated/prisma/index.js';
import { ExecutionContext } from './context.js';

test('concurrent runs keep every increment and append, including on first use', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ts6-flow-vars-'));
  const file = path.join(dir, 'test.db');
  const options = { datasourceUrl: 'file:' + file.replaceAll('\\', '/') };
  const db = new PrismaClient(options);
  const peer = new PrismaClient(options);
  try {
    await db.$executeRaw`CREATE TABLE BotVariable (
      id INTEGER PRIMARY KEY, flowId INTEGER NOT NULL, name TEXT NOT NULL,
      scope TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (flowId, name, scope)
    )`;
    const runs = Array.from({ length: 12 }, (_, i) => new ExecutionContext(i % 2 === 0 ? db : peer, 1, i, 1, 1, 'event', {}));
    const first = runs[0];
    await Promise.all(runs.map(run => run.incrementVariable('counter', '0.5')));
    assert.equal(await first.getVariable('counter'), '6');
    await Promise.all(runs.map(run => run.incrementVariable('counter', '1')));
    assert.equal(await first.getVariable('counter'), '18');

    const letters = runs.map((_, i) => String.fromCharCode(65 + i));
    await Promise.all(runs.map((run, i) => run.appendVariable('list', letters[i])));
    assert.deepEqual([...(await first.getVariable('list'))].sort(), letters);
    await first.setVariable('counter', '10.5 seconds');
    await first.incrementVariable('counter', '-1');
    assert.equal(await first.getVariable('counter'), '9.5');
  } finally {
    await Promise.all([db.$disconnect(), peer.$disconnect()]);
    await rm(file, { force: true });
    await rmdir(dir);
  }
});
