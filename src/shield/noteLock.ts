/** Runs whatever makes or spends the account's notes one at a time. */
export type NoteLock = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * A lock shared by everything that makes or spends notes: deposits, shields, withdrawals, claims and churns. Each reads
 * the notes only once the one before it has saved its own, so two never take the same counter or spend the same note.
 */
export function createNoteLock(): NoteLock {
  /* Only orders the work: each caller gets its own outcome, failure included, from `run`. */
  let tail: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
