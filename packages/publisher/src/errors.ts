import type { Diagnostic, Envelope } from "../../content-contract/src/index.js";
export class Failure extends Error {
  constructor(
    public code: string,
    public exitCode: Envelope["exitCode"],
    message = code,
  ) {
    super(message);
  }
}
export function diag(
  code: string,
  severity: Diagnostic["severity"] = "error",
  message = code,
): Diagnostic {
  return { code, severity, message, location: null };
}
export function failure(error: unknown, missing = "MISSING_SOURCE"): Failure {
  if (error instanceof Failure) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT")
    return new Failure(missing, missing === "CONFIG_NOT_FOUND" ? 4 : 3);
  if (code)
    return new Failure("IO_ERROR", 4, `Filesystem operation failed (${code})`);
  return new Failure("INTERNAL_ERROR", 1, "Unexpected internal failure");
}
export function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Failure("CANCELLED", 130);
}
