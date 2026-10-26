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

  beginRead(): ReadTicket {
    return { generation: this.generation, sequence: ++this.sequence };
  }

  acceptRead(ticket: ReadTicket): boolean {
    if (this.writesInFlight || ticket.generation !== this.generation ||
        ticket.sequence < this.lastAppliedRead) return false;
    this.lastAppliedRead = ticket.sequence;
    return true;
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
    return { apply, refresh };
  }
}
