import type {
  PurchasingRepository,
  BranchRepository,
  CatalogRepository,
  CustomerRepository,
  DashboardRepository,
  SalesRepository,
  ShiftRepository,
  StaffRepository,
  StockRepository,
} from "../repositories";
import type { StockEntry } from "@/types/stock";
import type { Sale, Shift } from "@/types/sale";
import type { Customer, StaffMember } from "@/types/people";
import type { LoyaltyLookup } from "../repositories";
import {
  canRedeem,
  checkEnrolment,
  pointsToRedemption,
  tierFor,
} from "@/lib/domain/loyalty";
import { MOCK_CATEGORIES, MOCK_PRODUCTS } from "./catalog";
import { MOCK_STOCK_LEDGER } from "./stock";
import { MOCK_PURCHASE_ORDERS } from "./operations";
import { MOCK_BRANCHES } from "./branches";
import { MOCK_CUSTOMERS, MOCK_STAFF } from "./people";
import {
  MOCK_CASHIER_OVERVIEW,
  MOCK_HQ_OVERVIEW,
  MOCK_MANAGER_OVERVIEW,
} from "./dashboards";
import { balancesForBranch } from "@/lib/domain/stock";

/** Stand-in for network latency so loading states are real during development. */
const LATENCY_MS = 220;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockBranchRepository: BranchRepository = {
  async list() {
    await wait(LATENCY_MS);
    return [...MOCK_BRANCHES]
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        id: b.id,
        name: b.name,
        // The fixtures predate branch codes; derive one so the shape matches.
        code: b.name.slice(0, 3).toUpperCase(),
        city: b.city,
        position: b.position,
      }));
  },
};

export const mockCatalogRepository: CatalogRepository = {
  async listProducts() {
    await wait(LATENCY_MS);
    return [...MOCK_PRODUCTS];
  },

  async listCategories() {
    await wait(LATENCY_MS);
    return [...MOCK_CATEGORIES].sort((a, b) => a.position - b.position);
  },

  async findByBarcode(barcode) {
    await wait(LATENCY_MS);
    return MOCK_PRODUCTS.find((p) => p.barcodes.includes(barcode)) ?? null;
  },
};

/**
 * The in-memory ledger. Appends survive client-side navigation within a session
 * so a manager can receive stock and immediately see the balance move — which
 * is the whole point of a derived balance — but they are lost on reload,
 * because this is a fixture and not a database.
 */
const appended: StockEntry[] = [];
let sequence = 0;

export const mockStockRepository: StockRepository = {
  async listEntries(branchId) {
    await wait(LATENCY_MS);
    const all = [...MOCK_STOCK_LEDGER, ...appended];
    return branchId ? all.filter((entry) => entry.branchId === branchId) : all;
  },

  async append(entries) {
    await wait(LATENCY_MS);

    const written = entries.map((entry) => ({
      ...entry,
      id: `stk_new_${String(++sequence).padStart(4, "0")}`,
    }));

    // Append only. Nothing here rewrites or removes an existing row.
    appended.push(...written);
    return { ok: true, entries: written };
  },

  /**
   * There are no reservations in the fixtures, so available equals on-hand.
   * The shape still matches the real one, so a screen written against it does
   * not change when the database arrives.
   */
  async availability(branchId) {
    await wait(LATENCY_MS);
    const balances = balancesForBranch([...MOCK_STOCK_LEDGER, ...appended], branchId);
    return new Map(
      [...balances].map(([productId, balance]) => [
        productId,
        {
          onHandMilli: balance.onHand.milli,
          heldMilli: 0,
          availableMilli: balance.onHand.milli,
        },
      ]),
    );
  },
};

/**
 * Sales are held by the client-side ledger store, not here — the till writes
 * locally first and syncs in the background (rule 8), so the fixture layer has
 * nothing to add. These exist so the contract is total.
 */
const recorded: Sale[] = [];

export const mockSalesRepository: SalesRepository = {
  async listForDay(day, branchId) {
    await wait(LATENCY_MS);
    return recorded.filter(
      (sale) =>
        sale.at.slice(0, 10) === day && (!branchId || sale.branchId === branchId),
    );
  },

  async record(sale) {
    await wait(LATENCY_MS);
    const existing = recorded.find((s) => s.receiptNo === sale.receiptNo);
    if (existing) return { ok: true, sale: existing };
    recorded.push(sale);
    return { ok: true, sale };
  },
};

let openShift: Shift | null = null;

export const mockShiftRepository: ShiftRepository = {
  async current() {
    await wait(LATENCY_MS);
    return openShift;
  },

  async open({ tillLabel, openingFloatKobo }) {
    await wait(LATENCY_MS);
    openShift = {
      id: `shf_${Date.now()}`,
      branchId: MOCK_BRANCHES[0].id,
      staffId: MOCK_STAFF[0].id,
      staffName: MOCK_STAFF[0].fullName,
      tillLabel,
      openedAt: new Date().toISOString(),
      openingFloat: { kobo: openingFloatKobo },
      closedAt: null,
      countedCash: null,
      status: "open",
    };
    return openShift;
  },

  async close(_shiftId, countedCashKobo) {
    await wait(LATENCY_MS);
    if (!openShift) throw new Error("No shift is open.");
    const closed: Shift = {
      ...openShift,
      closedAt: new Date().toISOString(),
      countedCash: { kobo: countedCashKobo },
      status: "closed",
    };
    openShift = null;
    return closed;
  },

  /** Idempotent, like the real one: a reload finds the shift already running. */
  async startForSignIn(tillLabel) {
    await wait(LATENCY_MS);
    if (openShift) return openShift;
    return mockShiftRepository.open({ tillLabel, openingFloatKobo: 5_000_000 });
  },
};

/** Fixture roster, mutated in memory so the screen behaves like the real one. */
const roster: StaffMember[] = [...MOCK_STAFF];

export const mockStaffRepository: StaffRepository = {
  async roster(branchId) {
    await wait(LATENCY_MS);
    return roster.filter((s) => !branchId || s.branchId === branchId);
  },

  async createSalesPerson(input) {
    await wait(LATENCY_MS);
    const fullName = input.fullName.trim().replace(/\s+/g, " ");
    if (!fullName) return { ok: false, field: "fullName", message: "Enter their full name." };
    if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) {
      return { ok: false, field: "email", message: "Enter a valid email address." };
    }
    if (roster.some((s) => s.email?.toLowerCase() === input.email.trim().toLowerCase())) {
      return { ok: false, field: "email", message: "Somebody already uses that email address." };
    }

    const branchId = input.branchId || MOCK_BRANCHES[0].id;
    const seq = roster.filter((s) => s.role === "sales_person").length + 1;
    const member: StaffMember = {
      id: `stf_new_${seq}`,
      fullName,
      staffCode: `NEW-C${String(seq).padStart(2, "0")}`,
      role: "sales_person",
      branchId,
      status: "invited",
      phone: input.phone.trim() || null,
      email: input.email.trim().toLowerCase(),
      lastShiftAt: null,
      salesPerHour: { kobo: 0 },
      voidRatePercent: 0,
      refundRatePercent: 0,
    };
    roster.push(member);
    // Fixture credentials, and obviously so. The real ones are generated
    // server-side and hashed before they are stored.
    return {
      ok: true,
      staff: member,
      temporaryPin: "0000",
      temporaryPassword: input.password?.trim() || "fixture-password",
    };
  },

  async setStatus(staffId, status) {
    await wait(LATENCY_MS);
    const i = roster.findIndex((s) => s.id === staffId);
    if (i === -1) return { ok: false, message: "That person is not on this roster." };
    roster[i] = { ...roster[i], status };
    return { ok: true, staff: roster[i] };
  },

  async resetPin() {
    await wait(LATENCY_MS);
    return { ok: true, pin: "0000" };
  },
};

/** Fixture members, mutated in memory so enrolment at the till behaves. */
const members: Customer[] = [...MOCK_CUSTOMERS];

/** The same shape the real lookup returns, so no screen can tell them apart. */
function lookupOf(customer: Customer): LoyaltyLookup {
  return {
    customer,
    tier: tierFor(customer.lifetimeSpend),
    pointsBalance: customer.pointsBalance,
    canRedeem: canRedeem(customer.pointsBalance),
    pointsToRedemption: pointsToRedemption(customer.pointsBalance),
  };
}

export const mockCustomerRepository: CustomerRepository = {
  async list() {
    await wait(LATENCY_MS);
    return [...members];
  },

  async findByPhone(phone) {
    await wait(LATENCY_MS);
    const check = checkEnrolment({ fullName: "lookup", phone });
    if (!check.ok) return null;
    const found = members.find((c) => c.phone === check.phone);
    return found ? lookupOf(found) : null;
  },

  async enrol({ fullName, phone }) {
    await wait(LATENCY_MS);
    const check = checkEnrolment({ fullName, phone });
    if (!check.ok) return { ok: false, field: check.field, message: check.message };

    const existing = members.find((c) => c.phone === check.phone);
    if (existing) return { ok: true, lookup: lookupOf(existing) };

    const customer: Customer = {
      id: `cus_new_${members.length + 1}`,
      fullName: check.fullName,
      phone: check.phone,
      homeBranchId: MOCK_BRANCHES[0].id,
      enrolledAt: new Date().toISOString(),
      visits: 0,
      lifetimeSpend: { kobo: 0 },
      pointsBalance: 0,
      lastVisitAt: null,
    };
    members.push(customer);
    return { ok: true, lookup: lookupOf(customer) };
  },

  async pointsHistory() {
    await wait(LATENCY_MS);
    return [];
  },
};

export const mockDashboardRepository: DashboardRepository = {
  async cashier() {
    await wait(LATENCY_MS);
    return MOCK_CASHIER_OVERVIEW;
  },
  async manager() {
    await wait(LATENCY_MS);
    return MOCK_MANAGER_OVERVIEW;
  },
  async hq() {
    await wait(LATENCY_MS);
    return MOCK_HQ_OVERVIEW;
  },
};

/** Purchase orders — the fixture list, newest first. */
export const mockPurchasingRepository: PurchasingRepository = {
  async listOrders() {
    await wait(LATENCY_MS);
    return [...MOCK_PURCHASE_ORDERS].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
