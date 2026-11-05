"use client";

import { FlaskConical, Play, Route, Send, Shuffle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useDemo } from "@/components/demo/demo-provider";
import { DemoNotice } from "@/components/demo/demo-ui";
import { ApiReferenceCard, IncomingList, IncomingTabs } from "@/components/incoming/incoming-sections";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/auth/permissions";
import { runRouting } from "@/lib/demo/engine";
import { generateIntakeBatch, simulateIntake, type SimulatedResponse } from "@/lib/demo/intake-sim";
import { createRng } from "@/lib/demo/rng";
import { incoming } from "@/lib/demo/selectors";
import { formatNumber } from "@/lib/format";
import { parseIncomingView } from "@/lib/incoming/views";
import { cn } from "@/lib/utils";

const EXAMPLE = {
  external_job_id: "ARO-2026-00125",
  source: "aroflo",
  customer: "Example Facilities Ltd",
  contact: { name: "John Smith", email: "john@example.com", phone: "+2348000000000" },
  service_address: "Example Service Address",
  category: "AC Maintenance",
  priority: "High",
  description: "Air conditioning unit requires inspection.",
  instructions: "Inspect the unit and upload photographic evidence.",
  scheduled_date: "2026-11-05",
  scheduled_time: "10:00",
  technician: "Technician A",
  destinations: ["northstar", "bluepeak"],
  attachments: [],
};

export function DemoIncoming() {
  const { state, user, now, run } = useDemo();
  const params = useSearchParams();
  const view = parseIncomingView(params.get("view"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const eventsVisible = can(user.role, "integration_events.read");
  const minute = Math.floor(now.getTime() / 60_000);
  const data = useMemo(
    () => incoming(state, view, page, eventsVisible, new Date(minute * 60_000)),
    [state, view, page, eventsVisible, minute],
  );
  const canRoute = can(user.role, "jobs.edit");

  return (
    <>
      <DemoNotice>
        <strong>Demo data layer.</strong> Intake events here come from the seed history, the simulator and the batch
        generator below. They are labelled as simulated and were not received over the network.
      </DemoNotice>
      <IncomingTabs data={data} view={view} />
      {view === "awaiting_routing" && data.total > 0 && canRoute ? (
        <div>
          <Button
            size="sm"
            onClick={() =>
              run((s, ctx) => {
                const r = runRouting(s, ctx);
                return r.state;
              }, "Routing rules applied to the jobs awaiting routing.")
            }
          >
            <Route aria-hidden /> Run routing now
          </Button>
        </div>
      ) : null}
      <IncomingList data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <IntakeSimulator />
        <BatchGenerator />
      </div>
      <ApiReferenceCard />
    </>
  );
}

function ResponseView({ response }: { response: SimulatedResponse }) {
  const tone =
    response.status < 300
      ? "text-status-good"
      : response.status === 409 || response.status === 200
        ? "text-amber-600"
        : "text-status-critical";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm">
        Response <span className={cn("font-mono font-semibold", tone)}>HTTP {response.status}</span>
      </div>
      <pre className="bg-muted/50 max-h-64 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(response.body, null, 2)}
      </pre>
    </div>
  );
}

function IntakeSimulator() {
  const { runWith, user } = useDemo();
  const [text, setText] = useState(() => JSON.stringify(EXAMPLE, null, 2));
  const [response, setResponse] = useState<SimulatedResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const allowed = can(user.role, "jobs.create");

  function submit() {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
      setParseError(null);
    } catch {
      setParseError("This is not valid JSON. The real API would answer 400 invalid_json.");
      setResponse(null);
      return;
    }
    const r = runWith((s) => {
      const out = simulateIntake(s, new Date(), payload, "simulator");
      return { state: out.state, value: out.response };
    });
    if (r.ok) setResponse(r.value);
  }

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FlaskConical className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Intake simulator</CardTitle>
        </div>
        <CardDescription>
          Runs a payload through the same validation and duplicate rules as{" "}
          <code className="font-mono">POST /api/v1/jobs/intake</code>, without authentication or rate limits. Send the
          example twice to see duplicate handling.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label htmlFor="intake-json" className="sr-only">
          JSON payload
        </label>
        <Textarea
          id="intake-json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          className="font-mono text-xs"
        />
        {parseError ? (
          <p role="alert" className="text-destructive text-sm">
            {parseError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={submit}
            disabled={!allowed}
            title={allowed ? undefined : "Operators and admins can submit jobs."}
          >
            <Send aria-hidden /> Send payload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify(EXAMPLE, null, 2))}>
            Reset example
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setText(JSON.stringify({ ...EXAMPLE, external_job_id: `ARO-${Date.now()}` }, null, 2))}
          >
            New external ID
          </Button>
        </div>
        {response ? <ResponseView response={response} /> : null}
      </CardContent>
    </Card>
  );
}

interface BatchSummary {
  total: number;
  byStatus: Record<number, number>;
}

function BatchGenerator() {
  const { runWith, user, notify } = useDemo();
  const [count, setCount] = useState(25);
  const [invalid, setInvalid] = useState(8);
  const [dupes, setDupes] = useState(6);
  const [unrouted, setUnrouted] = useState(20);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const allowed = can(user.role, "jobs.create");
  const valid = count >= 1 && count <= 100 && [invalid, dupes, unrouted].every((v) => v >= 0 && v <= 100);

  function generate() {
    const r = runWith((s) => {
      const t = new Date();
      const batch = generateIntakeBatch(createRng(t.getTime() % 2 ** 31), t, {
        count,
        invalidRate: invalid / 100,
        duplicateRate: dupes / 100,
        unroutedRate: unrouted / 100,
      });
      let next = s;
      const byStatus: Record<number, number> = {};
      for (const payload of batch) {
        const out = simulateIntake(next, t, payload, "generator");
        next = out.state;
        byStatus[out.response.status] = (byStatus[out.response.status] ?? 0) + 1;
      }
      return { state: next, value: { total: batch.length, byStatus } };
    });
    if (r.ok) {
      setSummary(r.value);
      notify(`Simulated ${r.value.total} incoming payloads.`);
    } else notify(r.error, "error");
  }

  const LABEL: Record<number, string> = {
    201: "Created",
    200: "Duplicate (identical)",
    409: "Duplicate (changed)",
    422: "Rejected",
    500: "Error",
  };

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shuffle className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>Sample job generator</CardTitle>
        </div>
        <CardDescription>
          Generates realistic work orders (up to 100 per batch) and sends each through the simulator, including invalid
          payloads and duplicates for testing.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={generate} disabled={!allowed || !valid}>
            <Play aria-hidden /> Generate
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <NumberField id="gen-count" label="Jobs in batch" value={count} min={1} max={100} onChange={setCount} />
          <NumberField
            id="gen-invalid"
            label="Invalid payloads (%)"
            value={invalid}
            min={0}
            max={100}
            onChange={setInvalid}
          />
          <NumberField id="gen-dupes" label="Duplicates (%)" value={dupes} min={0} max={100} onChange={setDupes} />
          <NumberField
            id="gen-unrouted"
            label="Without destinations (%)"
            value={unrouted}
            min={0}
            max={100}
            onChange={setUnrouted}
          />
        </div>
        {!valid ? <p className="text-destructive text-xs">Batch size must be 1–100 and percentages 0–100.</p> : null}
        {summary ? (
          <div className="rounded-md border">
            <div className="bg-muted/50 border-b px-3 py-2 text-xs font-medium">
              Last batch: {formatNumber(summary.total)} payloads
            </div>
            <ul className="divide-y text-sm">
              {Object.entries(summary.byStatus)
                .sort()
                .map(([code, n]) => (
                  <li key={code} className="flex justify-between px-3 py-1.5">
                    <span>
                      <span className="font-mono text-xs">{code}</span> {LABEL[Number(code)] ?? ""}
                    </span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
      />
    </div>
  );
}
