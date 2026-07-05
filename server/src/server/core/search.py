"""Fuzzy full-text search over a vault's markdown files.

Brute-force scan, no index: every non-blank line in every .md file is scored against the query with
rapidfuzz's partial_ratio (best-window edit distance), so an exact substring scores 100 and near-variants
rank just below. Scoring runs multicore: cdist executes in C++ with the GIL released, chunked across a
thread pool (cdist's own workers option only parallelizes over queries, and we have a single query).

Matching is per-line: a phrase spanning a hard line break won't match.
"""

import os
import threading
import unicodedata
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pathspec
from rapidfuzz import fuzz
from rapidfuzz import process

from server.models.search import MatchRange
from server.models.search import SearchHit

SCORE_CUTOFF = 60.0
SNIPPET_WINDOW = 200
DEFAULT_LIMIT = 50
MIN_LINES_PER_CHUNK = 10_000


class SearchCancelled(Exception):
    """Raised when the caller sets the cancel event (e.g. the client disconnected)."""


# Kept 1:1 by the fold so that fold(content).splitlines() aligns with content.splitlines().
_LINE_BOUNDARIES = "\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"


class _FoldTable(dict[int, int]):
    """Lazy per-codepoint fold cache for str.translate: each unique codepoint is computed once."""

    def __missing__(self, codepoint: int) -> int:
        ch = chr(codepoint)
        if ch in _LINE_BOUNDARIES:
            folded = ch
        else:
            base = unicodedata.normalize("NFD", ch)[0]
            low = base.lower()
            if len(low) != 1:
                low = base
            folded = low if low.isalnum() else " "
        self[codepoint] = ord(folded)
        return self[codepoint]


_fold_table = _FoldTable()


def normalize(text: str) -> str:
    """Length-preserving fold: lowercase, diacritics stripped, punctuation -> space, line breaks kept.

    Emits exactly one output codepoint per input codepoint, so offsets from rapidfuzz alignment over the
    folded string map 1:1 onto the original. (Hence .lower() per base char, never .casefold(): 'ß' -> 'ss'
    would break the invariant; rare multi-codepoint .lower() results like 'İ' keep the base char instead.)
    """
    return text.translate(_fold_table)


def _identity(text: str) -> str:
    return text


def _load_gitignore(vault_root: Path) -> pathspec.GitIgnoreSpec | None:
    gitignore = vault_root / ".gitignore"
    if not gitignore.is_file():
        return None
    return pathspec.GitIgnoreSpec.from_lines(gitignore.read_text(encoding="utf-8").splitlines())


def iter_md_files(vault_root: Path) -> list[Path]:
    """All .md files under the vault, skipping dot-directories and paths matched by the vault's .gitignore."""
    ignore = _load_gitignore(vault_root)
    files: list[Path] = []
    for path in sorted(vault_root.rglob("*.md")):
        if not path.is_file():
            continue
        rel = path.relative_to(vault_root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if ignore is not None and ignore.match_file(rel.as_posix()):
            continue
        files.append(path)
    return files


def _snippet(folded_query: str, line: str, fold: Callable[[str], str]) -> tuple[str, list[MatchRange]]:
    """Snippet text (line, windowed if long) plus highlight ranges for the best-matching window."""
    alignment = fuzz.partial_ratio_alignment(folded_query, fold(line))
    if alignment is None or alignment.dest_end <= alignment.dest_start:
        start, end = 0, 0
    else:
        start, end = alignment.dest_start, alignment.dest_end

    if len(line) <= SNIPPET_WINDOW:
        text, offset = line, 0
    else:
        center = (start + end) // 2
        window_start = max(0, min(center - SNIPPET_WINDOW // 2, len(line) - SNIPPET_WINDOW))
        text, offset = line[window_start : window_start + SNIPPET_WINDOW], window_start

    clipped_start = max(start - offset, 0)
    clipped_end = min(end - offset, len(text))
    ranges = [MatchRange(start=clipped_start, end=clipped_end)] if clipped_end > clipped_start else []
    return text, ranges


def _check_cancel(cancel: threading.Event | None) -> None:
    if cancel is not None and cancel.is_set():
        raise SearchCancelled


def _score(
    folded_query: str, choices: list[str], cancel: threading.Event | None
) -> "np.ndarray[tuple[int], np.dtype[np.float32]]":
    def score_chunk(chunk: list[str]) -> "np.ndarray[tuple[int], np.dtype[np.float32]]":
        _check_cancel(cancel)
        result: np.ndarray[tuple[int], np.dtype[np.float32]] = process.cdist(
            [folded_query], chunk, scorer=fuzz.partial_ratio, score_cutoff=SCORE_CUTOFF, dtype=np.float32
        )[0]
        return result

    workers = min(os.cpu_count() or 1, max(1, len(choices) // MIN_LINES_PER_CHUNK))
    if workers == 1:
        return score_chunk(choices)
    chunk_size = (len(choices) + workers - 1) // workers
    chunks = [choices[i : i + chunk_size] for i in range(0, len(choices), chunk_size)]
    with ThreadPoolExecutor(workers) as pool:
        return np.concatenate(list(pool.map(score_chunk, chunks)))


def search_vault(
    vault_root: Path,
    query: str,
    limit: int = DEFAULT_LIMIT,
    do_normalize: bool = True,
    cancel: threading.Event | None = None,
) -> list[SearchHit]:
    """Top `limit` matching lines across the vault, ranked purely by score (a file may appear repeatedly).

    With do_normalize=False the fold is skipped, so case/punctuation/diacritics count toward the distance.
    Setting `cancel` aborts the scan at the next file/chunk boundary by raising SearchCancelled.
    """
    if do_normalize:
        fold: Callable[[str], str] = normalize
        folded_query = " ".join(fold(query).split())
    else:
        fold = _identity
        folded_query = query.strip()
    if not folded_query:
        return []

    lines: list[tuple[str, int, str]] = []  # (rel_path, line_number, original_line)
    choices: list[str] = []
    for path in iter_md_files(vault_root):
        _check_cancel(cancel)
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(vault_root).as_posix()
        # Fold the whole file in one translate call; the fold preserves line boundaries 1:1.
        folded_lines = fold(content).splitlines()
        for line_number, (line, folded) in enumerate(zip(content.splitlines(), folded_lines, strict=True), start=1):
            if not folded.strip():
                continue
            lines.append((rel, line_number, line))
            choices.append(folded)
    if not choices:
        return []

    scores = _score(folded_query, choices, cancel)
    candidates = np.flatnonzero(scores >= SCORE_CUTOFF).tolist()
    candidates.sort(key=lambda i: (-scores[i], lines[i][0], lines[i][1]))

    hits: list[SearchHit] = []
    for i in candidates[: max(0, limit)]:
        rel, line_number, line = lines[i]
        text, ranges = _snippet(folded_query, line, fold)
        hits.append(SearchHit(path=rel, line_number=line_number, text=text, ranges=ranges, score=float(scores[i])))
    return hits
