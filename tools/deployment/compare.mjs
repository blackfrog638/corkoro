import { readFile } from "node:fs/promises";
import { parseDeployment } from "../../dist/packages/content-contract/src/deployment.js";
import { compare } from "../../dist/tools/cli/src/git-site.js";
const args = process.argv.slice(2);
if (args.length !== 3 || args.some((a) => !a.trim() || a.startsWith("-"))) {
  console.error(
    "Usage: pnpm --silent compare:site <snapshot.json> <local-repository> <branch>",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await compare(
      parseDeployment(await readFile(args[0])),
      args[1],
      args[2],
    );
    console.log(JSON.stringify(result));
    if (result.conflict.length) process.exitCode = 3;
  } catch (error) {
    console.error(JSON.stringify({ message: error.message }));
    process.exitCode = 1;
  }
}
