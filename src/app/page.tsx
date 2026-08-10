import { redirect } from "next/navigation";

/**
 * One door for the whole chain. The sign-in screen routes each account to its
 * own workspace once it knows the role — see `config/roles.ts`.
 */
export default function RootPage() {
  redirect("/login");
}
