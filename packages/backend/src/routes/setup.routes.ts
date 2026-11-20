import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { AppError } from '../middleware/error-handler.js';
import { validatePassword } from '../utils/validate-password.js';

export const setupRoutes: Router = Router();

// GET /api/setup/status — Check if initial setup is needed
setupRoutes.get('/status', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const userCount = await prisma.user.count();
    res.json({ needsSetup: userCount === 0 });
  } catch (err) { next(err); }
});

/** SQLite checks the empty table and inserts the first admin in one write. */
export async function createFirstAdmin(prisma: PrismaClient, username: string, passwordHash: string, displayName: string) {
  const inserted = await prisma.$executeRaw`
    INSERT INTO "User" ("username", "passwordHash", "displayName", "role", "updatedAt")
    SELECT ${username}, ${passwordHash}, ${displayName}, 'admin', ${new Date()}
    WHERE NOT EXISTS (SELECT 1 FROM "User")
  `;
  if (inserted === 0) throw new AppError(403, 'Setup already completed');
}

// POST /api/setup/init — Create the first admin user
setupRoutes.post('/init', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;

    // Only allow if no users exist
    const userCount = await prisma.user.count();
    if (userCount > 0) throw new AppError(403, 'Setup already completed');

    const { username, password, displayName } = req.body;
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      throw new AppError(400, 'Username and password are required');
    }
    if (displayName != null && typeof displayName !== 'string') throw new AppError(400, 'Invalid display name');

    const pwError = validatePassword(password);
    if (pwError) throw new AppError(400, pwError);

    const passwordHash = await bcrypt.hash(password, 12);
    await createFirstAdmin(prisma, username, passwordHash, displayName || username);

    res.status(201).json({ success: true, message: 'Admin account created. You can now log in.' });
  } catch (err) { next(err); }
});
