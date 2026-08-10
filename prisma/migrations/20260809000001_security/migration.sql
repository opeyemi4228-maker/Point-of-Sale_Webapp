-- Swiftgrocers — the security layer.
--
-- Everything the schema alone cannot say: the constraints that need two
-- columns, the roles, row-level security, the append-only locks, and the
-- geography that routes an online order to a branch.
--
-- This migration is why the two applications can share one database safely.
-- Without it, Prisma is a single connection with sight of every branch's
-- takings; with it, the database itself refuses to hand Branch A's rows to
-- Branch B's manager, and `tests/isolation/` means something again (SPEC §8).

/* ══ 1. Constraints that Prisma cannot express ═══════════════════════════ */

-- SPEC §7.2: only a general_admin floats above the branches. Everyone else
-- must stand in one.
ALTER TABLE "staff"
  ADD CONSTRAINT "branch_required_for_non_admin"
  CHECK (role = 'general_admin' OR branch_id IS NOT NULL);

-- Rule 2, at the level where it cannot be argued with. A line total may be
-- zero (a free item) but never negative; a refund is its own record with its
-- own positive lines, not a sale with the sign flipped.
ALTER TABLE "sale_line"
  ADD CONSTRAINT "sale_line_amounts_non_negative"
  CHECK (unit_price_kobo >= 0 AND discount_kobo >= 0 AND line_total_kobo >= 0);

ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_amounts_non_negative"
  CHECK (unit_price_kobo >= 0 AND discount_kobo >= 0 AND line_total_kobo >= 0);

ALTER TABLE "product"
  ADD CONSTRAINT "product_prices_non_negative"
  CHECK (price_kobo >= 0 AND cost_kobo >= 0);

-- A movement of zero is not a movement. It is almost always a bug upstream,
-- and it makes the ledger harder to read for no gain.
ALTER TABLE "stock_ledger"
  ADD CONSTRAINT "stock_ledger_delta_not_zero"
  CHECK (delta_milli <> 0);

ALTER TABLE "loyalty_ledger"
  ADD CONSTRAINT "loyalty_delta_not_zero"
  CHECK (delta_points <> 0);

-- You cannot reserve nothing, and you cannot reserve a negative crate.
ALTER TABLE "stock_reservation"
  ADD CONSTRAINT "reservation_qty_positive"
  CHECK (qty_milli > 0);

-- A branch that delivers has to be somewhere. Otherwise it can never be the
-- "nearest" anything and orders routed to it go into a hole.
ALTER TABLE "branch"
  ADD CONSTRAINT "delivering_branch_is_located"
  CHECK (delivers_online = false OR (latitude IS NOT NULL AND longitude IS NOT NULL));

-- A transfer to yourself is a typo, not a movement.
ALTER TABLE "transfer"
  ADD CONSTRAINT "transfer_between_two_branches"
  CHECK (from_branch_id <> to_branch_id);

-- One cart per customer, one per anonymous visitor, and never a cart that
-- belongs to neither.
ALTER TABLE "cart"
  ADD CONSTRAINT "cart_has_an_owner"
  CHECK (customer_id IS NOT NULL OR anonymous_id IS NOT NULL);

/* ══ 2. Defaults the ORM keeps to itself ═════════════════════════════════ */
--
-- Prisma generates `@default(uuid())` and `@updatedAt` in the *client*, so the
-- DDL it emits leaves those columns with no database default at all. Every
-- write that does not go through Prisma Client then fails or drifts: the
-- reservation sweeper, the nightly close, a seed script, a psql fix at 2am,
-- and any raw SQL either application runs.
--
-- A shared database cannot depend on one particular client library to stay
-- consistent. Give Postgres the defaults too. Prisma carries on supplying its
-- own values and these simply never fire.

-- Everything this migration adds beyond Prisma's own DDL lives in `app`, so
-- `\dn` tells you at a glance what is generated and what is ours.
CREATE SCHEMA IF NOT EXISTS app;

-- Primary keys.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND c.data_type = 'uuid'
      AND c.column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
  END LOOP;
END $$;

-- `updated_at`, both halves of it: a default so an INSERT need not mention the
-- column, and a trigger so an UPDATE from outside Prisma still moves it. A
-- timestamp that only some writers maintain is worse than none, because the
-- stale ones look current.
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT now()', t);
    -- The trigger name is built as its own identifier, not glued onto `%I`:
    -- `order` is a reserved word, so `%I` renders it quoted and
    -- `"order"_touch_updated_at` is a syntax error.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t);
  END LOOP;
END $$;

/* ══ 3. The session ══════════════════════════════════════════════════════ */
--
-- Prisma connects as one database role over one connection string, so the
-- database cannot tell a cashier from a general admin by the login alone.
-- Instead every query runs inside a transaction that has set `app.*` session
-- variables, and the policies below read them. src/lib/db/session.ts is the
-- only place those are set, and it is a Prisma client extension so that no
-- query can accidentally skip it.
--
-- `current_setting(..., true)` returns NULL rather than raising when the
-- setting is absent — so a connection that forgot to identify itself is not an
-- error, it is simply a session that can see nothing. That is the correct
-- failure direction.

CREATE OR REPLACE FUNCTION app.actor_kind() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.actor_kind', true), ''), 'none');
$$;

CREATE OR REPLACE FUNCTION app.staff_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.staff_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.customer_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.customer_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.branch_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.branch_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.staff_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.staff_role', true), ''), 'none');
$$;

-- A general_admin sees the whole chain. This is the single exception to branch
-- isolation and it is deliberately one function, so there is exactly one place
-- to audit.
CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.actor_kind() = 'staff' AND app.staff_role() = 'general_admin';
$$;

CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.actor_kind() = 'staff';
$$;

CREATE OR REPLACE FUNCTION app.is_customer() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.actor_kind() = 'customer' AND app.customer_id() IS NOT NULL;
$$;

-- Trusted server-side work with no human behind it: the reservation sweeper,
-- the nightly close, the loyalty accrual job. It is a separate kind rather
-- than "an admin" so that a background job never shows up in an audit trail
-- wearing somebody's name.
CREATE OR REPLACE FUNCTION app.is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.actor_kind() = 'service';
$$;

-- "This staff session may touch this branch's rows."
CREATE OR REPLACE FUNCTION app.can_touch_branch(target uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_service()
      OR app.is_admin()
      OR (app.is_staff() AND target IS NOT NULL AND target = app.branch_id());
$$;

/* ══ 4. The application role ═════════════════════════════════════════════ */
--
-- Two rules from SPEC §8, and neither is optional:
--
--   1. The application connects as a NON-SUPERUSER. A superuser bypasses every
--      policy below, so an app connecting as one is protected by nothing.
--   2. FORCE ROW LEVEL SECURITY on every policied table — a table's *owner*
--      also bypasses row security otherwise, and migrations run as the owner.
--
-- The password is set outside version control. On Neon you may also create
-- this role in the console; this block is idempotent either way.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swiftgrocers_app') THEN
    CREATE ROLE swiftgrocers_app LOGIN;
  END IF;
END $$;

-- Let whoever runs migrations assume the app role.
--
-- This is what allows `SET LOCAL ROLE swiftgrocers_app` in src/lib/db/session.ts
-- to work even on a connection that authenticated as somebody more privileged —
-- and that is the safety net for the single most dangerous misconfiguration in
-- the system. If `DATABASE_URL` is ever pointed at the owner, or at a managed
-- Postgres that quietly maps every login to a superuser, the queries still run
-- as the restricted role and row security still applies.
--
-- Without it, one wrong connection string turns every policy in this file off
-- with no error and no symptom until a manager sees another branch's takings.
DO $$
BEGIN
  EXECUTE format('GRANT swiftgrocers_app TO %I', CURRENT_USER);
EXCEPTION WHEN OTHERS THEN
  -- Already a member, or the grantor lacks the right — either way the app can
  -- still connect directly as the role, which is the intended arrangement.
  NULL;
END $$;

GRANT USAGE ON SCHEMA public, app TO swiftgrocers_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO swiftgrocers_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO swiftgrocers_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO swiftgrocers_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO swiftgrocers_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO swiftgrocers_app;

/* ══ 5. Row-level security ═══════════════════════════════════════════════ */

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── 5a. The chain's own furniture ───────────────────────────────────────────
-- Readable by any authenticated session, writable only from the top. A shopper
-- needs to see branch names and coordinates to pick a collection point.

CREATE POLICY org_read ON "org" FOR SELECT
  USING (app.is_staff() OR app.is_customer() OR app.is_service());
CREATE POLICY org_write ON "org" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

CREATE POLICY branch_read ON "branch" FOR SELECT
  USING (app.is_staff() OR app.is_customer() OR app.is_service());
CREATE POLICY branch_write ON "branch" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

-- A manager may see their own roster; only HQ may change it.
CREATE POLICY staff_read ON "staff" FOR SELECT
  USING (app.can_touch_branch(branch_id) OR app.staff_id() = id);
CREATE POLICY staff_write ON "staff" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

CREATE POLICY device_all ON "device" FOR ALL
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

-- ── 5b. The catalog ─────────────────────────────────────────────────────────
-- Central, and the same rows for both applications. Staff see everything on
-- the shelf; shoppers see only what is listed online and not delisted.
--
-- Note what RLS cannot do here: `product.cost_kobo` must never reach a cashier
-- or a shopper, and row security has nothing to say about columns. That is
-- handled above the database — the storefront reads the `product_public` view
-- created in §7, and the till's repository never selects the column.

CREATE POLICY category_read ON "category" FOR SELECT
  USING (app.is_staff() OR app.is_service() OR (app.is_customer() AND deleted_at IS NULL));
CREATE POLICY category_write ON "category" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

CREATE POLICY product_read ON "product" FOR SELECT
  USING (
    app.is_staff() OR app.is_service()
    OR (app.is_customer() AND online_listed = true AND delisted_at IS NULL)
  );
CREATE POLICY product_write ON "product" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

CREATE POLICY product_barcode_read ON "product_barcode" FOR SELECT
  USING (app.is_staff() OR app.is_service());
CREATE POLICY product_barcode_write ON "product_barcode" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

CREATE POLICY product_image_read ON "product_image" FOR SELECT
  USING (
    app.is_staff() OR app.is_service()
    OR EXISTS (
      SELECT 1 FROM "product" p
      WHERE p.id = product_image.product_id
        AND p.online_listed = true AND p.delisted_at IS NULL
    )
  );
CREATE POLICY product_image_write ON "product_image" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

-- ── 5c. Stock ───────────────────────────────────────────────────────────────
-- Strictly the session's own branch. This is the isolation the blocking test
-- exists to prove: a manager in Gwarinpa asking for the ledger gets Gwarinpa,
-- and asking for Lekki gets nothing at all rather than an error.
--
-- INSERT only — the append-only locks in §6 take away UPDATE and DELETE.

CREATE POLICY stock_ledger_read ON "stock_ledger" FOR SELECT
  USING (app.can_touch_branch(branch_id));
CREATE POLICY stock_ledger_append ON "stock_ledger" FOR INSERT
  WITH CHECK (app.can_touch_branch(branch_id));

CREATE POLICY stock_reservation_all ON "stock_reservation" FOR ALL
  USING (
    app.can_touch_branch(branch_id)
    OR (app.is_customer() AND EXISTS (
      SELECT 1 FROM "order" o
      WHERE o.id = stock_reservation.order_id AND o.customer_id = app.customer_id()
    ))
  )
  WITH CHECK (app.can_touch_branch(branch_id));

-- ── 5d. The till ────────────────────────────────────────────────────────────

CREATE POLICY shift_all ON "shift" FOR ALL
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

CREATE POLICY sale_read ON "sale" FOR SELECT
  USING (
    app.can_touch_branch(branch_id)
    OR (app.is_customer() AND customer_id = app.customer_id())
  );
CREATE POLICY sale_append ON "sale" FOR INSERT
  WITH CHECK (app.can_touch_branch(branch_id));
-- Narrow on purpose: the only lawful update is marking a synced sale synced,
-- and the trigger in §6 checks that nothing else moved.
CREATE POLICY sale_mark_synced ON "sale" FOR UPDATE
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

-- The children carry no branch of their own, so they borrow their parent's.
CREATE POLICY sale_line_read ON "sale_line" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "sale" s WHERE s.id = sale_line.sale_id));
CREATE POLICY sale_line_append ON "sale_line" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM "sale" s WHERE s.id = sale_line.sale_id));

CREATE POLICY tender_read ON "tender" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "sale" s WHERE s.id = tender.sale_id));
CREATE POLICY tender_append ON "tender" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM "sale" s WHERE s.id = tender.sale_id));

-- ── 5e. Customers, and the storefront ───────────────────────────────────────
-- A customer belongs to the chain, not to a branch: the same person shops in
-- Lekki on Tuesday and orders to Gwarinpa on Friday, and the till must find
-- them by phone wherever they are standing. So staff read the customer table
-- chain-wide, and a shopper reads exactly one row — their own.

CREATE POLICY customer_read ON "customer" FOR SELECT
  USING (app.is_staff() OR app.is_service() OR id = app.customer_id());
CREATE POLICY customer_write ON "customer" FOR ALL
  USING (app.is_staff() OR app.is_service() OR id = app.customer_id())
  WITH CHECK (app.is_staff() OR app.is_service() OR id = app.customer_id());

CREATE POLICY customer_address_all ON "customer_address" FOR ALL
  USING (app.is_staff() OR app.is_service() OR customer_id = app.customer_id())
  WITH CHECK (app.is_service() OR customer_id = app.customer_id());

CREATE POLICY cart_all ON "cart" FOR ALL
  USING (app.is_service() OR customer_id = app.customer_id())
  WITH CHECK (app.is_service() OR customer_id = app.customer_id());

CREATE POLICY cart_line_all ON "cart_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "cart" c WHERE c.id = cart_line.cart_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "cart" c WHERE c.id = cart_line.cart_id));

-- An order is visible to the shopper who placed it and to the branch that has
-- to fill it. Nobody else, including the branch down the road.
CREATE POLICY order_read ON "order" FOR SELECT
  USING (
    app.can_touch_branch(branch_id)
    OR (app.is_customer() AND customer_id = app.customer_id())
  );
CREATE POLICY order_write ON "order" FOR ALL
  USING (
    app.can_touch_branch(branch_id)
    OR (app.is_customer() AND customer_id = app.customer_id())
  )
  WITH CHECK (
    app.can_touch_branch(branch_id)
    OR (app.is_customer() AND customer_id = app.customer_id())
  );

CREATE POLICY order_line_all ON "order_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "order" o WHERE o.id = order_line.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "order" o WHERE o.id = order_line.order_id));

CREATE POLICY order_event_read ON "order_event" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "order" o WHERE o.id = order_event.order_id));
CREATE POLICY order_event_append ON "order_event" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM "order" o WHERE o.id = order_event.order_id));

-- ── 5f. Loyalty ─────────────────────────────────────────────────────────────
-- Chain-wide for staff, because points earned in Lekki are spendable in Ikeja
-- and a till has to be able to read the balance wherever the customer walks in.

CREATE POLICY loyalty_read ON "loyalty_ledger" FOR SELECT
  USING (app.is_staff() OR app.is_service() OR customer_id = app.customer_id());
CREATE POLICY loyalty_append ON "loyalty_ledger" FOR INSERT
  WITH CHECK (app.is_staff() OR app.is_service());

-- ── 5g. Operations ──────────────────────────────────────────────────────────

CREATE POLICY approval_all ON "approval" FOR ALL
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

CREATE POLICY stock_count_all ON "stock_count" FOR ALL
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

CREATE POLICY stock_count_line_all ON "stock_count_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "stock_count" c WHERE c.id = stock_count_line.count_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "stock_count" c WHERE c.id = stock_count_line.count_id));

-- A transfer is visible to both ends of it, and to nobody in between.
CREATE POLICY transfer_all ON "transfer" FOR ALL
  USING (app.can_touch_branch(from_branch_id) OR app.can_touch_branch(to_branch_id))
  WITH CHECK (app.can_touch_branch(from_branch_id) OR app.can_touch_branch(to_branch_id));

CREATE POLICY transfer_line_all ON "transfer_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "transfer" t WHERE t.id = transfer_line.transfer_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "transfer" t WHERE t.id = transfer_line.transfer_id));

CREATE POLICY purchase_order_all ON "purchase_order" FOR ALL
  USING (app.can_touch_branch(branch_id))
  WITH CHECK (app.can_touch_branch(branch_id));

CREATE POLICY purchase_order_line_all ON "purchase_order_line" FOR ALL
  USING (EXISTS (SELECT 1 FROM "purchase_order" p WHERE p.id = purchase_order_line.po_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "purchase_order" p WHERE p.id = purchase_order_line.po_id));

-- Readable where it is relevant, appendable by anyone acting, editable by
-- nobody at all (§6).
CREATE POLICY audit_read ON "audit_log" FOR SELECT
  USING (app.is_admin() OR app.is_service() OR app.can_touch_branch(branch_id));
CREATE POLICY audit_append ON "audit_log" FOR INSERT
  WITH CHECK (app.is_staff() OR app.is_service());

/* ══ 6. Append-only ══════════════════════════════════════════════════════ */
--
-- Rule 3 and rule 4, locked twice: the grant is taken away so the statement is
-- refused before it starts, and a trigger rejects it even if a future
-- migration hands the grant back by accident. Belt and braces, because these
-- are the tables the money and the stock rest on.

CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not allowed. Append a reversing entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stock_ledger', 'loyalty_ledger', 'audit_log', 'order_event',
    'sale_line', 'tender'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.reject_mutation()',
      t || '_append_only', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM swiftgrocers_app', t);
  END LOOP;
END $$;

-- A sale is immutable with exactly one exception. An offline till has to be
-- able to come back and stamp `synced_at` on what it queued (rule 8), and that
-- is the only column it may touch. Everything else about the sale was fixed
-- the moment the customer took the receipt.
CREATE OR REPLACE FUNCTION app.sale_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'synced_at') <> (to_jsonb(OLD) - 'synced_at') THEN
    RAISE EXCEPTION
      'A sale is written once (%): only synced_at may change afterwards. Void or refund it instead.',
      OLD.receipt_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sale_immutable BEFORE UPDATE ON "sale"
  FOR EACH ROW EXECUTE FUNCTION app.sale_is_immutable();

REVOKE DELETE ON "sale" FROM swiftgrocers_app;

/* ══ 7. What the storefront may see of a product ═════════════════════════ */
--
-- Row security cannot hide a column, and `cost_kobo` is the one column in the
-- catalog that must never leave the building. The storefront reads this view
-- rather than the table, so the margin on a tin of milk cannot be lifted out
-- of a JSON payload by anybody who opens the network tab.
--
-- `security_invoker` keeps the caller's RLS in force, so the view narrows what
-- is visible and never widens it.

CREATE VIEW app.product_public
WITH (security_invoker = true) AS
SELECT
  p.id, p.sku, p.slug, p.name, p.brand, p.description,
  p.category_id, p.price_kobo, p.compare_at_price_kobo,
  p.sold_by, p.unit, p.image_url, p.tags,
  p.rating_avg, p.rating_count, p.created_at
FROM "product" p
WHERE p.online_listed = true AND p.delisted_at IS NULL;

GRANT SELECT ON app.product_public TO swiftgrocers_app;

/* ══ 8. Stock a till may actually sell ═══════════════════════════════════ */
--
-- The number that keeps the two applications from selling the same crate.
--
--   on hand   = every movement ever recorded        (rule 3: derived, never stored)
--   held      = paid online, not yet lifted off the shelf
--   available = on hand − held
--
-- A cashier is shown `available`. The crate is still physically in the shop —
-- `on_hand` says so, and the stock count will find it — but it is spoken for.

CREATE OR REPLACE FUNCTION app.available_stock(p_branch uuid, p_product uuid)
RETURNS TABLE (on_hand_milli bigint, held_milli bigint, available_milli bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(l.total, 0) AS on_hand_milli,
    COALESCE(r.held, 0)  AS held_milli,
    COALESCE(l.total, 0) - COALESCE(r.held, 0) AS available_milli
  FROM
    (SELECT SUM(delta_milli)::bigint AS total
       FROM "stock_ledger"
      WHERE branch_id = p_branch AND product_id = p_product) l
    FULL JOIN
    (SELECT SUM(qty_milli)::bigint AS held
       FROM "stock_reservation"
      WHERE branch_id = p_branch AND product_id = p_product
        AND state = 'held' AND expires_at > now()) r
    ON true;
$$;

-- The same figure for a whole branch at once — what the stock screen and the
-- storefront's availability check both read, rather than N round trips.
CREATE OR REPLACE VIEW app.branch_stock
WITH (security_invoker = true) AS
SELECT
  b.id AS branch_id,
  p.id AS product_id,
  COALESCE(l.total, 0)::bigint AS on_hand_milli,
  COALESCE(r.held, 0)::bigint AS held_milli,
  (COALESCE(l.total, 0) - COALESCE(r.held, 0))::bigint AS available_milli,
  l.last_moved_at
FROM "branch" b
CROSS JOIN "product" p
LEFT JOIN LATERAL (
  SELECT SUM(delta_milli) AS total, MAX(at) AS last_moved_at
    FROM "stock_ledger" sl
   WHERE sl.branch_id = b.id AND sl.product_id = p.id
) l ON true
LEFT JOIN LATERAL (
  SELECT SUM(qty_milli) AS held
    FROM "stock_reservation" sr
   WHERE sr.branch_id = b.id AND sr.product_id = p.id
     AND sr.state = 'held' AND sr.expires_at > now()
) r ON true
WHERE l.total IS NOT NULL OR r.held IS NOT NULL;

GRANT SELECT ON app.branch_stock TO swiftgrocers_app;

/* ══ 9. Which branch takes this order ════════════════════════════════════ */
--
-- The shopper's browser offers a latitude and longitude, or they pick a branch
-- by hand. Either way the order goes to a real shop that can actually fill it,
-- and the distance that decided it is recorded on the order so a manager can
-- see the reasoning months later.
--
-- Haversine rather than PostGIS: this is a handful of branches, the earth is
-- close enough to a sphere over Lagos, and it costs nothing to install.

CREATE OR REPLACE FUNCTION app.distance_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- Candidate branches for a delivery, nearest first.
--
-- Only active shops that deliver, and only those whose own service radius
-- reaches the address — a branch does not get handed a drop it has already
-- said it will not drive to.
CREATE OR REPLACE FUNCTION app.nearest_branches(
  p_lat double precision,
  p_lon double precision,
  p_limit int DEFAULT 5
)
RETURNS TABLE (branch_id uuid, code text, name text, distance_m int, in_range boolean)
LANGUAGE sql STABLE AS $$
  SELECT
    b.id,
    b.code,
    b.name,
    round(app.distance_m(p_lat, p_lon, b.latitude::double precision, b.longitude::double precision))::int,
    app.distance_m(p_lat, p_lon, b.latitude::double precision, b.longitude::double precision) <= b.service_radius_m
  FROM "branch" b
  WHERE b.status = 'active'
    AND b.deleted_at IS NULL
    AND b.delivers_online = true
    AND b.latitude IS NOT NULL
    AND b.longitude IS NOT NULL
  ORDER BY 4 ASC
  LIMIT p_limit;
$$;

-- The routing decision itself: the nearest in-range branch that can cover
-- every line of the basket from stock it actually has available.
--
-- Returns nothing when no single branch can fill the order. That is a real
-- answer and the checkout must handle it — offering a later slot, or a split,
-- or an honest "not today". Silently assigning it to the nearest branch anyway
-- is how a customer gets a confirmation email for groceries that do not exist.
CREATE OR REPLACE FUNCTION app.route_order(
  p_lat double precision,
  p_lon double precision,
  p_lines jsonb  -- [{"product_id": "...", "qty_milli": 2000}, ...]
)
RETURNS TABLE (branch_id uuid, distance_m int)
LANGUAGE sql STABLE AS $$
  WITH wanted AS (
    SELECT (x->>'product_id')::uuid AS product_id,
           (x->>'qty_milli')::bigint AS qty_milli
    FROM jsonb_array_elements(p_lines) x
  ),
  candidates AS (
    SELECT n.branch_id, n.distance_m
    FROM app.nearest_branches(p_lat, p_lon, 20) n
    WHERE n.in_range
  )
  SELECT c.branch_id, c.distance_m
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM wanted w
    LEFT JOIN app.branch_stock s
      ON s.branch_id = c.branch_id AND s.product_id = w.product_id
    WHERE COALESCE(s.available_milli, 0) < w.qty_milli
  )
  ORDER BY c.distance_m ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO swiftgrocers_app;
