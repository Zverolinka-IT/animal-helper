import type { TransportCaseCommand } from "@animal-helper/contracts";

export type TransportResponse = Readonly<{
  status: number;
  body: unknown;
}>;

export type ApiTransport = Readonly<{
  sendCommand: (input: {
    authorization: string;
    command: TransportCaseCommand;
  }) => Promise<TransportResponse>;
  getStatus: (input: { authorization: string }) => Promise<TransportResponse>;
}>;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
    credentials: "omit";
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

const trimBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const readJson = async (
  response: Awaited<ReturnType<FetchLike>>,
): Promise<TransportResponse> => {
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: undefined };
  }
};

export const createFetchTransport = (options: {
  baseUrl: string;
  fetch?: FetchLike;
}): ApiTransport => {
  const baseUrl = trimBaseUrl(options.baseUrl);
  const fetchImpl: FetchLike =
    options.fetch ?? ((url, init) => fetch(url, init));

  return {
    sendCommand: async ({ authorization, command }) => {
      const response = await fetchImpl(`${baseUrl}/commands`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
        credentials: "omit",
        signal: AbortSignal.timeout(12_000),
      });

      return readJson(response);
    },
    getStatus: async ({ authorization }) => {
      const response = await fetchImpl(`${baseUrl}/status`, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization,
        },
        credentials: "omit",
        signal: AbortSignal.timeout(12_000),
      });

      return readJson(response);
    },
  };
};
