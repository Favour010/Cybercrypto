"use client";

import { ChevronDown, FlaskConical } from "lucide-react";

import { useDemoOptional } from "@/components/demo/demo-provider";
import { ROLE_META } from "@/lib/auth/permissions";
import { switchUser } from "@/lib/demo/engine";

/** Demo identity: no real authentication. Switch roles to try permissions. */
export function DemoUserMenu() {
  const demo = useDemoOptional();
  if (!demo) return <span className="bg-muted h-8 w-32 animate-pulse rounded-full" aria-hidden />;
  const { state, user, run } = demo;
  return (
    <details className="group relative">
      <summary className="hover:bg-accent flex cursor-pointer list-none items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1 pr-2 pl-1 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 [&::-webkit-details-marker]:hidden">
        <span className="bg-primary text-primary-foreground grid size-6 place-items-center rounded-full text-[11px] font-semibold">
          {user.full_name
            .split(" ")
            .map((p) => p[0])
            .join("")}
        </span>
        <span className="hidden max-w-36 truncate md:inline">{user.full_name}</span>
        <span className="text-muted-foreground hidden text-xs md:inline">{ROLE_META[user.role].label}</span>
        <ChevronDown
          className="text-muted-foreground size-3.5 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="bg-popover text-popover-foreground absolute right-0 z-40 mt-2 w-72 rounded-lg border p-1 shadow-lg">
        <div className="flex items-start gap-2 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>Demo mode: no sign-in. Switch the demo user to see what each role may do.</p>
        </div>
        <div className="bg-border my-1 h-px" />
        <fieldset>
          <legend className="text-muted-foreground px-3 py-1 text-[11px] font-medium tracking-wide uppercase">
            Act as
          </legend>
          {state.users.map((u) => (
            <label
              key={u.id}
              className="hover:bg-accent flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="demo-user"
                className="accent-primary mt-1"
                checked={u.id === user.id}
                onChange={() =>
                  run((s) => switchUser(s, u.id), `Now acting as ${u.full_name} (${ROLE_META[u.role].label}).`)
                }
              />
              <span>
                <span className="block font-medium">{u.full_name}</span>
                <span className="text-muted-foreground block text-xs">{ROLE_META[u.role].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  );
}
