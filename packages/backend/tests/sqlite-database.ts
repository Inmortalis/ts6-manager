import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma/index.js';

export async function createTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'ts6-sqlite-'));
  const path = join(directory, 'test.db');
  const url = 'file:' + path.replaceAll('\\', '/');
  const removeDirectory = () => rm(directory, { recursive: true, force: true, maxRetries: 3 });
  try {
    // The Windows schema engine needs an existing empty SQLite file.
    await writeFile(path, '');
    const require = createRequire(import.meta.url);
    const cli = join(dirname(require.resolve('prisma/package.json')), 'build/index.js');
    const schema = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
    execFileSync(process.execPath, [cli, 'db', 'push', '--schema', schema, '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    const prisma = new PrismaClient({ datasourceUrl: url });
    return {
      prisma,
      async close() {
        try {
          await prisma.$disconnect();
        } finally {
          await removeDirectory();
        }
      },
    };
  } catch (error) {
    await removeDirectory();
    throw error;
  }
}
