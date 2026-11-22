import { useEffect, useState, type FormEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Package } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CrmContext } from "@/features/companies/crm-context";
import { createExampleCrm, createSupabaseCrm } from "@/features/companies/repository";
import { configurationError, supabase } from "@/lib/supabase";
import { Workspace } from "./workspace";

export function CrmWorkspace({ session = null }: { session?: Session | null }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } }));
  const [crm] = useState(() => session && supabase ? createSupabaseCrm(supabase, session.user.id) : createExampleCrm());
  return (
    <QueryClientProvider client={queryClient}>
      <CrmContext.Provider value={crm}>
        <Workspace email={session?.user.email} demo={!session} signOut={session ? async () => {
          const result = await supabase!.auth.signOut({ scope: "local" });
          if (result.error) throw result.error;
        } : undefined} />
      </CrmContext.Provider>
    </QueryClientProvider>
  );
}

export function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      const result = await supabase!.auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (result.error) throw result.error;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }

  if (configurationError) return (
    <main className="mx-auto max-w-xl p-8">
      <Alert variant="destructive"><AlertDescription>Check the Supabase URL and publishable key, then restart or rebuild the app.</AlertDescription></Alert>
    </main>
  );
  if (!supabase || session) return <CrmWorkspace key={session?.user.id ?? "examples"} session={session} />;
  if (session === undefined) return <main className="p-8" role="status">Checking your session…</main>;

  return (
    <main className="grid min-h-dvh place-items-center bg-muted px-5 py-10">
      <Card className="w-full max-w-md p-3">
        <CardHeader>
          <span className="mb-3 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Package aria-hidden="true" /></span>
          <CardTitle className="text-2xl">GPI Sales Intelligence</CardTitle>
          <CardDescription>Sign in to access your private sales workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={signIn} className="grid gap-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="grid gap-1.5"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <Button size="lg" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
