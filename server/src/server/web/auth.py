"""Auth middleware: enforces OpenHost owner authentication.

All non-public routes require the ``x-openhost-is-owner: true`` header, set by the OpenHost edge proxy.
"""

from typing import Any
from typing import cast

from litestar.enums import ScopeType
from litestar.middleware import AbstractMiddleware
from litestar.types import ASGIApp
from litestar.types import Receive
from litestar.types import Scope
from litestar.types import Send

_PUBLIC_PREFIXES = ("/share/", "/assets/", "/ws/share/")
_PUBLIC_PATHS = ("/health",)


def _is_owner(scope: Scope) -> bool:
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
    return headers.get("x-openhost-is-owner") == "true"


def _is_public(path: str) -> bool:
    return path in _PUBLIC_PATHS or any(path.startswith(p) for p in _PUBLIC_PREFIXES)


class AuthMiddleware(AbstractMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app=app)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope["type"]
        if scope_type not in (ScopeType.HTTP, ScopeType.WEBSOCKET):
            await self.app(scope, receive, send)
            return

        if _is_public(scope["path"]) or _is_owner(scope):
            await self.app(scope, receive, send)
            return

        if scope_type == ScopeType.HTTP:
            await send(
                cast(
                    Any,
                    {
                        "type": "http.response.start",
                        "status": 401,
                        "headers": [(b"content-type", b"application/json")],
                    },
                )
            )
            await send(cast(Any, {"type": "http.response.body", "body": b'{"error":"Unauthorized"}'}))
        else:
            await receive()
            await send(cast(Any, {"type": "websocket.close", "code": 4403}))
