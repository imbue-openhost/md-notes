"""Share-link page: serves the SPA shell for /share/<uuid> URLs."""

from litestar import MediaType
from litestar import Response
from litestar import get

from server.core.config import Config


@get("/share/{link_uuid:str}", media_type=MediaType.HTML)
async def share_page(link_uuid: str, config: Config) -> Response[str]:
    """Serve the SPA shell for a share link. The SPA fetches /share/{uuid}/info to bootstrap."""
    index = config.frontend_dist / "index.html"
    if not index.exists():
        return Response("Frontend not built", status_code=404, media_type=MediaType.TEXT)
    return Response(index.read_text(), media_type=MediaType.HTML)
