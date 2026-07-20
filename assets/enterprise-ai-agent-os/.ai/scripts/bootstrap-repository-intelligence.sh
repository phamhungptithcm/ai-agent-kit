#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

CHECK_ONLY=0
HOOK=0
NO_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --hook) HOOK=1 ;;
    --no-install) NO_INSTALL=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

resolve_python() {
  if command -v python3 >/dev/null 2>&1 && python3 --version 2>&1 | grep -q 'Python 3\.'; then
    printf '%s\n' "python3"
    return 0
  fi
  if command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q 'Python 3\.'; then
    printf '%s\n' "python"
    return 0
  fi
  if command -v uv >/dev/null 2>&1; then
    printf '%s\n' "uv run --python 3.11 python"
    return 0
  fi
  return 1
}

PYTHON_CMD=$(resolve_python || true)
if [ -z "$PYTHON_CMD" ]; then
  echo "Repository Intelligence Gate BLOCKED: Python 3.11+ or uv is required." >&2
  exit 1
fi

cd "$REPO_ROOT"

if [ "$HOOK" -eq 1 ]; then
  # shellcheck disable=SC2086
  exec $PYTHON_CMD .ai/scripts/check-repository-intelligence.py --hook
fi

echo "Repository intelligence bootstrap"
echo "OS: $(uname -s)"
echo "Architecture: $(uname -m)"
echo "Repository: $REPO_ROOT"

if [ "$CHECK_ONLY" -eq 1 ]; then
  # shellcheck disable=SC2086
  exec $PYTHON_CMD .ai/scripts/check-repository-intelligence.py
fi

if [ "$NO_INSTALL" -eq 0 ]; then
  # shellcheck disable=SC2086
  $PYTHON_CMD .ai/scripts/install-repository-intelligence.py --execute
fi

# shellcheck disable=SC2086
$PYTHON_CMD .ai/scripts/index-repository.py
# shellcheck disable=SC2086
exec $PYTHON_CMD .ai/scripts/check-repository-intelligence.py
