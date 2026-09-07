import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const DEFAULT_OUTPUT = fileURLToPath(new URL('../src/generated/api.ts', import.meta.url));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePayloadSchema(schema, label) {
  if (!isObject(schema) || !['$ref', 'type', 'enum', 'const', 'allOf', 'anyOf', 'oneOf']
    .some((key) => Object.hasOwn(schema, key))) {
    throw new Error(`Empty or unspecified payload schema: ${label}`);
  }
  if (schema.type === 'object' && !schema.$ref &&
      Object.keys(schema.properties ?? {}).length === 0 &&
      !Object.hasOwn(schema, 'additionalProperties') &&
      !schema.allOf && !schema.anyOf && !schema.oneOf) {
    throw new Error(`Object payload has no declared properties: ${label}`);
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    validatePayloadSchema(property, `${label}.${name}`);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (!schema[key]) continue;
    if (!Array.isArray(schema[key]) || schema[key].length === 0) {
      throw new Error(`Empty schema composition: ${label}.${key}`);
    }
    schema[key].forEach((item, index) => validatePayloadSchema(item, `${label}.${key}[${index}]`));
  }
  if (schema.items) validatePayloadSchema(schema.items, `${label}.items`);
  if (isObject(schema.additionalProperties)) validatePayloadSchema(schema.additionalProperties, `${label}.*`);
}

function validateContent(content, label) {
  if (!isObject(content) || Object.keys(content).length === 0) {
    throw new Error(`Empty response/request content: ${label}`);
  }
  for (const [mediaType, media] of Object.entries(content)) {
    validatePayloadSchema(media?.schema, `${label}:${mediaType}`);
  }
}

export function validateOpenApi(document) {
  if (!isObject(document) || !/^3\.(0|1)\.\d+$/.test(document.openapi ?? '')) {
    throw new Error('Expected an OpenAPI 3.0 or 3.1 JSON document');
  }
  if (!isObject(document.paths) || Object.keys(document.paths).length === 0) {
    throw new Error('OpenAPI paths must not be empty');
  }
  if (!isObject(document.info) || !document.info.title || !document.info.version) {
    throw new Error('OpenAPI info.title and info.version are required');
  }
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    validatePayloadSchema(schema, `components.schemas.${name}`);
  }
  const operations = [];
  for (const [route, item] of Object.entries(document.paths)) {
    if (!route.startsWith('/') || !isObject(item)) {
      throw new Error(`Invalid OpenAPI path: ${route}`);
    }
    for (const method of HTTP_METHODS) {
      if (!Object.hasOwn(item, method)) continue;
      if (!isObject(item[method])) throw new Error(`Invalid operation: ${method} ${route}`);
      const operation = item[method];
      if (!isObject(operation.responses) || Object.keys(operation.responses).length === 0) {
        throw new Error(`Operation has no response contract: ${method} ${route}`);
      }
      if (!Object.keys(operation.responses).some((status) => /^[23]\d\d$/.test(status))) {
        throw new Error(`Operation has no explicit success response: ${method} ${route}`);
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!isObject(response)) throw new Error(`Invalid response: ${method} ${route}:${status}`);
        if (response.$ref) continue;
        if (response.content) validateContent(response.content, `${method} ${route}:${status}`);
        else if (/^2\d\d$/.test(status) && status !== '204' && status !== '205') {
          throw new Error(`Success response has no payload schema: ${method} ${route}:${status}`);
        }
      }
      if (operation.requestBody && !operation.requestBody.$ref) {
        validateContent(operation.requestBody.content, `${method} ${route}:requestBody`);
      }
      for (const parameter of [...(item.parameters ?? []), ...(operation.parameters ?? [])]) {
        if (parameter.$ref) continue;
        if (parameter.content) validateContent(parameter.content, `${method} ${route}:${parameter.name}`);
        else validatePayloadSchema(parameter.schema, `${method} ${route}:${parameter.name}`);
      }
      operations.push({ route, method });
    }
  }
  if (operations.length === 0) {
    throw new Error('OpenAPI paths must contain concrete HTTP operations; bundle path references first');
  }
  return operations;
}

function memberName(node) {
  return node && (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isIdentifier(node)) ? node.text : undefined;
}

/** Reject empty/truncated generator output before replacing the last good artifact. */
export function validateGeneratedPaths(source, operations) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Generator produced empty output');
  const file = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw new Error('Generator produced invalid TypeScript syntax');
  const typeDeclarations = new Map(file.statements
    .filter((node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    .map((node) => [node.name.text, node]));
  function resolveType(node, visited = new Set()) {
    if (!node || visited.has(node)) return undefined;
    visited.add(node);
    if (ts.isTypeAliasDeclaration(node)) return resolveType(node.type, visited);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      return resolveType(typeDeclarations.get(node.typeName.text), visited);
    }
    if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType)) {
      const owner = resolveType(node.objectType, visited);
      const key = node.indexType.literal.text;
      return resolveType(owner?.members?.find((member) => memberName(member.name) === key)?.type, visited);
    }
    return node;
  }
  const declarations = file.statements.filter((node) =>
    (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === 'paths',
  );
  if (declarations.length !== 1) throw new Error('Generator must export exactly one paths declaration');
  const declaration = declarations[0];
  if (!declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    throw new Error('Generated paths declaration is not exported');
  }
  const members = ts.isInterfaceDeclaration(declaration)
    ? declaration.members
    : ts.isTypeLiteralNode(declaration.type) ? declaration.type.members : [];
  for (const { route, method } of operations) {
    const routeMember = members.find((member) => memberName(member.name) === route);
    const methodMember = routeMember?.type && ts.isTypeLiteralNode(routeMember.type)
      ? routeMember.type.members.find((member) => memberName(member.name) === method)
      : undefined;
    if (!methodMember?.type || methodMember.questionToken ||
        [ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.UndefinedKeyword].includes(methodMember.type.kind)) {
      throw new Error(`Generated paths is empty or missing operation: ${method} ${route}`);
    }
    const operation = resolveType(methodMember.type);
    const responses = resolveType(operation?.members?.find((member) => memberName(member.name) === 'responses')?.type);
    if (!responses?.members?.length) {
      throw new Error(`Generated operation has no concrete response contract: ${method} ${route}`);
    }
    for (const response of responses.members) {
      const resolved = resolveType(response.type);
      if (!resolved?.members?.length) {
        throw new Error(`Generated response is empty or untyped: ${method} ${route}`);
      }
      const status = memberName(response.name);
      if (/^2\d\d$/.test(status ?? '') && status !== '204' && status !== '205') {
        const content = resolveType(resolved.members.find((member) => memberName(member.name) === 'content')?.type);
        if (!content?.members?.length) {
          throw new Error(`Generated success response has no payload: ${method} ${route}:${status}`);
        }
        for (const media of content.members) {
          const payload = resolveType(media.type);
          if (!payload || [ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword,
            ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.UndefinedKeyword].includes(payload.kind) ||
            (payload.members && payload.members.length === 0)) {
            throw new Error(`Generated success payload is empty or untyped: ${method} ${route}:${status}`);
          }
        }
      }
    }
  }
}

async function readDocument(input, fetchImpl) {
  let source;
  if (/^https?:\/\//i.test(input)) {
    const response = await fetchImpl(input, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
    source = await response.text();
  } else {
    source = await readFile(input, 'utf8');
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('OpenAPI input is not valid JSON');
  }
}

async function generateTypes(document) {
  const { default: openapiTS, astToString, COMMENT_HEADER } = await import('openapi-typescript');
  return COMMENT_HEADER + astToString(await openapiTS(document));
}

export async function generateApi({
  input,
  output = DEFAULT_OUTPUT,
  check = false,
  fetchImpl = globalThis.fetch,
  generate = generateTypes,
}) {
  if (!input) throw new Error('An explicit --input JSON file or URL is required');
  const document = await readDocument(input, fetchImpl);
  const operations = validateOpenApi(document);
  const source = await generate(document);
  validateGeneratedPaths(source, operations);
  if (check) {
    const current = await readFile(output, 'utf8');
    if (current !== source) throw new Error('Generated API is stale; regenerate it from the same input');
    return { output, operationCount: operations.length, check: true };
  }

  const directory = path.dirname(output);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(output)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return { output, operationCount: operations.length, check: false };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--input' || argument === '--output') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await generateApi(parseArguments(process.argv.slice(2)));
    console.log(`[generate:api] ${result.check ? 'Verified' : 'Generated'} ${result.operationCount} operations`);
  } catch (error) {
    console.error(`[generate:api] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
