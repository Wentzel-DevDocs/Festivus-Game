/**
 * Keeps an empty in-memory room alive briefly so Socket.IO reconnects can
 * reattach to the same match. The adapter owns this policy; RoomCore stays
 * transport-agnostic and unaware of sockets or timers.
 */

interface RoomLike {
  readonly connectionCount: number;
}

export interface RoomLifecycleTimers {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const systemTimers: RoomLifecycleTimers = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class EmptyRoomLifecycle<T extends RoomLike> {
  current: T;
  private pendingReset: unknown | null = null;
  private resetGeneration = 0;

  constructor(
    private readonly createRoom: () => T,
    private readonly reconnectGraceMs: number,
    private readonly timers: RoomLifecycleTimers = systemTimers,
  ) {
    this.current = createRoom();
  }

  /** Cancel an empty-room reset and return the room for a new connection. */
  acquire(): T {
    this.cancelPendingReset();
    return this.current;
  }

  /** Schedule a reset only if this is still the current, completely empty room. */
  releaseIfEmpty(room: T): void {
    if (room !== this.current || room.connectionCount !== 0) return;
    this.cancelPendingReset();
    const expectedRoom = room;
    const generation = ++this.resetGeneration;
    this.pendingReset = this.timers.schedule(() => {
      if (generation !== this.resetGeneration) return;
      this.pendingReset = null;
      if (this.current === expectedRoom && expectedRoom.connectionCount === 0) {
        this.current = this.createRoom();
      }
    }, this.reconnectGraceMs);
  }

  private cancelPendingReset(): void {
    if (this.pendingReset === null) return;
    this.timers.cancel(this.pendingReset);
    this.pendingReset = null;
    this.resetGeneration++;
  }
}
