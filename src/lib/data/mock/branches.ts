export type MockBranch = {
  id: string;
  name: string;
  city: string;
  /** Ordering everywhere a branch list appears — flagship first. */
  position: number;
};

/**
 * FIXTURE DATA — deleted when the real branch endpoints land (SPEC §16).
 * The four branches the spec's §15.3 mock-ups use.
 */
export const MOCK_BRANCHES: MockBranch[] = [
  { id: "brn_gwarinpa", name: "Gwarinpa", city: "Abuja", position: 1 },
  { id: "brn_wuse", name: "Wuse II", city: "Abuja", position: 2 },
  { id: "brn_lekki", name: "Lekki Phase 1", city: "Lagos", position: 3 },
  { id: "brn_ikeja", name: "Ikeja GRA", city: "Lagos", position: 4 },
];

export const BRANCH_NAME: Record<string, string> = Object.fromEntries(
  MOCK_BRANCHES.map((branch) => [branch.id, branch.name]),
);

/** The branch a demo session is standing in. */
export const CURRENT_BRANCH_ID = "brn_gwarinpa";
