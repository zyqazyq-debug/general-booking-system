/*
 * Fail-closed reconciliation for public mutating ingress.  This deliberately
 * reads controller syntax as well as the running Swagger document: Swagger
 * alone cannot see `@Body('field')`, raw provider callbacks, or a controller
 * accidentally omitted from AppModule/OpenAPI.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HTTP_DECORATORS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

class IngressCoverageError extends Error {
  constructor(errors) {
    super(`OpenAPI ingress coverage failed:\n- ${errors.join("\n- ")}`);
    this.name = "IngressCoverageError";
    this.errors = errors;
  }
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [];
}

function calledDecorator(decorator) {
  const expression = decorator.expression;
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression)
  )
    return null;
  return { name: expression.expression.text, args: expression.arguments };
}

function literalPath(args, label, errors) {
  if (args.length === 0) return "";
  if (args.length !== 1 || !ts.isStringLiteral(args[0])) {
    errors.push(`${label} must use zero or one string-literal route argument`);
    return null;
  }
  return args[0].text;
}

function joinRoute(...parts) {
  const segments = parts
    .filter((part) => part !== "")
    .flatMap((part) => String(part).split("/"))
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

function relativeControllerFile(fileName, backendRoot) {
  return path.relative(backendRoot, fileName).replaceAll(path.sep, "/");
}

function parameterBindings(method, label, errors) {
  let bodyBinding = "none";
  let hasRawRequest = false;
  for (const parameter of method.parameters) {
    for (const decorator of decoratorsOf(parameter)) {
      const called = calledDecorator(decorator);
      if (!called) continue;
      if (called.name === "Req" || called.name === "Request")
        hasRawRequest = true;
      if (called.name !== "Body") continue;
      if (bodyBinding !== "none") {
        errors.push(`${label} declares more than one @Body parameter`);
        continue;
      }
      if (called.args.length === 0 || !ts.isStringLiteral(called.args[0])) {
        // Pipes in @Body(pipe) still bind the complete body.  We intentionally
        // do not try to infer custom pipe behaviour; it remains a whole body.
        bodyBinding = "whole";
      } else {
        bodyBinding = "field";
      }
    }
  }
  return { bodyBinding, hasRawRequest };
}

function scanControllerSource(
  sourceText,
  fileName,
  { backendRoot = process.cwd() } = {},
) {
  const errors = [];
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const classes = source.statements.filter(ts.isClassDeclaration);
  const routes = [];
  for (const klass of classes) {
    const controller = decoratorsOf(klass)
      .map(calledDecorator)
      .find((decorator) => decorator?.name === "Controller");
    if (!controller) continue;
    const controllerPath = literalPath(
      controller.args,
      `${fileName} @Controller`,
      errors,
    );
    if (controllerPath === null) continue;
    for (const member of klass.members) {
      if (
        !ts.isMethodDeclaration(member) ||
        !member.name ||
        !ts.isIdentifier(member.name)
      )
        continue;
      const httpDecorators = decoratorsOf(member)
        .map(calledDecorator)
        .filter(
          (decorator) =>
            decorator && HTTP_DECORATORS.has(decorator.name.toUpperCase()),
        );
      if (httpDecorators.length === 0) continue;
      if (httpDecorators.length !== 1) {
        errors.push(
          `${fileName}.${member.name.text} has ambiguous HTTP decorators`,
        );
        continue;
      }
      const http = httpDecorators[0];
      const methodPath = literalPath(
        http.args,
        `${fileName}.${member.name.text} @${http.name}`,
        errors,
      );
      if (methodPath === null) continue;
      const { bodyBinding, hasRawRequest } = parameterBindings(
        member,
        `${fileName}.${member.name.text}`,
        errors,
      );
      routes.push({
        controller_file: relativeControllerFile(fileName, backendRoot),
        handler: member.name.text,
        method: http.name.toUpperCase(),
        source_path: joinRoute(controllerPath, methodPath),
        body_binding: bodyBinding,
        has_raw_request: hasRawRequest,
        api_excluded: decoratorsOf(member)
          .map(calledDecorator)
          .some((decorator) => decorator?.name === "ApiExcludeEndpoint"),
      });
    }
  }
  if (errors.length) throw new IngressCoverageError(errors);
  return routes;
}

function walkControllerFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkControllerFiles(absolute, files);
    else if (entry.isFile() && entry.name.endsWith(".controller.ts"))
      files.push(absolute);
  }
  return files;
}

function discoverIngressRoutes({ backendRoot }) {
  const sourceRoot = path.join(backendRoot, "src");
  if (!fs.existsSync(sourceRoot))
    throw new IngressCoverageError([
      `backend source root is missing: ${sourceRoot}`,
    ]);
  return walkControllerFiles(sourceRoot).flatMap((file) =>
    scanControllerSource(fs.readFileSync(file, "utf8"), file, { backendRoot }),
  );
}

function stringProperty(object, name, label, errors) {
  const property = object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteral(candidate.name) && candidate.name.text === name)),
  );
  if (!property || !ts.isStringLiteral(property.initializer)) {
    errors.push(`${label}.${name} must be a string literal`);
    return null;
  }
  return property.initializer.text;
}

function readGlobalPrefixConfiguration({ backendRoot }) {
  const mainFile = path.join(backendRoot, "src/main.ts");
  if (!fs.existsSync(mainFile)) {
    throw new IngressCoverageError([
      `backend bootstrap is missing: ${mainFile}`,
    ]);
  }
  const errors = [];
  const source = ts.createSourceFile(
    mainFile,
    fs.readFileSync(mainFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setGlobalPrefix"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (calls.length !== 1) {
    errors.push(
      `${mainFile} must contain exactly one statically readable app.setGlobalPrefix call`,
    );
  }
  const call = calls[0];
  if (!call) throw new IngressCoverageError(errors);
  if (
    call.arguments.length !== 2 ||
    !ts.isStringLiteral(call.arguments[0]) ||
    !ts.isObjectLiteralExpression(call.arguments[1])
  ) {
    errors.push(
      `${mainFile} setGlobalPrefix must use a string literal and object literal options`,
    );
  }
  const prefix = ts.isStringLiteral(call.arguments[0])
    ? call.arguments[0].text
    : null;
  const options = ts.isObjectLiteralExpression(call.arguments[1])
    ? call.arguments[1]
    : null;
  const excluded = new Set();
  if (options) {
    const exclude = options.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === "exclude") ||
          (ts.isStringLiteral(property.name) &&
            property.name.text === "exclude")),
    );
    if (!exclude || !ts.isArrayLiteralExpression(exclude.initializer)) {
      errors.push(
        `${mainFile} setGlobalPrefix options.exclude must be an array literal`,
      );
    } else {
      for (const [index, entry] of exclude.initializer.elements.entries()) {
        if (ts.isStringLiteral(entry)) {
          excluded.add(entry.text);
        } else if (ts.isObjectLiteralExpression(entry)) {
          const pathValue = stringProperty(
            entry,
            "path",
            `${mainFile} exclude[${index}]`,
            errors,
          );
          if (pathValue !== null) excluded.add(pathValue);
        } else {
          errors.push(
            `${mainFile} exclude[${index}] must be a string or object with literal path`,
          );
        }
      }
    }
  }
  if (errors.length) throw new IngressCoverageError(errors);
  return { prefix, excluded };
}

function routeKey(route) {
  return `${route.controller_file}#${route.handler} ${route.method} ${route.source_path}`;
}

function resolveProperties(
  schema,
  components,
  seen = new Set(),
  label = "schema",
) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${label} is not an object schema`);
  }
  if (typeof schema.$ref === "string") {
    const prefix = "#/components/schemas/";
    if (!schema.$ref.startsWith(prefix))
      throw new Error(`${label} has unsupported ref ${schema.$ref}`);
    const name = schema.$ref.slice(prefix.length);
    if (!name || seen.has(name))
      throw new Error(`${label} has missing or cyclic ref ${schema.$ref}`);
    const target = components?.schemas?.[name];
    if (!target)
      throw new Error(`${label} references missing component ${schema.$ref}`);
    const next = new Set(seen);
    next.add(name);
    return resolveProperties(target, components, next, `component ${name}`);
  }
  const properties = new Set(Object.keys(schema.properties || {}));
  if (Array.isArray(schema.allOf)) {
    for (const [index, branch] of schema.allOf.entries()) {
      for (const property of resolveProperties(
        branch,
        components,
        seen,
        `${label}.allOf[${index}]`,
      ))
        properties.add(property);
    }
  }
  if (schema.oneOf || schema.anyOf || schema.not) {
    throw new Error(
      `${label} uses unsupported composition without explicit object properties`,
    );
  }
  if (properties.size === 0)
    throw new Error(`${label} has no declared properties`);
  return properties;
}

function documentOpenApiPath(route) {
  return route.runtime_prefix === "api"
    ? `/api${route.openapi_path}`
    : route.openapi_path;
}

function operationAt(document, route) {
  const operation =
    document?.paths?.[documentOpenApiPath(route)]?.[
      route.method.toLowerCase()
    ];
  return operation && typeof operation === "object" ? operation : null;
}

function validateOpenApiManifestAgainstDocument(
  manifest,
  discoveredRoutes,
  document,
  runtimeConfiguration,
) {
  const errors = [];
  const discoveredByKey = new Map(
    discoveredRoutes.map((route) => [routeKey(route), route]),
  );
  const manifestByOpenApi = new Map();
  const manifestKeys = new Set();

  for (const route of manifest.routes) {
    const key = routeKey(route);
    manifestKeys.add(key);
    const discovered = discoveredByKey.get(key);
    const label = `${route.method} ${route.source_path} (${route.controller_file}.${route.handler})`;
    if (!discovered) {
      errors.push(
        `${label} is declared in manifest but not found in controller source`,
      );
      continue;
    }
    const sourceBinding =
      route.body_binding === "raw" && discovered.has_raw_request
        ? "raw"
        : discovered.body_binding;
    if (route.body_binding !== sourceBinding) {
      errors.push(
        `${label} body binding mismatch: manifest=${route.body_binding}, source=${discovered.body_binding}`,
      );
    }
    if (route.body_kind === "external-webhook") {
      if (!discovered.api_excluded)
        errors.push(`${label} external webhook lacks @ApiExcludeEndpoint()`);
      if (route.body_binding === "raw" && !discovered.has_raw_request)
        errors.push(`${label} raw webhook lacks @Req() or @Request()`);
    }
    if (
      route.surface === "test-only" &&
      !route.controller_file.endsWith("-test.controller.ts")
    ) {
      errors.push(
        `${label} is test-only but controller filename does not prove test-only status`,
      );
    }
    if (
      route.surface === "app" &&
      route.controller_file.endsWith("-test.controller.ts")
    ) {
      errors.push(
        `${label} is app surface but controller filename is test-only`,
      );
    }
    if (runtimeConfiguration) {
      const isExcluded = runtimeConfiguration.excluded.has(
        route.source_path.slice(1),
      );
      if (runtimeConfiguration.prefix !== "api") {
        errors.push(
          `backend global prefix must be "api", found ${String(runtimeConfiguration.prefix)}`,
        );
      } else if (route.runtime_prefix === "none" && !isExcluded) {
        errors.push(
          `${label} declares no runtime prefix but is absent from main.ts global-prefix exclusions`,
        );
      } else if (route.runtime_prefix === "api" && isExcluded) {
        errors.push(
          `${label} declares api runtime prefix but is excluded in main.ts`,
        );
      }
    }
    const openApiKey = `${route.method} ${documentOpenApiPath(route)}`;
    if (manifestByOpenApi.has(openApiKey))
      errors.push(`manifest duplicates OpenAPI operation ${openApiKey}`);
    manifestByOpenApi.set(openApiKey, route);
  }

  for (const discovered of discoveredRoutes) {
    if (!MUTATING_METHODS.has(discovered.method)) continue;
    const key = routeKey(discovered);
    if (!manifestKeys.has(key)) {
      errors.push(
        `${discovered.method} ${discovered.source_path} (${discovered.controller_file}.${discovered.handler}) is a mutating controller route omitted from manifest`,
      );
    }
  }

  for (const route of manifest.routes) {
    const label = `${route.method} ${route.openapi_path}`;
    const operation = operationAt(document, route);
    if (route.surface === "test-only") {
      if (operation)
        errors.push(`${label} is test-only but appears in running OpenAPI`);
      continue;
    }
    if (route.body_kind === "external-webhook") {
      if (operation)
        errors.push(`${label} external webhook must be absent from OpenAPI`);
      continue;
    }
    if (!operation) {
      errors.push(
        `${label} manifest app route is missing from running OpenAPI`,
      );
      continue;
    }
    if (route.body_kind === "no-body") {
      if (operation.requestBody)
        errors.push(`${label} is no-body but OpenAPI declares requestBody`);
      continue;
    }
    const content = operation.requestBody?.content?.["application/json"];
    if (!content?.schema) {
      errors.push(
        `${label} sdk-json route lacks application/json requestBody schema`,
      );
      continue;
    }
    try {
      const properties = resolveProperties(content.schema, document.components);
      for (const required of route.validation.required_properties) {
        if (!properties.has(required))
          errors.push(
            `${label} request schema lacks declared property ${required}`,
          );
      }
    } catch (error) {
      errors.push(`${label} request schema invalid: ${error.message}`);
    }
  }

  for (const [openapiPath, item] of Object.entries(document?.paths || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      const upper = method.toUpperCase();
      if (!HTTP_DECORATORS.has(upper) || !operation?.requestBody) continue;
      const route = manifestByOpenApi.get(`${upper} ${openapiPath}`);
      if (!route || route.surface !== "app" || route.body_kind !== "sdk-json") {
        errors.push(
          `${upper} ${openapiPath} has an orphan OpenAPI requestBody`,
        );
      }
    }
  }
  if (errors.length) throw new IngressCoverageError(errors);
}

module.exports = {
  IngressCoverageError,
  discoverIngressRoutes,
  readGlobalPrefixConfiguration,
  resolveProperties,
  scanControllerSource,
  validateOpenApiManifestAgainstDocument,
};
