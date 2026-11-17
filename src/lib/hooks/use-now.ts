"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, refreshed every 30 seconds — for "25 min ago" labels.
 *
 * Read through `useSyncExternalStore` rather than `Date.now()` in render, so
 * renders stay pure and the server (which has no ticking clock) renders the
 * label as absent instead of as a time that is wrong by the moment it arrives.
 * The snapshot is rounded to the half-minute so it is stable between ticks.
 */
const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

const snapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverSnapshot = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
