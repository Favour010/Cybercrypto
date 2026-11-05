"use client";

import { Check, Minus, Pencil, UserPlus, UserRoundCheck, UserRoundX } from "lucide-react";
import { useId, useState } from "react";

import { useDemo } from "@/components/demo/demo-provider";
import { ConfirmAction, DemoNotice } from "@/components/demo/demo-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APP_ROLES, can, PERMISSIONS, ROLE_META, type AppRole, type Permission } from "@/lib/auth/permissions";
import { addUser, setUserActive, updateUser, type UserInput } from "@/lib/demo/engine";
import type { DemoUser } from "@/lib/demo/types";
import { formatDateTime } from "@/lib/format";

const PERMISSION_LABEL: Record<Permission, string> = {
  "jobs.read": "View jobs, incoming jobs and reports",
  "jobs.create": "Create jobs and send intake payloads",
  "jobs.edit": "Edit jobs, assign portals, run routing",
  "jobs.archive": "Archive and restore jobs",
  "queue.read": "View the automation queue and executions",
  "queue.retry": "Retry, cancel or escalate submissions; start/pause the worker",
  "integration_events.read": "View intake and integration events",
  "portals.manage": "Configure portals and run connection tests",
  "routing_rules.manage": "Manage routing rules",
  "integrations.manage": "Configure n8n and the Playwright controller",
  "users.manage": "Manage users and roles",
  "audit_logs.read": "Read the audit log",
  "system.configure": "Change system configuration and demo data",
};

const EMPTY: UserInput = { email: "", full_name: "", role: "viewer" };

/** Users & roles for the demo organisation. Admin-only changes; everyone can see the role model. */
export function DemoUsers() {
  const { state, user, run } = useDemo();
  const [editing, setEditing] = useState<{ id: string | null; input: UserInput } | null>(null);
  const manage = can(user.role, "users.manage");
  const users = [...state.users].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name),
  );
  const activeAdmins = state.users.filter((u) => u.is_active && u.role === "admin").length;

  return (
    <>
      <DemoNotice>
        <strong>Demo data layer.</strong> Users exist only in this browser. Nobody is emailed and there is no sign-in:
        switch between users from the menu in the top bar to try each role. With Supabase, users sign in with their own
        account and the same roles are enforced by the database.
      </DemoNotice>
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {state.users.filter((u) => u.is_active).length} active of {state.users.length}.{" "}
            {manage ? "Deactivated users keep their history but cannot act." : "Only admins can change users."}
          </CardDescription>
          {manage ? (
            <CardAction>
              <Button size="sm" onClick={() => setEditing({ id: null, input: EMPTY })}>
                <UserPlus aria-hidden /> Add user
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                {manage ? <TableHead className="pr-6 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  me={u.id === user.id}
                  manage={manage}
                  lastAdmin={u.role === "admin" && u.is_active && activeAdmins <= 1}
                  onEdit={() =>
                    setEditing({ id: u.id, input: { email: u.email, full_name: u.full_name, role: u.role } })
                  }
                  onToggle={() =>
                    run(
                      (s, ctx) => setUserActive(s, ctx, u.id, !u.is_active),
                      `${u.full_name} ${u.is_active ? "deactivated" : "reactivated"}.`,
                    ).ok
                  }
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PermissionMatrix />
      {editing ? <UserDialog editing={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function UserRow({
  u,
  me,
  manage,
  lastAdmin,
  onEdit,
  onToggle,
}: {
  u: DemoUser;
  me: boolean;
  manage: boolean;
  lastAdmin: boolean;
  onEdit: () => void;
  onToggle: () => boolean;
}) {
  const blockedReason = me ? "You cannot deactivate yourself." : lastAdmin ? "The last active admin." : null;
  return (
    <TableRow className={u.is_active ? undefined : "text-muted-foreground"}>
      <TableCell className="pl-6">
        <div className="font-medium">
          {u.full_name} {me ? <span className="text-muted-foreground text-xs font-normal">(you)</span> : null}
        </div>
        <div className="text-muted-foreground text-xs">{u.email}</div>
      </TableCell>
      <TableCell>
        <Badge variant={u.role === "admin" ? "default" : "secondary"}>{ROLE_META[u.role].label}</Badge>
      </TableCell>
      <TableCell>
        {u.is_active ? (
          <span className="text-status-good text-sm">Active</span>
        ) : (
          <span className="text-sm">Deactivated</span>
        )}
      </TableCell>
      <TableCell className="hidden text-sm md:table-cell">{formatDateTime(u.created_at)}</TableCell>
      {manage ? (
        <TableCell className="pr-6">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${u.full_name}`}>
              <Pencil aria-hidden /> Edit
            </Button>
            {u.is_active ? (
              <ConfirmAction
                disabled={Boolean(blockedReason)}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={Boolean(blockedReason)}
                    title={blockedReason ?? undefined}
                  >
                    <UserRoundX aria-hidden /> Deactivate
                  </Button>
                }
                title={`Deactivate ${u.full_name}?`}
                description={
                  <p>
                    They can no longer act in JobSync. Their jobs, notes and audit history stay attributed to them. You
                    can reactivate them later.
                  </p>
                }
                confirmLabel="Deactivate"
                destructive
                onConfirm={onToggle}
              />
            ) : (
              <Button size="sm" variant="ghost" onClick={onToggle}>
                <UserRoundCheck aria-hidden /> Reactivate
              </Button>
            )}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function UserDialog({ editing, onClose }: { editing: { id: string | null; input: UserInput }; onClose: () => void }) {
  const { run } = useDemo();
  const [u, setU] = useState<UserInput>(editing.input);
  const base = useId();
  const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setU((x) => ({ ...x, [k]: v }));
  function save() {
    const ok = run(
      (s, ctx) => (editing.id ? updateUser(s, ctx, editing.id, u) : addUser(s, ctx, u)),
      editing.id ? `${u.full_name.trim()} saved.` : `${u.full_name.trim()} added.`,
    ).ok;
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.id ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {editing.id
              ? "Role changes take effect immediately."
              : "The user is created in this browser's demo data. No invitation is sent."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <label htmlFor={`${base}-name`} className="text-muted-foreground mb-1 block text-xs font-medium">
              Full name
            </label>
            <Input
              id={`${base}-name`}
              value={u.full_name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set("full_name", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${base}-email`} className="text-muted-foreground mb-1 block text-xs font-medium">
              Email
            </label>
            <Input
              id={`${base}-email`}
              type="email"
              value={u.email}
              maxLength={254}
              autoComplete="off"
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${base}-role`} className="text-muted-foreground mb-1 block text-xs font-medium">
              Role
            </label>
            <NativeSelect id={`${base}-role`} value={u.role} onChange={(e) => set("role", e.target.value as AppRole)}>
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].label} — {ROLE_META[r].description}
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{editing.id ? "Save user" : "Add user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionMatrix() {
  const perms = Object.keys(PERMISSIONS) as Permission[];
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>What each role can do</CardTitle>
        <CardDescription>
          The same permission table drives the demo engine and the Supabase row-level security policies.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Permission</TableHead>
              {APP_ROLES.map((r) => (
                <TableHead key={r} className="text-center last:pr-6">
                  {ROLE_META[r].label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {perms.map((p) => (
              <TableRow key={p}>
                <TableCell className="pl-6 text-sm whitespace-normal">{PERMISSION_LABEL[p]}</TableCell>
                {APP_ROLES.map((r) => (
                  <TableCell key={r} className="text-center last:pr-6">
                    {can(r, p) ? (
                      <Check className="text-status-good mx-auto size-4" aria-label="Allowed" />
                    ) : (
                      <Minus className="text-muted-foreground mx-auto size-4" aria-label="Not allowed" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
