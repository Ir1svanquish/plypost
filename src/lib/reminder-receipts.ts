/** Reminders already shown in this tab but not yet confirmed by the server. */
export class ShownReminderReceipts {
  private pending = new Map<string, number>();
  private generation = 0;
  private syncing = false;

  has(id: string): boolean {
    return this.pending.has(id);
  }

  get size(): number {
    return this.pending.size;
  }

  ids(): string[] {
    return [...this.pending.keys()];
  }

  markShown(ids: Iterable<string>): void {
    for (const id of ids) this.pending.set(id, ++this.generation);
  }

  remove(id: string): void {
    this.pending.delete(id);
  }

  async flush(persist: (ids: string[]) => Promise<unknown>): Promise<"empty" | "busy" | "saved" | "failed"> {
    if (this.syncing) return "busy";
    if (!this.pending.size) return "empty";
    const batch = [...this.pending];
    this.syncing = true;
    try {
      await persist(batch.map(([id]) => id));
      for (const [id, generation] of batch) {
        if (this.pending.get(id) === generation) this.pending.delete(id);
      }
      return "saved";
    } catch {
      return "failed";
    } finally {
      this.syncing = false;
    }
  }
}
