"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { EngineError, currentUser, workerTick, type Ctx } from "@/lib/demo/engine";
import { clearAll, loadState, probePersistence, saveState, type PersistenceKind } from "@/lib/demo/persistence";
import { createRng, type Rng } from "@/lib/demo/rng";
import { createSeedState, DEFAULT_SEED, type SeedOptions } from "@/lib/demo/seed";
import type { DemoState, DemoUser } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

type Mutation = (state: DemoState, ctx: Ctx) => DemoState;
export type RunResult = { ok: true } | { ok: false; error: string };

interface Toast {
  id: number;
  tone: "good" | "error";
  message: string;
}

interface DemoContextValue {
  state: DemoState;
  user: DemoUser;
  persistence: PersistenceKind;
  /** Ticks every second so time-based views (running attempts, backoff) stay live. */
  now: Date;
  run: (mutation: Mutation, success?: string) => RunResult;
  /** For multi-result operations: run, then read the produced value. */
  runWith: <T>(
    fn: (state: DemoState, ctx: Ctx) => { state: DemoState; value: T },
  ) => { ok: true; value: T } | { ok: false; error: string };
  notify: (message: string, tone?: Toast["tone"]) => void;
  /** Replace all demo data with a freshly generated sample. */
  reset: (options?: { seed?: number } & SeedOptions) => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used inside a loaded <DemoProvider> (wrap pages in <DemoReady>)");
  return ctx;
}

/** Null while demo data is loading (for shell components such as the top bar). */
export function useDemoOptional(): DemoContextValue | null {
  return useContext(DemoContext);
}

/** Renders page content once demo data has loaded. */
export function DemoReady({ children }: { children: React.ReactNode }) {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    return (
      <div
        className="text-muted-foreground flex min-h-64 items-center justify-center text-sm"
        role="status"
        aria-live="polite"
      >
        Loading demo data…
      </div>
    );
  }
  return <>{children}</>;
}

function messageOf(err: unknown): string {
  if (err instanceof EngineError) return err.message;
  console.error("[demo] unexpected error", err);
  return "Something went wrong. Your data was not changed.";
}

const CHANNEL = "jobsync-demo";

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [persistence, setPersistence] = useState<PersistenceKind>("indexeddb");
  // Set in the browser only (never during prerendering).
  const [now, setNow] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef<DemoState | null>(null);
  const rngRef = useRef<Rng | null>(null);
  const dirty = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const toastId = useRef(0);

  const commit = useCallback((next: DemoState) => {
    stateRef.current = next;
    dirty.current = true;
    setState(next);
  }, []);

  /**
   * User actions are written straight away (IndexedDB snapshots the value when
   * put() is called), so a change survives an immediate reload or tab close.
   * Worker ticks use the debounced save below.
   */
  const commitNow = useCallback(
    (next: DemoState) => {
      commit(next);
      if (persistence !== "indexeddb") return;
      dirty.current = false;
      void saveState(next).then((ok) => ok && channel.current?.postMessage({ type: "saved", at: Date.now() }));
    },
    [commit, persistence],
  );

  // Load (or seed) once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kind = await probePersistence();
      const stored = kind === "indexeddb" ? await loadState() : null;
      const initial = stored ?? createSeedState(new Date());
      if (cancelled) return;
      setPersistence(kind);
      setNow(new Date());
      rngRef.current = createRng(Date.now() % 2 ** 31);
      stateRef.current = initial;
      setState(initial);
      if (!stored && kind === "indexeddb") await saveState(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced save + notify other tabs.
  useEffect(() => {
    if (!state || !dirty.current || persistence !== "indexeddb") return;
    const t = window.setTimeout(async () => {
      dirty.current = false;
      if (await saveState(state)) channel.current?.postMessage({ type: "saved", at: Date.now() });
    }, 400);
    return () => window.clearTimeout(t);
  }, [state, persistence]);

  // Leaving or hiding the page: save pending changes now instead of after the debounce.
  useEffect(() => {
    if (persistence !== "indexeddb") return;
    const flush = () => {
      if (!dirty.current || !stateRef.current) return;
      dirty.current = false;
      void saveState(stateRef.current);
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistence]);

  // Other tabs saved: reload (unless this tab has unsaved changes).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = async (e) => {
      if (e.data?.type === "reset") {
        window.location.reload();
        return;
      }
      if (dirty.current) return;
      const fresh = await loadState();
      if (fresh) {
        stateRef.current = fresh;
        setState(fresh);
      }
    };
    return () => ch.close();
  }, []);

  // Clock + simulated worker (only in the visible tab, so two tabs never both run it).
  const interval = Math.max(1, state?.settings.polling_interval_seconds ?? 1) * 1000;
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = new Date();
      setNow(t);
      const current = stateRef.current;
      if (!current || !rngRef.current || document.visibilityState !== "visible") return;
      const hasRunning = current.executions.some((e) => e.status === "running");
      if (!current.settings.worker_running && !hasRunning) return;
      const { state: next } = workerTick(current, t, rngRef.current);
      if (next !== current) commit(next);
    }, interval);
    return () => window.clearInterval(id);
  }, [interval, commit]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "good") => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { id, tone, message }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  const run = useCallback(
    (mutation: Mutation, success?: string): RunResult => {
      const current = stateRef.current;
      if (!current) return { ok: false, error: "Demo data is still loading." };
      try {
        const next = mutation(current, { now: new Date(), actorId: current.current_user_id, actorType: "user" });
        commitNow(next);
        if (success) notify(success);
        return { ok: true };
      } catch (err) {
        const error = messageOf(err);
        notify(error, "error");
        return { ok: false, error };
      }
    },
    [commitNow, notify],
  );

  const runWith = useCallback(
    <T,>(fn: (state: DemoState, ctx: Ctx) => { state: DemoState; value: T }) => {
      const current = stateRef.current;
      if (!current) return { ok: false as const, error: "Demo data is still loading." };
      try {
        const out = fn(current, { now: new Date(), actorId: current.current_user_id, actorType: "user" });
        commitNow(out.state);
        return { ok: true as const, value: out.value };
      } catch (err) {
        return { ok: false as const, error: messageOf(err) };
      }
    },
    [commitNow],
  );

  const reset = useCallback(
    async (options: { seed?: number } & SeedOptions = {}) => {
      await clearAll();
      const { seed, ...rest } = options;
      const fresh = createSeedState(new Date(), seed ?? DEFAULT_SEED, rest);
      stateRef.current = fresh;
      setState(fresh);
      await saveState(fresh);
      channel.current?.postMessage({ type: "reset" });
      notify("Demo data was reset to a fresh sample.");
    },
    [notify],
  );

  const value = useMemo<DemoContextValue | null>(
    () => (state && now ? { state, user: currentUser(state), persistence, now, run, runWith, notify, reset } : null),
    [state, persistence, now, run, runWith, notify, reset],
  );

  return (
    <DemoContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "bg-popover text-popover-foreground pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg",
              t.tone === "error" && "border-red-200 dark:border-red-500/40",
            )}
          >
            {t.tone === "error" ? (
              <CircleAlert className="text-status-critical mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <CircleCheck className="text-status-good mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </DemoContext.Provider>
  );
}
