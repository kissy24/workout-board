import { resolve } from "node:path";
import { DEMO_VALUES } from "./lib/demo";
import {
  clearImportedFile,
  loadImportedFile,
  parseImportedFile,
  saveImportedFile,
} from "./lib/import-store";
import type { ImportedFile, ParsedWorkoutSheet, Period } from "./lib/types";
import { buildDashboard, parseWorkoutValues } from "./lib/workouts";

const HOSTNAME = "127.0.0.1";
const portValue = Number(Bun.env.WORKOUT_BOARD_PORT ?? "4173");
if (!Number.isInteger(portValue) || portValue < 1024 || portValue > 65_535) {
  throw new Error("WORKOUT_BOARD_PORTは1024〜65535の整数にしてください。");
}
const PORT = portValue;
const ORIGIN = `http://${HOSTNAME}:${PORT}`;
const MAX_JSON_BYTES = 65_536;
const MAX_IMPORT_BYTES = 5 * 1_024 * 1_024;
const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_BYTES * 2 + MAX_JSON_BYTES;
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const DEMO_MODE = Bun.env.WORKOUT_BOARD_DEMO === "1";
const DEVELOPMENT_MODE = Bun.env.WORKOUT_BOARD_DEV === "1";

interface BrowserSession {
  csrfToken: string;
  expiresAt: number;
}

const sessions = new Map<string, BrowserSession>();
const storedImport = DEMO_MODE ? null : await loadImportedFile();
let importedFile: ImportedFile | null = storedImport?.file ?? null;
let workoutData: ParsedWorkoutSheet | null = DEMO_MODE
  ? parseWorkoutValues(DEMO_VALUES)
  : (storedImport?.data ?? null);
let lastSyncedAt: string | null = DEMO_MODE
  ? new Date().toISOString()
  : (storedImport?.file.importedAt ?? null);

let clientScript = await buildClientScript();
const indexHtml = Bun.file(resolve(import.meta.dir, "client/index.html"));
const stylesheet = Bun.file(resolve(import.meta.dir, "client/styles.css"));

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  development: false,
  routes: {},
  async fetch(request) {
    try {
      return await routeRequest(request);
    } catch (error) {
      return errorResponse(error);
    }
  },
});

console.log(`Workout Board: ${server.url}`);
if (DEMO_MODE) console.log("デモデータで起動しています。");

async function routeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  enforceHost(request);
  cleanupExpiredState();

  if (request.method === "GET" && url.pathname === "/") {
    return secureResponse(indexHtml, "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/assets/app.js") {
    if (DEVELOPMENT_MODE) clientScript = await buildClientScript();
    return secureResponse(clientScript, "text/javascript; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/assets/styles.css") {
    return secureResponse(stylesheet, "text/css; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/favicon.svg") {
    return secureResponse(favicon(), "image/svg+xml", "public, max-age=86400");
  }
  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    return bootstrap(request);
  }

  const session = requireSession(request);
  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    return dashboardResponse(url);
  }
  enforceSameOrigin(request);
  enforceCsrf(request, session);
  if (request.method === "POST" && url.pathname === "/api/import") {
    ensureNotDemo();
    const body = await readJson<{ fileName?: unknown; contents?: unknown }>(
      request,
      MAX_IMPORT_REQUEST_BYTES,
    );
    if (
      typeof body.fileName !== "string" ||
      body.fileName.length < 1 ||
      body.fileName.length > 255 ||
      typeof body.contents !== "string"
    ) {
      throw new PublicError(400, "INVALID_IMPORT", "ファイルを読み取れません。");
    }
    if (new TextEncoder().encode(body.contents).byteLength > MAX_IMPORT_BYTES) {
      throw new PublicError(413, "IMPORT_TOO_LARGE", "ファイルは5MB以下にしてください。");
    }
    let parsed: ParsedWorkoutSheet;
    try {
      parsed = parseImportedFile(body.fileName, body.contents);
    } catch (error) {
      throw new PublicError(
        400,
        "INVALID_IMPORT",
        error instanceof Error ? error.message : "ファイルを読み取れません。",
      );
    }
    const importedAt = new Date().toISOString();
    await saveImportedFile(body.fileName, body.contents, importedAt);
    importedFile = { type: "import", fileName: body.fileName, importedAt };
    workoutData = parsed;
    lastSyncedAt = importedAt;
    return json({
      ok: true,
      file: importedFile,
      recordCount: parsed.records.length,
      warningCount: parsed.warnings.length,
    });
  }
  if (request.method === "POST" && url.pathname === "/api/reset") {
    ensureNotDemo();
    await clearImportedFile();
    importedFile = null;
    workoutData = null;
    lastSyncedAt = null;
    return json({ ok: true });
  }

  throw new PublicError(404, "NOT_FOUND", "ページが見つかりません。");
}

async function buildClientScript(): Promise<Blob> {
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "client/app.ts")],
    target: "browser",
    minify: !DEVELOPMENT_MODE,
    sourcemap: DEVELOPMENT_MODE ? "inline" : "none",
  });
  if (!build.success || !build.outputs[0]) {
    throw new Error("ブラウザー用コードをビルドできませんでした。", {
      cause: build.logs.map((log) => log.message).join("\n"),
    });
  }
  return build.outputs[0];
}

async function bootstrap(request: Request): Promise<Response> {
  const existingId = cookieValue(request, "wb_session");
  const sessionId = existingId && sessions.has(existingId) ? existingId : randomToken(32);
  const session = sessions.get(sessionId) ?? { csrfToken: randomToken(32), expiresAt: 0 };
  session.expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1_000;
  sessions.set(sessionId, session);
  const response = json({
    csrfToken: session.csrfToken,
    importedFile,
    hasData: workoutData !== null,
    demoMode: DEMO_MODE,
  });
  response.headers.append(
    "set-cookie",
    `wb_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  );
  return response;
}

function dashboardResponse(url: URL): Response {
  const periodValue = url.searchParams.get("period") ?? "180";
  if (!(["30", "90", "180", "all"] as const).includes(periodValue as Period)) {
    throw new PublicError(400, "INVALID_PERIOD", "期間指定が不正です。");
  }
  const data = workoutData ?? { records: [], warnings: [] };
  return json(buildDashboard(data.records, data.warnings, lastSyncedAt, periodValue as Period));
}

function secureResponse(body: BodyInit, contentType: string, cacheControl = "no-store"): Response {
  return new Response(body, { headers: securityHeaders(contentType, cacheControl) });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders("application/json; charset=utf-8", "no-store"),
  });
}

function securityHeaders(contentType: string, cacheControl: string): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": cacheControl,
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof PublicError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
  console.error(`[workout-board] ${message}`);
  return json({ error: { code: "INTERNAL_ERROR", message } }, 500);
}

class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(request: Request, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentType !== "application/json") {
    throw new PublicError(415, "INVALID_CONTENT", "JSONリクエストだけを受け付けます。");
  }
  if (contentLength > maxBytes) {
    throw new PublicError(413, "PAYLOAD_TOO_LARGE", "リクエストが大きすぎます。");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PublicError(413, "PAYLOAD_TOO_LARGE", "リクエストが大きすぎます。");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PublicError(400, "INVALID_JSON", "JSONを読み取れません。");
  }
}

function enforceHost(request: Request): void {
  const host = request.headers.get("host");
  if (host !== `${HOSTNAME}:${PORT}` && host !== `localhost:${PORT}`) {
    throw new PublicError(421, "INVALID_HOST", "許可されていないHostです。");
  }
}

function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== ORIGIN && origin !== `http://localhost:${PORT}`) {
    throw new PublicError(403, "INVALID_ORIGIN", "許可されていないOriginです。");
  }
}

function enforceCsrf(request: Request, session: BrowserSession): void {
  const received = request.headers.get("x-csrf-token");
  if (!received || !timingSafeEqual(received, session.csrfToken)) {
    throw new PublicError(
      403,
      "INVALID_CSRF",
      "リクエストを確認できませんでした。再読み込みしてください。",
    );
  }
}

function requireSession(request: Request): BrowserSession {
  const id = cookieValue(request, "wb_session");
  const session = id ? sessions.get(id) : undefined;
  if (!session || session.expiresAt < Date.now()) {
    throw new PublicError(401, "SESSION_REQUIRED", "画面を再読み込みしてください。");
  }
  return session;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function randomToken(length: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(length))).toString("base64url");
}

function cleanupExpiredState(): void {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt < now) sessions.delete(id);
}

function ensureNotDemo(): void {
  if (DEMO_MODE) throw new PublicError(403, "DEMO_MODE", "デモモードでは設定を変更できません。");
}

function favicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#d6e3ff"/><path d="M12 28h7v-7h6v22h-6v-7h-7zm40 0h-7v-7h-6v22h6v-7h7zM25 29h14v6H25z" fill="#284777"/></svg>`;
}
