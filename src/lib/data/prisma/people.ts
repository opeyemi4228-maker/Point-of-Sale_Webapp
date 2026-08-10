import type { Actor, TxClient } from "@/lib/db";
import { dbFor } from "@/lib/db";
import { toCustomer, toStaffMember, money } from "./mappers";
import { ZERO, kobo } from "@/lib/domain/money";
import {
  canRedeem,
  checkEnrolment,
  pointsToRedemption,
  tierFor,
} from "@/lib/domain/loyalty";
import {
  checkPassword,
  generatePin,
  generateTemporaryPassword,
  hashSecret,
} from "@/lib/auth/credentials";
import type {
  CustomerRepository,
  LoyaltyLookup,
  ShiftRepository,
  StaffRepository,
} from "../repositories";
import type { CreateStaffResult, NewSalesPerson } from "@/types/people";

/**
 * Customers, shifts and staff — the three things a branch manager actually
 * manages, and the loyalty scheme the till runs on.
 *
 * All of it is branch-scoped by the database rather than by these functions
 * (docs/DATABASE.md §3). The one deliberate exception is the customer lookup:
 * a loyalty member belongs to the chain, not to a branch, because the same
 * person shops in Lekki on Tuesday and Gwarinpa on Friday and the till has to
 * find them either way.
 */

/* ── Loyalty ──────────────────────────────────────────────────────────────── */

const CUSTOMER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  homeBranchId: true,
  enrolledAt: true,
  lastVisitAt: true,
} as const;

/**
 * A card's standing, assembled in one place.
 *
 * Balance, lifetime spend and tier are all derived — the balance from the
 * points ledger, the spend from the sales — so none of them can drift from the
 * movements that produced them (CLAUDE.md rule 3). There is no
 * `points_balance` column to go stale, and adding one would be the bug.
 */
async function standing(tx: TxClient, customerId: string) {
  const [points, spend] = await Promise.all([
    tx.loyaltyLedger.aggregate({
      where: { customerId },
      _sum: { deltaPoints: true },
    }),
    tx.sale.aggregate({
      where: { customerId, status: "completed" },
      _sum: { totalKobo: true },
      _count: true,
    }),
  ]);

  const balance = points._sum.deltaPoints ?? 0;
  const lifetimeSpend = spend._sum.totalKobo ? money(spend._sum.totalKobo) : ZERO;

  return {
    visits: spend._count,
    lifetimeSpend,
    pointsBalance: balance,
    tier: tierFor(lifetimeSpend),
  };
}

async function lookupFor(tx: TxClient, customerId: string): Promise<LoyaltyLookup | null> {
  const row = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: CUSTOMER_SELECT,
  });
  if (!row) return null;

  const s = await standing(tx, customerId);
  return {
    customer: toCustomer(row, {
      visits: s.visits,
      lifetimeSpend: s.lifetimeSpend,
      pointsBalance: s.pointsBalance,
    }),
    tier: s.tier,
    pointsBalance: s.pointsBalance,
    canRedeem: canRedeem(s.pointsBalance),
    pointsToRedemption: pointsToRedemption(s.pointsBalance),
  };
}

export function customerRepository(actor: Actor): CustomerRepository {
  const db = dbFor(actor);
  const branchId = actor.kind === "staff" ? actor.branchId : null;

  return {
    async list() {
      return db(async (tx) => {
        const rows = await tx.customer.findMany({
          where: { deletedAt: null },
          orderBy: { fullName: "asc" },
          select: CUSTOMER_SELECT,
        });
        const totals = await Promise.all(rows.map((r) => standing(tx, r.id)));
        return rows.map((row, i) =>
          toCustomer(row, {
            visits: totals[i].visits,
            lifetimeSpend: totals[i].lifetimeSpend,
            pointsBalance: totals[i].pointsBalance,
          }),
        );
      });
    },

    async findByPhone(phone: string) {
      // Normalised before the lookup, so `08031234567` and `+234 803 123 4567`
      // find the same person rather than creating a second card for them.
      const check = checkEnrolment({ fullName: "lookup", phone });
      if (!check.ok) return null;

      return db(async (tx) => {
        const row = await tx.customer.findFirst({
          where: { phone: check.phone, deletedAt: null },
          select: { id: true },
        });
        return row ? lookupFor(tx, row.id) : null;
      });
    },

    async enrol({ fullName, phone }) {
      const check = checkEnrolment({ fullName, phone });
      if (!check.ok) {
        return { ok: false as const, field: check.field, message: check.message };
      }

      return db(async (tx) => {
        // Somebody already on the scheme is not an error to show a cashier —
        // it is the card they were looking for. Hand it back.
        const existing = await tx.customer.findFirst({
          where: { phone: check.phone },
          select: { id: true, deletedAt: true },
        });

        if (existing) {
          if (existing.deletedAt) {
            return {
              ok: false as const,
              field: "phone" as const,
              message: "That number belonged to a closed account. A manager can reopen it.",
            };
          }
          const lookup = await lookupFor(tx, existing.id);
          return lookup
            ? { ok: true as const, lookup }
            : {
                ok: false as const,
                field: "form" as const,
                message: "That card could not be read. Try again.",
              };
        }

        const created = await tx.customer.create({
          data: {
            fullName: check.fullName,
            phone: check.phone,
            // Where they joined, which is the branch they are standing in.
            homeBranchId: branchId,
            // Consent is recorded, never assumed. Both default false.
          },
          select: { id: true },
        });

        const lookup = await lookupFor(tx, created.id);
        return lookup
          ? { ok: true as const, lookup }
          : {
              ok: false as const,
              field: "form" as const,
              message: "The card was created but could not be read back.",
            };
      });
    },

    async pointsHistory(customerId: string) {
      return db(async (tx) => {
        const rows = await tx.loyaltyLedger.findMany({
          where: { customerId },
          orderBy: { at: "desc" },
          take: 100,
          select: { at: true, deltaPoints: true, reason: true, ref: true },
        });
        return rows.map((r) => ({
          at: r.at.toISOString(),
          delta: r.deltaPoints,
          reason: r.reason,
          ref: r.ref,
        }));
      });
    },
  };
}

/* ── Shifts ───────────────────────────────────────────────────────────────── */

const SHIFT_SELECT = {
  id: true,
  branchId: true,
  staffId: true,
  tillLabel: true,
  openedAt: true,
  openingFloatKobo: true,
  closedAt: true,
  countedCashKobo: true,
  status: true,
  staff: { select: { fullName: true } },
} as const;

export function shiftRepository(actor: Actor): ShiftRepository {
  const db = dbFor(actor);
  const staffId = actor.kind === "staff" ? actor.staffId : null;
  const branchId = actor.kind === "staff" ? actor.branchId : null;

  const toShiftRow = async (tx: TxClient, id: string) => {
    const row = await tx.shift.findUniqueOrThrow({ where: { id }, select: SHIFT_SELECT });
    const { toShift } = await import("./mappers");
    return toShift(row);
  };

  return {
    async current() {
      if (!staffId) return null;
      return db(async (tx) => {
        const row = await tx.shift.findFirst({
          where: { staffId, status: "open" },
          orderBy: { openedAt: "desc" },
          select: SHIFT_SELECT,
        });
        if (!row) return null;
        const { toShift } = await import("./mappers");
        return toShift(row);
      });
    },

    async open({ tillLabel, openingFloatKobo }) {
      if (!staffId || !branchId) {
        throw new Error("Only a branch staff member can open a shift.");
      }
      return db(async (tx) => {
        const row = await tx.shift.create({
          data: {
            branchId,
            staffId,
            tillLabel,
            openingFloatKobo: BigInt(openingFloatKobo),
            status: "open",
          },
          select: { id: true },
        });
        return toShiftRow(tx, row.id);
      });
    },

    async close(shiftId: string, countedCashKobo: number) {
      return db(async (tx) => {
        await tx.shift.update({
          where: { id: shiftId },
          data: {
            status: "closed",
            closedAt: new Date(),
            countedCashKobo: BigInt(countedCashKobo),
          },
        });
        return toShiftRow(tx, shiftId);
      });
    },

    /**
     * Start the clock when they sign in.
     *
     * A cashier's hours should not depend on their remembering to press a
     * button before serving the first customer of the day — the manager's
     * roster and the sales-per-hour figure both read this, and a shift opened
     * forty minutes late makes an honest cashier look slow.
     *
     * Idempotent, which is the whole trick: a reload, a second tab or a re-auth
     * finds the shift already running and returns it. Opening a second one
     * would split the day's takings across two rows and double-count the hours.
     */
    async startForSignIn(tillLabel: string) {
      if (!staffId || !branchId) return null;

      return db(async (tx) => {
        const running = await tx.shift.findFirst({
          where: { staffId, status: "open" },
          orderBy: { openedAt: "desc" },
          select: SHIFT_SELECT,
        });

        const { toShift } = await import("./mappers");
        if (running) return toShift(running);

        const branch = await tx.branch.findUnique({
          where: { id: branchId },
          select: { openingFloatKobo: true },
        });

        const created = await tx.shift.create({
          data: {
            branchId,
            staffId,
            tillLabel,
            // The branch's standing float. A cashier is not asked to key it at
            // sign-in — that is a counting exercise for shift close, and asking
            // for it before the first customer is how tills open late.
            openingFloatKobo: branch?.openingFloatKobo ?? BigInt(0),
            status: "open",
          },
          select: SHIFT_SELECT,
        });

        return toShift(created);
      });
    },
  };
}

/* ── Staff ────────────────────────────────────────────────────────────────── */

const STAFF_SELECT = {
  id: true,
  orgId: true,
  branchId: true,
  role: true,
  fullName: true,
  email: true,
  staffCode: true,
  status: true,
  phone: true,
  branch: { select: { name: true } },
} as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Hours worked, closed shifts plus whatever is running now.
 *
 * Counting the open shift is the point: a manager looking at the roster at
 * eleven wants to know somebody has been on since seven, not that they have
 * logged zero hours because they have not gone home yet.
 */
async function hoursWorked(tx: TxClient, staffId: string, now: Date): Promise<number> {
  const shifts = await tx.shift.findMany({
    where: { staffId },
    select: { openedAt: true, closedAt: true, status: true },
  });

  const ms = shifts.reduce((total, s) => {
    const end = s.closedAt ?? (s.status === "open" ? now : null);
    return end ? total + (end.getTime() - s.openedAt.getTime()) : total;
  }, 0);

  return ms / 3_600_000;
}

export function staffRepository(actor: Actor): StaffRepository {
  const db = dbFor(actor);
  const branchId = actor.kind === "staff" ? actor.branchId : null;

  async function memberOf(tx: TxClient, id: string, now: Date) {
    const row = await tx.staff.findUniqueOrThrow({ where: { id }, select: STAFF_SELECT });
    return withPerformance(tx, row, now);
  }

  async function withPerformance(
    tx: TxClient,
    row: { id: string } & Record<string, unknown>,
    now: Date,
  ) {
    const [shift, totals, voided, refunded, hours] = await Promise.all([
      tx.shift.findFirst({
        where: { staffId: row.id },
        orderBy: { openedAt: "desc" },
        select: { openedAt: true },
      }),
      tx.sale.aggregate({
        where: { staffId: row.id, status: "completed" },
        _sum: { totalKobo: true },
        _count: true,
      }),
      tx.sale.count({ where: { staffId: row.id, status: "voided" } }),
      tx.sale.count({
        where: { staffId: row.id, status: { in: ["refunded", "partially_refunded"] } },
      }),
      hoursWorked(tx, row.id, now),
    ]);

    const all = totals._count + voided + refunded;

    return toStaffMember(row as never, {
      lastShiftAt: shift ? shift.openedAt.toISOString() : null,
      salesPerHour:
        hours > 0 && totals._sum.totalKobo
          ? kobo(Math.round(Number(totals._sum.totalKobo) / hours))
          : ZERO,
      voidRatePercent: all ? round1((voided / all) * 100) : 0,
      refundRatePercent: all ? round1((refunded / all) * 100) : 0,
    });
  }

  return {
    async roster(scopeBranchId?: string) {
      const now = new Date();
      return db(async (tx) => {
        const rows = await tx.staff.findMany({
          where: { deletedAt: null, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
          orderBy: { fullName: "asc" },
          select: STAFF_SELECT,
        });
        return Promise.all(rows.map((row) => withPerformance(tx, row, now)));
      });
    },

    /**
     * The branch is taken from the actor and never from the argument.
     *
     * `NewSalesPerson` carries a `branchId` because the form collects one, but
     * it is deliberately ignored: there must be no argument capable of putting
     * a cashier on somebody else's branch. Row-level security would refuse the
     * insert anyway — this makes it impossible to attempt.
     */
    async createSalesPerson(input: NewSalesPerson): Promise<CreateStaffResult> {
      const fullName = input.fullName.trim().replace(/\s+/g, " ");
      const email = input.email.trim().toLowerCase();

      if (!fullName) {
        return { ok: false, field: "fullName", message: "Enter their full name." };
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return { ok: false, field: "email", message: "Enter a valid email address." };
      }
      if (!branchId) {
        return {
          ok: false,
          field: "form",
          message: "Only a branch manager can add a sales person.",
        };
      }

      return db(async (tx) => {
        const clash = await tx.staff.findFirst({
          where: { email },
          select: { id: true },
        });
        if (clash) {
          return {
            ok: false as const,
            field: "email" as const,
            message: "Somebody already uses that email address.",
          };
        }

        const branch = await tx.branch.findUnique({
          where: { id: branchId },
          select: { code: true, orgId: true },
        });
        if (!branch) {
          return { ok: false as const, field: "form" as const, message: "Branch not found." };
        }

        const staffCode = await nextStaffCode(tx, branch.code);

        // Two credentials, because there are two ways in (SPEC §17):
        //
        //   the PIN opens the till — four digits, keyed at a counter;
        //   the password is for everything else, and is theirs to change.
        //
        // Both are issued here, hashed before they are stored, and returned
        // exactly once so the manager can hand them over.
        const pin = generatePin();
        const password = input.password?.trim()
          ? input.password.trim()
          : generateTemporaryPassword();

        const strong = checkPassword(password);
        if (!strong.ok) {
          return { ok: false as const, field: "password" as const, message: strong.message };
        }

        const [pinHash, passwordHash] = await Promise.all([
          hashSecret(pin),
          hashSecret(password),
        ]);

        const created = await tx.staff.create({
          data: {
            orgId: branch.orgId,
            branchId,
            fullName,
            email,
            phone: input.phone.trim() || null,
            staffCode,
            role: "sales_person",
            status: "invited",
            pinHash,
            pinSetAt: new Date(),
            passwordHash,
            // They must change it the first time they use it. A password a
            // manager knows is not a password.
            mustChangePassword: true,
          },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            branchId,
            action: "STAFF_CREATED",
            entity: "staff",
            entityId: created.id,
            actorId: actor.kind === "staff" ? actor.staffId : null,
            actorName: "Branch manager",
            actorRole: actor.kind === "staff" ? actor.role : "unknown",
            detail: `${fullName} added as ${staffCode}`,
          },
        });

        return {
          ok: true as const,
          staff: await memberOf(tx, created.id, new Date()),
          // Said out loud once. Only the hashes are kept, so there is no second
          // chance to look either of these up — and the screen says so.
          temporaryPin: pin,
          temporaryPassword: password,
        };
      });
    },

    async setStatus(staffId: string, status: "active" | "suspended") {
      return db(async (tx) => {
        const target = await tx.staff.findFirst({
          where: { id: staffId, deletedAt: null },
          select: { id: true, role: true, fullName: true, branchId: true },
        });
        if (!target) {
          return { ok: false as const, message: "That person is not on this roster." };
        }
        // A manager runs their own branch's cashiers, not the chain's managers.
        if (target.role !== "sales_person" && actor.kind === "staff" && actor.role !== "general_admin") {
          return { ok: false as const, message: "Only HQ can change a manager's status." };
        }

        await tx.staff.update({ where: { id: staffId }, data: { status } });

        // Suspending somebody must not leave their till open behind them.
        if (status === "suspended") {
          await tx.shift.updateMany({
            where: { staffId, status: "open" },
            data: { status: "force_closed", closedAt: new Date() },
          });
        }

        await tx.auditLog.create({
          data: {
            branchId: target.branchId,
            action: status === "suspended" ? "STAFF_SUSPENDED" : "STAFF_REINSTATED",
            entity: "staff",
            entityId: staffId,
            actorId: actor.kind === "staff" ? actor.staffId : null,
            actorName: "Branch manager",
            actorRole: actor.kind === "staff" ? actor.role : "unknown",
            detail: target.fullName,
          },
        });

        return { ok: true as const, staff: await memberOf(tx, staffId, new Date()) };
      });
    },

    async resetPin(staffId: string) {
      const pin = generatePin();
      return db(async (tx) => {
        const target = await tx.staff.findFirst({
          where: { id: staffId, deletedAt: null },
          select: { id: true, fullName: true, branchId: true },
        });
        if (!target) return { ok: false as const, message: "That person is not on this roster." };

        await tx.staff.update({
          where: { id: staffId },
          data: {
            pinHash: await hashSecret(pin),
            pinSetAt: new Date(),
            // A reset clears the lockout too — that is usually why it is being
            // reset, and leaving somebody locked out with a fresh PIN helps
            // nobody.
            pinAttempts: 0,
            lockedUntil: null,
          },
        });

        await tx.auditLog.create({
          data: {
            branchId: target.branchId,
            action: "STAFF_PIN_RESET",
            entity: "staff",
            entityId: staffId,
            actorId: actor.kind === "staff" ? actor.staffId : null,
            actorName: "Branch manager",
            actorRole: actor.kind === "staff" ? actor.role : "unknown",
            detail: target.fullName,
          },
        });

        return { ok: true as const, pin };
      });
    },
  };
}

/* ── Internals ────────────────────────────────────────────────────────────── */

/** `GWA-C07` — the code printed on receipts (SPEC §12). */
async function nextStaffCode(tx: TxClient, branchCode: string): Promise<string> {
  const existing = await tx.staff.findMany({
    where: { staffCode: { startsWith: `${branchCode}-C` } },
    select: { staffCode: true },
  });

  const highest = existing.reduce((top, s) => {
    const n = Number(s.staffCode.split("-C")[1] ?? 0);
    return Number.isFinite(n) && n > top ? n : top;
  }, 0);

  return `${branchCode}-C${String(highest + 1).padStart(2, "0")}`;
}

