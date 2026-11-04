import type { Metadata } from "next";
import { Suspense } from "react";

import { PasswordForm } from "@/components/auth/password-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Password" };

export default function PasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Password" description="Set or change the password for your JobSync account." />
      <Card>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-40" />}>
            <PasswordBody />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function PasswordBody() {
  const auth = await requireUser();
  if (auth.kind === "dev_bypass") {
    return (
      <p className="text-muted-foreground text-sm">Passwords are managed by Supabase Auth, which is not configured.</p>
    );
  }
  return <PasswordForm />;
}
