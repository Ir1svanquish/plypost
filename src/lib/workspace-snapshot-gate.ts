type ReadTicket = { generation: number; sequence: number };

/** Keep an older workspace read from replacing a newer read or a completed write. */
export class WorkspaceSnapshotGate {
  private generation = 0;
  private sequence = 0;
  private lastAppliedRead = 0;
  private writesInFlight = 0;

  beginRead(): ReadTicket {
    return { generation: this.generation, sequence: ++this.sequence };
  }

  acceptRead(ticket: ReadTicket): boolean {
    if (this.writesInFlight || ticket.generation !== this.generation ||
        ticket.sequence < this.lastAppliedRead) return false;
    this.lastAppliedRead = ticket.sequence;
    return true;
  }

  beginWrite(): void {
    this.writesInFlight += 1;
    this.generation += 1;
  }

  endWrite(): void {
    if (this.writesInFlight < 1) throw new Error("Workspace write tracking is out of sync.");
    this.writesInFlight -= 1;
    this.generation += 1;
  }
}
