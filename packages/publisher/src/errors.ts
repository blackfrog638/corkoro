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

export const diagnosticExitCode = (ds: Diagnostic[]): Envelope["exitCode"] =>
  ds.some((d) => d.code === "CANCELLED")
    ? 130
    : ds.some((d) => d.code === "INTERNAL_ERROR")
      ? 1
      : ds.some((d) => ["IO_ERROR", "INPUT_CHANGED"].includes(d.code))
        ? 4
        : ds.some((d) => d.severity === "error")
          ? 3
          : 0;
const compareDiagnosticValue = (
  a: string | number | null,
  b: string | number | null,
) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
export const compareDiagnostics = (a: Diagnostic, b: Diagnostic) =>
  ({ error: 0, warning: 1, info: 2 })[a.severity] -
    { error: 0, warning: 1, info: 2 }[b.severity] ||
  compareDiagnosticValue(a.code, b.code) ||
  compareDiagnosticValue(a.location?.path ?? null, b.location?.path ?? null) ||
  compareDiagnosticValue(
    a.location?.pointer ?? null,
    b.location?.pointer ?? null,
  ) ||
  compareDiagnosticValue(a.location?.line ?? null, b.location?.line ?? null) ||
  compareDiagnosticValue(
    a.location?.column ?? null,
    b.location?.column ?? null,
  );
