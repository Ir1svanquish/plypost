type ReadTicket = { generation: number; sequence: number };
type WriteTicket = { sequence: number };

/** Keep stale workspace responses from replacing newer state; reconcile overlapping writes. */
export class WorkspaceSnapshotGate {
  private generation = 0;
  private sequence = 0;
  private lastAppliedRead = 0;
  private lastAppliedWrite = 0;
  private writesInFlight = 0;
  private reconcileAfterWrites = false;
  private idleWaiters: Array<() => void> = [];

  beginRead(): ReadTicket {
    return { generation: this.generation, sequence: ++this.sequence };
  }

  acceptRead(ticket: ReadTicket): boolean {
    if (this.writesInFlight || ticket.generation !== this.generation ||
        ticket.sequence < this.lastAppliedRead) return false;
    this.lastAppliedRead = ticket.sequence;
    return true;
  }

  /** Retry a superseded user read after current writes settle. Background polls can use one attempt. */
  async read<T>(load: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const ticket = this.beginRead();
      const snapshot = await load();
      if (this.acceptRead(ticket)) return snapshot;
      if (attempt + 1 < maxAttempts && this.writesInFlight) {
        await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
      }
    }
    throw new Error("Workspace changed while loading. Refresh and try again.");
  }

  beginWrite(): WriteTicket {
    if (this.writesInFlight) this.reconcileAfterWrites = true;
    this.writesInFlight += 1;
    this.generation += 1;
    return { sequence: ++this.sequence };
  }

  endWrite(ticket: WriteTicket, succeeded: boolean): { apply: boolean; refresh: boolean } {
    if (this.writesInFlight < 1) throw new Error("Workspace write tracking is out of sync.");
    this.writesInFlight -= 1;
    this.generation += 1;
    const apply = succeeded && ticket.sequence > this.lastAppliedWrite;
    if (apply) this.lastAppliedWrite = ticket.sequence;
    const refresh = this.writesInFlight === 0 && this.reconcileAfterWrites;
    if (refresh) this.reconcileAfterWrites = false;
    if (this.writesInFlight === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
    return { apply, refresh };
  }
}
