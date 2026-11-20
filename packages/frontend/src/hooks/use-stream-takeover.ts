import { useLayoutEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../lib/api-error';
import { startWithTakeover, type ActiveVideoSession } from '../lib/stream-takeover';

type Prompt = { session: ActiveVideoSession; decide: (approved: boolean) => void; destination: string };

export function useStreamTakeover(owner: string) {
  const current = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    setPrompt(null);
    setPending(false);
    setError('');
    return () => {
      const previous = current.current;
      current.current = null;
      previous?.abort();
    };
  }, [owner]);

  async function start(
    destination: string,
    submit: Parameters<typeof startWithTakeover>[0],
    onSuccess?: () => void,
  ) {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setError('');
    setPending(true);
    try {
      const started = await startWithTakeover(submit, session => new Promise<boolean>(resolve => {
        let settled = false;
        const cancel = () => decide(false);
        const decide = (approved: boolean) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener('abort', cancel);
          if (current.current === controller) setPrompt(null);
          resolve(approved);
        };
        controller.signal.addEventListener('abort', cancel, { once: true });
        setPrompt({ session, destination, decide });
      }), controller.signal);
      if (started && current.current === controller) onSuccess?.();
    } catch (cause) {
      if (current.current === controller) setError(apiErrorMessage(cause, 'Failed to start stream'));
    } finally {
      if (current.current === controller) {
        current.current = null;
        setPending(false);
      }
    }
  }

  return {
    start, pending, error,
    dialog: {
      open: !!prompt,
      title: 'Replace the active video stream?',
      description: prompt
        ? `Stop the stream on ${prompt.session.botName || 'bot'} (#${prompt.session.botId}) and start ${prompt.destination}? Current viewers will be disconnected.`
        : '',
      confirmLabel: 'Replace stream',
      destructive: true,
      onOpenChange: (open: boolean) => { if (!open) prompt?.decide(false); },
      onConfirm: () => prompt?.decide(true),
    },
  };
}
