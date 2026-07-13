/** CLI-wide error/exit-code contract: 0 success, 1 runtime error, 2 usage error. */
export class CliError extends Error {
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function usageError(message: string): never {
  throw new CliError(message, 2);
}

export function runtimeError(message: string): never {
  throw new CliError(message, 1);
}
