import type { SignInResult } from "@/types/staff";
import type { Category, Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import type { Sale, Shift } from "@/types/sale";
import type { Customer, CreateStaffResult, NewSalesPerson, StaffMember } from "@/types/people";
import type { LoyaltyReason, LoyaltyTier } from "@/types/enums";
import type { CashierOverview, HqOverview, ManagerOverview } from "@/types/dashboard";
import type { PurchaseOrder } from "@/types/operations";

/**
 * The contract every screen codes against. Implementations live in `mock/`
 * and `prisma/`; swapping them must not change a single screen.
 *
 * Two things shape this interface and are worth stating plainly.
 *
 * **It is scoped to an actor, not global.** `getRepositories(actor)` returns a
 * view of the data that actor is allowed to see, and the branch scoping is
 * enforced by the database rather than by these methods (docs/DATABASE.md).
 * That is why almost nothing here takes a `branchId`: a branch manager asking
 * for "the stock ledger" gets their own branch because the database will not
 * hand over another one. A `branchId` parameter would imply a choice they do
 * not have.
 *
 * **Reads are shaped like screens, not like tables.** `dashboards.manager()`
 * returns the manager's overview in one round trip rather than seven table
 * reads the screen has to assemble itself. A dashboard that assembles itself
 * from raw tables is a dashboard that eventually disagrees with the report
 * beside it.
 */

export type AuthRepository = {
  /**
   * One sign-in for every tier. The identifier is an email address or a staff
   * code; the account's role decides which workspace opens.
   */
  signIn(identifier: string, password: string): Promise<SignInResult>;
};

/** A branch, as every workspace lists them. */
export type BranchSummary = {
  id: string;
  name: string;
  code: string;
  city: string;
  /** Ordering everywhere a branch list appears — flagship first. */
  position: number;
};

export type BranchRepository = {
  /** Every branch the actor may see. A manager sees one; HQ sees the chain. */
  list(): Promise<BranchSummary[]>;
};

/** The master catalog — read-only from every workspace below HQ (SPEC §7.3). */
export type CatalogRepository = {
  listProducts(): Promise<Product[]>;
  listCategories(): Promise<Category[]>;
  /** Resolve a scanned code. Null when nothing matches (SPEC §11.2). */
  findByBarcode(barcode: string): Promise<Product | null>;
};

/**
 * The stock ledger — SPEC §10.
 *
 * `append` and nothing else. There is deliberately no `setQuantity`, no
 * `update` and no `delete`: a balance is derived from the movements and the
 * only way to change one is to record another movement (CLAUDE.md rule 3).
 * Keeping that out of the interface means no screen can even ask.
 */
export type StockRepository = {
  /**
   * Movements the actor may see. `branchId` narrows *within* what they are
   * already allowed — it cannot widen it, and HQ uses it to look at one branch.
   */
  listEntries(branchId?: string): Promise<StockEntry[]>;
  append(
    entries: readonly Omit<StockEntry, "id">[],
  ): Promise<{ ok: true; entries: StockEntry[] }>;
  /**
   * On-hand less anything a paid online order has already claimed, per product.
   *
   * This is the figure a cashier is shown. The reserved crate is still
   * physically on the shelf and the stock count will find it, but it is spoken
   * for — see docs/DATABASE.md §5.
   */
  availability(
    branchId: string,
  ): Promise<Map<string, { onHandMilli: number; heldMilli: number; availableMilli: number }>>;
};

/**
 * Purchase orders — SPEC §7.7. Read-only here: what has arrived against an
 * order is the stock ledger's business, not the order's.
 */
export type PurchasingRepository = {
  /** Every order the actor may see, newest first. */
  listOrders(): Promise<PurchaseOrder[]>;
};

export type SalesRepository = {
  /** Sales for a day, newest first. `day` is an ISO date in Lagos terms. */
  listForDay(day: string, branchId?: string): Promise<Sale[]>;
  /**
   * Record a completed sale and the stock movements it caused, in one
   * transaction.
   *
   * `clientId` is minted by the till and unique in the database, so a sale
   * queued offline and retried over a flaky connection lands exactly once
   * (rule 8). Re-sending a known `clientId` returns the sale that already
   * exists rather than failing — a retry is not an error.
   */
  record(sale: Sale & { clientId: string }): Promise<{ ok: true; sale: Sale }>;
};

export type ShiftRepository = {
  /** The actor's open shift, if they have one. */
  current(): Promise<Shift | null>;
  open(input: { tillLabel: string; openingFloatKobo: number }): Promise<Shift>;
  close(shiftId: string, countedCashKobo: number): Promise<Shift>;

  /**
   * The shift a sales person is on, opened if they did not have one.
   *
   * Called when they sign in, so their hours start the moment they do rather
   * than when somebody remembers to press a button. Idempotent: signing in
   * twice, or reloading the till, returns the shift already running instead of
   * opening a second one and splitting the day's takings across both.
   */
  startForSignIn(tillLabel: string): Promise<Shift | null>;
};

export type StaffRepository = {
  /** The roster, with the performance figures §15.2 puts beside each name. */
  roster(branchId?: string): Promise<StaffMember[]>;

  /**
   * Add a sales person to the manager's own branch — SPEC §15.2.
   *
   * The branch is not a parameter. It comes from the actor, so there is no
   * argument capable of putting a cashier on somebody else's branch, and the
   * database would refuse it even if there were.
   */
  createSalesPerson(input: NewSalesPerson): Promise<CreateStaffResult>;

  /**
   * Suspend or reinstate somebody. Never delete (CLAUDE.md rule 4) — a
   * suspended cashier keeps every sale they ever rang.
   */
  setStatus(
    staffId: string,
    status: "active" | "suspended",
  ): Promise<{ ok: true; staff: StaffMember } | { ok: false; message: string }>;

  /**
   * Issue a fresh till PIN and return it once, to be read out and not stored.
   *
   * Only the hash is kept, so this is the single moment the PIN exists in
   * readable form anywhere in the system.
   */
  resetPin(staffId: string): Promise<{ ok: true; pin: string } | { ok: false; message: string }>;
};

/** Hours a person has been on shift — the manager's roster column (§15.2). */
export type ShiftHours = {
  staffId: string;
  /** Whole minutes across closed shifts today, plus any shift still running. */
  minutesToday: number;
  /** Null when they are not on shift now. */
  onSinceAt: string | null;
};

/**
 * A loyalty member as the till needs them mid-sale: who they are, what they
 * hold, and what they may spend today. Assembled server-side so a cashier gets
 * one answer rather than a balance the screen has to interpret.
 */
export type LoyaltyLookup = {
  customer: Customer;
  tier: LoyaltyTier;
  pointsBalance: number;
  /** False until the balance is worth something tangible (SPEC §11). */
  canRedeem: boolean;
  /** Points still needed before any can be spent. Zero once they can. */
  pointsToRedemption: number;
};

export type CustomerRepository = {
  list(): Promise<Customer[]>;
  /**
   * The loyalty card is the phone number (SPEC §11).
   *
   * Takes whatever the cashier keyed — `08031234567`, `+234 803 123 4567` — and
   * normalises before looking up, so one person cannot end up with three cards.
   */
  findByPhone(phone: string): Promise<LoyaltyLookup | null>;

  /**
   * Enrol a new member. Name and number, both required, nothing else.
   *
   * Anything more is a form, and a form at a till with a queue behind it does
   * not get filled in — it gets skipped, and the customer never joins.
   */
  enrol(input: {
    fullName: string;
    phone: string;
  }): Promise<
    | { ok: true; lookup: LoyaltyLookup }
    | { ok: false; field: "fullName" | "phone" | "form"; message: string }
  >;

  /** Every movement on a card, newest first — how a balance is explained. */
  pointsHistory(customerId: string): Promise<
    { at: string; delta: number; reason: LoyaltyReason; ref: string | null }[]
  >;
};

/**
 * The three overviews, each computed in one round trip.
 *
 * `day` is an ISO date already resolved to Lagos by the caller — these
 * functions never read a clock, so the server and the client cannot disagree
 * about which day it is.
 */
export type DashboardRepository = {
  cashier(day: string): Promise<CashierOverview>;
  manager(day: string): Promise<ManagerOverview>;
  hq(day: string): Promise<HqOverview>;
};

export type Repositories = {
  auth: AuthRepository;
  branches: BranchRepository;
  catalog: CatalogRepository;
  stock: StockRepository;
  purchasing: PurchasingRepository;
  sales: SalesRepository;
  shifts: ShiftRepository;
  staff: StaffRepository;
  customers: CustomerRepository;
  dashboards: DashboardRepository;
};
