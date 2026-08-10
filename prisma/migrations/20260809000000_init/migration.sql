-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('provisioning', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('general_admin', 'branch_manager', 'sales_person');

-- CreateEnum
CREATE TYPE "staff_status" AS ENUM ('invited', 'active', 'suspended', 'offboarded');

-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('open', 'closed', 'force_closed');

-- CreateEnum
CREATE TYPE "sold_by" AS ENUM ('unit', 'weight');

-- CreateEnum
CREATE TYPE "stock_reason" AS ENUM ('BRANCH_OPENED', 'SALE', 'REFUND', 'VOID', 'PURCHASE_RECEIPT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUSTMENT', 'DAMAGE', 'EXPIRY', 'THEFT', 'SAMPLE', 'CORRECTION', 'ONLINE_ORDER', 'ONLINE_RETURN');

-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('draft', 'completed', 'voided', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card', 'transfer', 'pos_terminal', 'loyalty_points', 'split', 'credit');

-- CreateEnum
CREATE TYPE "loyalty_reason" AS ENUM ('EARN', 'REDEEM', 'REVERSAL', 'EXPIRY', 'MANUAL_ADJUST', 'SIGNUP_BONUS', 'BIRTHDAY_BONUS', 'PROMOTION');

-- CreateEnum
CREATE TYPE "loyalty_tier" AS ENUM ('bronze', 'silver', 'gold');

-- CreateEnum
CREATE TYPE "po_status" AS ENUM ('draft', 'sent', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('requested', 'approved', 'in_transit', 'received', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "count_status" AS ENUM ('open', 'counting', 'review', 'posted', 'abandoned');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateEnum
CREATE TYPE "approval_action" AS ENUM ('PRICE_OVERRIDE', 'VOID_SALE', 'REFUND', 'POST_COUNT', 'OVERSELL', 'POINTS_ADJUST');

-- CreateEnum
CREATE TYPE "sales_channel" AS ENUM ('till', 'online');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('cart', 'awaiting_payment', 'awaiting_branch', 'accepted', 'picking', 'ready', 'out_for_delivery', 'delivered', 'collected', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'authorized', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "fulfilment_method" AS ENUM ('delivery', 'collection');

-- CreateEnum
CREATE TYPE "reservation_state" AS ENUM ('held', 'committed', 'released', 'expired');

-- CreateTable
CREATE TABLE "org" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "branch_status" NOT NULL DEFAULT 'provisioning',
    "position" INTEGER NOT NULL DEFAULT 0,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "service_radius_m" INTEGER NOT NULL DEFAULT 10000,
    "delivers_online" BOOLEAN NOT NULL DEFAULT false,
    "offers_collection" BOOLEAN NOT NULL DEFAULT true,
    "delivery_fee_kobo" BIGINT NOT NULL DEFAULT 0,
    "opening_float_kobo" BIGINT NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "app_version" TEXT NOT NULL DEFAULT '',
    "last_seen_at" TIMESTAMPTZ(6),
    "clock_skew_minutes" INTEGER NOT NULL DEFAULT 0,
    "queued_writes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID,
    "stack_user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "staff_code" TEXT NOT NULL,
    "role" "staff_role" NOT NULL,
    "status" "staff_status" NOT NULL DEFAULT 'invited',
    "password_hash" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" TEXT,
    "pin_set_at" TIMESTAMPTZ(6),
    "pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "stack_user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "home_branch_id" UUID,
    "tier" "loyalty_tier" NOT NULL DEFAULT 'bronze',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_visit_at" TIMESTAMPTZ(6),
    "accepts_email" BOOLEAN NOT NULL DEFAULT false,
    "accepts_sms" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "landmark" TEXT,
    "phone" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "category_id" UUID NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "compare_at_price_kobo" BIGINT,
    "cost_kobo" BIGINT NOT NULL,
    "sold_by" "sold_by" NOT NULL DEFAULT 'unit',
    "unit" TEXT NOT NULL DEFAULT 'ea',
    "pack_size" TEXT,
    "reorder_level_milli" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "online_listed" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "delisted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcode" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "delta_milli" INTEGER NOT NULL,
    "reason" "stock_reason" NOT NULL,
    "channel" "sales_channel",
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staff_id" UUID,
    "staff_name" TEXT NOT NULL,
    "ref" TEXT,
    "note" TEXT,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "state" "reservation_state" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "device_id" UUID,
    "till_label" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float_kobo" BIGINT NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "counted_cash_kobo" BIGINT,
    "status" "shift_status" NOT NULL DEFAULT 'open',

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "shift_id" UUID,
    "customer_id" UUID,
    "branch_name" TEXT NOT NULL,
    "staff_name" TEXT NOT NULL,
    "staff_code" TEXT NOT NULL,
    "subtotal_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_kobo" BIGINT NOT NULL,
    "change_kobo" BIGINT NOT NULL DEFAULT 0,
    "rounding_kobo" BIGINT NOT NULL DEFAULT 0,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "points_redeemed" INTEGER NOT NULL DEFAULT 0,
    "status" "sale_status" NOT NULL DEFAULT 'completed',
    "channel" "sales_channel" NOT NULL DEFAULT 'till',
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taken_offline" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6),

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "sold_by" "sold_by" NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "line_total_kobo" BIGINT NOT NULL,

    CONSTRAINT "sale_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "reference" TEXT,

    CONSTRAINT "tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart" (
    "id" UUID NOT NULL,
    "customer_id" UUID,
    "anonymous_id" TEXT,
    "branch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_line" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID,
    "address_id" UUID,
    "status" "order_status" NOT NULL DEFAULT 'cart',
    "payment_status" "payment_status" NOT NULL DEFAULT 'pending',
    "fulfilment" "fulfilment_method" NOT NULL DEFAULT 'delivery',
    "subtotal_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "delivery_fee_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_kobo" BIGINT NOT NULL,
    "payment_method" "payment_method",
    "payment_ref" TEXT,
    "deliver_to_street" TEXT,
    "deliver_to_city" TEXT,
    "deliver_to_state" TEXT,
    "deliver_to_phone" TEXT,
    "deliver_to_latitude" DECIMAL(9,6),
    "deliver_to_longitude" DECIMAL(9,6),
    "distance_m" INTEGER,
    "branch_chosen_by_customer" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "placed_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "sold_by" "sold_by" NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "line_total_kobo" BIGINT NOT NULL,
    "picked_qty_milli" INTEGER,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_event" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "order_status" NOT NULL,
    "note" TEXT,
    "staff_id" UUID,
    "actor_name" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID,
    "delta_points" INTEGER NOT NULL,
    "reason" "loyalty_reason" NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "action" "approval_action" NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "amount_kobo" BIGINT,
    "status" "approval_status" NOT NULL DEFAULT 'pending',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_label" TEXT NOT NULL,
    "status" "count_status" NOT NULL DEFAULT 'open',
    "started_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_line" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_milli" INTEGER NOT NULL,
    "counted_milli" INTEGER,
    "counted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'requested',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),

    CONSTRAINT "transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_line" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "received_qty_milli" INTEGER,

    CONSTRAINT "transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "status" "po_status" NOT NULL DEFAULT 'draft',
    "total_kobo" BIGINT NOT NULL DEFAULT 0,
    "expected_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_milli" INTEGER NOT NULL,
    "received_qty_milli" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_kobo" BIGINT NOT NULL,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "actor_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_code_key" ON "branch"("code");

-- CreateIndex
CREATE INDEX "branch_org_id_status_idx" ON "branch"("org_id", "status");

-- CreateIndex
CREATE INDEX "branch_delivers_online_status_idx" ON "branch"("delivers_online", "status");

-- CreateIndex
CREATE UNIQUE INDEX "device_device_code_key" ON "device"("device_code");

-- CreateIndex
CREATE INDEX "device_branch_id_idx" ON "device"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_stack_user_id_key" ON "staff"("stack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_staff_code_key" ON "staff"("staff_code");

-- CreateIndex
CREATE INDEX "staff_branch_id_role_status_idx" ON "staff"("branch_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_stack_user_id_key" ON "customer"("stack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_phone_key" ON "customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_key" ON "customer"("email");

-- CreateIndex
CREATE INDEX "customer_home_branch_id_idx" ON "customer"("home_branch_id");

-- CreateIndex
CREATE INDEX "customer_address_customer_id_idx" ON "customer_address"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_slug_key" ON "product"("slug");

-- CreateIndex
CREATE INDEX "product_category_id_delisted_at_idx" ON "product"("category_id", "delisted_at");

-- CreateIndex
CREATE INDEX "product_online_listed_delisted_at_idx" ON "product"("online_listed", "delisted_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcode_barcode_key" ON "product_barcode"("barcode");

-- CreateIndex
CREATE INDEX "product_barcode_product_id_idx" ON "product_barcode"("product_id");

-- CreateIndex
CREATE INDEX "product_image_product_id_position_idx" ON "product_image"("product_id", "position");

-- CreateIndex
CREATE INDEX "stock_ledger_branch_id_product_id_at_idx" ON "stock_ledger"("branch_id", "product_id", "at");

-- CreateIndex
CREATE INDEX "stock_ledger_branch_id_at_idx" ON "stock_ledger"("branch_id", "at");

-- CreateIndex
CREATE INDEX "stock_ledger_ref_idx" ON "stock_ledger"("ref");

-- CreateIndex
CREATE INDEX "stock_reservation_branch_id_product_id_state_idx" ON "stock_reservation"("branch_id", "product_id", "state");

-- CreateIndex
CREATE INDEX "stock_reservation_order_id_idx" ON "stock_reservation"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservation_state_expires_at_idx" ON "stock_reservation"("state", "expires_at");

-- CreateIndex
CREATE INDEX "shift_branch_id_status_idx" ON "shift"("branch_id", "status");

-- CreateIndex
CREATE INDEX "shift_staff_id_opened_at_idx" ON "shift"("staff_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_client_id_key" ON "sale"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_receipt_no_key" ON "sale"("receipt_no");

-- CreateIndex
CREATE INDEX "sale_branch_id_at_idx" ON "sale"("branch_id", "at");

-- CreateIndex
CREATE INDEX "sale_shift_id_idx" ON "sale"("shift_id");

-- CreateIndex
CREATE INDEX "sale_customer_id_idx" ON "sale"("customer_id");

-- CreateIndex
CREATE INDEX "sale_line_sale_id_idx" ON "sale_line"("sale_id");

-- CreateIndex
CREATE INDEX "sale_line_product_id_idx" ON "sale_line"("product_id");

-- CreateIndex
CREATE INDEX "tender_sale_id_idx" ON "tender"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_customer_id_key" ON "cart"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_anonymous_id_key" ON "cart"("anonymous_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_line_cart_id_product_id_key" ON "cart_line"("cart_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_order_no_key" ON "order"("order_no");

-- CreateIndex
CREATE INDEX "order_customer_id_created_at_idx" ON "order"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "order_branch_id_status_idx" ON "order"("branch_id", "status");

-- CreateIndex
CREATE INDEX "order_status_placed_at_idx" ON "order"("status", "placed_at");

-- CreateIndex
CREATE INDEX "order_line_order_id_idx" ON "order_line"("order_id");

-- CreateIndex
CREATE INDEX "order_line_product_id_idx" ON "order_line"("product_id");

-- CreateIndex
CREATE INDEX "order_event_order_id_at_idx" ON "order_event"("order_id", "at");

-- CreateIndex
CREATE INDEX "loyalty_ledger_customer_id_at_idx" ON "loyalty_ledger"("customer_id", "at");

-- CreateIndex
CREATE INDEX "loyalty_ledger_ref_idx" ON "loyalty_ledger"("ref");

-- CreateIndex
CREATE INDEX "approval_branch_id_status_requested_at_idx" ON "approval"("branch_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_reference_key" ON "stock_count"("reference");

-- CreateIndex
CREATE INDEX "stock_count_branch_id_status_idx" ON "stock_count"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_line_count_id_product_id_key" ON "stock_count_line"("count_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_reference_key" ON "transfer"("reference");

-- CreateIndex
CREATE INDEX "transfer_from_branch_id_status_idx" ON "transfer"("from_branch_id", "status");

-- CreateIndex
CREATE INDEX "transfer_to_branch_id_status_idx" ON "transfer"("to_branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_line_transfer_id_product_id_key" ON "transfer_line"("transfer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_reference_key" ON "purchase_order"("reference");

-- CreateIndex
CREATE INDEX "purchase_order_branch_id_status_idx" ON "purchase_order"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_line_po_id_product_id_key" ON "purchase_order_line"("po_id", "product_id");

-- CreateIndex
CREATE INDEX "audit_log_branch_id_occurred_at_idx" ON "audit_log"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcode" ADD CONSTRAINT "product_barcode_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender" ADD CONSTRAINT "tender_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "customer_address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_count"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
