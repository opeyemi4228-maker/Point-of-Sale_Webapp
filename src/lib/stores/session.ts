"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import type { Session } from "@/types/staff";

type SessionState = {
  session: Session | null;
  setSession: (session: Session) => void;
  signOut: () => void;
};

const STORE_KEY = "swiftgrocers.session";
const REMEMBER_KEY = "swiftgrocers.remember";

/* ── "Remember me" is a storage decision, not a checkbox ──────────────────── */

/**
 * Where the session is kept.
 *
 * Remembered → `localStorage`, so a manager's own laptop keeps them signed in.
 * Not remembered → `sessionStorage`, which dies with the tab. That is the
 * setting a shared till wants: the next cashier gets a sign-in screen rather
 * than the previous person's session (§17).
 */
function remembering(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Call before writing a session, so the write lands in the right store. */
export function setRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, String(remember));
    // Never leave a copy behind in the store we are no longer using.
    (remember ? sessionStorage : localStorage).removeItem(STORE_KEY);
  } catch {
    // Private mode still signs in; it just will not remember.
  }
}

const dualStorage: StateStorage = {
  getItem: (name) => {
    try {
      return remembering()
        ? localStorage.getItem(name)
        : sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      (remembering() ? localStorage : sessionStorage).setItem(name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

/* ── The store ────────────────────────────────────────────────────────────── */

/**
 * Who is signed in on this device.
 *
 * Persisted so a till survives a reload mid-shift (SPEC §15.1). This is a
 * rendering convenience only — it decides which chrome to draw, never what data
 * a user may reach. That is row-level security's job (SPEC §8), and it stays
 * that way when the real backend lands.
 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      signOut: () => set({ session: null }),
    }),
    {
      name: STORE_KEY,
      storage: {
        getItem: (name) => {
          const raw = dualStorage.getItem(name);
          return raw ? JSON.parse(raw as string) : null;
        },
        setItem: (name, value) => dualStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => dualStorage.removeItem(name),
      },
    },
  ),
);

/* ── Hydration ────────────────────────────────────────────────────────────── */

const subscribeToHydration = (onChange: () => void) =>
  useSessionStore.persist.onFinishHydration(onChange);

const hasHydrated = () => useSessionStore.persist.hasHydrated();

/** The server has no storage, so nothing is ever rehydrated there. */
const neverOnTheServer = () => false;

/**
 * True once the persisted session has been read back from storage.
 *
 * Deliberately *not* a field on the store. Web storage is synchronous, so
 * zustand rehydrates during `create()` — any `onRehydrateStorage` callback that
 * reaches for `useSessionStore` runs while that binding is still in its temporal
 * dead zone, throws, and leaves the store permanently marked un-hydrated. Every
 * guard then spins forever. Reading the persist API from outside sidesteps it.
 *
 * `useSyncExternalStore`'s server snapshot also keeps the first client render
 * matching the server's, so there is no hydration mismatch.
 */
export function useSessionHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    hasHydrated,
    neverOnTheServer,
  );
}
