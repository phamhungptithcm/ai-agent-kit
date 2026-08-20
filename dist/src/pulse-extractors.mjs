import path from "node:path";
import { PULSE_EXTRACTOR_VERSION } from "./pulse-contract.mjs";
import { readScannedSource } from "./pulse-scanner.mjs";

function lineNumber(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function captures(content, patterns) {
  const imports = [];
  for (const { pattern, group = 1, kind = "import" } of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[group]?.trim();
      if (value) imports.push({ specifier: value, line: lineNumber(content, match.index ?? 0), kind });
    }
  }
  return imports;
}

function extractJavaScript(content) {
  return captures(content, [
    { pattern: /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g },
    { pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "require" },
    { pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "dynamic-import" }
  ]);
}

function extractPython(content) {
  const imports = captures(content, [{ pattern: /^\s*import\s+([^#\n]+)/gm }]).flatMap((item) => item.specifier.split(",").map((part) => ({ ...item, specifier: part.trim().split(/\s+as\s+/)[0] })).filter((item) => item.specifier));
  for (const match of content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^#\n]+)/gm)) {
    const moduleName = match[1];
    const names = match[2].replace(/[()]/g, "").split(",").map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const line = lineNumber(content, match.index ?? 0);
    if (!names.length || names.includes("*")) imports.push({ specifier: moduleName, line, kind: "from-import" });
    else for (const name of names) imports.push({ specifier: `${moduleName}${moduleName.endsWith(".") ? "" : "."}${name}`, line, kind: "from-import" });
  }
  return imports;
}

function extractGo(content) {
  const imports = captures(content, [{ pattern: /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm }]);
  for (const block of content.matchAll(/\bimport\s*\(([^)]+)\)/gs)) {
    for (const match of block[1].matchAll(/(?:^|\n)\s*(?:[\w.]+\s+)?"([^"]+)"/g)) imports.push({ specifier: match[1], line: lineNumber(content, (block.index ?? 0) + (match.index ?? 0)), kind: "import" });
  }
  return imports;
}

function extractRust(content) {
  return captures(content, [
    { pattern: /^\s*use\s+((?:crate|self|super)::[A-Za-z0-9_:]+)/gm },
    { pattern: /^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm, kind: "module" }
  ]).map((item) => ({ ...item, specifier: item.specifier.replace(/::\{.*$/, "") }));
}

function extractJvm(content) {
  return captures(content, [{ pattern: /^\s*import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.*]+)/gm }]);
}

function extractCsharp(content) {
  return captures(content, [{ pattern: /^\s*(?:global\s+)?using\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm }]);
}

function extractor(language, content) {
  if (["javascript", "typescript"].includes(language)) return extractJavaScript(content);
  if (language === "python") return extractPython(content);
  if (language === "go") return extractGo(content);
  if (language === "rust") return extractRust(content);
  if (["java", "kotlin"].includes(language)) return extractJvm(content);
  if (language === "csharp") return extractCsharp(content);
  return [];
}

function candidatesFor(entry, specifier) {
  const directory = path.posix.dirname(entry.path);
  if (["javascript", "typescript"].includes(entry.language) && specifier.startsWith(".")) {
    const base = path.posix.normalize(path.posix.join(directory, specifier));
    return [base, ...[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].map((extension) => `${base}${extension}`), ...["index.js", "index.mjs", "index.ts", "index.tsx"].map((name) => path.posix.join(base, name))];
  }
  if (entry.language === "python") {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const moduleName = specifier.replace(/^\.+/, "").split(".").join("/");
    let base = dots ? directory : "";
    for (let index = 1; index < dots; index += 1) base = path.posix.dirname(base);
    const target = path.posix.normalize(path.posix.join(base, moduleName));
    return [`${target}.py`, path.posix.join(target, "__init__.py")];
  }
  if (entry.language === "rust" && /^(crate|self|super)::/.test(specifier)) {
    const parts = specifier.split("::");
    let base = parts.shift() === "crate" ? "src" : directory;
    while (parts[0] === "super") { base = path.posix.dirname(base); parts.shift(); }
    if (parts[0] === "self") parts.shift();
    const target = path.posix.join(base, ...parts.slice(0, 1));
    return [`${target}.rs`, path.posix.join(target, "mod.rs")];
  }
  return [];
}

function symbolIndexes(scan) {
  const jvm = new Map();
  const csharp = new Map();
  const goModules = [];
  for (const entry of scan.inventory.entries) {
    const content = readScannedSource(scan, entry);
    if (["java", "kotlin"].includes(entry.language)) {
      const packageName = content.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/m)?.[1];
      if (packageName) jvm.set(`${packageName}.${path.posix.basename(entry.path).replace(/\.(java|kt|kts)$/, "")}`, entry.path);
    }
    if (entry.language === "csharp") {
      const namespace = content.match(/^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/m)?.[1];
      if (namespace) csharp.set(namespace, entry.path);
    }
    if (path.posix.basename(entry.path) === "go.mod") {
      const moduleName = content.match(/^\s*module\s+(\S+)/m)?.[1];
      if (moduleName) goModules.push({ moduleName, directory: path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path) });
    }
  }
  return { jvm, csharp, goModules };
}

function resolveImport(entry, specifier, files, indexes) {
  const sameFamily = (left, right) => left === right || (["javascript", "typescript"].includes(left) && ["javascript", "typescript"].includes(right)) || (["java", "kotlin"].includes(left) && ["java", "kotlin"].includes(right));
  for (const candidate of candidatesFor(entry, specifier)) if (files.has(candidate) && sameFamily(files.get(candidate).language, entry.language)) return { target: candidate, resolution: "same-language" };
  if (["java", "kotlin"].includes(entry.language)) {
    const exact = indexes.jvm.get(specifier.replace(/\.\*$/, ""));
    if (exact && sameFamily(files.get(exact)?.language, entry.language)) return { target: exact, resolution: "same-language" };
  }
  if (entry.language === "csharp") {
    const exact = indexes.csharp.get(specifier);
    if (exact) return { target: exact, resolution: "same-language" };
  }
  if (entry.language === "go") {
    for (const module of indexes.goModules) {
      if (specifier === module.moduleName || specifier.startsWith(`${module.moduleName}/`)) {
        const suffix = specifier.slice(module.moduleName.length).replace(/^\//, "");
        const directory = path.posix.join(module.directory, suffix);
        const target = [...files.keys()].find((file) => files.get(file).language === "go" && path.posix.dirname(file) === directory);
        if (target) return { target, resolution: "same-language-manifest" };
      }
    }
  }
  return null;
}

export function extractDependencies(scan) {
  const files = new Map(scan.inventory.entries.map((entry) => [entry.path, entry]));
  const indexes = symbolIndexes(scan);
  const edges = [];
  const unresolved = [];
  const failures = [];
  let importsTotal = 0;
  for (const entry of scan.inventory.entries) {
    try {
      const content = readScannedSource(scan, entry);
      const imports = extractor(entry.language, content);
      importsTotal += imports.length;
      for (const item of imports) {
        const resolved = resolveImport(entry, item.specifier, files, indexes);
        if (resolved) edges.push({ from: entry.path, to: resolved.target, language: entry.language, kind: item.kind, specifier: item.specifier, line: item.line, resolution: resolved.resolution });
        else unresolved.push({ from: entry.path, language: entry.language, kind: item.kind, specifier: item.specifier, line: item.line, reason: "external_ambiguous_or_unsupported" });
      }
    } catch (error) {
      failures.push({ path: entry.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const bridge of scan.config.bridges ?? []) {
    if (!bridge || typeof bridge !== "object" || !files.has(bridge.from) || !files.has(bridge.to)) throw new Error("pulse bridge must reference two inventoried files");
    edges.push({ from: bridge.from, to: bridge.to, language: `${files.get(bridge.from).language}->${files.get(bridge.to).language}`, kind: "manifest-bridge", specifier: bridge.id ?? `${bridge.from}->${bridge.to}`, line: null, resolution: "explicit-cross-language-manifest" });
  }
  const unique = [...new Map(edges.map((edge) => [`${edge.from}\0${edge.to}\0${edge.kind}\0${edge.specifier}`, edge])).values()].sort((left, right) => `${left.from}:${left.to}:${left.line ?? 0}`.localeCompare(`${right.from}:${right.to}:${right.line ?? 0}`));
  const resolvedImports = unique.filter((edge) => edge.resolution !== "explicit-cross-language-manifest").length;
  const explicitBridges = unique.length - resolvedImports;
  return {
    extractor_version: PULSE_EXTRACTOR_VERSION,
    edges: unique,
    unresolved: unresolved.sort((left, right) => `${left.from}:${left.line}`.localeCompare(`${right.from}:${right.line}`)),
    failures,
    counts: { imports_total: importsTotal, resolved_internal: resolvedImports, explicit_bridges: explicitBridges, unresolved: unresolved.length, failures: failures.length }
  };
}
