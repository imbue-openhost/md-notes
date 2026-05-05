"""OpenHost owner guard.

Applied as the app-wide default guard. Public routes opt out with ``opt={"public": True}``.
"""

from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.handlers import BaseRouteHandler


def requires_owner(connection: ASGIConnection, handler: BaseRouteHandler) -> None:  # type: ignore[type-arg]
    if handler.opt.get("public"):
        return
    if connection.headers.get("x-openhost-is-owner") != "true":
        raise NotAuthorizedException()
