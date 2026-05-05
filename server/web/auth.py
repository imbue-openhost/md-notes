"""API-key auth middleware for both HTTP and WebSocket scopes."""

from typing import Any
from typing import cast
from urllib.parse import parse_qs

from litestar.enums import ScopeType
from litestar.middleware import AbstractMiddleware
from litestar.types import ASGIApp
from litestar.types import Receive
from litestar.types import Scope
from litestar.types import Send

from server.core.config import API_KEY

_PUBLIC_PREFIXES = ("/share/", "/assets/", "/ws/share/")
_PUBLIC_PATHS = ("/health",)


def _has_valid_token(scope: Scope) -> bool:
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}

    if headers.get("x-openhost-is-owner") == "true":
        return True

    auth = headers.get("authorization", "")
    if auth == f"Bearer {API_KEY}":
        return True

    qs = parse_qs(scope.get("query_string", b"").decode())
    token_values = qs.get("token", [])
    return bool(token_values) and token_values[0] == API_KEY


def _is_public(path: str) -> bool:
    return path in _PUBLIC_PATHS or any(path.startswith(p) for p in _PUBLIC_PREFIXES)


class AuthMiddleware(AbstractMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app=app)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope["type"]
        if not API_KEY or scope_type not in (ScopeType.HTTP, ScopeType.WEBSOCKET):
            await self.app(scope, receive, send)
            return

        if _is_public(scope["path"]) or _has_valid_token(scope):
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
            # Drain the websocket.connect frame, then refuse the handshake.
            await receive()
            await send(cast(Any, {"type": "websocket.close", "code": 4403}))
