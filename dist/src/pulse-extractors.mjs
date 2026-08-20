import path from "node:path";
import { spawnSync } from "node:child_process";
import { PULSE_EXTRACTOR_VERSION, PULSE_RESOLVER_VERSION, pulseFingerprint } from "./pulse-contract.mjs";
import { readScannedSource } from "./pulse-scanner.mjs";

const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const TIER_RANK = new Map([["SOURCE_FALLBACK", 0], ["AST_VERIFIED", 1], ["RESOLVER_VERIFIED", 2], ["INDEX_VERIFIED", 3], ["EXPLICIT_MANIFEST", 4]]);

function lineNumber(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function maskComments(content) {
  const chars = [...content];
  let state = "code";
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];
    if (state === "line") {
      if (current === "\n") state = "code";
      else chars[index] = " ";
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") { chars[index] = " "; chars[index + 1] = " "; index += 1; state = "code"; }
      else if (current !== "\n") chars[index] = " ";
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      const terminal = state === "single" ? "'" : state === "double" ? "\"" : "`";
      if (current === "\\") { index += 1; continue; }
      if (current === terminal) state = "code";
      continue;
    }
    if (current === "/" && next === "/") { chars[index] = " "; chars[index + 1] = " "; index += 1; state = "line"; }
    else if (current === "/" && next === "*") { chars[index] = " "; chars[index + 1] = " "; index += 1; state = "block"; }
    else if (current === "'") state = "single";
    else if (current === "\"") state = "double";
    else if (current === "`") state = "template";
  }
  return chars.join("");
}

function captures(content, patterns, evidenceTier = "SOURCE_FALLBACK") {
  const imports = [];
  for (const { pattern, group = 1, kind = "import" } of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[group]?.trim();
      if (value) imports.push({ specifier: value, line: lineNumber(content, match.index ?? 0), kind, evidence_tier: evidenceTier });
    }
  }
  return imports;
}

function extractJavaScript(content) {
  const masked = maskComments(content);
  return captures(masked, [
    { pattern: /(?:^|[;\n])\s*(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g },
    { pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "require" },
    { pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, kind: "dynamic-import" }
  ]);
}

function pythonAstImports(scan, entry, content) {
  if (scan.config.resolvers?.python === false) return null;
  const script = [
    "import ast,json,sys",
    "tree=ast.parse(sys.stdin.read())",
    "out=[]",
    "for n in ast.walk(tree):",
    "  if isinstance(n,ast.Import):",
    "    out += [{'specifier':x.name,'line':n.lineno,'kind':'import'} for x in n.names]",
    "  elif isinstance(n,ast.ImportFrom):",
    "    base='.'*n.level+(n.module or '')",
    "    if n.module:",
    "      out += [{'specifier':base if x.name=='*' else base+'.'+x.name,'fallback_specifier':base,'line':n.lineno,'kind':'from-import'} for x in n.names]",
    "    else:",
    "      out += [{'specifier':base+x.name,'line':n.lineno,'kind':'from-import'} for x in n.names]",
    "print(json.dumps(out,separators=(',',':')))"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], {
    cwd: scan.root,
    input: content,
    encoding: "utf8",
    timeout: scan.deadline?.remaining() ?? 10000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout).map((item) => ({ ...item, evidence_tier: "AST_VERIFIED" })); } catch { return null; }
}

function extractPythonFallback(content) {
  const imports = captures(content, [{ pattern: /^\s*import\s+([^#\n]+)/gm }]).flatMap((item) => item.specifier.split(",").map((part) => ({ ...item, specifier: part.trim().split(/\s+as\s+/)[0] })).filter((item) => item.specifier));
  for (const match of content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^#\n]+)/gm)) imports.push({ specifier: match[1], line: lineNumber(content, match.index ?? 0), kind: "from-import", evidence_tier: "SOURCE_FALLBACK" });
  return imports;
}

function extractGo(content) {
  const imports = captures(maskComments(content), [{ pattern: /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm }]);
  for (const block of content.matchAll(/\bimport\s*\(([^)]+)\)/gs)) {
    for (const match of block[1].matchAll(/(?:^|\n)\s*(?:[\w.]+\s+)?"([^"]+)"/g)) imports.push({ specifier: match[1], line: lineNumber(content, (block.index ?? 0) + (match.index ?? 0)), kind: "import", evidence_tier: "SOURCE_FALLBACK" });
  }
  return imports;
}

function extractRust(content) {
  return captures(maskComments(content), [
    { pattern: /^\s*use\s+((?:crate|self|super|[A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_:]+)/gm },
    { pattern: /^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm, kind: "module" }
  ]).map((item) => ({ ...item, specifier: item.specifier.replace(/::\{.*$/, "") }));
}

function extractJvm(content) {
  return captures(maskComments(content), [{ pattern: /^\s*import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.*]+)/gm }]);
}

function extractCsharp(content) {
  return captures(maskComments(content), [{ pattern: /^\s*(?:global\s+)?using\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm }]);
}

function extractor(scan, entry, content) {
  if (["javascript", "typescript"].includes(entry.language)) return extractJavaScript(content);
  if (entry.language === "python") return pythonAstImports(scan, entry, content) ?? extractPythonFallback(content);
  if (entry.language === "go") return extractGo(content);
  if (entry.language === "rust") return extractRust(content);
  if (["java", "kotlin"].includes(entry.language)) return extractJvm(content);
  if (entry.language === "csharp") return extractCsharp(content);
  return [];
}

function parseJson(content) {
  try { return JSON.parse(content); } catch { return null; }
}

function manifestIndexes(scan) {
  const indexes = {
    jvm: new Map(), csharp: new Map(), goModules: [], packages: new Map(), tsconfigs: [],
    cargoPackages: new Map(), projectReferences: [], capabilities: [], unavailable: []
  };
  const entries = scan.inventory.entries;
  for (const entry of entries) {
    scan.deadline?.check("manifest indexing");
    const content = readScannedSource(scan, entry);
    if (["java", "kotlin"].includes(entry.language)) {
      const packageName = content.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/m)?.[1];
      if (packageName) indexes.jvm.set(`${packageName}.${path.posix.basename(entry.path).replace(/\.(java|kt|kts)$/, "")}`, entry.path);
    } else if (entry.language === "csharp") {
      for (const match of content.matchAll(/^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) {
        const list = indexes.csharp.get(match[1]) ?? [];
        list.push(entry.path);
        indexes.csharp.set(match[1], list.sort());
      }
    } else if (entry.language === "go-manifest") {
      const moduleName = content.match(/^\s*module\s+(\S+)/m)?.[1];
      if (moduleName) indexes.goModules.push({ moduleName, directory: path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path) });
    } else if (entry.language === "javascript-manifest") {
      const manifest = parseJson(content);
      if (manifest?.name) indexes.packages.set(manifest.name, { directory: path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path), manifest });
    } else if (["typescript-config", "javascript-config"].includes(entry.language)) {
      const parsed = parseJson(content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
      if (parsed) indexes.tsconfigs.push({ directory: path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path), config: parsed });
    } else if (entry.language === "msbuild-manifest") {
      for (const match of content.matchAll(/<ProjectReference\s+Include=["']([^"']+)["']/g)) {
        indexes.projectReferences.push({ from: entry.path, specifier: match[1].replaceAll("\\", "/"), kind: "project-reference" });
      }
    }
  }
  optionalNativeResolverEvidence(scan, indexes);
  return indexes;
}

function optionalCommand(scan, command, args, label, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: scan.root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: scan.deadline?.remaining() ?? 10000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  indexesCapability(scan, label, command, args);
  return result.stdout;
}

function indexesCapability(scan, label, command, args) {
  if (!scan._resolverCapabilities) Object.defineProperty(scan, "_resolverCapabilities", { value: [], enumerable: false });
  scan._resolverCapabilities.push({ id: label, command, arguments: args, status: "AVAILABLE", network: false });
}

function optionalNativeResolverEvidence(scan, indexes) {
  if (scan.inventory.entries.some((entry) => entry.language === "go-manifest") && scan.config.resolvers?.go !== false) {
    const output = optionalCommand(scan, "go", ["list", "-deps", "-f", "{{.ImportPath}}\t{{.Dir}}", "./..."], "go-list", { GOPROXY: "off", GOSUMDB: "off" });
    if (output) indexes.goResolved = new Set(output.split("\n").filter(Boolean).map((line) => line.split("\t")[0]));
    else indexes.unavailable.push("go-list");
  }
  if (scan.inventory.entries.some((entry) => entry.language === "rust-manifest") && scan.config.resolvers?.rust !== false) {
    const output = optionalCommand(scan, "cargo", ["metadata", "--format-version", "1", "--no-deps", "--offline"], "cargo-metadata", { CARGO_NET_OFFLINE: "true" });
    if (output) {
      try {
        const metadata = JSON.parse(output);
        for (const item of metadata.packages ?? []) indexes.cargoPackages.set(item.name, path.posix.dirname(path.relative(scan.root, item.manifest_path).replaceAll("\\", "/")));
      } catch { indexes.unavailable.push("cargo-metadata-invalid"); }
    } else indexes.unavailable.push("cargo-metadata");
  }
}

function jsCandidates(entry, specifier, indexes) {
  const directory = path.posix.dirname(entry.path);
  const candidates = [];
  if (specifier.startsWith(".")) {
    const base = path.posix.normalize(path.posix.join(directory, specifier));
    candidates.push(base, ...JS_EXTENSIONS.map((extension) => `${base}${extension}`), ...["index.js", "index.mjs", "index.ts", "index.tsx"].map((name) => path.posix.join(base, name)));
  }
  for (const item of indexes.tsconfigs) {
    if (item.directory && !(entry.path === item.directory || entry.path.startsWith(`${item.directory}/`))) continue;
    const compiler = item.config.compilerOptions ?? {};
    const baseUrl = path.posix.join(item.directory, compiler.baseUrl ?? "");
    for (const [alias, targets] of Object.entries(compiler.paths ?? {})) {
      const marker = alias.indexOf("*");
      const prefix = marker >= 0 ? alias.slice(0, marker) : alias;
      const suffix = marker >= 0 ? specifier.slice(prefix.length) : "";
      if ((marker >= 0 && specifier.startsWith(prefix)) || specifier === alias) {
        for (const target of targets) {
          const resolved = path.posix.join(baseUrl, target.replace("*", suffix));
          candidates.push(resolved, ...JS_EXTENSIONS.map((extension) => `${resolved}${extension}`), ...["index.js", "index.ts"].map((name) => path.posix.join(resolved, name)));
        }
      }
    }
  }
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const workspace = indexes.packages.get(packageName);
  if (workspace) {
    const subpath = specifier.slice(packageName.length).replace(/^\//, "");
    const manifest = workspace.manifest;
    const entrypoint = subpath || manifest.exports?.["."]?.import || manifest.exports?.["."] || manifest.module || manifest.main || manifest.types || "index";
    if (typeof entrypoint === "string") {
      const base = path.posix.join(workspace.directory, entrypoint.replace(/^\.\//, ""));
      candidates.push(base, ...JS_EXTENSIONS.map((extension) => `${base}${extension}`), ...["index.js", "index.ts"].map((name) => path.posix.join(base, name)));
    }
  }
  return { candidates, workspace: Boolean(workspace) };
}

function pythonCandidates(entry, specifier) {
  const directory = path.posix.dirname(entry.path);
  const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
  const moduleName = specifier.replace(/^\.+/, "").split(".").join("/");
  let base = dots ? directory : "";
  for (let index = 1; index < dots; index += 1) base = path.posix.dirname(base);
  const target = path.posix.normalize(path.posix.join(base, moduleName));
  return [`${target}.py`, path.posix.join(target, "__init__.py")];
}

function rustCandidates(entry, specifier, indexes) {
  if (/^(crate|self|super)::/.test(specifier)) {
    const parts = specifier.split("::");
    let base = parts.shift() === "crate" ? path.posix.join(path.posix.dirname(entry.path).split("/src")[0], "src") : path.posix.dirname(entry.path);
    while (parts[0] === "super") { base = path.posix.dirname(base); parts.shift(); }
    if (parts[0] === "self") parts.shift();
    const target = path.posix.join(base, ...parts.slice(0, 1));
    return [`${target}.rs`, path.posix.join(target, "mod.rs")];
  }
  const crate = specifier.split("::")[0].replaceAll("_", "-");
  const directory = indexes.cargoPackages.get(crate);
  return directory ? [path.posix.join(directory, "src/lib.rs"), path.posix.join(directory, "src/main.rs")] : [];
}

function resolution(entry, item, files, indexes) {
  const sameFamily = (left, right) => left === right || (["javascript", "typescript"].includes(left) && ["javascript", "typescript"].includes(right)) || (["java", "kotlin"].includes(left) && ["java", "kotlin"].includes(right));
  let candidates = [];
  let resolverVerified = false;
  if (["javascript", "typescript"].includes(entry.language)) {
    const js = jsCandidates(entry, item.specifier, indexes);
    candidates = js.candidates;
    resolverVerified = js.workspace || !item.specifier.startsWith(".");
  } else if (entry.language === "python") {
    candidates = pythonCandidates(entry, item.specifier);
    if (item.fallback_specifier && item.fallback_specifier !== item.specifier) candidates.push(...pythonCandidates(entry, item.fallback_specifier));
  }
  else if (entry.language === "rust") {
    candidates = item.kind === "module"
      ? [`${path.posix.join(path.posix.dirname(entry.path), item.specifier)}.rs`, path.posix.join(path.posix.dirname(entry.path), item.specifier, "mod.rs")]
      : rustCandidates(entry, item.specifier, indexes);
    resolverVerified = candidates.length > 0 && indexes.cargoPackages.size > 0;
  }
  for (const candidate of candidates) {
    if (files.has(candidate) && sameFamily(files.get(candidate).language, entry.language)) {
      const evidenceTier = resolverVerified ? "RESOLVER_VERIFIED" : item.evidence_tier;
      return { target: candidate, resolution: resolverVerified ? "native-or-manifest-resolver" : "same-language", evidence_tier: evidenceTier };
    }
  }
  if (["java", "kotlin"].includes(entry.language)) {
    const exact = indexes.jvm.get(item.specifier.replace(/\.\*$/, ""));
    if (exact && sameFamily(files.get(exact)?.language, entry.language)) return { target: exact, resolution: "symbol-index", evidence_tier: "SOURCE_FALLBACK" };
  }
  if (entry.language === "csharp") {
    const exact = indexes.csharp.get(item.specifier);
    if (exact?.length === 1) return { target: exact[0], resolution: "namespace-index", evidence_tier: "SOURCE_FALLBACK" };
    if (exact?.length > 1) return { ambiguous: exact };
  }
  if (entry.language === "go") {
    for (const module of indexes.goModules) {
      if (item.specifier === module.moduleName || item.specifier.startsWith(`${module.moduleName}/`)) {
        const suffix = item.specifier.slice(module.moduleName.length).replace(/^\//, "");
        const directory = path.posix.join(module.directory, suffix);
        const targets = [...files.keys()].filter((file) => files.get(file).language === "go" && path.posix.dirname(file) === directory).sort();
        if (targets.length) return { target: targets[0], resolution: indexes.goResolved ? "go-list" : "go-module", evidence_tier: indexes.goResolved ? "RESOLVER_VERIFIED" : "SOURCE_FALLBACK" };
      }
    }
  }
  return null;
}

function classifyUnresolved(entry, specifier, indexes, config) {
  const declaredExternal = (config.external_packages ?? []).some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`) || specifier.startsWith(`${prefix}.`) || specifier.startsWith(`${prefix}::`));
  if (declaredExternal) return "external_declared";
  if (["javascript", "typescript"].includes(entry.language)) {
    if (specifier.startsWith(".") || indexes.packages.has(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0])) return "unresolved_internal";
    return "external_declared";
  }
  if (entry.language === "python") return specifier.startsWith(".") ? "unresolved_internal" : "external_declared";
  if (entry.language === "go") return indexes.goModules.some((item) => specifier.startsWith(item.moduleName)) ? "unresolved_internal" : "external_declared";
  if (entry.language === "rust") return /^(crate|self|super)::/.test(specifier) ? "unresolved_internal" : "external_declared";
  return "ambiguous";
}

function edgeRecord(entry, item, resolved) {
  const edge_type = resolved.resolution.includes("project") ? "project-reference" : item.kind === "dynamic-import" ? "dynamic-import" : "source-import";
  const identity = { from: entry.path, to: resolved.target, edge_type, kind: item.kind, specifier: item.specifier };
  return {
    ...identity,
    fingerprint: pulseFingerprint("edge", identity),
    language: entry.language,
    line: item.line,
    resolution: resolved.resolution,
    evidence_tier: resolved.evidence_tier
  };
}

function projectReferenceEdges(indexes, files) {
  const edges = [];
  for (const reference of indexes.projectReferences) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(reference.from), reference.specifier));
    if (!files.has(target)) continue;
    const item = { kind: "project-reference", specifier: reference.specifier, line: null };
    edges.push(edgeRecord({ path: reference.from, language: "csharp" }, item, { target, resolution: "project-manifest", evidence_tier: "RESOLVER_VERIFIED" }));
  }
  return edges;
}

function minimumTier(edges) {
  if (!edges.length) return "SOURCE_FALLBACK";
  return [...edges].sort((left, right) => TIER_RANK.get(left.evidence_tier) - TIER_RANK.get(right.evidence_tier))[0].evidence_tier;
}

export function extractDependencies(scan) {
  const sourceEntries = scan.inventory.entries.filter((entry) => entry.role === "source");
  const files = new Map(scan.inventory.entries.map((entry) => [entry.path, entry]));
  const indexes = manifestIndexes(scan);
  const edges = projectReferenceEdges(indexes, files);
  const unresolved = [];
  const failures = [];
  let importsTotal = 0;
  for (const entry of sourceEntries) {
    scan.deadline?.check("dependency extraction");
    try {
      const content = readScannedSource(scan, entry);
      const imports = extractor(scan, entry, content);
      importsTotal += imports.length;
      for (const item of imports) {
        const resolved = resolution(entry, item, files, indexes);
        if (resolved?.target) edges.push(edgeRecord(entry, item, resolved));
        else {
          const classification = resolved?.ambiguous ? "ambiguous" : classifyUnresolved(entry, item.specifier, indexes, scan.config);
          unresolved.push({ from: entry.path, language: entry.language, kind: item.kind, specifier: item.specifier, line: item.line, classification, candidates: resolved?.ambiguous ?? [], evidence_tier: item.evidence_tier });
        }
      }
    } catch (error) {
      failures.push({ path: entry.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const bridge of scan.config.bridges ?? []) {
    if (!files.has(bridge.from) || !files.has(bridge.to)) throw new Error("pulse bridge must reference two inventoried files");
    const item = { kind: bridge.kind ?? "manifest-bridge", specifier: bridge.id ?? `${bridge.from}->${bridge.to}`, line: null };
    edges.push(edgeRecord({ path: bridge.from, language: `${files.get(bridge.from).language}->${files.get(bridge.to).language}` }, item, { target: bridge.to, resolution: "explicit-cross-language-manifest", evidence_tier: "EXPLICIT_MANIFEST" }));
  }
  const unique = [...new Map(edges.map((edge) => [edge.fingerprint, edge])).values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const counts = {
    imports_total: importsTotal,
    resolved_internal: unique.filter((edge) => edge.edge_type !== "project-reference" || edge.kind !== "manifest-bridge").length,
    explicit_bridges: unique.filter((edge) => edge.resolution === "explicit-cross-language-manifest").length,
    external_declared: unresolved.filter((item) => item.classification === "external_declared").length,
    unresolved_internal: unresolved.filter((item) => item.classification === "unresolved_internal").length,
    ambiguous: unresolved.filter((item) => item.classification === "ambiguous").length,
    failures: failures.length
  };
  return {
    extractor_version: PULSE_EXTRACTOR_VERSION,
    resolver_version: PULSE_RESOLVER_VERSION,
    edges: unique,
    unresolved: unresolved.sort((left, right) => `${left.from}:${left.line ?? 0}:${left.specifier}`.localeCompare(`${right.from}:${right.line ?? 0}:${right.specifier}`)),
    failures,
    counts,
    evidence: {
      minimum_tier: minimumTier(unique),
      tiers: Object.fromEntries([...new Set(unique.map((edge) => edge.evidence_tier))].sort().map((tier) => [tier, unique.filter((edge) => edge.evidence_tier === tier).length])),
      resolvers: [...(scan._resolverCapabilities ?? [])],
      unavailable_resolvers: indexes.unavailable
    }
  };
}
