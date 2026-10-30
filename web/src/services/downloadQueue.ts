/** Runs network downloads one at a time. A failed download does not cancel the ones waiting behind it. */
export function createDownloadQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
