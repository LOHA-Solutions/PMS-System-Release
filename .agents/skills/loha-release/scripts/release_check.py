#!/usr/bin/env python3
"""Read-only LOHA source checks; no environment loading, network or database access."""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

EXCLUDED = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "dist-ssr",
    "__pycache__",
    ".local-postgres",
    ".ruff_cache",
    ".pytest_cache",
    "output",
    "coverage",
}
TEXT = {
    ".py",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".css",
    ".html",
    ".json",
    ".toml",
    ".yml",
    ".yaml",
    ".md",
    ".txt",
    ".example",
    ".gitignore",
    ".dockerignore",
}
SENSITIVE = re.compile(
    r"(?:^|_)(?:API_KEY|SECRET|SECRET_KEY|PASSWORD|TOKEN|PRIVATE_KEY|"
    r"ENCRYPTION_KEY|DATABASE_URL|DATABASE_MIGRATION_URL|DSN)(?:_|$)",
    re.IGNORECASE,
)
TOKENS = {
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "AWS access key": r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "GitHub token": r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b",
    "service token": r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|xox[baprs]-[A-Za-z0-9-]{20,})\b",
    "credential URL": r"\b(?:postgres(?:ql)?(?:\+psycopg)?|mysql|redis)://[^\s:@/]+:([^\s@/]+)@",
}
LITERAL = re.compile(
    r"""\b([A-Z0-9_]*(?:API_KEY|SECRET_KEY|ENCRYPTION_KEY|PASSWORD|ACCESS_TOKEN)"""
    r"""[A-Z0-9_]*)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']""",
    re.IGNORECASE,
)


def placeholder(value: str) -> bool:
    value = unquote(value.strip())
    return (
        not value
        or bool(re.fullmatch(r"<[^<>]+>|\$\{[^}]+\}|\$\{\{.*\}\}", value))
        or bool(
            re.fullmatch(
                r"(?:your|replace|change|example|placeholder|dummy|redacted)[-_A-Za-z0-9.]*",
                value,
                re.IGNORECASE,
            )
        )
    )


class Checker:
    def __init__(self, root: Path):
        self.root = root
        self.results: list[dict[str, str]] = []
        self.files: list[Path] = []
        self.tracked: list[Path] = []
        self.git = False

    def add(self, name: str, errors: list[str], success: str) -> None:
        self.results.append(
            {
                "name": name,
                "status": "FAIL" if errors else "PASS",
                "detail": "; ".join(errors) if errors else success,
            }
        )

    def note(self, name: str, status: str, detail: str) -> None:
        self.results.append({"name": name, "status": status, "detail": detail})

    def rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def command(
        self, *args: str, stdin: str | None = None
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=self.root,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )

    def discover(self) -> None:
        if shutil.which("git"):
            result = self.command("git", "rev-parse", "--show-toplevel")
            self.git = (
                result.returncode == 0
                and Path(result.stdout.strip()).resolve() == self.root
            )
        if self.git:
            tracked = self.command("git", "ls-files", "-z")
            candidates = self.command(
                "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"
            )
            if tracked.returncode or candidates.returncode:
                raise RuntimeError("Git enumeration failed")
            self.tracked = [
                self.root / name for name in tracked.stdout.split("\0") if name
            ]
            paths = {self.root / name for name in candidates.stdout.split("\0") if name}
        else:
            paths = set()
            for directory, dirs, filenames in os.walk(self.root, followlinks=False):
                dirs[:] = [name for name in dirs if name not in EXCLUDED]
                paths.update(Path(directory) / name for name in filenames)
        self.files = sorted(
            path
            for path in paths
            if path.is_file()
            and not path.is_symlink()
            and path.resolve().is_relative_to(self.root)
            and not any(part in EXCLUDED for part in path.relative_to(self.root).parts)
        )

    def hygiene(self, strict: bool) -> None:
        if not self.git:
            self.note("git-exclusions", "SKIP", "Git checkout/tool unavailable")
            return
        probes = [
            "backend/.env",
            "backend/.env.production",
            "frontend/.env.local",
            "landingpage/.env.production",
            "frontend/node_modules/probe",
            "frontend/dist/probe",
            "landingpage/node_modules/probe",
            "landingpage/dist/probe",
            "backend/__pycache__/probe.pyc",
            "backend/.local-postgres/probe",
            "backups/release.dump",
            "release.sql",
            "release.pem",
            "output/probe.log",
        ]
        ignored = self.command(
            "git",
            "check-ignore",
            "--no-index",
            "--stdin",
            "-z",
            stdin="\0".join(probes) + "\0",
        )
        errors = [
            "Not ignored: " + name
            for name in sorted(set(probes) - set(ignored.stdout.split("\0")))
        ]
        examples = [
            "backend/.env.example",
            "frontend/.env.example",
            "landingpage/.env.example",
            ".agents/skills/loha-release/SKILL.md",
        ]
        allowed = self.command(
            "git",
            "check-ignore",
            "--no-index",
            "--stdin",
            "-z",
            stdin="\0".join(examples) + "\0",
        )
        errors += [
            "Must remain commit-able: " + name
            for name in allowed.stdout.split("\0")
            if name
        ]
        if ignored.returncode not in (0, 1) or allowed.returncode not in (0, 1):
            errors.append("git check-ignore failed")
        for path in self.tracked:
            if path.exists() and (
                any(part in EXCLUDED for part in path.relative_to(self.root).parts)
                or (path.name.startswith(".env") and path.name != ".env.example")
                or path.suffix.lower() in {".pem", ".key", ".dump", ".pyc"}
            ):
                errors.append("Sensitive/generated file tracked: " + self.rel(path))
        self.add(
            "git-exclusions",
            errors,
            "Secrets, caches, builds and backups excluded; examples/skill permitted",
        )
        state = self.command("git", "status", "--porcelain", "--untracked-files=normal")
        if state.returncode:
            self.add("git-state", ["git status failed"], "")
        elif state.stdout.strip():
            self.note(
                "git-state",
                "FAIL" if strict else "INFO",
                "Working tree has changes; commit and rerun --strict-git when sealing release",
            )
        else:
            self.add("git-state", [], "Working tree clean")

    def source(self) -> None:
        syntax, secrets, env, tests = [], [], [], []
        python_count, example_count = 0, 0
        for directory in ("backend", "frontend", "landingpage"):
            if not (self.root / directory / ".env.example").is_file():
                env.append(f"Missing required example: {directory}/.env.example")
        for path in self.files:
            relative = self.rel(path)
            if (
                "tests" in path.relative_to(self.root).parts
                or path.name.startswith("test_")
                or re.search(r"\.(?:test|spec)\.[cm]?[jt]sx?$", path.name)
            ):
                tests.append(relative)
            if path.suffix not in TEXT and path.name not in {
                "Dockerfile",
                ".gitignore",
                ".dockerignore",
            }:
                continue
            try:
                text = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeError):
                self.add("read-source", ["Cannot read UTF-8: " + relative], "")
                continue
            if path.suffix == ".py":
                python_count += 1
                try:
                    ast.parse(text, filename=relative)
                except SyntaxError as error:
                    syntax.append(f"{relative}:{error.lineno}")
            if path.name == ".env.example":
                example_count += 1
                for number, line in enumerate(text.splitlines(), 1):
                    match = re.match(
                        r"\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)", line
                    )
                    if match and SENSITIVE.search(match[1]):
                        value = match[2].split(" #", 1)[0].strip().strip("\"'")
                        if not placeholder(value):
                            env.append(f"{relative}:{number} ({match[1]})")
                        if match[1].startswith("VITE_"):
                            env.append(
                                f"{relative}:{number} (credential name exposed to Vite)"
                            )
            for category, pattern in TOKENS.items():
                for match in re.finditer(pattern, text):
                    if category == "credential URL" and placeholder(match[1]):
                        continue
                    line = text.count("\n", 0, match.start()) + 1
                    secrets.append(f"{relative}:{line} ({category})")
            # Password field labels in translation catalogs are public copy.
            # Recognized provider tokens/URLs above are still scanned there.
            literal_matches = (
                () if "/i18n/locales/" in relative else LITERAL.finditer(text)
            )
            for match in literal_matches:
                if not placeholder(match[2]) and re.search(r"[0-9]", match[2]):
                    line = text.count("\n", 0, match.start()) + 1
                    secrets.append(f"{relative}:{line} (literal credential)")
        self.add(
            "python-syntax",
            syntax,
            f"Parsed {python_count} Python files without imports",
        )
        self.add(
            "env-examples",
            env or ([] if example_count else ["No env examples found"]),
            f"{example_count} credential-safe env examples",
        )
        self.add(
            "secret-signals",
            sorted(set(secrets)),
            "No recognized secret signals (heuristic, current source only)",
        )
        self.add("release-source", tests, "No test files in release source")

    def migrations(self) -> None:
        graph, errors = {}, []
        for path in sorted((self.root / "backend/migrations/versions").glob("*.py")):
            try:
                values = {}
                for node in ast.parse(path.read_text(encoding="utf-8-sig")).body:
                    if isinstance(node, ast.Assign):
                        targets = node.targets
                    elif isinstance(node, ast.AnnAssign):
                        targets = [node.target]
                    else:
                        targets = []
                    for target in targets:
                        if isinstance(target, ast.Name) and target.id in {
                            "revision",
                            "down_revision",
                        }:
                            values[target.id] = ast.literal_eval(node.value)
                revision, parent = values["revision"], values["down_revision"]
                parents = (
                    ()
                    if parent is None
                    else (parent,)
                    if isinstance(parent, str)
                    else tuple(parent)
                )
                if (
                    not isinstance(revision, str)
                    or not re.fullmatch(r"[A-Za-z0-9_-]+", revision)
                    or not all(isinstance(item, str) for item in parents)
                    or revision in graph
                ):
                    raise ValueError
                graph[revision] = parents
            except (SyntaxError, ValueError, TypeError, KeyError):
                errors.append("Invalid/duplicate revision: " + self.rel(path))
        referenced = {parent for parents in graph.values() for parent in parents}
        missing = referenced - graph.keys()
        heads = graph.keys() - referenced
        if missing:
            errors.append("Missing parents: " + ", ".join(sorted(missing)))
        if len(heads) != 1:
            errors.append(f"Expected one head, found {len(heads)}")
        pending, resolved = dict(graph), set()
        while pending:
            ready = {
                revision
                for revision, parents in pending.items()
                if set(parents) <= resolved
            }
            if not ready:
                errors.append("Cycle or unresolved migration parents")
                break
            resolved.update(ready)
            for revision in ready:
                del pending[revision]
        self.add(
            "migration-graph",
            errors,
            f"{len(graph)} revisions; heads: {', '.join(sorted(heads))}; target DB not inspected",
        )

    def dependencies(self) -> None:
        errors = []
        for directory in ("frontend", "landingpage"):
            try:
                folder = self.root / directory
                package = json.loads(
                    (folder / "package.json").read_text(encoding="utf-8-sig")
                )
                lock = json.loads(
                    (folder / "package-lock.json").read_text(encoding="utf-8-sig")
                )
                locked = lock["packages"][""]
                for key in (
                    "name",
                    "version",
                    "dependencies",
                    "devDependencies",
                    "optionalDependencies",
                ):
                    if package.get(key, {}) != locked.get(key, {}):
                        errors.append(f"{directory}: lock mismatch in {key}")
                for command in ("build", "lint", "format:check"):
                    if not package.get("scripts", {}).get(command):
                        errors.append(f"{directory}: missing {command} script")
                for name, dependency in lock["packages"].items():
                    if (
                        name
                        and dependency.get("resolved", "").startswith("https:")
                        and not dependency.get("integrity")
                    ):
                        errors.append(f"{directory}: missing lock integrity for {name}")
            except (OSError, ValueError, KeyError, TypeError):
                errors.append(f"{directory}: missing/malformed package or lockfile")
        requirements = sorted((self.root / "backend").glob("requirements*.txt"))
        if not requirements:
            errors.append("Backend requirements missing")
        for path in requirements:
            text = path.read_text(encoding="utf-8-sig")
            if "--require-hashes" not in text:
                errors.append(self.rel(path) + ": --require-hashes missing")
            for line in re.sub(r"\\\s*\n", " ", text).splitlines():
                line = line.strip()
                if not line or line.startswith(("#", "--")):
                    continue
                if line.startswith("-r "):
                    if not (path.parent / line[3:].strip()).is_file():
                        errors.append(
                            self.rel(path) + ": missing included requirements"
                        )
                elif not re.match(
                    r"^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[^\s]+", line
                ) or not re.search(r"--hash=sha256:[a-f0-9]{64}(?:\s|$)", line):
                    errors.append(
                        self.rel(path) + ": dependency is not exactly pinned and hashed"
                    )
        self.add(
            "dependency-manifests",
            errors,
            "npm locks match manifests; Python pins/hashes present; network audits not run",
        )

    def packaging_and_docs(self) -> None:
        errors, links = [], []
        required = (
            ".agents/skills/loha-release/SKILL.md",
            ".agents/skills/loha-release/scripts/release_check.py",
            "backend/app.py",
            "backend/manage.py",
            "backend/gunicorn_conf.py",
            "backend/pms_api/__init__.py",
            "backend/pms_api/config.py",
            "backend/pms_api/security.py",
            "backend/pms_api/rls.py",
            "backend/migrations/env.py",
            "backend/migrations/alembic.ini",
            "backend/requirements.txt",
            "backend/requirements-dev.txt",
            "backend/requirements-installer.txt",
            "backend/requirements-audit.txt",
            "backend/scripts/verify_restore.py",
            "backend/scripts/restore_database.py",
            "frontend/src/main.jsx",
            "frontend/src/app/App.jsx",
            "landingpage/src/main.jsx",
            "landingpage/src/App.jsx",
            "landingpage/src/apps/marketing/Home.jsx",
            "landingpage/src/apps/marketing/Pricing.jsx",
            "landingpage/src/apps/marketing/Blog.jsx",
            "landingpage/src/apps/marketing/Contact.jsx",
            ".github/workflows/ci.yml",
            "README.md",
            "docs/runbooks/operations-and-restore.md",
        )
        for relative in required:
            path = self.root / relative
            if not path.is_file() or path.stat().st_size == 0:
                errors.append("Missing/empty release file: " + relative)
        docker, ignore = (
            self.root / "backend/Dockerfile",
            self.root / "backend/.dockerignore",
        )
        if not docker.is_file() or not ignore.is_file():
            errors.append("Backend Dockerfile/.dockerignore missing")
        else:
            text = docker.read_text(encoding="utf-8")
            rules = ignore.read_text(encoding="utf-8").splitlines()
            if re.search(
                r"^\s*(?:COPY|ADD)\s+(?:--\S+\s+)*\.\s",
                text,
                re.MULTILINE | re.IGNORECASE,
            ):
                errors.append(
                    "Backend image copies entire context instead of runtime paths"
                )
            if "USER pms" not in text or "HEALTHCHECK" not in text:
                errors.append("Backend requires non-root runtime and healthcheck")
            for name in (".env", ".venv", ".local-postgres", "__pycache__"):
                if name not in rules:
                    errors.append("Backend Docker context does not exclude " + name)
        if (self.root / "frontend/src/apps/marketing").exists():
            errors.append("Marketing pages still inside frontend/src/apps/marketing")
        for directory in ("frontend", "landingpage"):
            if not (self.root / directory / "index.html").is_file():
                errors.append(directory + "/index.html missing")
        self.add(
            "release-packaging",
            errors,
            "Explicit backend runtime COPY; landingpage has independent entrypoint",
        )
        for path in self.files:
            if path.suffix.lower() != ".md":
                continue
            text = re.sub(
                r"```.*?```|~~~.*?~~~",
                "",
                path.read_text(encoding="utf-8-sig"),
                flags=re.DOTALL,
            )
            destinations = re.findall(r"!?\[[^\]]*\]\(([^)\n]+)\)", text)
            destinations += re.findall(r"^\s*\[[^\]]+\]:\s+(\S+)", text, re.MULTILINE)
            for destination in destinations:
                destination = destination.strip()
                destination = (
                    destination[1 : destination.find(">")]
                    if destination.startswith("<")
                    else destination.split()[0]
                )
                parsed = urlsplit(destination)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                if parsed.path.startswith("/"):
                    target = self.root / unquote(parsed.path).lstrip("/")
                else:
                    target = path.parent / unquote(parsed.path)
                if not target.exists():
                    links.append(f"{self.rel(path)} -> {destination}")
        self.add(
            "documentation-links",
            links,
            "Local Markdown file links resolve; external URLs/anchors not checked",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[4]
    )
    parser.add_argument(
        "--strict-git", action="store_true", help="Require a clean release working tree"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Machine-readable results without secret values",
    )
    args = parser.parse_args()
    checker = Checker(args.root.resolve())
    try:
        checker.discover()
        checker.hygiene(args.strict_git)
        checker.source()
        checker.migrations()
        checker.dependencies()
        checker.packaging_and_docs()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        checker.note(
            "checker-execution",
            "FAIL",
            f"Cannot finish ({type(error).__name__}); environment values suppressed",
        )
    checker.note(
        "environment-evidence",
        "SKIP",
        "Verify installed lint/format/build/dependency audits, staging auth/tenant/OTA, "
        "live schema/readiness/workers, backup/restore and rollback using SKILL.md",
    )
    failed = any(result["status"] == "FAIL" for result in checker.results)
    exit_code = 1 if failed else 0 if checker.git else 2
    if args.json:
        print(
            json.dumps(
                {
                    "exit_code": exit_code,
                    "release_approved": False,
                    "checks": checker.results,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        for result in checker.results:
            print(f"{result['status']:4} {result['name']}: {result['detail']}")
        print(f"Exit {exit_code}; local checks do not approve production release.")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
