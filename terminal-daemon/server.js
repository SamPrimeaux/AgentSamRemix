import { PORT, log } from "./lib/pty-env.js";
import { server } from "./lib/http-routes.js";
import "./lib/ws-pty.js";
import { getMcpFsProcess } from "./lib/mcp-fs.js";
import { destroyAllSessions } from "./lib/session-lifecycle.js";

function shutdown(signal) {
  log(`received ${signal} — destroying all PTY sessions`);
  try {
    destroyAllSessions(`signal_${signal}`);
  } catch (err) {
    log(`shutdown destroy failed: ${err?.message || err}`);
  }
  try {
    server.close();
  } catch (_) {}
  // Give process-group SIGKILL timers a moment, then exit.
  setTimeout(() => process.exit(0), 200).unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, "0.0.0.0", () => {
  log(`ready on port ${PORT}`);
  getMcpFsProcess();
});
