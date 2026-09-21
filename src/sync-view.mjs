#!/usr/bin/env node
import { syncAttentionViewAtStartup } from "./view.mjs";

const socketPath = process.env.HERDR_SOCKET_PATH;
if (!socketPath) {
  console.error("attention view: missing Herdr socket path");
  process.exit(1);
}

try {
  await syncAttentionViewAtStartup(socketPath);
} catch (error) {
  console.error(`attention view: ${error.message}`);
  process.exit(1);
}
