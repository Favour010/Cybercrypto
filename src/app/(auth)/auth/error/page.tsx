import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Access problem" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  inactive: {
    title: "Your account is deactivated",
    body: "An administrator has deactivated this account. Contact your JobSync administrator to restore access.",
  },
  missing: {
    title: "No JobSync profile for this account",
    body: "You are signed in, but no JobSync profile exists for this user. An administrator needs to check the account.",
  },
  schema_missing: {
    title: "Database schema not applied",
    body: "Sign-in worked, but the JobSync tables were not found. Apply the SQL migrations in supabase/migrations.",
  },
  link: {
    title: "This link is invalid or has expired",
    body: "Ask your administrator to send a new invitation or password-reset email.",
  },
};

export default function AuthErrorPage(props: PageProps<"/auth/error">) {
  return (
    <Suspense>
      <AuthErrorBody searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AuthErrorBody({ searchParams }: { searchParams: PageProps<"/auth/error">["searchParams"] }) {
  const { reason } = await searchParams;
  const m = MESSAGES[typeof reason === "string" ? reason : ""] ?? {
    title: "Something went wrong signing in",
    body: "Try signing in again.",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{m.title}</CardTitle>
        <CardDescription>{m.body}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
        <Button asChild size="sm" variant="ghost">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
