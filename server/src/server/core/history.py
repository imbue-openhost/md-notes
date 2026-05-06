"""Git-based autosave of vault contents.

A single git repo lives at ``vault_path`` covering every vault. Every ``AUTOSAVE_INTERVAL_SECS`` we stage any
changes and commit them as ``autosave on <iso timestamp>``. Only files whose extension is in
``ALLOWED_EXTENSIONS`` are included from untracked state — anything else is logged and skipped.

Nothing here is exposed on the API; ``HistoryManager`` is started/stopped from the Litestar lifespan.
"""

import asyncio
import shutil
import subprocess
from datetime import UTC
from datetime import datetime
from pathlib import Path
from typing import ClassVar

from loguru import logger

_GIT_USER_NAME = "md-notes"
_GIT_USER_EMAIL = "md-notes@localhost"

ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".md", ".png", ".jpeg"})


class GitNotInstalled(Exception):
    pass


class HistoryManager:
    AUTOSAVE_INTERVAL_SECS: ClassVar[float] = 15 * 60

    def __init__(self, vault_path: Path) -> None:
        self._vault_path = vault_path
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if shutil.which("git") is None:
            raise GitNotInstalled("git CLI not found on PATH")
        self._vault_path.mkdir(parents=True, exist_ok=True)
        if not (self._vault_path / ".git").exists():
            await self._run_git("init", "-q")
            logger.info("Initialised git repo at {}", self._vault_path)
        self._task = asyncio.create_task(self._loop())
        logger.info("History autosave started (interval={}s)", int(self.AUTOSAVE_INTERVAL_SECS))

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        logger.info("History autosave stopped")

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.AUTOSAVE_INTERVAL_SECS)
                await self._autosave()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Autosave failed")

    async def _autosave(self) -> None:
        await self._run_git("add", "-u")

        untracked = await self._list_untracked()
        to_add: list[str] = []
        for path in untracked:
            if Path(path).suffix.lower() in ALLOWED_EXTENSIONS:
                to_add.append(path)
            else:
                logger.warning("Skipping non-whitelisted file from autosave: {}", path)
        if to_add:
            await self._run_git("add", "--", *to_add)

        if await self._run_git("diff", "--cached", "--quiet", check=False) == 0:
            return

        timestamp = datetime.now(UTC).isoformat(timespec="seconds")
        await self._run_git("commit", "-q", "-m", f"autosave on {timestamp}")
        logger.info("Autosaved at {}", timestamp)

    async def _list_untracked(self) -> list[str]:
        out = await self._run_git_capture("ls-files", "--others", "--exclude-standard", "-z")
        return [p for p in out.split("\0") if p]

    async def _run_git(self, *args: str, check: bool = True) -> int:
        proc = await asyncio.create_subprocess_exec(
            "git",
            "-C",
            str(self._vault_path),
            "-c",
            f"user.name={_GIT_USER_NAME}",
            "-c",
            f"user.email={_GIT_USER_EMAIL}",
            *args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        rc = proc.returncode
        assert rc is not None
        if check and rc != 0:
            err = stderr.decode("utf-8", errors="replace") if stderr else ""
            raise RuntimeError(f"git {' '.join(args)} failed (rc={rc}): {err}")
        return rc

    async def _run_git_capture(self, *args: str) -> str:
        proc = await asyncio.create_subprocess_exec(
            "git",
            "-C",
            str(self._vault_path),
            *args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace") if stderr else ""
            raise RuntimeError(f"git {' '.join(args)} failed (rc={proc.returncode}): {err}")
        return stdout.decode("utf-8", errors="replace")
