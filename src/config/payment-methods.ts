import type { PaymentMethod } from "@/types";

/** SPEC §7.5 `payment_method`, written the way a cashier would say it. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  pos_terminal: "POS terminal",
  loyalty_points: "Points",
  split: "Split",
  credit: "Store credit",
};
