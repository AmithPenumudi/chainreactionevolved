/** How many times a player may undo in one match. */
export const MAX_UNDOS = 3;

/**
 * Bounded history of snapshots taken just before each of the local player's moves.
 * Undo restores the most recent snapshot; a match allows at most `limit` undos.
 */
export class UndoHistory<T> {
  private snapshots: T[] = [];
  private used = 0;

  constructor(private readonly limit = MAX_UNDOS) {}

  /** Remember the position as it was before a move. */
  record(snapshot: T): void {
    this.snapshots.push(snapshot);
    // Only the last `limit` positions can ever be reached, so older ones are dropped.
    if (this.snapshots.length > this.limit) this.snapshots.shift();
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get canUndo(): boolean {
    return this.snapshots.length > 0 && this.remaining > 0;
  }

  /** Pops the latest snapshot and spends one undo, or returns undefined if none is available. */
  undo(): T | undefined {
    if (!this.canUndo) return undefined;
    this.used += 1;
    return this.snapshots.pop();
  }
}

/** Undo is offered only when exactly one human plays against computer opponents. */
export function undoAllowed(players: { isAI?: boolean }[]): boolean {
  return players.filter((p) => !p.isAI).length === 1 && players.some((p) => p.isAI);
}
