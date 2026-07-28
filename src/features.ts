export interface ExperimentalFeatures {
  imports: boolean;
  enums: boolean;
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
