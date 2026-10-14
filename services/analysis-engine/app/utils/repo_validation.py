"""Input validation for user-supplied repo URLs, branches, and paths.

The ATX analysis/transform pipelines run ``git`` and the ATX CLI against
externally submitted repositories. Repo URLs, branches (split from the URL on
``#``), and config paths are untrusted input. A crafted value (e.g. one starting
with ``-`` interpreted as an option, or a path escaping the workspace) can alter
command behaviour. Validate/allow-list every value before it reaches a subprocess
call, and always pass user values after a ``--`` end-of-options separator.
"""
import os
import re
from typing import Optional, Tuple
from urllib.parse import urlparse

# Allowed URL schemes for cloning.
_ALLOWED_SCHEMES = {"https"}

# Allowed hosts for cloning. Extend via ATX_ALLOWED_REPO_HOSTS (comma-separated).
_DEFAULT_ALLOWED_HOSTS = {"github.com", "gitlab.com", "bitbucket.org"}

# Branch names: git-ref-safe subset. No leading '-', no '..', no whitespace.
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


def _allowed_hosts() -> set:
    extra = os.environ.get("ATX_ALLOWED_REPO_HOSTS", "")
    hosts = set(_DEFAULT_ALLOWED_HOSTS)
    hosts.update(h.strip().lower() for h in extra.split(",") if h.strip())
    return hosts


def validate_branch(branch: Optional[str]) -> str:
    """Return a validated branch name, defaulting to 'main'.

    Raises ValueError for values that are empty-after-default, start with '-',
    contain '..', or include characters outside the allow-list.
    """
    b = (branch or "main").strip()
    if b.startswith("-"):
        raise ValueError(f"invalid branch (must not start with '-'): {b!r}")
    if ".." in b:
        raise ValueError(f"invalid branch (must not contain '..'): {b!r}")
    if not _BRANCH_RE.fullmatch(b):
        raise ValueError(f"invalid branch name: {b!r}")
    return b


def validate_repo_url(url: str) -> str:
    """Return a validated clone URL (scheme/host allow-listed, no option injection).

    Raises ValueError for disallowed schemes/hosts or values that could be
    interpreted as a command-line option.
    """
    if not url or not url.strip():
        raise ValueError("empty repo URL")
    u = url.strip()
    if u.startswith("-"):
        raise ValueError(f"invalid repo URL (must not start with '-'): {u!r}")
    parsed = urlparse(u)
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise ValueError(f"disallowed URL scheme: {parsed.scheme!r} (allowed: {sorted(_ALLOWED_SCHEMES)})")
    host = (parsed.hostname or "").lower()
    if host not in _allowed_hosts():
        raise ValueError(f"disallowed repo host: {host!r} (allowed: {sorted(_allowed_hosts())})")
    return u


def split_and_validate(repo_url: str) -> Tuple[str, Optional[str]]:
    """Split a ``url#branch`` value and validate both parts.

    Returns (clean_url, branch|None). The branch is only validated when present;
    callers that always need a branch should use ``validate_branch`` on the result.
    """
    raw = repo_url
    branch: Optional[str] = None
    if "#" in raw:
        raw, raw_branch = raw.rsplit("#", 1)
        branch = validate_branch(raw_branch)
    clean_url = validate_repo_url(raw)
    return clean_url, branch


def validate_config_path(config_path: str, expected_root: str) -> str:
    """Confirm *config_path* resolves inside *expected_root*.

    Raises ValueError if the resolved path escapes the expected directory.
    """
    root = os.path.realpath(expected_root)
    resolved = os.path.realpath(config_path)
    if os.path.commonpath([root, resolved]) != root:
        raise ValueError(f"config path escapes expected directory: {config_path!r}")
    return resolved
