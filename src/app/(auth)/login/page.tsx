import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthConfig, isDevAuthBypassActive } from "@/lib/auth/config";
import { safeNextPath } from "@/lib/auth/routes";
import { isDemoMode } from "@/lib/data-mode";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>Use the account your JobSync administrator created for you.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <LoginBody searchParams={props.searchParams} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next = rawNext ? safeNextPath(rawNext) : undefined;

  if (isDemoMode()) {
    return (
      <Alert variant="info">
        <TriangleAlert />
        <AlertTitle>No sign-in needed in demo mode</AlertTitle>
        <AlertDescription>
          <p>
            JobSync is running on the demo data layer: sample data stored in your own browser, with simulated portal
            runs.{" "}
            <Link href="/" className="font-medium underline underline-offset-2">
              Open the dashboard
            </Link>
            .
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (!getAuthConfig()) {
    return isDevAuthBypassActive() ? (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>Development auth bypass is active</AlertTitle>
        <AlertDescription>
          <p>
            Supabase is not configured and <code className="font-mono text-xs">JOBSYNC_DEV_AUTH_BYPASS=true</code> is
            set, so sign-in is skipped in local development only.{" "}
            <Link href="/" className="font-medium underline underline-offset-2">
              Continue to the dashboard
            </Link>
            .
          </p>
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>Sign-in is not available</AlertTitle>
        <AlertDescription>
          <p>
            Authentication is not configured on this server.{" "}
            <Link href="/setup" className="font-medium underline underline-offset-2">
              See setup instructions
            </Link>
            .
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LoginForm next={next !== "/" ? next : undefined} />
      <p className="text-muted-foreground text-xs">
        Accounts are created by an administrator. There is no public sign-up.
      </p>
    </div>
  );
}
