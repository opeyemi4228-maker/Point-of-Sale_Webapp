"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import type { CreateStaffResult, NewSalesPerson } from "@/types/people";

/**
 * What a branch manager may do to their roster — SPEC §15.2.
 *
 * Every function here resolves the actor server-side and hands it to the
 * repositories, which query under that actor's row-level security. That is not
 * belt and braces, it is the only authorisation in the system: **a server
 * action is reachable by a direct POST**, not just from the screen that renders
 * the button, so a check that lives in the component protects nothing.
 *
 * Note what is *not* passed in. None of these take a branch. A manager's branch
 * comes from their session, so there is no argument capable of reaching into
 * another branch's roster — and the database would refuse it if there were.
 */

/** Refresh every screen that reads the roster, including the badge counts. */
function refreshRoster() {
  revalidatePath("/manager/staff");
  revalidatePath("/manager");
}

export async function createSalesPersonAction(
  input: NewSalesPerson,
): Promise<CreateStaffResult> {
  const actor = await currentActor();
  if (actor.kind !== "staff") {
    return { ok: false, field: "form", message: "Sign in to manage staff." };
  }
  if (actor.role === "sales_person") {
    return { ok: false, field: "form", message: "Only a manager can add staff." };
  }

  const repositories = await getRepositories(actor);
  const result = await repositories.staff.createSalesPerson(input);

  if (result.ok) refreshRoster();
  return result;
}

export async function setStaffStatusAction(
  staffId: string,
  status: "active" | "suspended",
) {
  const actor = await currentActor();
  if (actor.kind !== "staff" || actor.role === "sales_person") {
    return { ok: false as const, message: "Only a manager can change a status." };
  }

  const repositories = await getRepositories(actor);
  const result = await repositories.staff.setStatus(staffId, status);

  if (result.ok) refreshRoster();
  return result;
}

/**
 * Issue a fresh till PIN.
 *
 * The PIN comes back once, to be read out to the person standing there. Only
 * the hash is kept, so there is no second chance to look it up — which is the
 * point, and the screen says so.
 */
export async function resetStaffPinAction(staffId: string) {
  const actor = await currentActor();
  if (actor.kind !== "staff" || actor.role === "sales_person") {
    return { ok: false as const, message: "Only a manager can reset a PIN." };
  }

  const repositories = await getRepositories(actor);
  return repositories.staff.resetPin(staffId);
}
