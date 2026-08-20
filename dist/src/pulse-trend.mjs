import fs from "node:fs";
import path from "node:path";
import { pulseDigest, validatePulseResult } from "./pulse-contract.mjs";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

function filePath(root, requested = ".ai-agent-kit/pulse/trends/history.jsonl") {
  const file = path.resolve(root, requested);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("pulse trend path must remain inside the repository");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("pulse trend path cannot traverse a symbolic link");
  }
  return file;
}

export function readPulseTrend(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = filePath(root, options.file);
  if (!fs.existsSync(file)) return { status: "EMPTY", records: [], head_digest: null };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > MAX_HISTORY_BYTES) throw new Error("pulse trend history must be a bounded non-linked regular file");
  const records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`pulse trend line ${index + 1} is invalid JSON`); }
  });
  let previous = null;
  for (const [index, record] of records.entries()) {
    const { record_digest, ...body } = record;
    if (body.previous_digest !== previous || pulseDigest(body) !== record_digest) throw new Error(`pulse trend integrity failed at line ${index + 1}`);
    previous = record_digest;
  }
  return { status: "VERIFIED", records, head_digest: previous };
}

export function recordPulseTrend(document, options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  if (document?.protocol === "aak-architecture-pulse-v2") validatePulseResult(document);
  else {
    const { evidence_digest: claimed, ...body } = document ?? {};
    if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || pulseDigest(body) !== claimed) throw new Error("pulse trend comparison evidence digest mismatch");
  }
  const file = filePath(root, options.file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let lockDescriptor;
  let historyDescriptor;
  try {
    lockDescriptor = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const history = readPulseTrend(options);
    const source = document.protocol === "aak-architecture-pulse-v2" ? document : document.current;
    if (!source?.repository || !source.metrics || !source.coverage || !source.confidence || !/^[a-f0-9]{64}$/.test(document.result_digest ?? document.evidence_digest ?? "")) throw new Error("pulse trend requires verified result or comparison evidence");
    const body = {
      schema_version: 1,
      recorded_at: options.recordedAt ?? new Date().toISOString(),
      previous_digest: history.head_digest,
      evidence_digest: document.result_digest ?? document.evidence_digest,
      repository: { identity_hash: source.repository.identity_hash, commit: source.repository.commit },
      outcome: document.status ?? document.analysis_status,
      metrics: source.metrics,
      coverage: source.coverage,
      confidence: source.confidence
    };
    if (!Number.isFinite(Date.parse(body.recorded_at))) throw new Error("pulse trend recorded_at is invalid");
    const record = { ...body, record_digest: pulseDigest(body) };
    const line = `${JSON.stringify(record)}\n`;
    const currentSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (currentSize + Buffer.byteLength(line) > MAX_HISTORY_BYTES) throw new Error("pulse trend history exceeds the bounded artifact budget");
    historyDescriptor = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const stat = fs.fstatSync(historyDescriptor);
    if (!stat.isFile() || stat.nlink > 1) throw new Error("pulse trend history must be a non-linked regular file");
    fs.writeSync(historyDescriptor, line);
    fs.fsyncSync(historyDescriptor);
    return { status: "RECORDED", file: path.relative(root, file).split(path.sep).join("/"), record_digest: record.record_digest };
  } finally {
    if (historyDescriptor != null) fs.closeSync(historyDescriptor);
    if (lockDescriptor != null) fs.closeSync(lockDescriptor);
    if (fs.existsSync(lock) && !fs.lstatSync(lock).isSymbolicLink()) fs.unlinkSync(lock);
  }
}
