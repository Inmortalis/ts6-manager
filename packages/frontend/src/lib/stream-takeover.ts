export interface ActiveVideoSession {
  id: string;
  botId: number;
  botName: string;
}

function conflictingSession(error: unknown): ActiveVideoSession | undefined {
  const response = (error as { response?: { status?: number; data?: {
    reason?: string; activeSession?: Partial<ActiveVideoSession>;
  } } } | null)?.response;
  const session = response?.data?.activeSession;
  if (response?.status !== 409 || response.data?.reason !== 'video_session_conflict'
      || !session || typeof session.id !== 'string' || !session.id.trim()
      || typeof session.botId !== 'number' || typeof session.botName !== 'string') return;
  return { id: session.id, botId: session.botId, botName: session.botName };
}

/** Each retry requires approval of the exact session reported by the server. */
export async function startWithTakeover(
  start: (replaceSessionId: string | undefined, signal: AbortSignal) => Promise<unknown>,
  confirm: (session: ActiveVideoSession) => Promise<boolean>,
  signal: AbortSignal,
): Promise<boolean> {
  let replaceSessionId: string | undefined;
  while (!signal.aborted) {
    try {
      await start(replaceSessionId, signal);
      return !signal.aborted;
    } catch (error) {
      if (signal.aborted) return false;
      const active = conflictingSession(error);
      if (!active) throw error;
      if (!await confirm(active)) return false;
      replaceSessionId = active.id;
    }
  }
  return false;
}
