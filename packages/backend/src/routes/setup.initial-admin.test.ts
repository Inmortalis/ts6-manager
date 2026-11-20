import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestDatabase } from '../../tests/sqlite-database.js';
import { AppError } from '../middleware/error-handler.js';
import { createFirstAdmin } from './setup.routes.js';

test('two initial writes to a fresh SQLite database yield exactly one enabled administrator', async () => {
  const { prisma, close } = await createTestDatabase();
  try {
    const results = await Promise.allSettled(['first', 'second'].map(name =>
      createFirstAdmin(prisma, name, 'test-hash', name),
    ));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected?.reason instanceof AppError);
    assert.equal(rejected.reason.statusCode, 403);
    const accounts = await prisma.user.findMany();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].role, 'admin');
    assert.equal(accounts[0].enabled, true);
    assert.ok(accounts[0].updatedAt instanceof Date);
  } finally {
    await close();
  }
});
