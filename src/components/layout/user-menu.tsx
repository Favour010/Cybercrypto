import { ChevronDown, KeyRound, LogOut, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { ROLE_META, type AppRole } from "@/lib/auth/permissions";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Dropdown built on <details> so it works before and without hydration. */
export function UserMenu({
  name,
  email,
  role,
  organisation,
  devBypass,
}: {
  name: string;
  email: string;
  role: AppRole;
  organisation: string | null;
  devBypass: boolean;
}) {
  return (
    <details className="group relative">
      <summary
        className={cn(
          "hover:bg-accent flex cursor-pointer list-none items-center gap-2 rounded-full border py-1 pr-2 pl-1 text-sm [&::-webkit-details-marker]:hidden",
          devBypass && "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
        )}
      >
        <span className="bg-primary text-primary-foreground grid size-6 place-items-center rounded-full text-[11px] font-semibold">
          {devBypass ? <ShieldAlert className="size-3.5" aria-hidden /> : initials(name)}
        </span>
        <span className="hidden max-w-36 truncate md:inline">{devBypass ? "Auth bypassed" : name}</span>
        <span className="text-muted-foreground hidden text-xs md:inline">{ROLE_META[role].label}</span>
        <ChevronDown
          className="text-muted-foreground size-3.5 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="bg-popover text-popover-foreground absolute right-0 z-40 mt-2 w-64 rounded-lg border p-1 shadow-lg">
        <div className="px-3 py-2">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-muted-foreground truncate text-xs">{email}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            {ROLE_META[role].label}
            {organisation ? ` · ${organisation}` : ""}
          </div>
          {devBypass ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Local development only: Supabase auth is not configured, so sign-in is skipped.
            </p>
          ) : null}
        </div>
        {!devBypass ? (
          <>
            <div className="bg-border my-1 h-px" />
            <Link
              href="/account/password"
              className="hover:bg-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <KeyRound className="size-4" aria-hidden /> Change password
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
              >
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </form>
          </>
        ) : null}
      </div>
    </details>
  );
}
