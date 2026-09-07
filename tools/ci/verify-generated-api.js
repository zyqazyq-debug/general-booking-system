const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  discoverIngressRoutes,
  readGlobalPrefixConfiguration,
  validateOpenApiManifestAgainstDocument,
} = require("./openapi-ingress-coverage");

const repoRoot = path.resolve(__dirname, "../..");
const committedClient = path.join(repoRoot, "frontend/src/generated/api.ts");
const backendEntrypoint = path.join(repoRoot, "backend/dist/src/main.js");
const manifestModule = path.join(
  repoRoot,
  "backend/contracts/openapi-ingress-manifest.mjs",
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => value.replace(/\r\n/g, "\n").trimEnd();
const MAX_CHILD_LOG_BYTES = 16 * 1024;

function parseExplicitPort(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("QUALITY_GATE_PORT must be an integer from 1 to 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("QUALITY_GATE_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      server.removeListener("error", fail);
      const address = server.address();
      if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
        server.close(() => reject(new Error("could not reserve a loopback port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function resolveQualityGatePort({ env = process.env, reservePort = reserveLoopbackPort } = {}) {
  if (env.QUALITY_GATE_PORT !== undefined) {
    return parseExplicitPort(env.QUALITY_GATE_PORT);
  }
  return reservePort();
}

function openApiUrlForPort(port) {
  return `http://127.0.0.1:${port}/api-json`;
}

function createBoundedLog(maxBytes = MAX_CHILD_LOG_BYTES) {
  let value = "";
  return {
    append(chunk) {
      value = (value + Buffer.from(chunk).toString("utf8")).slice(-maxBytes);
    },
    read() {
      return value || "<empty>";
    },
  };
}

function captureChildOutput(child) {
  const stdout = createBoundedLog();
  const stderr = createBoundedLog();
  let spawnError = null;
  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));
  child.once("error", (error) => {
    spawnError = error;
  });
  return { stdout, stderr, get spawnError() { return spawnError; } };
}

function childDiagnostics(child, output) {
  return [
    `exit=${String(child.exitCode)} signal=${String(child.signalCode)}`,
    output.spawnError ? `spawnError=${output.spawnError.message}` : null,
    `stdout:\n${output.stdout.read()}`,
    `stderr:\n${output.stderr.read()}`,
  ].filter(Boolean).join("\n");
}

function backendEnvironment(port, baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    NODE_ENV: "test",
    USE_POSTGRES: "false",
    TYPEORM_SYNCHRONIZE: "true",
    JWT_SECRET: "quality_gate_only_secret",
    JWT_SECRET1: "quality_gate_only_secret",
    JWT_SECRET_ACTIVE_INDEX: "1",
    TELEGRAM_BOT_TOKEN: "DUMMY",
    TELEGRAM_BOT_MODE: "polling",
    TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP: "false",
    H5_URL: "http://127.0.0.1:8080",
    TELEGRAM_WEBAPP_URL: "http://127.0.0.1:8080",
    PORT_ACTIVE_INDEX: "1",
    PORT1: String(port),
    PORT2: String(port),
    SENTRY_DSN: "",
  };
}

async function waitForOpenApi(child, output, { openapiUrl, fetchImpl = fetch, attempts = 60, sleep = delay } = {}) {
  if (!openapiUrl) throw new Error("openapiUrl is required");
  let lastError = "backend did not respond";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `backend exited before OpenAPI was ready\n${childDiagnostics(child, output)}`,
      );
    }
    try {
      const response = await fetchImpl(openapiUrl, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const document = await response.json();
        const pathCount = Object.keys(document.paths || {}).length;
        const schemaCount = Object.keys(
          document.components?.schemas || {},
        ).length;
        if (pathCount === 0 || schemaCount === 0) {
          throw new Error(
            `OpenAPI document is empty (paths=${pathCount}, schemas=${schemaCount})`,
          );
        }
        return document;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(
    `OpenAPI readiness timeout: ${lastError}\n${childDiagnostics(child, output)}`,
  );
}

async function validateIngress(document) {
  const { readOpenApiIngressManifest } = await import(
    pathToFileURL(manifestModule).href
  );
  const manifest = readOpenApiIngressManifest(
    path.join(repoRoot, "backend/contracts/openapi-ingress-manifest.json"),
  );
  const routes = discoverIngressRoutes({
    backendRoot: path.join(repoRoot, "backend"),
  });
  const runtimeConfiguration = readGlobalPrefixConfiguration({
    backendRoot: path.join(repoRoot, "backend"),
  });
  validateOpenApiManifestAgainstDocument(
    manifest,
    routes,
    document,
    runtimeConfiguration,
  );
  console.log(
    "[generated-api] PASS ingress manifest and runtime OpenAPI coverage",
  );
}

function resolveGeneratorCli() {
  const runtimeEntrypoint = require.resolve("openapi-typescript", {
    paths: [path.join(repoRoot, "frontend")],
  });
  const packageJson = path.resolve(
    path.dirname(runtimeEntrypoint),
    "../package.json",
  );
  const metadata = JSON.parse(fs.readFileSync(packageJson, "utf8"));
  const relativeBin =
    typeof metadata.bin === "string"
      ? metadata.bin
      : metadata.bin?.["openapi-typescript"];
  if (!relativeBin) {
    throw new Error("openapi-typescript CLI entrypoint is missing");
  }
  return path.resolve(path.dirname(packageJson), relativeBin);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) {
    await delay(100);
  }
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function run() {
  if (!fs.existsSync(backendEntrypoint)) {
    throw new Error("backend build output is missing; run backend build first");
  }
  if (!fs.existsSync(committedClient)) {
    throw new Error("frontend/src/generated/api.ts is missing");
  }

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "booking-openapi-gate-"),
  );
  const generatedClient = path.join(temporaryDirectory, "api.ts");
  const port = await resolveQualityGatePort();
  const openapiUrl = openApiUrlForPort(port);
  const child = spawn(process.execPath, [backendEntrypoint], {
    cwd: path.join(repoRoot, "backend"),
    env: backendEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureChildOutput(child);

  try {
    const document = await waitForOpenApi(child, output, { openapiUrl });
    await validateIngress(document);
    const cli = resolveGeneratorCli();
    const generator = spawn(
      process.execPath,
      [cli, openapiUrl, "-o", generatedClient],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    const exitCode = await new Promise((resolve, reject) => {
      generator.once("error", reject);
      generator.once("exit", resolve);
    });
    if (exitCode !== 0) {
      throw new Error(`openapi-typescript failed (exit=${String(exitCode)})`);
    }
    const generated = fs.readFileSync(generatedClient, "utf8");
    if (/export\s+type\s+paths\s*=\s*\{\s*\}/.test(generated)) {
      throw new Error("generated API contains an empty paths contract");
    }
    const committed = fs.readFileSync(committedClient, "utf8");
    if (normalize(generated) !== normalize(committed)) {
      throw new Error(
        "frontend/src/generated/api.ts is stale; regenerate from the built backend OpenAPI document",
      );
    }
    console.log("[generated-api] PASS non-empty and reproducible");
  } finally {
    await stopChild(child);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module)
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

module.exports = {
  MAX_CHILD_LOG_BYTES,
  backendEnvironment,
  captureChildOutput,
  childDiagnostics,
  createBoundedLog,
  openApiUrlForPort,
  parseExplicitPort,
  reserveLoopbackPort,
  resolveQualityGatePort,
  run,
  validateIngress,
  waitForOpenApi,
};
