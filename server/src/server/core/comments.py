"""Comment CRUD applied to a document's Y.Doc.

Comments live in a Y.Map named ``comments`` on the same Y.Doc as the text, keyed by comment id, so they ride
the existing CRDT sync/sidecar persistence and never touch the .md. Values are plain JSON objects::

    {id, parentId?, userId, userName, text, anchorStart?, anchorEnd?, createdAt, editedAt?, resolved?}

``anchorStart``/``anchorEnd`` are base64 Yjs relative positions into the ``content`` text, encoded by the
client and stored opaquely; replies carry ``parentId`` instead of anchors. All mutations replace the whole
value under the key (LWW per comment) — concurrent edits of a single comment are rare enough that CRDT-merging
inside a comment isn't worth the complexity.

Clients cannot write comments over the CRDT websocket themselves (share channels are read-only below "write",
and even write channels shouldn't be trusted to invent authorship), so every mutation goes through these
functions via REST; the room then broadcasts the resulting Y.Doc update to all connected clients.
"""

import base64
import uuid
from datetime import UTC
from datetime import datetime
from typing import Any

from loguru import logger
from pycrdt import Doc
from pycrdt import Map
from pycrdt import StickyIndex
from pycrdt import Text


class CommentNotFound(Exception):
    pass


class CommentPermissionError(Exception):
    pass


class InvalidComment(Exception):
    pass


MAX_TEXT_CHARS = 10_000
MAX_NAME_CHARS = 120

COMMENTS_MAP_NAME = "comments"
CONTENT_TEXT_NAME = "content"


def comments_map(doc: Doc[Any]) -> Map[Any]:
    result: Map[Any] = doc.get(COMMENTS_MAP_NAME, type=Map)
    return result


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _require_text(text: str, field: str, max_chars: int) -> str:
    if not isinstance(text, str) or not text.strip():
        raise InvalidComment(f"{field} must be a non-empty string")
    if len(text) > max_chars:
        raise InvalidComment(f"{field} exceeds {max_chars} characters")
    return text


def _decode_anchor(doc: Doc[Any], encoded: str, field: str) -> StickyIndex:
    content = doc.get(CONTENT_TEXT_NAME, type=Text)
    try:
        return StickyIndex.decode(base64.b64decode(encoded), content)
    except Exception as exc:
        raise InvalidComment(f"{field} is not a valid anchor: {exc}") from exc


def create_comment(
    doc: Doc[Any],
    *,
    user_id: str,
    user_name: str,
    text: str,
    anchor_start: str | None,
    anchor_end: str | None,
    parent_id: str | None,
) -> str:
    _require_text(user_id, "userId", MAX_NAME_CHARS)
    _require_text(user_name, "userName", MAX_NAME_CHARS)
    _require_text(text, "text", MAX_TEXT_CHARS)

    comments = comments_map(doc)
    comment_id = uuid.uuid4().hex
    record: dict[str, Any] = {
        "id": comment_id,
        "userId": user_id,
        "userName": user_name,
        "text": text,
        "createdAt": _now(),
    }

    with doc.transaction():
        if parent_id is not None:
            parent = comments.get(parent_id)
            if parent is None:
                raise CommentNotFound(parent_id)
            if parent.get("parentId"):
                raise InvalidComment("cannot reply to a reply")
            record["parentId"] = parent_id
        else:
            if not anchor_start or not anchor_end:
                raise InvalidComment("top-level comments require anchorStart and anchorEnd")
            start = _decode_anchor(doc, anchor_start, "anchorStart")
            end = _decode_anchor(doc, anchor_end, "anchorEnd")
            if start.get_index() >= end.get_index():
                raise InvalidComment("anchors must span a non-empty range")
            record["anchorStart"] = anchor_start
            record["anchorEnd"] = anchor_end
            record["resolved"] = False
        comments[comment_id] = record

    return comment_id


def update_comment(
    doc: Doc[Any],
    comment_id: str,
    *,
    user_id: str,
    is_owner: bool,
    text: str | None,
    resolved: bool | None,
) -> None:
    if text is None and resolved is None:
        raise InvalidComment("nothing to update")

    comments = comments_map(doc)
    with doc.transaction():
        record = comments.get(comment_id)
        if record is None:
            raise CommentNotFound(comment_id)
        if text is not None:
            # Only the author may edit the text — the owner can delete anything but not put words in
            # someone else's mouth.
            if record.get("userId") != user_id:
                raise CommentPermissionError("only the author can edit a comment")
            record["text"] = _require_text(text, "text", MAX_TEXT_CHARS)
            record["editedAt"] = _now()
        if resolved is not None:
            if record.get("parentId"):
                raise InvalidComment("replies cannot be resolved")
            record["resolved"] = bool(resolved)
        comments[comment_id] = record


def delete_comment(doc: Doc[Any], comment_id: str, *, user_id: str, is_owner: bool) -> None:
    comments = comments_map(doc)
    with doc.transaction():
        record = comments.get(comment_id)
        if record is None:
            raise CommentNotFound(comment_id)
        if not is_owner and record.get("userId") != user_id:
            raise CommentPermissionError("only the author or the doc owner can delete a comment")
        del comments[comment_id]
        if not record.get("parentId"):
            reply_ids = [k for k in comments.keys() if (comments.get(k) or {}).get("parentId") == comment_id]
            for reply_id in reply_ids:
                del comments[reply_id]


def gc_orphaned_comments(doc: Doc[Any], doc_path: str) -> int:
    """Delete top-level comments whose anchored span has been fully deleted (anchors collapsed), plus their
    replies. Called on room save; clients hide collapsed comments immediately, this makes it permanent."""
    comments = comments_map(doc)
    deleted = 0
    with doc.transaction():
        for comment_id in list(comments.keys()):
            record = comments.get(comment_id)
            if not isinstance(record, dict) or record.get("parentId"):
                continue
            anchor_start = record.get("anchorStart")
            anchor_end = record.get("anchorEnd")
            if not anchor_start or not anchor_end:
                continue
            try:
                start = _decode_anchor(doc, anchor_start, "anchorStart")
                end = _decode_anchor(doc, anchor_end, "anchorEnd")
            except InvalidComment:
                logger.warning("Comment {} on {} has undecodable anchors; leaving in place", comment_id, doc_path)
                continue
            if start.get_index() < end.get_index():
                continue
            delete_comment(doc, comment_id, user_id="", is_owner=True)
            deleted += 1
    if deleted:
        logger.info("GC'd {} orphaned comment(s) on {}", deleted, doc_path)
    return deleted
