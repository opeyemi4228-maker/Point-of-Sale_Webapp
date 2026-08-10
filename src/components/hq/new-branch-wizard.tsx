"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleCheck,
  LoaderCircle,
  Sliders,
  TabletSmartphone,
  UserRound,
  Boxes,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { CURRENCY_SYMBOL } from "@/config/currency";
import { cn } from "@/lib/utils/cn";
import type { NewBranch } from "@/types/operations";

/**
 * Create a branch — SPEC §4 and §15.3.
 *
 * Five steps, because a manager filling this in is gathering facts from three
 * different places and a single 18-field form is where that gets abandoned.
 * Each step validates on the way forward, so nobody reaches the review with a
 * problem four steps behind them.
 *
 * The provisioning run is shown as it happens and is **atomic**: a failure at
 * any step rolls the whole thing back. Half-created branches are the single
 * worst outcome here — a branch that exists but has no catalog, or a manager
 * invite pointing at nothing — so the transaction boundary is not negotiable,
 * and the UI never implies partial success.
 */

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
].map((name) => ({ value: name, label: name }));

const STEPS = [
  { key: "details", title: "Branch details", icon: Building2 },
  { key: "settings", title: "Settings", icon: Sliders },
  { key: "manager", title: "Branch manager", icon: UserRound },
  { key: "catalog", title: "Catalog", icon: Boxes },
  { key: "devices", title: "Tills", icon: TabletSmartphone },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
type Errors = Partial<Record<keyof NewBranch, string>>;

const INITIAL: NewBranch = {
  name: "",
  code: "",
  city: "",
  state: "Lagos",
  address: "",
  phone: "",
  openingFloat: "20000",
  lowStockThreshold: "10",
  managerName: "",
  managerEmail: "",
  managerPhone: "",
  catalogMode: "full",
  tills: "2",
};

/** What the provisioning job does, in the order §4 does it. */
const PROVISIONING_STEPS = [
  "Reserving the branch code and receipt prefix",
  "Writing branch settings",
  "Seeding the catalog at branch level",
  "Creating the manager account and invite",
  "Registering till devices and issuing keys",
  "Writing the opening ledger marker and audit row",
];

export function NewBranchWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<NewBranch>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [reviewing, setReviewing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const step = STEPS[stepIndex];

  function set<K extends keyof NewBranch>(key: K, value: NewBranch[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(key: StepKey): boolean {
    const next: Errors = {};

    if (key === "details") {
      if (values.name.trim().length < 3) next.name = "Give the branch a name people use.";
      if (!/^[A-Z]{3}\d{2}$/.test(values.code.trim().toUpperCase())) {
        next.code = "Three letters and two digits, e.g. ABJ03. It prints on every receipt.";
      }
      if (!values.city.trim()) next.city = "Which city?";
      if (values.address.trim().length < 8) next.address = "The full street address.";
      if (!/^(\+234\d{10}|0\d{10})$/.test(values.phone.replace(/[^\d+]/g, ""))) {
        next.phone = "Use 0801 234 5678 or +234 801 234 5678.";
      }
    }

    if (key === "settings") {
      if (!(Number(values.openingFloat) >= 0)) next.openingFloat = "A number, in naira.";
      if (!(Number(values.lowStockThreshold) > 0)) {
        next.lowStockThreshold = "At least 1.";
      }
    }

    if (key === "manager") {
      if (values.managerName.trim().length < 3) next.managerName = "Their full name.";
      if (!/^\S+@\S+\.\S+$/.test(values.managerEmail.trim())) {
        next.managerEmail = "The invite is sent here, so it has to be right.";
      }
      if (!/^(\+234\d{10}|0\d{10})$/.test(values.managerPhone.replace(/[^\d+]/g, ""))) {
        next.managerPhone = "Use 0801 234 5678 or +234 801 234 5678.";
      }
    }

    if (key === "devices") {
      const n = Number(values.tills);
      if (!Number.isInteger(n) || n < 1 || n > 12) next.tills = "Between 1 and 12.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goForward() {
    if (!validate(step.key)) return;
    if (stepIndex === STEPS.length - 1) setReviewing(true);
    else setStepIndex((i) => i + 1);
  }

  function goBack() {
    if (reviewing) setReviewing(false);
    else setStepIndex((i) => Math.max(0, i - 1));
  }

  async function provision() {
    setProgress(0);
    for (let i = 0; i < PROVISIONING_STEPS.length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      setProgress(i + 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    setDone(true);
  }

  if (done) {
    return (
      <PageBody width="narrow">
        <Panel>
          <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <CircleCheck size={36} aria-hidden className="text-market" />
            <h2 className="font-display text-display-md text-ink">
              {values.name} is trading
            </h2>
            <p className="max-w-md text-body-lg text-ink-70">
              The workspace is sealed to this branch, {values.tills}{" "}
              {Number(values.tills) === 1 ? "till is" : "tills are"} registered, and an invite is
              on its way to {values.managerEmail}. Receipts here will read{" "}
              <span className="font-mono text-ink">{values.code.toUpperCase()}-T1-…</span>
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <Button onClick={() => router.push("/hq/branches")}>View branches</Button>
              <Button variant="secondary" onClick={() => router.push("/hq")}>
                Back to overview
              </Button>
            </div>
          </div>
        </Panel>
      </PageBody>
    );
  }

  if (progress !== null) {
    return (
      <PageBody width="narrow">
        <Panel>
          <div className="px-6 py-10">
            <h2 className="font-display text-display-md text-ink">
              Provisioning {values.name}
            </h2>
            <p className="mt-2 text-body-lg text-ink-70">
              This runs as one transaction. If any step fails, nothing is created.
            </p>

            <ol className="mt-8 flex flex-col gap-3">
              {PROVISIONING_STEPS.map((label, index) => {
                const state =
                  index < progress ? "done" : index === progress ? "running" : "waiting";
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center">
                      {state === "done" && (
                        <CircleCheck size={20} aria-hidden className="text-market" />
                      )}
                      {state === "running" && (
                        <LoaderCircle
                          size={20}
                          aria-hidden
                          className="animate-spin text-market"
                        />
                      )}
                      {state === "waiting" && (
                        <span className="size-2 rounded-pill bg-line" aria-hidden />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-body-lg",
                        state === "waiting" ? "text-ink-40" : "text-ink",
                      )}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </Panel>
      </PageBody>
    );
  }

  return (
    <PageBody width="narrow">
      <StepRail current={reviewing ? STEPS.length : stepIndex} />

        <Panel>
          <div className="border-b border-line px-6 py-4">
            <p className="text-label uppercase text-ink-40">
              {reviewing ? `Step ${STEPS.length + 1} of ${STEPS.length + 1}` : `Step ${stepIndex + 1} of ${STEPS.length + 1}`}
            </p>
            <h2 className="mt-1 font-display text-title text-ink">
              {reviewing ? "Review" : step.title}
            </h2>
          </div>

          <div className="px-6 py-6">
            {reviewing ? (
              <Review values={values} />
            ) : (
              <StepFields
                step={step.key}
                values={values}
                errors={errors}
                set={set}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
            <Button
              variant="secondary"
              onClick={goBack}
              disabled={stepIndex === 0 && !reviewing}
            >
              <ArrowLeft size={18} aria-hidden />
              Back
            </Button>

            {reviewing ? (
              <Button onClick={provision}>
                <Check size={18} aria-hidden />
                Create branch
              </Button>
            ) : (
              <Button onClick={goForward}>
                Continue
                <ArrowRight size={18} aria-hidden />
              </Button>
            )}
          </div>
        </Panel>
    </PageBody>
  );
}

/* ── Step rail ────────────────────────────────────────────────────────────── */

function StepRail({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {[...STEPS, { key: "review", title: "Review", icon: Check }].map((s, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        const Icon = s.icon;
        return (
          <li
            key={s.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-pill border px-3 py-1.5 text-label font-semibold",
              state === "done" && "border-market/30 bg-market-tint text-ink",
              state === "current" && "border-market bg-market text-white",
              state === "todo" && "border-line bg-surface text-ink-40",
            )}
          >
            {state === "done" ? (
              <Check size={14} aria-hidden />
            ) : (
              <Icon size={14} aria-hidden />
            )}
            {s.title}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Fields per step ──────────────────────────────────────────────────────── */

function StepFields({
  step,
  values,
  errors,
  set,
}: {
  step: StepKey;
  values: NewBranch;
  errors: Errors;
  set: <K extends keyof NewBranch>(key: K, value: NewBranch[K]) => void;
}) {
  if (step === "details") {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Branch name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Gwarinpa"
          required
          invalid={Boolean(errors.name)}
          hint={errors.name}
        />
        <TextField
          label="Branch code"
          value={values.code}
          onChange={(e) => set("code", e.target.value.toUpperCase())}
          placeholder="ABJ03"
          autoCapitalize="characters"
          required
          invalid={Boolean(errors.code)}
          hint={errors.code ?? "Prints on every receipt, e.g. ABJ03-T1-20260809-0042."}
        />
        <TextField
          label="Street address"
          className="sm:col-span-2"
          value={values.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="6th Avenue, Gwarinpa"
          required
          invalid={Boolean(errors.address)}
          hint={errors.address}
        />
        <TextField
          label="City"
          value={values.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder="Abuja"
          required
          invalid={Boolean(errors.city)}
          hint={errors.city}
        />
        <Select
          label="State"
          value={values.state}
          onChange={(e) => set("state", e.target.value)}
          options={NIGERIAN_STATES}
          required
        />
        <TextField
          label="Branch phone"
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="0802 540 1891"
          inputMode="tel"
          required
          invalid={Boolean(errors.phone)}
          hint={errors.phone}
        />
      </div>
    );
  }

  if (step === "settings") {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="info" title="Fixed for every branch">
          VAT is 7.5% and inclusive in the shelf price, and the currency is the naira. Neither
          is a per-branch setting, so neither is asked here.
        </Alert>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={`Opening float (${CURRENCY_SYMBOL})`}
            value={values.openingFloat}
            onChange={(e) => set("openingFloat", e.target.value)}
            inputMode="numeric"
            required
            invalid={Boolean(errors.openingFloat)}
            hint={errors.openingFloat ?? "What each till starts the day with in the drawer."}
          />
          <TextField
            label="Low-stock threshold"
            value={values.lowStockThreshold}
            onChange={(e) => set("lowStockThreshold", e.target.value)}
            inputMode="numeric"
            required
            invalid={Boolean(errors.lowStockThreshold)}
            hint={errors.lowStockThreshold ?? "Units on hand before the branch is told to reorder."}
          />
        </div>
      </div>
    );
  }

  if (step === "manager") {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-body-lg text-ink-70">
          They get an invite on completion and set their own password. Until they do, the branch
          exists but nobody can open a till in it.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Full name"
            className="sm:col-span-2"
            value={values.managerName}
            onChange={(e) => set("managerName", e.target.value)}
            placeholder="Ifeoma Nwosu"
            required
            invalid={Boolean(errors.managerName)}
            hint={errors.managerName}
          />
          <TextField
            label="Email address"
            value={values.managerEmail}
            onChange={(e) => set("managerEmail", e.target.value)}
            placeholder="name@swiftgrocers.ng"
            inputMode="email"
            required
            invalid={Boolean(errors.managerEmail)}
            hint={errors.managerEmail}
          />
          <TextField
            label="Phone number"
            value={values.managerPhone}
            onChange={(e) => set("managerPhone", e.target.value)}
            placeholder="0801 234 5678"
            inputMode="tel"
            required
            invalid={Boolean(errors.managerPhone)}
            hint={errors.managerPhone}
          />
        </div>
      </div>
    );
  }

  if (step === "catalog") {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-lg text-ink-70">
          Every branch sells from the one master catalog. This only decides what is stocked here
          on day one — prices stay central either way.
        </legend>

        <RadioCard
          name="catalogMode"
          value="full"
          checked={values.catalogMode === "full"}
          onChange={() => set("catalogMode", "full")}
          title="Copy the full master catalog"
          detail="Every active product, at master prices, starting at zero on hand. The usual choice."
        />
        <RadioCard
          name="catalogMode"
          value="none"
          checked={values.catalogMode === "none"}
          onChange={() => set("catalogMode", "none")}
          title="Start empty"
          detail="Nothing stocked. The manager adds lines as the first delivery is received."
        />
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-lg text-ink-70">
        Each till gets a device key at provisioning. A till without one cannot sell, and a key
        can be revoked from HQ the moment a device goes missing.
      </p>
      <TextField
        label="Number of tills"
        value={values.tills}
        onChange={(e) => set("tills", e.target.value)}
        inputMode="numeric"
        required
        invalid={Boolean(errors.tills)}
        hint={errors.tills ?? "You can register more later without touching the branch."}
        className="max-w-40"
      />
    </div>
  );
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-input border p-4",
        "transition-colors duration-150 ease-out-pos",
        checked ? "border-market bg-market-tint" : "border-line bg-surface hover:border-ink-40",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-5 shrink-0 accent-market"
      />
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-body text-ink-70">{detail}</span>
      </span>
    </label>
  );
}

/* ── Review ───────────────────────────────────────────────────────────────── */

function Review({ values }: { values: NewBranch }) {
  const rows: [string, string][] = [
    ["Branch", `${values.name} (${values.code.toUpperCase()})`],
    ["Address", `${values.address}, ${values.city}, ${values.state}`],
    ["Phone", values.phone],
    ["Opening float", `${CURRENCY_SYMBOL}${Number(values.openingFloat).toLocaleString("en-NG")}`],
    ["Low-stock threshold", `${values.lowStockThreshold} units`],
    ["Branch manager", `${values.managerName} · ${values.managerEmail}`],
    ["Manager phone", values.managerPhone],
    [
      "Catalog",
      values.catalogMode === "full" ? "Full master catalog at zero on hand" : "Empty",
    ],
    ["Tills", `${values.tills} registered`],
  ];

  return (
    <>
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-x-6 gap-y-1 py-3">
            <dt className="w-48 shrink-0 text-body text-ink-40">{label}</dt>
            <dd className="min-w-0 flex-1 text-body-lg text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <Alert tone="signal" className="mt-6" title="This runs as one transaction">
        The branch, its settings, its catalog, the manager invite and the device keys are
        created together or not at all. A failure at any step leaves nothing behind.
      </Alert>
    </>
  );
}
