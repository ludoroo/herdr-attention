#!/usr/bin/env node
import { clearAttentionView } from "./view.mjs";

const socketPath = process.env.HERDR_SOCKET_PATH;
if (!socketPath) {
  console.error("attention view: missing Herdr socket path");
  process.exit(1);
}

try {
  await clearAttentionView(socketPath);
} catch (error) {
  console.error(`attention view: ${error.message}`);
  process.exit(1);
}
