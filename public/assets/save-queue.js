// Serialise writes so a slow, older request cannot overwrite a newer edit.
export function createSaveQueue(initial, write, changed = () => {}) {
  let desired = initial;
  let confirmed = initial;
  let running = null;
  const queue = {
    set(value) { desired = value; changed(); },
    dirty() { return desired !== confirmed; },
    busy() { return running !== null; },
    flush() {
      if (running) return running;
      running = (async () => {
        while (desired !== confirmed) {
          const snapshot = desired;
          await write(snapshot);
          confirmed = snapshot;
          changed();
        }
      })().finally(() => { running = null; changed(); });
      return running;
    },
  };
  return queue;
}
