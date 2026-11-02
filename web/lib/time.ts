// Server pages call this after their data access, so it only ever runs at request time.
export const nowMs = () => Date.now();
