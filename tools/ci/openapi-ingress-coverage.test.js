const assert = require("assert/strict");
const test = require("node:test");
const {
  IngressCoverageError,
  resolveProperties,
  scanControllerSource,
  validateOpenApiManifestAgainstDocument,
} = require("./openapi-ingress-coverage");

const backendRoot = process.cwd();
const controllerFile = `${backendRoot}/src/example.controller.ts`;
const manifestRoute = {
  controller_file: "src/example.controller.ts",
  handler: "create",
  surface: "app",
  method: "POST",
  source_path: "/example/:id",
  openapi_path: "/example/{id}",
  runtime_prefix: "api",
  runtime_path: "/api/example/:id",
  body_kind: "sdk-json",
  body_binding: "whole",
  owner: "example",
  validation: { required_properties: ["name"] },
};
const source = `import { Body, Controller, Post } from '@nestjs/common';
@Controller('example') export class ExampleController { @Post(':id') create(@Body() input: unknown) {} }`;
const discovered = scanControllerSource(source, controllerFile, {
  backendRoot,
});
const documentFor = (schema) => ({
  paths: {
    "/example/{id}": {
      post: { requestBody: { content: { "application/json": { schema } } } },
    },
  },
  components: {
    schemas: {
      Input: { type: "object", properties: { name: { type: "string" } } },
    },
  },
});

test("accepts a manifest route whose local ref has declared properties", () => {
  assert.doesNotThrow(() =>
    validateOpenApiManifestAgainstDocument(
      { routes: [manifestRoute] },
      discovered,
      documentFor({ $ref: "#/components/schemas/Input" }),
    ),
  );
});

test("rejects empty, missing and orphan request body schemas", () => {
  assert.throws(
    () =>
      validateOpenApiManifestAgainstDocument(
        { routes: [manifestRoute] },
        discovered,
        documentFor({ type: "object", properties: {} }),
      ),
    IngressCoverageError,
  );
  assert.throws(
    () =>
      validateOpenApiManifestAgainstDocument(
        { routes: [manifestRoute] },
        discovered,
        { paths: { "/example/{id}": { post: {} } } },
      ),
    IngressCoverageError,
  );
  const orphan = documentFor({ $ref: "#/components/schemas/Input" });
  orphan.paths["/other"] = {
    post: {
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", properties: { value: {} } },
          },
        },
      },
    },
  };
  assert.throws(
    () =>
      validateOpenApiManifestAgainstDocument(
        { routes: [manifestRoute] },
        discovered,
        orphan,
      ),
    /orphan/,
  );
});

test("resolves allOf but rejects missing refs", () => {
  const components = {
    schemas: {
      Base: { type: "object", properties: { name: {} } },
      Child: {
        allOf: [
          { $ref: "#/components/schemas/Base" },
          { type: "object", properties: { email: {} } },
        ],
      },
    },
  };
  assert.deepEqual(
    [
      ...resolveProperties({ $ref: "#/components/schemas/Child" }, components),
    ].sort(),
    ["email", "name"],
  );
  assert.throws(() =>
    resolveProperties({ $ref: "#/components/schemas/Nope" }, components),
  );
});

test("scans field body and raw excluded webhook with fail-closed route metadata", () => {
  const field = scanControllerSource(
    `import { Body, Controller, Patch } from '@nestjs/common'; @Controller('x') export class X { @Patch(':id') update(@Body('name') name: string) {} }`,
    controllerFile,
    { backendRoot },
  );
  assert.equal(field[0].body_binding, "field");
  const raw = scanControllerSource(
    `import { Controller, Post, Req } from '@nestjs/common'; import { ApiExcludeEndpoint } from '@nestjs/swagger'; @Controller('hook') export class X { @Post() @ApiExcludeEndpoint() receive(@Req() req: unknown) {} }`,
    controllerFile,
    { backendRoot },
  );
  assert.equal(raw[0].has_raw_request, true);
  assert.equal(raw[0].api_excluded, true);
  const webhook = {
    ...manifestRoute,
    handler: "receive",
    source_path: "/hook",
    openapi_path: "/hook",
    runtime_path: "/api/hook",
    body_kind: "external-webhook",
    body_binding: "raw",
    validation: { required_properties: [] },
    external_webhook: { classification: "external-provider-webhook-adapter" },
  };
  assert.doesNotThrow(() =>
    validateOpenApiManifestAgainstDocument({ routes: [webhook] }, raw, {
      paths: {},
    }),
  );
});

test("rejects a discovered mutating route omitted from the manifest", () => {
  assert.throws(
    () =>
      validateOpenApiManifestAgainstDocument({ routes: [] }, discovered, {
        paths: {},
      }),
    /omitted/,
  );
});
