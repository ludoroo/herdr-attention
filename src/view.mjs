import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

const VIEW_SOURCE = "plugin:ludoroo.attention";
const REQUEST_TIMEOUT_MS = 3_000;
const STARTUP_REQUEST_TIMEOUT_MS = 1_000;
const STARTUP_RETRY_DELAYS_MS = [100, 250, 500, 1_000];

export function viewRequest() {
  return {
    source: VIEW_SOURCE,
    label: "attention",
    filter: { op: "in", field: "status", values: ["blocked", "done"] },
    sort: [
      { field: "attention", order: "desc" },
      { field: "state_change_seq", order: "desc" },
    ],
  };
}

export function request(socketPath, method, params, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!socketPath) return Promise.reject(new Error("HERDR_SOCKET_PATH is not set"));
  const id = `ludoroo-attention-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(() => {
      const error = new Error(`Herdr API request timed out after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      finish(error);
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let response;
        try {
          response = JSON.parse(line);
        } catch (error) {
          finish(new Error(`Herdr API returned invalid JSON: ${error.message}`));
          return;
        }
        if (!response || typeof response !== "object" || response.id !== id) continue;
        if (response.error) {
          finish(new Error(`${response.error.code ?? "api_error"}: ${response.error.message ?? "request failed"}`));
        } else if (Object.hasOwn(response, "result")) {
          finish(null, response.result);
        } else {
          finish(new Error("Herdr API response contained neither result nor error"));
        }
        return;
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("Herdr API ended before responding")));
    socket.on("close", () => finish(new Error("Herdr API closed before responding")));
  });
}

export async function syncAttentionView(socketPath, options) {
  return request(socketPath, "agent.view.set", viewRequest(), options);
}

export async function clearAttentionView(socketPath, options) {
  return request(socketPath, "agent.view.clear", { source: VIEW_SOURCE }, options);
}

function startupErrorIsRetryable(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ENOENT", "EPIPE", "ETIMEDOUT"].includes(error?.code);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function syncAttentionViewAtStartup(
  socketPath,
  {
    retryDelaysMs = STARTUP_RETRY_DELAYS_MS,
    timeoutMs = STARTUP_REQUEST_TIMEOUT_MS,
    waitForRetry = wait,
  } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await syncAttentionView(socketPath, { timeoutMs });
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined || !startupErrorIsRetryable(error)) throw error;
      await waitForRetry(delayMs);
    }
  }
}
