"""Comment endpoints, owner-authed (per vault) and share-link (comment/write tiers).

Mutations are applied to the document's live Y.Doc via ``SyncManager.mutate_doc`` and broadcast to connected
clients over the normal CRDT sync; REST is the only write path for comments (see core/comments.py).
"""

from typing import Any

from litestar import Controller
from litestar import Request
from litestar import delete
from litestar import patch
from litestar import post
from litestar.exceptions import NotFoundException
from litestar.exceptions import PermissionDeniedException
from litestar.status_codes import HTTP_201_CREATED
from pycrdt import Doc

from server.core.comments import create_comment
from server.core.comments import delete_comment
from server.core.comments import update_comment
from server.core.db import get_link
from server.core.sync import SyncManager
from server.models.comments import CreateCommentBody
from server.models.comments import CreateCommentResponse
from server.models.comments import UpdateCommentBody
from server.models.common import OkResponse
from server.models.share import ShareLink


def _sync_manager(request: Request[Any, Any, Any]) -> SyncManager:
    return request.app.state.sync_manager  # type: ignore[no-any-return]


def _doc_path(vault_name: str, path: str) -> str:
    return f"{vault_name}/{path.lstrip('/')}"


async def _create(manager: SyncManager, doc_path: str, data: CreateCommentBody) -> CreateCommentResponse:
    def mutate(doc: Doc[Any]) -> str:
        return create_comment(
            doc,
            user_id=data.userId,
            user_name=data.userName,
            text=data.text,
            anchor_start=data.anchorStart,
            anchor_end=data.anchorEnd,
            parent_id=data.parentId,
        )

    return CreateCommentResponse(id=await manager.mutate_doc(doc_path, mutate))


async def _update(
    manager: SyncManager, doc_path: str, comment_id: str, data: UpdateCommentBody, is_owner: bool
) -> OkResponse:
    def mutate(doc: Doc[Any]) -> None:
        update_comment(
            doc,
            comment_id,
            user_id=data.userId,
            is_owner=is_owner,
            text=data.text,
            resolved=data.resolved,
        )

    await manager.mutate_doc(doc_path, mutate)
    return OkResponse()


async def _delete(manager: SyncManager, doc_path: str, comment_id: str, user_id: str, is_owner: bool) -> OkResponse:
    def mutate(doc: Doc[Any]) -> None:
        delete_comment(doc, comment_id, user_id=user_id, is_owner=is_owner)

    await manager.mutate_doc(doc_path, mutate)
    return OkResponse()


class DocCommentsController(Controller):
    """Owner comment routes; ``path`` query param is the file path within the vault."""

    path = "/api/docs/{vault_name:str}/comments"

    @post("/", status_code=HTTP_201_CREATED)
    async def create(
        self,
        request: Request[Any, Any, Any],
        vault_name: str,
        path: str,
        data: CreateCommentBody,
    ) -> CreateCommentResponse:
        return await _create(_sync_manager(request), _doc_path(vault_name, path), data)

    @patch("/{comment_id:str}")
    async def update(
        self,
        request: Request[Any, Any, Any],
        vault_name: str,
        path: str,
        comment_id: str,
        data: UpdateCommentBody,
    ) -> OkResponse:
        return await _update(_sync_manager(request), _doc_path(vault_name, path), comment_id, data, is_owner=True)

    @delete("/{comment_id:str}", status_code=200)
    async def remove(
        self,
        request: Request[Any, Any, Any],
        vault_name: str,
        path: str,
        comment_id: str,
        userId: str,
    ) -> OkResponse:
        return await _delete(_sync_manager(request), _doc_path(vault_name, path), comment_id, userId, is_owner=True)


def _commentable_link(link_uuid: str) -> ShareLink:
    link = get_link(link_uuid)
    if not link:
        raise NotFoundException(detail="not found")
    if link.permission not in ("comment", "write"):
        raise PermissionDeniedException(detail="this share link does not allow commenting")
    return link


class ShareCommentsController(Controller):
    """Share-link comment routes. The UUID is the capability; commenting needs the comment or write tier."""

    path = "/api/share/{link_uuid:str}/comments"

    @post("/", status_code=HTTP_201_CREATED, opt={"public": True})
    async def create(
        self,
        request: Request[Any, Any, Any],
        link_uuid: str,
        data: CreateCommentBody,
    ) -> CreateCommentResponse:
        link = _commentable_link(link_uuid)
        return await _create(_sync_manager(request), link.doc_path, data)

    @patch("/{comment_id:str}", opt={"public": True})
    async def update(
        self,
        request: Request[Any, Any, Any],
        link_uuid: str,
        comment_id: str,
        data: UpdateCommentBody,
    ) -> OkResponse:
        link = _commentable_link(link_uuid)
        return await _update(_sync_manager(request), link.doc_path, comment_id, data, is_owner=False)

    @delete("/{comment_id:str}", status_code=200, opt={"public": True})
    async def remove(
        self,
        request: Request[Any, Any, Any],
        link_uuid: str,
        comment_id: str,
        userId: str,
    ) -> OkResponse:
        link = _commentable_link(link_uuid)
        return await _delete(_sync_manager(request), link.doc_path, comment_id, userId, is_owner=False)
