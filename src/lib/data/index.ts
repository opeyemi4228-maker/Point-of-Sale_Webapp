import type { Repositories } from "./repositories";
import { mockAuthRepository } from "./mock/auth";
import {
  mockBranchRepository,
  mockCatalogRepository,
  mockCustomerRepository,
  mockDashboardRepository,
  mockSalesRepository,
  mockShiftRepository,
  mockStaffRepository,
  mockStockRepository,
} from "./mock/repos";

/**
 * The client-safe half of the data layer.
 *
 * This module must never reach Prisma, the Neon driver or anything that imports
 * `server-only` — a client component importing it would drag the database
 * client into the browser bundle, and the build fails on `node:module` rather
 * than shipping it. That is the correct outcome, but it is easier to not write
 * the import: **the real repositories live in `./server`.**
 *
 * Anything server-side wants `getRepositories` from `@/lib/data/server`.
 */

export const mockRepositories: Repositories = {
  auth: mockAuthRepository,
  branches: mockBranchRepository,
  catalog: mockCatalogRepository,
  stock: mockStockRepository,
  sales: mockSalesRepository,
  shifts: mockShiftRepository,
  staff: mockStaffRepository,
  customers: mockCustomerRepository,
  dashboards: mockDashboardRepository,
};

/**
 * The fixture repositories, unscoped and safe in a browser.
 *
 * Client components that still talk to the data layer directly use this — the
 * sign-in panel, chiefly, which needs a repository before there is a session to
 * scope one with.
 */
export const repositories: Repositories = mockRepositories;

export type {
  Repositories,
  AuthRepository,
  BranchRepository,
  BranchSummary,
  CatalogRepository,
  CustomerRepository,
  DashboardRepository,
  SalesRepository,
  ShiftRepository,
  StaffRepository,
  StockRepository,
} from "./repositories";
