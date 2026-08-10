const KEY = "swiftgrocers.intended-route";

/**
 * Where the user was heading before the guard sent them to sign in. Held in
 * sessionStorage so a deep link survives the round trip but dies with the tab.
 */
export const intendedRoute = {
  set(path: string) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(KEY, path);
  },
  take(): string | null {
    if (typeof window === "undefined") return null;
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value;
  },
};
