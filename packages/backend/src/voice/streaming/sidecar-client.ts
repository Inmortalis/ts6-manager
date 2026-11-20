/**
 * HTTP client for the Go WebRTC sidecar process.
 * Manages peers, media sources, and health checks.
 */

export interface SidecarStats {
  videoPort: number;
  audioPort: number;
  peerCount: number;
  peers: Record<string, { active: boolean; state: string }>;
  source: string;
  supportsEmptyPeerGuard?: boolean;
  pendingPeerCount?: number;
}

export class SidecarHttpError extends Error {
  constructor(public status: number, endpoint: string, details: string) {
    super(`Sidecar ${endpoint}: ${status} ${details}`);
  }
}

export class SidecarClient {
  private baseUrl: string;
  private secret: string | undefined;

  constructor(portOrUrl: number | string = 9800, secret?: string) {
    this.baseUrl = typeof portOrUrl === 'string'
      ? portOrUrl.replace(/\/+$/, '')
      : `http://127.0.0.1:${portOrUrl}`;
    this.secret = secret ?? process.env.SIDECAR_SECRET;
  }

  async waitHealthy(timeoutMs: number = 6000): Promise<void> {
    const maxAttempts = Math.ceil(timeoutMs / 200);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.call('GET', '/health');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error('Sidecar health check timeout');
  }

  async createPeer(id: string): Promise<{ sdp: string }> {
    return this.call('POST', '/peer/create', { id });
  }

  async setAnswer(id: string, sdp: string): Promise<void> {
    await this.call('POST', '/peer/answer', { id, sdp });
  }

  async addIceCandidate(id: string, candidate: string, sdpMid: string, sdpMLineIndex: number): Promise<void> {
    await this.call('POST', '/peer/ice', { id, candidate, sdpMid, sdpMLineIndex });
  }

  async closePeer(id: string): Promise<void> {
    await this.call('POST', '/peer/close', { id });
  }

  async setSource(
    source: string,
    width?: number,
    height?: number,
    framerate?: number,
    bitrate?: string,
    volume?: number,
    loop?: boolean,
    requireEmptyPeers = false,
  ): Promise<void> {
    await this.call('POST', '/source', {
      source,
      width,
      height,
      framerate,
      bitrate,
      volume,
      loop,
      ...(requireEmptyPeers && { requireEmptyPeers: true }),
    });
  }

  async stopSource(): Promise<void> {
    await this.call('POST', '/source/stop');
  }

  async getStats(): Promise<SidecarStats> {
    return this.call('GET', '/stats');
  }

  private async peerIdsForHandover(): Promise<string[]> {
    const stats = await this.getStats();
    if (stats?.supportsEmptyPeerGuard !== true) {
      throw new Error('Update the shared video sidecar to the matching backend version.');
    }
    if (!Number.isSafeInteger(stats.pendingPeerCount) || stats.pendingPeerCount !== 0) {
      throw new Error('Peer creation is still pending or cannot be verified. Retry the stream change.');
    }
    if (!stats.peers || typeof stats.peers !== 'object' || Array.isArray(stats.peers)) {
      throw new Error('The sidecar did not return its peer inventory.');
    }
    const ids = Object.keys(stats.peers);
    if (stats.peerCount !== ids.length) throw new Error('The sidecar returned an incomplete peer inventory.');
    return ids;
  }

  /** Include peers that survived a backend restart or a failed signaling request. */
  async clearSessionPeers(): Promise<void> {
    const ids = await this.peerIdsForHandover();
    for (const id of ids) await this.closePeer(id);
    if (ids.length && (await this.peerIdsForHandover()).length) {
      throw new Error('The sidecar still has open peers. Retry the stream change.');
    }
  }

  async getHealth(): Promise<{ status: string; videoPort: number; audioPort: number }> {
    return this.call('GET', '/health');
  }

  private async call(method: string, endpoint: string, body?: any): Promise<any> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new SidecarHttpError(res.status, endpoint, text);
    }
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}
