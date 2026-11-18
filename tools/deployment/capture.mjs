import { captureDeployment } from "../../dist/apps/web/src/deployment.js";
import { failure } from "../../dist/packages/publisher/src/errors.js";
const abort = new AbortController();
process.on("SIGINT", () => abort.abort());
process.on("SIGTERM", () => abort.abort());
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].trim() || args[0].startsWith("--")) {
    process.stderr.write(
      "Usage: pnpm --silent package:site <output-directory>\n",
    );
    process.exitCode = 2;
  } else {
    const snapshot = await captureDeployment(args[0], abort.signal);
    process.stdout.write(JSON.stringify(snapshot) + "\n");
  }
} catch (error) {
  const err = failure(error);
  process.stderr.write(
    JSON.stringify({ code: err.code, message: err.message }) + "\n",
  );
  process.exitCode = err.exitCode;
}
