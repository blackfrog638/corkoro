import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { canonical, forbidden, hash } from "./files.js";
import { cancelled, Failure } from "./errors.js";
import { parseJson } from "../../content-contract/src/index.js";

async function safeFile(p: string, allowMissing = false) {
  try {
    const s = await fs.lstat(p);
    if (s.isSymbolicLink() || !s.isFile() || s.nlink !== 1)
      throw new Failure("UNSAFE_TRANSACTION_STATE", 4);
  } catch (e) {
    if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function openTransaction(input: string, signal?: AbortSignal) {
  cancelled(signal);
  if (
    process.platform !== "win32" ||
    !path.isAbsolute(input) ||
    input.startsWith("\\\\")
  )
    throw new Failure("TRANSACTION_UNSUPPORTED", 4);
  if (forbidden(input)) throw new Failure("PATH_OUT_OF_SCOPE", 3);
  await safeFile(input, true);
  const target = await canonical(input),
    parent = path.dirname(target);
  if (target.startsWith("\\\\"))
    throw new Failure("TRANSACTION_UNSUPPORTED", 4);
  const helper = fileURLToPath(
    new URL("../native/windows-transaction.ps1", import.meta.url),
  );
  const executable = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const child = spawn(
    executable,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false },
  );
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  child.on("error", (e) => {
    spawnError = e;
  });
  child.stdin.on("error", () => {});
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  let committing = false,
    closed = false;
  const stop = () => {
    if (!committing) child.stdin.end();
  };
  signal?.addEventListener("abort", stop, { once: true });
  const close = async () => {
    if (!closed) {
      closed = true;
      signal?.removeEventListener("abort", stop);
      child.stdin.end();
    }
    await exited;
  };
  const send = (v: unknown) => child.stdin.write(JSON.stringify(v) + "\n");
  const receive = async () => {
    const line = await iterator.next();
    if (line.done || spawnError)
      throw new Failure(
        committing ? "COMMIT_UNKNOWN" : "TRANSACTION_UNSUPPORTED",
        committing ? 5 : 4,
      );
    let r: { status?: string; code?: string };
    try {
      r = JSON.parse(line.value);
      if (
        !r ||
        typeof r !== "object" ||
        (!["supported", "ready", "committed"].includes(r.status ?? "") &&
          ![
            "TRANSACTION_UNSUPPORTED",
            "CONFIG_BUSY",
            "IO_ERROR",
            "UNSAFE_TRANSACTION_STATE",
            "CONFIG_EXISTS",
            "CONFIG_CHANGED",
            "COMMIT_UNKNOWN",
          ].includes(r.code ?? ""))
      )
        throw new Error("Invalid response");
    } catch {
      throw new Failure(
        committing ? "COMMIT_UNKNOWN" : "TRANSACTION_UNSUPPORTED",
        committing ? 5 : 4,
      );
    }
    if (r.code) throw new Failure(r.code, r.code === "COMMIT_UNKNOWN" ? 5 : 4);
    return r;
  };
  let stateDir: string;
  try {
    send({ path: target });
    await receive();
    cancelled(signal);
    await fs.mkdir(parent, { recursive: true });
    stateDir = path.join(parent, ".corkoro-state");
    let created = false;
    try {
      await fs.mkdir(stateDir);
      created = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const d = await fs.lstat(stateDir);
    if (!d.isDirectory() || d.isSymbolicLink())
      throw new Failure("UNSAFE_TRANSACTION_STATE", 4);
    const marker = path.join(stateDir, "marker.json");
    if (created)
      await fs.writeFile(
        marker,
        JSON.stringify({ format: "corkoro-transactions", version: 1 }),
        { flag: "wx" },
      );
    await safeFile(marker);
    let metadata: unknown;
    try {
      metadata = parseJson(await fs.readFile(marker));
    } catch {
      throw new Failure("UNSAFE_TRANSACTION_STATE", 4);
    }
    if (
      JSON.stringify(metadata) !==
      JSON.stringify({ format: "corkoro-transactions", version: 1 })
    )
      throw new Failure("UNSAFE_TRANSACTION_STATE", 4);
    const key = createHash("sha256").update(target.toUpperCase()).digest("hex");
    const lock = path.join(stateDir, key + ".lock");
    await safeFile(lock, true);
    cancelled(signal);
    send({ lock });
    await receive();
    cancelled(signal);
    await safeFile(target, true);
  } catch (e) {
    await close();
    cancelled(signal);
    throw e;
  }
  let initialIdentity: string | null = null;
  try {
    const st = await fs.stat(target, { bigint: true });
    initialIdentity = `${st.dev}:${st.ino}`;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      await close();
      throw e;
    }
  }
  async function verifyTargetIdentity() {
    let currentIdentity: string | null = null;
    try {
      const st = await fs.stat(target, { bigint: true });
      currentIdentity = `${st.dev}:${st.ino}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (currentIdentity !== initialIdentity)
      throw new Failure(
        initialIdentity === null ? "CONFIG_EXISTS" : "CONFIG_CHANGED",
        4,
      );
  }
  let leftovers: boolean;
  try {
    leftovers = (await fs.readdir(stateDir)).some((s) => s.endsWith(".tmp"));
  } catch (e) {
    await close();
    throw e;
  }
  let cleanupPending = false;
  return {
    target,
    close,
    leftovers,
    get cleanupPending() {
      return cleanupPending;
    },
    async commit(bytes: Buffer, expected: string | null) {
      let temp: string | undefined,
        identity: { dev: bigint; ino: bigint } | undefined,
        unknown = false;
      try {
        cancelled(signal);
        await safeFile(target, true);
        await verifyTargetIdentity();
        temp = path.join(stateDir, randomUUID() + ".tmp");
        const f = await fs.open(temp, "wx");
        try {
          await f.writeFile(bytes);
          await f.sync();
          identity = await f.stat({ bigint: true });
        } finally {
          await f.close();
        }
        cancelled(signal);
        await safeFile(target, true);
        await verifyTargetIdentity();
        committing = true;
        send({ action: "commit", temp, expected });
        const response = await receive();
        if (response.status !== "committed")
          throw new Failure("COMMIT_UNKNOWN", 5);
        return {
          version: hash(bytes),
          cancelledAfterCommit: signal?.aborted ?? false,
        };
      } catch (e) {
        unknown =
          committing &&
          (!(e instanceof Failure) || e.code === "COMMIT_UNKNOWN");
        if (unknown) throw new Failure("COMMIT_UNKNOWN", 5);
        if (committing && signal?.aborted) throw new Failure("CANCELLED", 130);
        throw e;
      } finally {
        if (temp && identity && !unknown) {
          try {
            const st = await fs.lstat(temp, { bigint: true });
            if (
              st.dev === identity.dev &&
              st.ino === identity.ino &&
              !st.isSymbolicLink()
            )
              await fs.unlink(temp);
            else cleanupPending = true;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
              cleanupPending = true;
          }
        }
        if (unknown) cleanupPending = true;
        await close();
      }
    },
  };
}
