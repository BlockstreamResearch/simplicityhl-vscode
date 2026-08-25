import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

const DEFAULT_WINDOWS_EXTENSIONS = ".COM;.EXE";
const DIRECT_WINDOWS_EXTENSIONS = new Set([".com", ".exe"]);

export interface ExecutableSearchOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

/** Candidate file names that Windows would derive through PATHEXT. */
export function executableNames(
  command: string,
  platform: NodeJS.Platform,
  pathExt = DEFAULT_WINDOWS_EXTENSIONS,
): readonly string[] {
  if (platform !== "win32" || path.extname(command)) {
    return [command];
  }
  const extensions = pathExt
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`)
    .map((extension) => extension.toLowerCase())
    .filter((extension) => DIRECT_WINDOWS_EXTENSIONS.has(extension));
  return [
    command,
    ...extensions.map((extension) => `${command}${extension}`),
  ];
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    return environment[name];
  }
  return Object.entries(environment).find(([key]) =>
    key.toUpperCase() === name)?.[1];
}

function isUsableExecutable(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false;
    }
    if (platform === "win32") {
      const extension = path.extname(candidate).toLowerCase();
      if (extension && !DIRECT_WINDOWS_EXTENSIONS.has(extension)) {
        return false;
      }
    } else {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/** Find an executable in `PATH` or the common user installation directories. */
export function findExecutable(
  command: string,
  options: ExecutableSearchOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const home = options.homeDirectory ?? os.homedir();
  const pathSeparator = platform === "win32" ? ";" : path.delimiter;
  const pathDirectories = (environmentValue(environment, "PATH", platform) ?? "")
    .split(pathSeparator)
    .map((directory) => directory.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean);
  const commonDirectories = platform === "win32"
    ? [path.join(
        environmentValue(environment, "USERPROFILE", platform) ?? "C:\\Users\\Default",
        ".cargo",
        "bin",
      )]
    : [
        path.join(home, ".cargo", "bin"),
        "/usr/local/bin",
        "/usr/bin",
        path.join(home, ".local", "bin"),
      ];
  const names = executableNames(
    command,
    platform,
    environmentValue(environment, "PATHEXT", platform) ?? DEFAULT_WINDOWS_EXTENSIONS,
  );

  for (const directory of [...pathDirectories, ...commonDirectories]) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      const resolved = path.resolve(candidate);
      if (isUsableExecutable(resolved, platform)) {
        return resolved;
      }
    }
  }
  return null;
}
