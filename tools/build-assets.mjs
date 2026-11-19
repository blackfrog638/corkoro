import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/packages/publisher/native", { recursive: true });
await copyFile(
  "packages/publisher/native/windows-transaction.ps1",
  "dist/packages/publisher/native/windows-transaction.ps1",
);
await copyFile(
  "packages/publisher/native/posix-transaction.py",
  "dist/packages/publisher/native/posix-transaction.py",
);
