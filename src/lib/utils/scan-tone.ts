"use client";

import { useSyncExternalStore } from "react";

/**
 * Scan tones — SPEC §14.
 *
 * A cashier scanning at speed is looking at the next item, not the screen. A
 * hardware scanner's own beep only says the code was read, not that the till
 * accepted it; this says which. One short high note for "on the tape", two low
 * ones for "refused" — different in pitch *and* rhythm, so they are told apart
 * by anyone, in a noisy shop, without looking.
 *
 * Synthesised with Web Audio rather than shipped as files: nothing to fetch,
 * so it works on a till that has never been online (rule 8).
 *
 * Sound is an addition, never the only signal — the feedback bar still carries
 * an icon and words for every outcome (rule 7).
 */

const MUTE_KEY = "swiftgrocers.till-muted";

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    context ??= new AudioContext();
    // Browsers start the context suspended until a user gesture; the first
    // scan or tap is one.
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = frequency;
  // Short attack and release: a hard edge on a square wave clicks.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.06, start + 0.005);
  gain.gain.setValueAtTime(0.06, start + duration - 0.01);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function playScanTone(kind: "accepted" | "refused") {
  if (isTillMuted()) return;
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (kind === "accepted") {
    tone(ctx, 1_760, now, 0.07);
  } else {
    tone(ctx, 330, now, 0.12);
    tone(ctx, 247, now + 0.16, 0.18);
  }
}

export function isTillMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function setTillMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // Private mode keeps the choice for this page load only.
  }
  listeners.forEach((notify) => notify());
}

/** The mute preference, read without a server/client mismatch. */
export function useTillMuted(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isTillMuted,
    () => false,
  );
}
