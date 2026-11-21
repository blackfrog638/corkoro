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
await mkdir("dist/apps/api/migrations", { recursive: true });
for (const name of ["0001_comments", "0002_reviews"])
  await copyFile(
    "apps/api/migrations/" + name + ".sql",
    "dist/apps/api/migrations/" + name + ".sql",
  );
