/**
 * Auth shell — SPEC §16 Auth.
 * Two paths: email + password for managers and admin, staff code + PIN at the till.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh">{children}</div>;
}
