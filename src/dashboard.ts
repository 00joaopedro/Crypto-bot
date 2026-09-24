import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { z } from "zod";
import type { DashboardSettings, PostgresPersistence } from "./persistence.js";

const settingsSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,15}\/USDT$/),
  orderSizeUsdt: z.number().positive().max(100),
  maxTrades: z.number().int().min(1).max(100),
  intervalMinutes: z.number().int().min(15).max(10_080),
});

type DashboardOptions = {
  port: number;
  host?: string;
  password: string;
  sessionSecret: string;
  persistence: PostgresPersistence;
  supportedSymbols: string[];
  onSettingsChanged: () => void | Promise<void>;
};

const assets = new Map<string, { file: string; type: string }>([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
]);

export async function startDashboard(options: DashboardOptions): Promise<Server> {
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
        response.setHeader("set-cookie", "bot_session=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0");
        return json(response, 200, { ok: true });
      }

      if (!isAuthenticated(request, options.sessionSecret)) {
        return json(response, 401, { error: "Não autenticado." });
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const data = await options.persistence.getDashboardData();
        return json(response, 200, { ...data, supportedSymbols: options.supportedSymbols });
      }
      if (request.method === "POST" && url.pathname === "/api/control") {
        requireSameOrigin(request);
        const body = await readJson(request);
        if (typeof body.paused !== "boolean") return json(response, 400, { error: "Ação inválida." });
        await options.persistence.setPaused(body.paused, "dashboard");
        return json(response, 200, { paused: body.paused });
      }
      if (request.method === "PUT" && url.pathname === "/api/settings") {
        requireSameOrigin(request);
        const parsed = settingsSchema.safeParse(await readJson(request));
        if (!parsed.success || !options.supportedSymbols.includes(parsed.data.symbol)) {
          return json(response, 400, { error: "Configuração ou par não suportado." });
        }
        await options.persistence.updateDashboardSettings(parsed.data, "dashboard");
        json(response, 200, { ok: true, reconfiguring: true });
        setTimeout(() => {
          void Promise.resolve(options.onSettingsChanged()).catch((error) => {
            console.error(JSON.stringify({
              event: "dashboard_reconfiguration_failed",
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }, 500);
        return;
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

function createSessionCookie(secret: string): string {
  const expires = Date.now() + 12 * 60 * 60_000;
  const payload = String(expires);
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `bot_session=${payload}.${signature}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=43200`;
}

function isAuthenticated(request: IncomingMessage, secret: string): boolean {
  const value = request.headers.cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith("bot_session="))?.slice(12);
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) <= Date.now()) return false;
  const expected = createHmac("sha256", secret).update(expires).digest("hex");
  return secureEqual(signature, expected);
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
