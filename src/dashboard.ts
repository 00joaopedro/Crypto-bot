import type { DemoBalanceEvidence } from './demo-ledger.js';
import { createSessionCookie, sessionExpires } from './dashboard-session.js';
import { DashboardRead } from './dashboard-read-cache.js';
import { MAX_CONCURRENT_POSITIONS, MAX_DEMO_ORDERS_PER_INTERVAL } from "./trading-limits.js";
import type { DemoExecutionState } from "./demo-execution-safety.js";
import { demoBotExposure, demoTradingExposure } from "./demo-exposure.js";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { z } from "zod";
import type { DashboardSettings, PostgresPersistence } from "./persistence.js";
import type { OkxDemoAccountSnapshot } from "./okx-demo.js";

const demoCycleSchema = z.object({ expectedStart: z.iso.datetime({ precision: 3 }).nullable() }).strict();

const settingsSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,15}\/USDT$/),
  orderSizeUsdt: z.number().positive().max(100),
  paperTradeSizeUsdt: z.number().positive().max(100).nullable().optional(),
  maxTrades: z.number().int().min(1).max(MAX_DEMO_ORDERS_PER_INTERVAL),
  intervalMinutes: z.number().int().min(15).max(10_080),
  maxConcurrentPositions: z.number().int().min(1).max(MAX_CONCURRENT_POSITIONS),
});

type DashboardOptions = {
  port: number;
  host?: string;
  password: string;
  sessionSecret: string;
  persistence: PostgresPersistence;
  supportedSymbols: string[];
  onSettingsChanged: () => void | Promise<void>;
  getDemoSupervision?: () => unknown;
  getExecutionFidelity?: () => Promise<unknown>;
  readAccountTerms?: () => Promise<unknown>;
  getLastSignalScan?: () => { pairs: string[]; candleTimestamp: number; cooldowns?: Array<{ symbol: string; until: number }> } | null;
  getOkxDemoSnapshot?: () => Promise<OkxDemoAccountSnapshot>;
  inspectDemoAccounting?: () => Promise<unknown>;
  inspectDemoPermission?: () => Promise<unknown>;
  inspectDemoPositions?: () => Promise<DemoExecutionState>;
  demoBotBudgetUsdt?: number;
  paperDefaultTradeSize?: number;
  getAutoResumeStatus?: () => Promise<unknown>;
  onResume?: (signal?: AbortSignal, progress?: (phase: string) => void) => Promise<{ status: "resumed" } | { status: "blocked"; reason: string; attributionReason?: string; balanceEvidence?: DemoBalanceEvidence }>;
  resumeCheckTimeoutMs?: number;
};

const assets = new Map<string, { file: string; type: string }>([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
]);

export async function startDashboard(options: DashboardOptions): Promise<Server> {
  let settingsApply: { revision: number; status: "idle" | "pending" | "applied" | "failed" } = { revision: 0, status: "idle" };
  // Legacy synchronous clients retain request ordering; the UI uses cancellable jobs.
  let controlTail: Promise<void> = Promise.resolve();
  const serializeControl = <T>(action: () => Promise<T>): Promise<T> => {
    const current = controlTail.then(action);
    controlTail = current.then(() => undefined, () => undefined);
    return current;
  };
  const accountingRead = new DashboardRead<unknown>(async () => options.inspectDemoAccounting?.() ?? { status: 'unavailable', reason: 'demo_disabled' }, { status: 'unavailable', reason: 'diagnostic_refreshing' });
  const positionsRead = new DashboardRead<DemoExecutionState>(async () => options.inspectDemoPositions?.() ?? { status: 'blocked', reason: 'demo_disabled' }, { status: 'blocked', reason: 'diagnostic_refreshing' });
  const snapshotRead = new DashboardRead<OkxDemoAccountSnapshot | null>(async () => options.getOkxDemoSnapshot?.() ?? null, null, 30_000);
  const accounting = () => accountingRead.get();
  const demoPositions = () => positionsRead.get();
  let controlRevision = 0;
  let controlJob: { id: number; status: 'pending' | 'completed' | 'blocked' | 'failed' | 'cancelled'; startedAt: number; phase: string; reason?: string; attributionReason?: string; balanceEvidence?: DemoBalanceEvidence } | null = null;
  let resumeController: AbortController | undefined;
  let resumeWork: Promise<void> | undefined;
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const asset = assets.get(url.pathname);
      if (request.method === "GET" && asset) {
        const content = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
        response.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
        response.end(content);
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { status: "ok" });
      }
      if (request.method === "POST" && url.pathname === "/api/login") {
        if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Origem inválida.' });
        const body = await readJson(request);
        if (!secureEqual(String(body.password ?? ""), options.password)) {
          // Apply a small per-request penalty without using the shared Railway
          // proxy address as a global lockout bucket.
          await new Promise((resolve) => setTimeout(resolve, 250));
          return json(response, 401, { error: "Senha inválida." });
        }
        response.setHeader("set-cookie", createSessionCookie(options.sessionSecret));
        return json(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/logout") {
        response.setHeader("set-cookie", "bot_session=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0");
        return json(response, 200, { ok: true });
      }

      const expiresAt = sessionExpires(request.headers.cookie, options.sessionSecret);
      if (expiresAt === null) {
        return json(response, 401, { error: "Não autenticado." });
      }
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { authenticated: true, expiresAt });
      if (request.method === 'GET' && url.pathname === '/api/control-status') {
        const control = await options.persistence.readControlState();
        return json(response, 200, { paused: control.paused, pauseReason: control.pauseReason, job: controlJob });
      }
      if (request.method === "GET" && url.pathname === "/api/account-terms-readonly") {
        if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Origem inválida.' });
        try { return json(response, 200, options.readAccountTerms ? await options.readAccountTerms() : { status: 'not_configured', ordersSent: 0 }); }
        catch { return json(response, 200, { status: 'unavailable', reason: 'read_query_failed', ordersSent: 0 }); }
      }
      if (request.method === "GET" && url.pathname === "/api/execution-fidelity") {
        return json(response, 200, options.getExecutionFidelity ? await options.getExecutionFidelity() : { status: "unavailable", reason: "runtime_not_initialized" });
      }
      if (request.method === "GET" && url.pathname === "/api/demo-reconciliation") {
        return json(response, 200, await accounting());
      }
      if (request.method === "GET" && url.pathname === "/api/demo-permission") {
        if (!options.inspectDemoPermission) return json(response, 200, { status: "unavailable", reason: "demo_disabled" });
        try { return json(response, 200, await options.inspectDemoPermission()); }
        catch { return json(response, 200, { status: "unavailable", reason: "permission_request_failed" }); }
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const historySymbol = url.searchParams.get("symbol") || undefined;
        const since = url.searchParams.get("paperSince");
        const paperSince = since ? Date.parse(since + "T00:00:00Z") : undefined;
        if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(paperSince) ||
          new Date(paperSince!).toISOString().slice(0, 10) !== since)) return json(response, 400, { error: "Data Paper inválida." });
        const fast = url.searchParams.get('fast') === '1';
        const [data, positions] = await Promise.all([options.persistence.getDashboardData(40, historySymbol, paperSince), fast ? positionsRead.peek() : demoPositions()]);
        const budget = options.demoBotBudgetUsdt;
        let okxDemo: typeof data.okxDemo & {
          tradingExposure?: ReturnType<typeof demoTradingExposure>;
          botExposure?: { budgetUsdt: number; tradingEquityUsdt: number | null; exposureUsdt: number | null };
        } = data.okxDemo;
        if (options.getOkxDemoSnapshot) {
          try {
            const snapshot = fast ? snapshotRead.peek() : await snapshotRead.get();
            if (snapshot) {
              const scoped = budget !== undefined && positions.status === "safe" ? demoBotExposure(snapshot, budget, positions.positions) : null;
              okxDemo = { ...okxDemo, ...snapshot, tradingExposure: demoTradingExposure(snapshot), status: "ok",
                ...(budget === undefined ? {} : { botExposure: { budgetUsdt: budget, tradingEquityUsdt: scoped?.tradingEquityUsdt ?? null, exposureUsdt: scoped?.exposureUsdt ?? null } }),
              };
            }
          } catch (error) {
              okxDemo = { ...okxDemo, status: "unhealthy", lastError: error instanceof Error ? error.message : String(error) };
          }
        }
        const decisionLogs = await options.persistence.latestDemoDecision();
        return json(response, 200, { ...data, ...(options.getAutoResumeStatus ? { autoResume: await options.getAutoResumeStatus() } : {}), latestDemoDecision: decisionLogs, demoSupervision: options.getDemoSupervision?.() ?? null, lastDemoReconciliation: await options.persistence.latestDemoReconciliation(), okxDemo, demoAccounting: fast ? accountingRead.peek() : await accounting(), diagnostics: { positions: positionsRead.status(), accounting: accountingRead.status(), snapshot: snapshotRead.status() }, demoPositions: positions, controlJob, paperDefaultTradeSize: options.paperDefaultTradeSize, supportedSymbols: options.supportedSymbols, lastSignalScan: options.getLastSignalScan?.() ?? null });
      }
      if (request.method === "GET" && url.pathname === "/api/logs") {
        const hours = Number(url.searchParams.get("hours") ?? 6);
        const limit = Number(url.searchParams.get("limit") ?? 500);
        const exported = await options.persistence.getDiagnosticLogs(hours, limit);
        const content = options.getExecutionFidelity
          ? JSON.stringify({ ...JSON.parse(exported), executionFidelity: await options.getExecutionFidelity() }, null, 2)
          : exported;
        // Validate the complete document before starting the attachment response.
        const parsed = JSON.parse(content) as { records?: unknown };
        if (!parsed || !Array.isArray(parsed.records)) throw new Error("Invalid diagnostic export");
        const extension = url.searchParams.get("format") === "txt" ? "txt" : "json";
        response.writeHead(200, { "content-type": extension === "txt" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "content-disposition": `attachment; filename="crypto-bot-diagnostic-logs.${extension}"`, "content-length": Buffer.byteLength(content), "x-content-type-options": "nosniff", "cache-control": "no-store" });
        response.end(content);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/demo-cycle") {
        try { requireSameOrigin(request); }
        catch { return json(response, 403, { error: "Origem inválida." }); }
        const input = demoCycleSchema.safeParse(await readJson(request));
        if (!input.success) return json(response, 400, { error: "Marco de ciclo inválido." });
        const cycleStartedAt = await options.persistence.startDemoCycle(input.data.expectedStart);
        if (!cycleStartedAt) return json(response, 409, { error: "O ciclo já mudou. Atualize o painel." });
        return json(response, 200, { cycleStartedAt });
      }
      if (request.method === "POST" && url.pathname === "/api/control") {
        requireSameOrigin(request);
        const body = await readJson(request);
        if (typeof body.paused !== "boolean") return json(response, 400, { error: "Ação inválida." });
        const paused = body.paused;
        if (url.searchParams.get('async') === '1') {
          if (paused) {
            resumeController?.abort();
            if (controlJob?.status === 'pending') { controlJob.status = 'cancelled'; controlJob.phase = 'cancelled'; }
            else controlJob = null;
            await options.persistence.setPaused(true, 'dashboard');
            return json(response, 200, { paused: true, status: 'completed' });
          }
          if (resumeWork) return json(response, 202, { paused: true, job: controlJob });
          const controller = new AbortController(); resumeController = controller;
          const job: NonNullable<typeof controlJob> = { id: ++controlRevision, status: 'pending', startedAt: Date.now(), phase: 'queued' };
          controlJob = job;
          const deadline = setTimeout(() => {
            if (job.status !== 'pending') return;
            controller.abort(); job.status = 'failed'; job.phase = 'timeout'; job.reason = 'resume_check_timeout';
            // Fence a late commit as well as aborting the checks. A timeout never authorizes trading.
            void options.persistence.setPaused(true, 'dashboard').catch(() => undefined);
            console.warn(JSON.stringify({ event: 'dashboard_resume_timeout', jobId: job.id, elapsedMs: Date.now() - job.startedAt }));
          }, options.resumeCheckTimeoutMs ?? 120_000);
          resumeWork = Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            const result: Awaited<ReturnType<NonNullable<DashboardOptions['onResume']>>> = options.onResume ? await options.onResume(controller.signal, phase => { if (!controller.signal.aborted && job.status === 'pending') job.phase = phase; }) : await (async () => {
              const control = await options.persistence.readControlState();
              if (controller.signal.aborted) return { status: 'blocked' as const, reason: 'resume_cancelled' };
              const changed = await options.persistence.setPaused(false, 'dashboard', undefined, control.revision);
              return changed || !control.paused ? { status: 'resumed' as const } :
                { status: 'blocked' as const, reason: 'control_changed_during_resume' };
            })();
            if (controller.signal.aborted) return;
            if (result.status === 'blocked') {
              job.status = 'blocked'; job.reason = result.reason;
              if (result.attributionReason) job.attributionReason = result.attributionReason;
              if (result.balanceEvidence) job.balanceEvidence = result.balanceEvidence;
            } else job.status = 'completed';
            job.phase = job.status;
          }).catch(() => { if (!controller.signal.aborted) { job.status = 'failed'; job.reason = 'resume_check_failed'; } })
            .finally(() => { clearTimeout(deadline); if (controller.signal.aborted && job.status === 'pending') { job.status = 'cancelled'; job.phase = 'cancelled'; } resumeWork = undefined; });
          return json(response, 202, { paused: true, job });
        }
        const result = await serializeControl(async () => {
          if (!paused && options.onResume) return options.onResume();
          await options.persistence.setPaused(paused, "dashboard");
          return { status: "updated" as const };
        });
        if (result.status === "blocked") return json(response, 409, { error: "Bot permanece pausado: verifique a segurança Demo.", reason: result.reason });
        return json(response, 200, { paused });
      }
      if (request.method === "GET" && url.pathname === "/api/settings-status") return json(response, 200, settingsApply);
      if (request.method === "PUT" && url.pathname === "/api/settings") {
        requireSameOrigin(request);
        const parsed = settingsSchema.safeParse(await readJson(request));
        if (!parsed.success || !options.supportedSymbols.includes(parsed.data.symbol)) {
          return json(response, 400, { error: "Configuração ou par não suportado." });
        }
        const { paperTradeSizeUsdt, ...settings } = parsed.data;
        await options.persistence.updateDashboardSettings({ ...settings, ...(paperTradeSizeUsdt !== undefined ? { paperTradeSizeUsdt } : {}) }, "dashboard");
        const revision = settingsApply.revision + 1;
        settingsApply = { revision, status: "pending" };
        void Promise.resolve().then(() => options.onSettingsChanged()).then(() => {
          if (settingsApply.revision === revision) settingsApply = { revision, status: "applied" };
        }).catch((error) => {
            if (settingsApply.revision === revision) settingsApply = { revision, status: "failed" };
            console.error(JSON.stringify({
              event: "dashboard_reconfiguration_failed",
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        return json(response, 202, { ok: true, revision, status: "pending" });
      }
      return json(response, 404, { error: "Rota não encontrada." });
    } catch (error) {
      console.error(JSON.stringify({
        event: "dashboard_request_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return json(response, 500, { error: "Não foi possível concluir a operação." });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(JSON.stringify({ event: "dashboard_started", port: options.port }));
  return server;
}

export async function stopDashboard(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || new URL(origin).host !== host) throw new Error("Origin inválida");
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Payload muito grande");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

