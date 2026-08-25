import type { ExperimentalFeatures, TaskCommand } from "../contracts";

export interface CompileOptions {
  debug?: boolean;
  witnessFile?: string;
  json?: boolean;
}

export function compilerFeatureArguments(
  features: ExperimentalFeatures,
): string[] {
  const args: string[] = [];
  if (features.imports) {
    args.push("-Z", "imports");
  }
  if (features.enums) {
    args.push("-Z", "enums");
  }
  return args;
}

export function compilerArguments(
  file: string,
  features: ExperimentalFeatures,
  options: CompileOptions = {},
): string[] {
  const args = [file, ...compilerFeatureArguments(features)];
  if (options.witnessFile) {
    args.push("-w", options.witnessFile);
  }
  if (options.debug) {
    args.push("--debug");
  }
  if (options.json) {
    args.push("--json");
  }
  return args;
}

export function taskCompilerArguments(
  command: TaskCommand,
  file: string,
  witnessFile: string | undefined,
  features: ExperimentalFeatures,
): string[] {
  switch (command) {
    case "compile":
      return compilerArguments(file, features);
    case "compile-debug":
      return compilerArguments(file, features, { debug: true });
    case "compile-with-witness":
      return compilerArguments(file, features, {
        witnessFile: witnessFile || "${file/.simf/.wit/}",
      });
  }
}
