/**
 * Minimal strongly-typed event emitter. Node's `EventEmitter` is untyped, which
 * fights `strictTypeChecked`; this keeps listener signatures fully checked.
 */
export class TypedEmitter<Events extends Record<keyof Events, (...args: never[]) => void>> {
  readonly #listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<E extends keyof Events>(event: E, listener: Events[E]): void {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener);
    this.#listeners.set(event, set);
  }

  off<E extends keyof Events>(event: E, listener: Events[E]): void {
    this.#listeners.get(event)?.delete(listener);
  }

  protected emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void {
    const set = this.#listeners.get(event);
    if (set === undefined) {
      return;
    }
    for (const listener of [...set]) {
      (listener as (...a: Parameters<Events[E]>) => void)(...args);
    }
  }
}
