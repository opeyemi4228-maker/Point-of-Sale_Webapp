import type { AuthRepository } from "../repositories";
import type { SignInResult, Staff } from "@/types/staff";
import { MOCK_ACCOUNTS } from "./accounts";

/** Stand-in for network latency so loading states are real during development. */
const LATENCY_MS = 450;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalise(identifier: string) {
  return identifier.trim().toLowerCase();
}

function strip(account: Staff & { password: string }): Staff {
  // Never let the fixture password escape the data layer.
  const { password: _password, ...staff } = account;
  return staff;
}

export const mockAuthRepository: AuthRepository = {
  async signIn(identifier, password): Promise<SignInResult> {
    await wait(LATENCY_MS);

    if (!identifier.trim() || !password) {
      return {
        ok: false,
        error: {
          code: "MISSING_FIELDS",
          message: "Enter your email or staff code, and your password.",
        },
      };
    }

    const key = normalise(identifier);
    const account = MOCK_ACCOUNTS.find(
      (a) => a.email.toLowerCase() === key || a.staffCode.toLowerCase() === key,
    );

    // Same message for an unknown account and a wrong password: telling an
    // attacker which staff codes exist is a free gift (SPEC §17).
    if (!account || account.password !== password) {
      return {
        ok: false,
        error: {
          code: account ? "WRONG_PASSWORD" : "UNKNOWN_ACCOUNT",
          message: "That email, staff code or password is not right. Try again.",
        },
      };
    }

    if (account.status !== "active") {
      return {
        ok: false,
        error: {
          code: "ACCOUNT_SUSPENDED",
          message:
            "This account is suspended. Ask your manager to reactivate it before signing in.",
        },
      };
    }

    return {
      ok: true,
      session: { staff: strip(account), signedInAt: new Date().toISOString() },
    };
  },
};
