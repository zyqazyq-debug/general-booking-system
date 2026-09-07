const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  discoverIngressRoutes,
  validateOpenApiManifestAgainstDocument,
} = require("./openapi-ingress-coverage");

const repoRoot = path.resolve(__dirname, "../..");
const port = Number(process.env.QUALITY_GATE_PORT || "3101");
const openapiUrl = `http://127.0.0.1:${port}/api-json`;
const committedClient = path.join(repoRoot, "frontend/src/generated/api.ts");
const backendEntrypoint = path.join(repoRoot, "backend/dist/src/main.js");
const manifestModule = path.join(
  repoRoot,
  "backend/contracts/openapi-ingress-manifest.mjs",
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => value.replace(/\r\n/g, "\n").trimEnd();

async function waitForOpenApi(child) {
  let lastError = "backend did not respond";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `backend exited before OpenAPI was ready (exit=${child.exitCode})`,
      );
    }
    try {
      const response = await fetch(openapiUrl, {
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
    await delay(500);
  }
  throw new Error(`OpenAPI readiness timeout: ${lastError}`);
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
  validateOpenApiManifestAgainstDocument(manifest, routes, document);
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
  const child = spawn(process.execPath, [backendEntrypoint], {
    cwd: path.join(repoRoot, "backend"),
    env: {
      ...process.env,
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
    },
    stdio: "ignore",
  });

  try {
    const document = await waitForOpenApi(child);
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

module.exports = { run, validateIngress, waitForOpenApi };
