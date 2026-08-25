/** Parsed payload emitted by `simc`. */
export interface CompilerOutput {
  program?: string;
  witness?: string;
}

export function parseCompilerOutput(
  stdout: string,
  json: boolean,
): CompilerOutput {
  if (json) {
    try {
      const output = JSON.parse(stdout);
      return {
        program: output.program,
        witness: output.witness,
      };
    } catch {
      return { program: stdout };
    }
  }

  const programMatch = stdout.match(/Program:\s*\n(.+)/);
  const witnessMatch = stdout.match(/Witness:\s*\n(.+)/);
  return {
    program: programMatch?.[1]?.trim(),
    witness: witnessMatch?.[1]?.trim(),
  };
}
