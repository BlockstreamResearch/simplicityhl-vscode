import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import * as cp from "node:child_process";

// Searches for an executable in PATH and common installation directories.
// Used by both LSP client and compiler to locate binaries (simplicityhl-lsp, simc).
export function findExecutable(command: string): string | null {
  try {
    const resolved = cp
      .execSync(
        process.platform === "win32" ? `where ${command}` : `which ${command}`,
      )
      .toString()
      .split(/\r?\n/)[0]
      .trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Not found in PATH
  }

  const commonDirs: string[] = [];

  if (process.platform === "win32") {
    commonDirs.push(
      path.join(
        process.env["USERPROFILE"] ?? "C:\\Users\\Default",
        ".cargo",
        "bin",
      ),
    );
  } else {
    commonDirs.push(path.join(os.homedir(), ".cargo", "bin"));

    commonDirs.push(
      "/usr/local/bin",
      "/usr/bin",
      path.join(os.homedir(), ".local", "bin"),
    );
  }

  for (const dir of commonDirs) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
