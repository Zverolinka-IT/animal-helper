import type { IncomingMessage, ServerResponse } from "node:http";

import { vercelFetch, vercelNode } from "../src/vercel-runtime.js";

const isWebRequest = (value: object): value is Request =>
  "headers" in value &&
  typeof (value as { headers?: { get?: unknown } }).headers?.get === "function";

// This file is the Vercel Function for the admin project. The same deployment
// serves the backoffice build, so /admin cookies stay on the passkey origin
// (ADR 0009). Rewrites keep the browser path; this handler reads that URL.
// Local `vercel dev` calls the Node listener. Production may call either shape.
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
