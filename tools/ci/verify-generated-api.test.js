const assert = require("assert/strict");
const { EventEmitter } = require("events");
const test = require("node:test");
const {
  backendEnvironment,
  captureChildOutput,
  openApiUrlForPort,
  parseExplicitPort,
  reserveLoopbackPort,
  resolveQualityGatePort,
  waitForOpenApi,
} = require("./verify-generated-api");

function child({ exitCode = null, signalCode = null } = {}) {
  const result = new EventEmitter();
  result.exitCode = exitCode;
  result.signalCode = signalCode;
  result.stdout = new EventEmitter();
  result.stderr = new EventEmitter();
  return result;
}

test("uses a validated explicit QUALITY_GATE_PORT", async () => {
  assert.equal(parseExplicitPort("43123"), 43123);
  assert.equal(
    await resolveQualityGatePort({
      env: { QUALITY_GATE_PORT: "43123" },
      reservePort: async () => assert.fail("explicit port must not reserve"),
    }),
    43123,
  );
  for (const invalid of ["", "0", "65536", "port"]) {
    assert.throws(() => parseExplicitPort(invalid), /1 to 65535/);
  }
});

test("propagates an auto-selected loopback port consistently", async () => {
  const port = await resolveQualityGatePort({
    env: {},
    reservePort: async () => 41234,
  });
  const env = backendEnvironment(port, {});
  assert.equal(port, 41234);
  assert.equal(env.PORT1, "41234");
  assert.equal(env.PORT2, "41234");
  assert.equal(openApiUrlForPort(port), "http://127.0.0.1:41234/api-json");
});

test("planned concurrent auto invocations receive distinct ports", async () => {
  let nextPort = 44000;
  const reservePort = async () => nextPort++;
  const ports = await Promise.all([
    resolveQualityGatePort({ env: {}, reservePort }),
    resolveQualityGatePort({ env: {}, reservePort }),
  ]);
  assert.notEqual(ports[0], ports[1]);
});

test("reserves distinct real loopback ports for concurrent plans", async () => {
  const ports = await Promise.all([reserveLoopbackPort(), reserveLoopbackPort()]);
  assert.ok(ports.every((port) => Number.isInteger(port) && port > 0));
  assert.notEqual(ports[0], ports[1]);
});

test("early backend exit includes captured stderr diagnostics", async () => {
  const early = child({ exitCode: 1 });
  const output = captureChildOutput(early);
  early.stderr.emit("data", Buffer.from("database bootstrap failed"));
  await assert.rejects(
    () =>
      waitForOpenApi(early, output, {
        openapiUrl: "http://127.0.0.1:41000/api-json",
        attempts: 1,
        sleep: async () => {},
      }),
    /exit=1[\s\S]*database bootstrap failed/,
  );
});

test("readiness timeout includes the last child stderr", async () => {
  const pending = child();
  const output = captureChildOutput(pending);
  pending.stderr.emit("data", Buffer.from("waiting for migration"));
  await assert.rejects(
    () =>
      waitForOpenApi(pending, output, {
        openapiUrl: "http://127.0.0.1:41000/api-json",
        attempts: 1,
        sleep: async () => {},
        fetchImpl: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    /OpenAPI readiness timeout: connect ECONNREFUSED[\s\S]*waiting for migration/,
  );
});
