"use strict";

require("dotenv").config({ quiet: true, path: process.env.ENV_FILE || undefined });

const { load } = require("./src/config");
const { createApp } = require("./src/app");

let config;
try {
  config = load();
} catch (err) {
  console.error(err.message);
  process.exit(1); // refuse to start with bad settings
}

const app = createApp(config);
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`WildStrides running on port ${config.port} (${config.nodeEnv})`);
});

// Hosts' proxies keep connections open; Node's default (5s) can make them see random 502s.
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `Port ${config.port} is already in use. Stop the other server first.` : err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0)); // finish requests already in progress
  setTimeout(() => process.exit(1), 10 * 1000).unref(); // never hang forever
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1); // state may be corrupt; let the host restart a clean copy
});
