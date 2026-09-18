// Tiny cross-platform production launcher for the built dashboard.
// Reads PORT in Node (always reliable) instead of relying on shell-specific
// variable-expansion syntax like ${PORT:-3000}, which silently breaks under
// cmd.exe on Windows and is easy to get subtly wrong across shells.
import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";

const child = spawn("npx", ["serve", "-s", "dist", "-l", port], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
