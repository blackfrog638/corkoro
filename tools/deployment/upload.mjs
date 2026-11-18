import { uploadSite } from "../../dist/tools/cli/src/upload.js";
import { failure } from "../../dist/packages/publisher/src/errors.js";
const args = process.argv.slice(2);
if (args.length !== 7 || args.some((v) => !v.trim() || v.startsWith("-"))) {
  console.error(
    "Usage: pnpm --silent upload:site <snapshot> <local-repo> <branch> <remote> <expected-remote-commit> <local-commit> <deployment-id>",
  );
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await uploadSite(...args)));
  } catch (error) {
    const err = failure(error);
    console.error(JSON.stringify({ code: err.code, message: err.message }));
    process.exitCode = err.exitCode;
  }
}
