"""Mock OpenHost router for local end-to-end tests.

Proxies HTTP and WebSocket traffic to an upstream app (the container running
md-notes), injecting ``X-OpenHost-Is-Owner: true`` on every request to simulate
an authenticated owner session.

Run directly:
    UPSTREAM_PORT=8080 ROUTER_PORT=9000 python tests/mock_router.py
"""

import asyncio
import logging
import os

import attr
import httpx
import websockets
from hypercorn.asyncio import serve
from hypercorn.config import Config
from litestar import Litestar
from litestar.handlers import asgi
from litestar.types import Receive
from litestar.types import Scope
from litestar.types import Send

logger = logging.getLogger(__name__)

AUTH_HEADER_NAME = "x-openhost-is-owner"
AUTH_HEADER_VALUE = "true"


@attr.s(auto_attribs=True, frozen=True)
class RouterConfig:
    upstream_host: str
    upstream_port: int
    router_port: int


def _config() -> RouterConfig:
    return RouterConfig(
        upstream_host=os.environ.get("UPSTREAM_HOST", "localhost"),
        upstream_port=int(os.environ.get("UPSTREAM_PORT", "8080")),
        router_port=int(os.environ.get("ROUTER_PORT", "9000")),
    )


CONFIG = _config()


async def _proxy_http(scope: Scope, receive: Receive, send: Send) -> None:
    method = scope["method"]
    path = scope["raw_path"].decode() if scope.get("raw_path") else scope["path"]
    query = scope["query_string"].decode()
    upstream_url = f"http://{CONFIG.upstream_host}:{CONFIG.upstream_port}{path}"
    if query:
        upstream_url = f"{upstream_url}?{query}"

    headers: list[tuple[str, str]] = []
    seen_auth = False
    for raw_k, raw_v in scope["headers"]:
        k = raw_k.decode()
        if k.lower() == "host":
            continue
        if k.lower() == AUTH_HEADER_NAME:
            seen_auth = True
        headers.append((k, raw_v.decode()))
    if not seen_auth:
        headers.append((AUTH_HEADER_NAME, AUTH_HEADER_VALUE))

    body = b""
    while True:
        msg = await receive()
        if msg["type"] == "http.disconnect":
            return
        if msg["type"] == "http.request":
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        upstream_resp = await client.request(method, upstream_url, headers=headers, content=body)

    response_headers: list[tuple[bytes, bytes]] = []
    for k, v in upstream_resp.headers.multi_items():
        if k.lower() in ("transfer-encoding", "content-encoding", "content-length"):
            continue
        response_headers.append((k.encode(), v.encode()))
    response_headers.append((b"content-length", str(len(upstream_resp.content)).encode()))

    await send(
        {
            "type": "http.response.start",
            "status": upstream_resp.status_code,
            "headers": response_headers,
        }
    )
    await send(
        {
            "type": "http.response.body",
            "body": upstream_resp.content,
        }
    )


async def _proxy_websocket(scope: Scope, receive: Receive, send: Send) -> None:
    path = scope["raw_path"].decode() if scope.get("raw_path") else scope["path"]
    query = scope["query_string"].decode()
    upstream_url = f"ws://{CONFIG.upstream_host}:{CONFIG.upstream_port}{path}"
    if query:
        upstream_url = f"{upstream_url}?{query}"

    additional_headers = {AUTH_HEADER_NAME: AUTH_HEADER_VALUE}

    msg = await receive()
    if msg["type"] != "websocket.connect":
        return

    try:
        upstream = await websockets.connect(upstream_url, additional_headers=additional_headers)
    except Exception as e:
        logger.warning("Upstream WS connect failed: %s", e)
        await send({"type": "websocket.close", "code": 1011, "reason": str(e)})
        return

    await send({"type": "websocket.accept"})

    closed = False

    async def client_to_upstream() -> None:
        nonlocal closed
        try:
            while not closed:
                m = await receive()
                if m["type"] == "websocket.receive":
                    if "text" in m and m["text"] is not None:
                        await upstream.send(m["text"])
                    elif "bytes" in m and m["bytes"] is not None:
                        await upstream.send(m["bytes"])
                elif m["type"] == "websocket.disconnect":
                    return
        except (websockets.ConnectionClosed, RuntimeError):
            return

    async def upstream_to_client() -> None:
        nonlocal closed
        try:
            async for m in upstream:
                if closed:
                    return
                if isinstance(m, str):
                    await send({"type": "websocket.send", "text": m})
                else:
                    await send({"type": "websocket.send", "bytes": m})
        except (websockets.ConnectionClosed, RuntimeError):
            return

    try:
        await asyncio.gather(client_to_upstream(), upstream_to_client())
    finally:
        closed = True
        await upstream.close()
        try:
            await send({"type": "websocket.close", "code": 1000})
        except Exception:
            pass


@asgi("/", is_mount=True)
async def proxy(scope: Scope, receive: Receive, send: Send) -> None:
    if scope["type"] == "http":
        await _proxy_http(scope, receive, send)
    elif scope["type"] == "websocket":
        await _proxy_websocket(scope, receive, send)


app = Litestar(route_handlers=[proxy])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger.info("Mock router :%d -> upstream %s:%d", CONFIG.router_port, CONFIG.upstream_host, CONFIG.upstream_port)
    config = Config()
    config.bind = [f"0.0.0.0:{CONFIG.router_port}"]
    config.loglevel = "warning"
    asyncio.run(serve(app, config))  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
