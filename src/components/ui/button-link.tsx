import Link from "next/link";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button-styles";

/**
 * A link that looks like a button.
 *
 * A real `<a>`, not a `<button>` with an `onClick` that navigates: middle-click,
 * open-in-new-tab and the browser's own status bar all come free, and assistive
 * technology is told this goes somewhere rather than does something.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "admin",
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link {...props} href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
