import { useSyncExternalStore } from "react";

export const listeners = () => {
  const set = new Set<() => void>();
  let version = 0;
  return {
    subscribe: (fn: () => void) => {
      set.add(fn);
      return () => void set.delete(fn);
    },
    emit: () => {
      version++;
      for (const fn of set) fn();
    },
    version: () => version,
  };
};

type Bus = ReturnType<typeof listeners>;

/** Re-renders whenever the bus says something changed. */
export const useBus = (bus: Bus) => useSyncExternalStore(bus.subscribe, bus.version);
