#!/usr/bin/env python3
"""Shared helpers for the Repository Intelligence Gate."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


STATE_RELATIVE_PATH = ".ai/local/repository-intelligence-state.json"
CODEGRAPH_HEALTH_QUERY = "Account"
COCOINDEX_HEALTH_QUERY = "account balance repository"

SENSITIVE_EXCLUDE_PATTERNS = [
    ".git/**",
    ".codegraph/**",
    ".cocoindex_code/**",
    ".ai/local/**",
    ".ai/generated/**",
    ".codex_tmp/**",
    "**/node_modules/**",
    "**/target/**",
    "**/build/**",
    "**/dist/**",
    "**/coverage/**",
    "**/test-results/**",
    "**/surefire-reports/**",
    "**/logs/**",
    "**/*.log",
    "**/*.class",
    "**/*.jar",
    "**/*.war",
    "**/*.ear",
    "**/*.zip",
    "**/*.gz",
    "**/.env",
    "**/.env.*",
    "**/secrets/**",
    "**/*secret*",
    "**/*credential*",
    "**/*token*",
    "**/*.pem",
    "**/*.p12",
    "**/*.jks",
    "**/*private-key*",
    "**/*cvv*",
    "**/*pan*",
    "**/*production-data*",
    "**/*customer-data*",
]

INDEX_INCLUDE_HINTS = [
    "application and service source code",
    "low-code or model-driven app source and exported documentation",
    "frontend and mobile application assets",
    "SQL, migrations, database docs, and datafix procedures",
    "event schemas, API contracts, and integration contracts",
    "batch, scheduler, infrastructure, container, and CI/CD configuration",
    "architecture docs, ADRs, business specs, runbooks, tests, demo, and release docs",
]


@dataclass
class CommandResult:
    args: list[str]
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out

    @property
    def combined(self) -> str:
        return "\n".join(part for part in [self.stdout.strip(), self.stderr.strip()] if part)


@dataclass
class ToolStatus:
    name: str
    installation: str
    version: str
    configuration: str
    index_status: str
    health_check: str
    details: str
    source: str
    install_method: str

    def as_dict(self) -> dict[str, str]:
        return {
            "installation": self.installation,
            "version": self.version,
            "configuration": self.configuration,
            "index_status": self.index_status,
            "health_check": self.health_check,
            "details": self.details,
            "source": self.source,
            "install_method": self.install_method,
        }


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def state_path(root: Path) -> Path:
    return root / STATE_RELATIVE_PATH


def normalize_rel(root: Path, path: Path | str) -> str:
    item = Path(path)
    try:
        if item.is_absolute():
            item = item.relative_to(root)
    except ValueError:
        pass
    return item.as_posix().lstrip("./")


def is_excluded(rel_path: str) -> bool:
    rel = rel_path.replace("\\", "/").lstrip("./")
    for pattern in SENSITIVE_EXCLUDE_PATTERNS:
        if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch("/" + rel, pattern):
            return True
    return False


def run_command(
    args: list[str],
    root: Path,
    timeout: int = 60,
    env: dict[str, str] | None = None,
) -> CommandResult:
    resolved_args = resolve_args(args)
    try:
        completed = subprocess.run(
            resolved_args,
            cwd=root,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
        return CommandResult(args, completed.returncode, completed.stdout, completed.stderr)
    except subprocess.TimeoutExpired as exc:
        return CommandResult(
            args,
            124,
            exc.stdout or "",
            exc.stderr or f"timed out after {timeout}s",
            timed_out=True,
        )
    except FileNotFoundError as exc:
        return CommandResult(args, 127, "", str(exc))


def stream_command(args: list[str], root: Path, timeout: int = 1800, quiet: bool = False) -> CommandResult:
    resolved_args = resolve_args(args)
    if quiet:
        return run_command(args, root, timeout=timeout)
    try:
        completed = subprocess.run(resolved_args, cwd=root, text=True, timeout=timeout, check=False)
        return CommandResult(args, completed.returncode, "", "")
    except subprocess.TimeoutExpired as exc:
        return CommandResult(args, 124, exc.stdout or "", exc.stderr or "timed out", timed_out=True)
    except FileNotFoundError as exc:
        return CommandResult(args, 127, "", str(exc))


def which(command: str) -> str | None:
    return resolve_command(command)


def resolve_command(command: str) -> str | None:
    if os.name == "nt" and not any(sep in command for sep in ["/", "\\"]):
        for suffix in [".cmd", ".exe", ".bat", ""]:
            resolved = shutil.which(command + suffix)
            if resolved and not resolved.lower().endswith(".ps1"):
                return resolved
    return shutil.which(command)


def resolve_args(args: list[str]) -> list[str]:
    if not args:
        return args
    command = args[0]
    resolved = resolve_command(command)
    if not resolved:
        return args
    if os.name == "nt" and resolved.lower().endswith(".ps1"):
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved, *args[1:]]
    return [resolved, *args[1:]]


def strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def git_value(root: Path, *args: str) -> str:
    result = run_command(["git", *args], root, timeout=20)
    if result.ok:
        return result.stdout.strip()
    return ""


def current_commit(root: Path) -> str:
    return git_value(root, "rev-parse", "HEAD") or "unknown"


def current_branch(root: Path) -> str:
    return git_value(root, "branch", "--show-current") or "detached-or-unknown"


def changed_paths(root: Path) -> list[str]:
    result = run_command(["git", "status", "--porcelain=v1", "--untracked-files=all"], root, timeout=60)
    if not result.ok:
        return []
    paths: list[str] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        path_part = line[3:] if len(line) > 3 else line
        if " -> " in path_part:
            path_part = path_part.split(" -> ", 1)[1]
        path_part = path_part.strip('"')
        rel = path_part.replace("\\", "/")
        if rel and not is_excluded(rel):
            paths.append(rel)
    return sorted(set(paths))


def worktree_signature(root: Path) -> str:
    hasher = hashlib.sha256()
    hasher.update(current_commit(root).encode("utf-8", errors="replace"))
    for rel in changed_paths(root):
        hasher.update(rel.encode("utf-8", errors="replace"))
        path = root / rel
        if path.exists() and path.is_file():
            stat = path.stat()
            hasher.update(f":{stat.st_size}:{stat.st_mtime_ns}".encode("ascii"))
    return hasher.hexdigest()


def load_state(root: Path) -> dict[str, object]:
    path = state_path(root)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_state(root: Path, codegraph_version: str, cocoindex_version: str) -> dict[str, object]:
    state = {
        "repository_root": str(root.resolve()),
        "git_branch": current_branch(root),
        "git_commit": current_commit(root),
        "worktree_signature": worktree_signature(root),
        "indexed_at_unix": int(time.time()),
        "codegraph": {"version": codegraph_version},
        "cocoindex": {"version": cocoindex_version},
        "exclude_patterns": SENSITIVE_EXCLUDE_PATTERNS,
        "include_hints": INDEX_INCLUDE_HINTS,
    }
    path = state_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return state


def state_matches_checkout(root: Path, state: dict[str, object]) -> bool:
    return (
        state.get("repository_root") == str(root.resolve())
        and state.get("git_commit") == current_commit(root)
        and state.get("worktree_signature") == worktree_signature(root)
    )


def codegraph_version(root: Path) -> str:
    if not which("codegraph"):
        return ""
    result = run_command(["codegraph", "--version"], root, timeout=30)
    return result.stdout.strip() if result.ok else ""


def cocoindex_version(root: Path) -> str:
    if not which("ccc"):
        return ""
    result = run_command(["ccc", "--version"], root, timeout=30)
    if result.ok and result.stdout.strip():
        return result.stdout.strip()
    help_result = run_command(["ccc", "--help"], root, timeout=30)
    if help_result.ok:
        first_line = (help_result.stdout.strip() or help_result.stderr.strip()).splitlines()
        return first_line[0].strip() if first_line else "available"
    return ""


def has_mcp_server(root: Path, server_name: str) -> bool:
    config = root / ".codex" / "config.toml"
    mcp_json = root / ".mcp.json"
    marker = f"[mcp_servers.{server_name}]"
    if config.exists() and marker in config.read_text(encoding="utf-8", errors="replace"):
        return True
    if mcp_json.exists() and f'"{server_name}"' in mcp_json.read_text(encoding="utf-8", errors="replace"):
        return True
    return False


def check_codegraph(root: Path, state: dict[str, object] | None = None) -> ToolStatus:
    state = state or load_state(root)
    executable = which("codegraph")
    source = "https://github.com/colbymchenry/codegraph"
    install_method = "npx @colbymchenry/codegraph or npm install -g @colbymchenry/codegraph"
    if not executable:
        return ToolStatus("CodeGraph", "Missing", "", "Missing executable", "Missing", "Failed", "codegraph not found on PATH", source, install_method)

    version = codegraph_version(root) or "unknown"
    mcp = has_mcp_server(root, "codegraph")
    db = root / ".codegraph" / "codegraph.db"
    config = "Project .codegraph present" if db.exists() else "Project .codegraph missing"
    config += "; MCP configured" if mcp else "; MCP missing"

    status = run_command(["codegraph", "status", "."], root, timeout=120)
    query = run_command(["codegraph", "query", "--path", ".", "--limit", "1", "--json", CODEGRAPH_HEALTH_QUERY], root, timeout=60)
    status_text = strip_ansi(status.combined)
    status_current = "[OK] Index is up to date" in status_text or "Index is up to date" in status_text

    if not db.exists():
        index_status = "Missing"
    elif status_current and state_matches_checkout(root, state):
        index_status = "Current"
    else:
        index_status = "Stale"

    health = "Passed" if status.ok and query.ok and bool(query.stdout.strip()) else "Failed"
    details = "status and query succeeded" if health == "Passed" else (query.combined or status.combined or "health check failed")
    return ToolStatus("CodeGraph", "Installed", version, config, index_status, health, details, source, install_method)


def check_cocoindex(root: Path, state: dict[str, object] | None = None) -> ToolStatus:
    state = state or load_state(root)
    executable = which("ccc")
    source = "https://github.com/cocoindex-io/cocoindex-code"
    install_method = 'uv tool install --upgrade "cocoindex-code[full]"'
    if not executable:
        return ToolStatus("CocoIndex", "Missing", "", "Missing executable", "Missing", "Failed", "ccc not found on PATH", source, install_method)

    version = cocoindex_version(root) or "available"
    mcp = has_mcp_server(root, "cocoindex-code")
    index_dir = root / ".cocoindex_code"
    config = "Project .cocoindex_code present" if index_dir.exists() else "Project .cocoindex_code missing"
    config += "; MCP configured" if mcp else "; MCP missing"

    status = run_command(["ccc", "status"], root, timeout=120)
    search = run_command(["ccc", "search", "--limit", "1", COCOINDEX_HEALTH_QUERY], root, timeout=120)

    if not index_dir.exists():
        index_status = "Missing"
    elif status.ok and state_matches_checkout(root, state):
        index_status = "Current"
    else:
        index_status = "Stale"

    health = "Passed" if status.ok and search.ok else "Failed"
    details = "status and search succeeded" if health == "Passed" else (search.combined or status.combined or "health check failed")
    return ToolStatus("CocoIndex", "Installed", version, config, index_status, health, details, source, install_method)


def gate_ready(codegraph: ToolStatus, cocoindex: ToolStatus) -> bool:
    statuses = [codegraph, cocoindex]
    return all(
        item.installation == "Installed"
        and item.index_status == "Current"
        and item.health_check == "Passed"
        and "MCP configured" in item.configuration
        for item in statuses
    )


def gate_report(root: Path, codegraph: ToolStatus, cocoindex: ToolStatus) -> str:
    state = load_state(root)
    indexed_commit = str(state.get("git_commit") or "unknown")
    result = "READY" if gate_ready(codegraph, cocoindex) else "BLOCKED"
    return f"""Repository Intelligence Gate

CodeGraph:
- Installation: {codegraph.installation}
- Version: {codegraph.version or "N/A"}
- Configuration: {codegraph.configuration}
- Index status: {codegraph.index_status}
- Health check: {codegraph.health_check}

CocoIndex:
- Installation: {cocoindex.installation}
- Version: {cocoindex.version or "N/A"}
- Configuration: {cocoindex.configuration}
- Index status: {cocoindex.index_status}
- Health check: {cocoindex.health_check}

Repository commit: {current_commit(root)}
Indexed commit: {indexed_commit}

Gate result:
{result}
"""


def manual_commands(codegraph: ToolStatus, cocoindex: ToolStatus) -> list[str]:
    commands: list[str] = []
    if codegraph.installation != "Installed":
        commands.append("npx @colbymchenry/codegraph")
    if cocoindex.installation != "Installed":
        commands.append('uv tool install --upgrade "cocoindex-code[full]"')
    commands.extend(
        [
            "python .ai/scripts/index-repository.py",
            "python .ai/scripts/check-repository-intelligence.py",
        ]
    )
    return commands


def print_command_failure(result: CommandResult) -> None:
    command = " ".join(result.args)
    print(f"ERROR: command failed: {command}", file=sys.stderr)
    detail = result.combined.strip()
    if detail:
        print(detail, file=sys.stderr)


def python_executable() -> str:
    return sys.executable
