import { ShieldX } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { ROLE_META, type AppRole } from "@/lib/auth/permissions";

export function PermissionDenied({ role, needed, what }: { role: AppRole; needed: AppRole; what: string }) {
  return (
    <EmptyState
      icon={ShieldX}
      title="You do not have permission"
      description={`${what} requires the ${ROLE_META[needed].label} role or higher. Your role is ${ROLE_META[role].label}. Ask an administrator if you need access.`}
    />
  );
}
