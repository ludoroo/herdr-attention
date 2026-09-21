import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearAttentionView,
  syncAttentionView,
  syncAttentionViewAtStartup,
  viewRequest,
} from "../src/view.mjs";

async function withServer(handler, run) {
  const directory = await mkdtemp(join(tmpdir(), "herdr-attention-view-test-"));
  const socketPath = join(directory, "herdr.sock");
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    return await run(socketPath);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("projects blocked and unseen completed agents in attention order", () => {
  assert.deepEqual(viewRequest(), {
    source: "plugin:ludoroo.attention",
    label: "attention",
    filter: { op: "in", field: "status", values: ["blocked", "done"] },
    sort: [
      { field: "attention", order: "desc" },
      { field: "state_change_seq", order: "desc" },
    ],
  });
});

test("sets the transient agent view through the Herdr socket", async () => {
  let received;
  await withServer((socket) => {
    let input = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      input += chunk;
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      received = JSON.parse(input.slice(0, newline));
      socket.write(`${JSON.stringify({ id: received.id, result: { active: true } })}\n`);
    });
  }, async (socketPath) => {
    const result = await syncAttentionView(socketPath);
    assert.deepEqual(result, { active: true });
  });

  assert.equal(received.method, "agent.view.set");
  assert.deepEqual(received.params, viewRequest());
});

test("ignores non-object and unrelated responses and accepts a chunked match", async () => {
  await withServer((socket) => {
    socket.once("data", (input) => {
      const request = JSON.parse(String(input).trim());
      const response = `${JSON.stringify({ id: request.id, result: { active: true } })}\n`;
      socket.write(`null\n${JSON.stringify({ id: "another-request", result: {} })}\n`);
      socket.write(response.slice(0, 5));
      setImmediate(() => socket.write(response.slice(5)));
    });
  }, async (socketPath) => {
    assert.deepEqual(await syncAttentionView(socketPath), { active: true });
  });
});

test("retries transient startup failures until the socket is ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-attention-retry-test-"));
  const socketPath = join(directory, "herdr.sock");
  const server = createServer((socket) => {
    socket.once("data", (input) => {
      const request = JSON.parse(String(input).trim());
      socket.write(`${JSON.stringify({ id: request.id, result: { active: true } })}\n`);
    });
  });
  const startServer = setTimeout(() => server.listen(socketPath), 30);

  try {
    const result = await syncAttentionViewAtStartup(socketPath, {
      retryDelaysMs: [20, 20, 20],
      timeoutMs: 100,
    });
    assert.deepEqual(result, { active: true });
  } finally {
    clearTimeout(startServer);
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("clears only the view owned by this plugin", async () => {
  let received;
  await withServer((socket) => {
    socket.once("data", (input) => {
      received = JSON.parse(String(input).trim());
      socket.write(`${JSON.stringify({ id: received.id, result: { active: false } })}\n`);
    });
  }, async (socketPath) => {
    const result = await clearAttentionView(socketPath);
    assert.deepEqual(result, { active: false });
  });

  assert.equal(received.method, "agent.view.clear");
  assert.deepEqual(received.params, { source: "plugin:ludoroo.attention" });
});

test("surfaces Herdr API errors", async () => {
  await withServer((socket) => {
    socket.once("data", (input) => {
      const request = JSON.parse(String(input).trim());
      socket.write(`${JSON.stringify({
        id: request.id,
        error: { code: "invalid_view", message: "bad filter" },
      })}\n`);
    });
  }, async (socketPath) => {
    await assert.rejects(
      syncAttentionView(socketPath),
      /invalid_view: bad filter/,
    );
  });
});

test("times out when the API accepts a request without responding", async () => {
  await withServer(() => {}, async (socketPath) => {
    await assert.rejects(
      syncAttentionView(socketPath, { timeoutMs: 25 }),
      (error) => error.code === "ETIMEDOUT",
    );
  });
});

test("fails immediately when the socket closes without a response", async () => {
  await withServer((socket) => socket.destroy(), async (socketPath) => {
    const startedAt = Date.now();
    await assert.rejects(syncAttentionView(socketPath, { timeoutMs: 1_000 }));
    assert.ok(Date.now() - startedAt < 500, "closed socket should not wait for the timeout");
  });
});
