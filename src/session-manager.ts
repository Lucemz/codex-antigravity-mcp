import { AgySession, normalizeOptions } from "./agy-session.js";
import { SessionOptions, SessionSummary } from "./types.js";

export class SessionManager {
  private readonly sessions = new Map<string, AgySession>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly binary: string, private readonly maxSessions = 3, private readonly idleMs = 900_000) {
    this.timer = setInterval(() => void this.expireIdle(), 30_000).unref();
  }

  create(options: SessionOptions): AgySession {
    if (this.sessions.size >= this.maxSessions) throw new Error(`Session limit reached (${this.maxSessions}). Close an existing session first.`);
    const session = new AgySession(this.binary, normalizeOptions(options), () => this.sessions.delete(session.id));
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): AgySession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    return session;
  }

  list(): SessionSummary[] { return [...this.sessions.values()].map((session) => session.summary()); }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.close();
    this.sessions.delete(id);
  }

  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  private async expireIdle(): Promise<void> {
    const cutoff = Date.now() - this.idleMs;
    await Promise.all(this.list()
      .filter((summary) => summary.state === "idle" && Date.parse(summary.lastActivityAt) < cutoff)
      .map((summary) => this.close(summary.sessionId)));
  }
}
