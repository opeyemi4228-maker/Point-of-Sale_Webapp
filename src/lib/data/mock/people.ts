import { naira } from "@/lib/domain/money";
import { CURRENT_BRANCH_ID } from "./branches";
import type { Customer, StaffMember } from "@/types/people";

/**
 * FIXTURE DATA — deleted when the real staff and customer endpoints land (§16).
 *
 * Chidi Obi is deliberately an outlier on both void rate and refund rate, and
 * Ada Mbeki is deliberately clean. The roster is the branch manager's main
 * anti-fraud instrument, and a fixture where every row looks the same cannot
 * show whether the screen does its job.
 */
export const MOCK_STAFF: StaffMember[] = [
  {
    id: "stf_mgr_abj03",
    fullName: "Ifeoma Nwosu",
    staffCode: "ABJ03-M01",
    role: "branch_manager",
    branchId: CURRENT_BRANCH_ID,
    status: "active",
    phone: "+2348031110001",
    email: "gwarinpa.manager@swiftgrocers.ng",
    lastShiftAt: "2026-08-09T07:40:00+01:00",
    salesPerHour: naira(0),
    voidRatePercent: 0.4,
    refundRatePercent: 0.6,
  },
  {
    id: "stf_cashier_01",
    fullName: "Blessing Achike",
    staffCode: "ABJ03-C07",
    role: "sales_person",
    branchId: CURRENT_BRANCH_ID,
    status: "active",
    phone: "+2348031110002",
    email: "blessing.a@swiftgrocers.ng",
    lastShiftAt: "2026-08-09T08:02:00+01:00",
    salesPerHour: naira(63_400),
    voidRatePercent: 1.2,
    refundRatePercent: 0.8,
  },
  {
    id: "stf_cashier_02",
    fullName: "Chidi Obi",
    staffCode: "ABJ03-C08",
    role: "sales_person",
    branchId: CURRENT_BRANCH_ID,
    status: "suspended",
    phone: "+2348031110003",
    email: "chidi.o@swiftgrocers.ng",
    lastShiftAt: "2026-08-08T13:04:00+01:00",
    salesPerHour: naira(51_900),
    voidRatePercent: 7.8,
    refundRatePercent: 6.4,
  },
  {
    id: "stf_cashier_03",
    fullName: "Ada Mbeki",
    staffCode: "ABJ03-C09",
    role: "sales_person",
    branchId: CURRENT_BRANCH_ID,
    status: "active",
    phone: "+2348031110004",
    email: null,
    lastShiftAt: "2026-08-09T12:30:00+01:00",
    salesPerHour: naira(48_600),
    voidRatePercent: 0.9,
    refundRatePercent: 0.5,
  },
  {
    id: "stf_cashier_04",
    fullName: "Musa Bello",
    staffCode: "ABJ03-C10",
    role: "sales_person",
    branchId: CURRENT_BRANCH_ID,
    status: "invited",
    phone: "+2348031110005",
    email: null,
    lastShiftAt: null,
    salesPerHour: naira(0),
    voidRatePercent: 0,
    refundRatePercent: 0,
  },
];

/**
 * The void/refund pair that should make a manager look twice. Anything at or
 * above this on both counts is the pattern worth investigating (§15.2).
 */
export const FRAUD_WATCH_PERCENT = 5;

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: "cus_001",
    fullName: "Ade Okonkwo",
    phone: "+2348012345678",
    homeBranchId: CURRENT_BRANCH_ID,
    enrolledAt: "2025-11-04T10:12:00+01:00",
    visits: 84,
    lifetimeSpend: naira(1_284_500),
    pointsBalance: 1_712,
    lastVisitAt: "2026-08-09T14:32:00+01:00",
  },
  {
    id: "cus_002",
    fullName: "Ngozi Eze",
    phone: "+2348023456789",
    homeBranchId: CURRENT_BRANCH_ID,
    enrolledAt: "2026-01-18T16:40:00+01:00",
    visits: 41,
    lifetimeSpend: naira(612_300),
    pointsBalance: 806,
    lastVisitAt: "2026-08-09T14:21:00+01:00",
  },
  {
    id: "cus_003",
    fullName: "Tunji Bakare",
    phone: "+2348034567890",
    homeBranchId: CURRENT_BRANCH_ID,
    enrolledAt: "2026-03-02T09:05:00+01:00",
    visits: 27,
    lifetimeSpend: naira(318_900),
    pointsBalance: 402,
    lastVisitAt: "2026-08-09T14:09:00+01:00",
  },
  {
    id: "cus_004",
    fullName: "Ifeanyi Kalu",
    phone: "+2348045678901",
    homeBranchId: CURRENT_BRANCH_ID,
    enrolledAt: "2026-05-21T11:33:00+01:00",
    visits: 12,
    lifetimeSpend: naira(96_400),
    pointsBalance: 128,
    lastVisitAt: "2026-08-08T17:52:00+01:00",
  },
  {
    id: "cus_005",
    fullName: "Halima Yusuf",
    phone: "+2348056789012",
    homeBranchId: CURRENT_BRANCH_ID,
    enrolledAt: "2026-07-30T08:15:00+01:00",
    visits: 3,
    lifetimeSpend: naira(18_200),
    pointsBalance: 32,
    lastVisitAt: "2026-08-06T09:44:00+01:00",
  },
];

/** `+234801****678` — SPEC §17. Full numbers appear only on a detail view. */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}
