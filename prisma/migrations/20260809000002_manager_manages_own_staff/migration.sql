-- A branch manager runs their own branch's cashiers — SPEC §15.2.
--
-- The original policy let only HQ write to `staff`, which made
-- `createSalesPerson` impossible: the repository built the row correctly and
-- the database refused it. The repository was right about the rule and the
-- database did not know it, which is the wrong way round — a rule enforced only
-- in application code is a rule that holds until somebody writes a second
-- caller.
--
-- So the capability is granted here, narrowly, and the limits are the point:
--
--   a branch manager may add and amend **sales people**, **on their own
--   branch**, and nothing else.
--
-- Managers and admins remain HQ's to create. A manager cannot promote
-- themselves, cannot appoint a peer, and cannot reach another branch's roster —
-- and none of that depends on the application asking the right question.

DROP POLICY IF EXISTS staff_write ON "staff";

-- HQ keeps the unrestricted hand.
CREATE POLICY staff_write_hq ON "staff" FOR ALL
  USING (app.is_admin() OR app.is_service())
  WITH CHECK (app.is_admin() OR app.is_service());

/**
 * "This session is a branch manager, and this row is one of their cashiers."
 *
 * Both halves matter. Dropping the role check would let a manager appoint
 * another manager; dropping the branch check would let them staff a branch
 * they have never visited.
 */
CREATE OR REPLACE FUNCTION app.manages_cashier(target_branch uuid, target_role staff_role)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_staff()
     AND app.staff_role() = 'branch_manager'
     AND target_role = 'sales_person'
     AND target_branch IS NOT NULL
     AND target_branch = app.branch_id();
$$;

CREATE POLICY staff_manager_adds_cashier ON "staff" FOR INSERT
  WITH CHECK (app.manages_cashier(branch_id, role));

-- `USING` decides which rows they may touch; `WITH CHECK` decides what those
-- rows may become. Both are needed: without the second, a manager could take a
-- cashier they legitimately manage and move them to another branch, or promote
-- them, in a single UPDATE.
CREATE POLICY staff_manager_amends_cashier ON "staff" FOR UPDATE
  USING (app.manages_cashier(branch_id, role))
  WITH CHECK (app.manages_cashier(branch_id, role));

GRANT EXECUTE ON FUNCTION app.manages_cashier(uuid, staff_role) TO swiftgrocers_app;
