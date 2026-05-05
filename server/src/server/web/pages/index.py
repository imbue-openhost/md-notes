"""Top-level pages: SPA shell, health check."""

from litestar import MediaType
from litestar import Response
from litestar import get

from server.core.config import Config


@get("/health", media_type=MediaType.TEXT)
async def health() -> str:
    return "ok"


@get("/")
async def serve_index(config: Config) -> Response[str]:
    index = config.frontend_dist / "index.html"
    if index.exists():
        return Response(index.read_text(), media_type=MediaType.HTML)
    return Response(
        "Frontend not built. Run `npm run build` in frontend/.", status_code=404, media_type=MediaType.TEXT
    )
