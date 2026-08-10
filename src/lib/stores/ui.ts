"use client";

import { create } from "zustand";

const COLLAPSE_KEY = "swiftgrocers.sidebar-collapsed";

type UiState = {
  /** Desktop: sidebar reduced to an icon rail. */
  sidebarCollapsed: boolean;
  /** Mobile: the off-canvas drawer is open. */
  mobileNavOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
};

/**
 * Chrome state. Deliberately un-persisted at the middleware level — the
 * preference is read from localStorage in an effect after mount instead, so the
 * server and the first client render always agree. See the note in
 * `stores/session.ts` for why persist middleware and SSR need care here.
 */
export const useUiStore = create<UiState>()((set, get) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      // A till in private mode still gets a working sidebar, just a forgetful one.
    }
  },
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}));

/** Reads the stored preference. Call from an effect, never during render. */
export function readStoredSidebarCollapsed(): boolean | null {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}
