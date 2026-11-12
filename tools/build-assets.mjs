import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/packages/publisher/native", { recursive: true });
await copyFile(
  "packages/publisher/native/windows-transaction.ps1",
  "dist/packages/publisher/native/windows-transaction.ps1",
);
