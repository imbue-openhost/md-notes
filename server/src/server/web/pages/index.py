"""Top-level pages: SPA shell, health check, API key endpoint."""

from litestar import MediaType
from litestar import Response
from litestar import get

from server.core.config import API_KEY
from server.core.config import FRONTEND_DIST


@get("/api/key")
async def get_api_key() -> dict[str, str]:
    return {"api_key": API_KEY}


@get("/health", media_type=MediaType.TEXT)
async def health() -> str:
    return "ok"


@get("/")
async def serve_index() -> Response[str]:
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return Response(index.read_text(), media_type=MediaType.HTML)
    return Response(
        "Frontend not built. Run `npm run build` in frontend/.", status_code=404, media_type=MediaType.TEXT
    )
