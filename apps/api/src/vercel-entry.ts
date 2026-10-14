import type { IncomingMessage, ServerResponse } from "node:http";

import { vercelFetch, vercelNode } from "./vercel-runtime.js";

const isWebRequest = (value: object): value is Request =>
  "headers" in value &&
  typeof (value as { headers?: { get?: unknown } }).headers?.get === "function";

// Bundled to api/index.mjs during the Vercel build. The admin app and this
// function share one origin so passkey cookies stay first-party (ADR 0009).
export default function vercelHandler(
  request: Request | IncomingMessage,
  response?: ServerResponse,
): Promise<Response> | Promise<void> {
  if (response !== undefined && !isWebRequest(request)) {
    return vercelNode(request, response);
  }
  if (!isWebRequest(request)) {
    throw new TypeError("Expected a Fetch request");
  }
  return vercelFetch(request);
}
