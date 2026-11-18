import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

test("deployment snapshot validates portable paths, bytes and a site-specific identity", async () => {
  const { sealDeployment, parseDeployment } = await import(
    "../../dist/packages/content-contract/src/deployment.js"
  );
  const file = {
    path: "index.html",
    base64: Buffer.from("public").toString("base64"),
    hash: digest("public"),
  };
  const input = {
    format: "corkoro-deployment",
    schemaVersion: 1,
    buildId: "sha256:" + "a".repeat(64),
    base: "/blog/",
    files: [file],
  };
  const snapshot = sealDeployment(input);
  assert.deepEqual(
    parseDeployment(Buffer.from(JSON.stringify(snapshot))),
    snapshot,
  );
  assert.deepEqual(sealDeployment(input), snapshot);
  const themeChanged = sealDeployment({
    ...input,
    files: [
      {
        ...file,
        base64: Buffer.from("new theme").toString("base64"),
        hash: digest("new theme"),
      },
    ],
  });
  assert.notEqual(themeChanged.deploymentId, snapshot.deploymentId);
  for (const name of [
    "../secret",
    "C:/secret",
    "/secret",
    "a\\secret",
    "a/../secret",
  ])
    assert.throws(() =>
      sealDeployment({ ...input, files: [file, { ...file, path: name }] }),
    );
  assert.throws(() =>
    sealDeployment({
      ...input,
      files: [file, { ...file, path: "INDEX.html" }],
    }),
  );
  assert.throws(() =>
    sealDeployment({
      ...input,
      files: [
        file,
        { ...file, path: "assets" },
        { ...file, path: "assets/icon.svg" },
      ],
    }),
  );
  assert.throws(() =>
    sealDeployment({ ...input, files: [{ ...file, base64: "bad" }] }),
  );
  assert.throws(() =>
    parseDeployment(
      Buffer.from(JSON.stringify({ ...snapshot, base: "/other/" })),
    ),
  );
});
