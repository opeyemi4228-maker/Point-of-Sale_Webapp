/**
 * What counts as a password — SPEC §17.
 *
 * Deliberately in its own module with no `server-only` marker, because the rule
 * has to be enforced in two places at once: the form tells somebody their
 * password is too short before they submit it, and the server refuses it
 * regardless of what the form did.
 *
 * One definition, imported by both. Two copies of a validation rule drift, and
 * the drift is always in the direction of the server being stricter than the
 * screen — which reads as the form losing your work for no stated reason.
 *
 * The hashing itself stays in `./credentials`, which is server-only and must
 * never reach a browser.
 */

/**
 * Length over composition rules.
 *
 * Forcing a symbol and a capital produces `Password1!` across an entire chain;
 * requiring length produces something an attacker actually has to work for. Ten
 * characters is the floor, and the message says why rather than listing rules.
 */
export const MINIMUM_PASSWORD_LENGTH = 10;

export function checkPassword(
  password: string,
): { ok: true } | { ok: false; message: string } {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters. A short phrase is stronger than a short password.`,
    };
  }
  if (/^\s|\s$/.test(password)) {
    return { ok: false, message: "Remove the space at the start or end." };
  }
  return { ok: true };
}
