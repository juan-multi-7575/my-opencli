import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Capability probe: the --session-key option only exists in opencli builds
// after it landed upstream. The bridge must never pass an unknown flag to an
// older installed opencli (commander rejects it and every browser command
// would break). Probe once per process, cache the result.

let _sessionKeySupported: boolean | null = null;

/** true if the installed opencli knows --session-key (cached after first call). */
export function sessionKeySupported(): boolean {
  if (_sessionKeySupported !== null) return _sessionKeySupported;
  _sessionKeySupported = probeInstalledOpencli();
  return _sessionKeySupported;
}

function probeInstalledOpencli(): boolean {
  try {
    const bin = execFileSync("which", ["opencli"], { encoding: "utf8", timeout: 5_000 }).trim();
    const pkgDir = path.dirname(path.dirname(path.dirname(fs.realpathSync(bin))));
    if (!pkgDir || !fs.existsSync(path.join(pkgDir, "package.json"))) return false;
    // grep the compiled dist for the flag literal — one scan, fast.
    execFileSync("grep", ["-rl", "--include=*.js", "--session-key", path.join(pkgDir, "dist")], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** The --session-key CLI args to append, or [] when the installed CLI lacks the option. */
export function sessionKeyArgs(): string[] {
  if (!sessionKeySupported()) return [];
  return ["--session-key", `pi-${process.env.PI_SESSION_ID ?? "default"}`];
}

/** Test hook: pin the probe result instead of shelling out. */
export function __setSessionKeySupportForTest(v: boolean): void {
  _sessionKeySupported = v;
}
