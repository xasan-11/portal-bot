// Tiny cross-platform production launcher for the built dashboard.
// Reads PORT in Node (always reliable) instead of relying on shell-specific
// variable-expansion syntax like ${PORT:-3000}, which silently breaks under
// cmd.exe on Windows and is easy to get subtly wrong across shells.
import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";

// `-l <port>` alone left `serve` bound to localhost only, which Railway
// can't route external traffic to (confirmed from the deploy logs: 502
// despite the process being up). An explicit tcp:// listen URI binds it to
// 0.0.0.0, reachable from outside the container.
const child = spawn("npx", ["serve", "-s", "dist", "-l", `tcp://0.0.0.0:${port}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
