import type { IncomingMessage, ServerResponse } from "node:http";

import {
  assertDatabaseUrlDoesNotOverrideTls,
  createSqlOptions,
  parseCapabilityPepper,
} from "@animal-helper/event-store";
import postgres from "postgres";
import { Headers, Request, Response } from "undici";

import { loadAdminConfig } from "./admin/config.js";
import { loadApiEnv } from "./env.js";
import { MAX_BODY_BYTES, serveFetch } from "./fetch-handler.js";
import { createPostgresGateway } from "./gateway.js";
import { createApiHandler } from "./handler.js";

type Serve = (request: Request) => Promise<Response>;

let runtime: Promise<Serve> | undefined;

const logFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted"),
  );
};

const unavailable = (): Response =>
  new Response(JSON.stringify({ ok: false, error: { code: "UNAVAILABLE" } }), {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

const createRuntime = (): Serve => {
  const env = loadApiEnv(process.env);
  assertDatabaseUrlDoesNotOverrideTls(env.databaseUrl);
  const sql = postgres(env.databaseUrl, {
    ...createSqlOptions(process.env, { max: 1 }),
    // The production URL is Neon's transaction pooler, which drops named
    // prepared statements between transactions.
    prepare: false,
  });
  const admin = loadAdminConfig(process.env);
  const handle = createApiHandler({
    gateway: createPostgresGateway(sql),
    pepper: parseCapabilityPepper(env.capabilityPepper),
    sql,
    ...(env.corsOrigin === undefined ? {} : { corsOrigin: env.corsOrigin }),
    ...(admin === undefined ? {} : { admin: { sql, config: admin } }),
  });

  return (request) => serveFetch(handle, request);
};

const loadRuntime = (): Promise<Serve> => {
  runtime ??= Promise.resolve()
    .then(() => createRuntime())
    .catch((error: unknown) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
};

const nodeHeader = (
  request: IncomingMessage,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
};

const readNodeBody = async (
  request: IncomingMessage,
): Promise<Buffer | undefined> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      request.destroy();
      return Buffer.alloc(MAX_BODY_BYTES + 1);
    }
    chunks.push(buffer);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
};

export const webRequestFromNode = async (
  request: IncomingMessage,
): Promise<Request> => {
  const host =
    nodeHeader(request, "x-forwarded-host") ?? nodeHeader(request, "host");
  const proto = nodeHeader(request, "x-forwarded-proto") ?? "https";
  const url = new URL(request.url ?? "/", `${proto}://${host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  const body = await readNodeBody(request);
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
};

const headersAlreadySent = (value: ServerResponse): boolean =>
  value.headersSent;

const writeNodeResponse = async (
  result: Response,
  response: ServerResponse,
): Promise<void> => {
  const headers: Record<string, string | string[]> = {};
  result.headers.forEach((value, key) => {
    if (key === "set-cookie") {
      return;
    }
    headers[key] = value;
  });
  const cookies = result.headers.getSetCookie();
  if (cookies.length > 0) {
    headers["set-cookie"] = cookies;
  }
  response.writeHead(result.status, headers);
  const bytes = Buffer.from(await result.arrayBuffer());
  response.end(bytes.length === 0 ? undefined : bytes);
};

export const vercelFetch = async (request: Request): Promise<Response> => {
  try {
    const serve = await loadRuntime();
    return await serve(request);
  } catch (error: unknown) {
    logFailure(error);
    return unavailable();
  }
};

export const vercelNode = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  if (headersAlreadySent(response)) {
    response.end();
    return;
  }
  try {
    const serve = await loadRuntime();
    await writeNodeResponse(
      await serve(await webRequestFromNode(request)),
      response,
    );
  } catch (error: unknown) {
    logFailure(error);
    if (headersAlreadySent(response)) {
      response.end();
      return;
    }
    await writeNodeResponse(unavailable(), response);
  }
};
