"""REST endpoints for user settings (vimrc, etc.) and owner identity."""

from litestar import Controller
from litestar import get
from litestar import put

from server.core.config import Config
from server.core.db import get_setting
from server.core.db import set_setting
from server.models.common import OkResponse
from server.models.settings import MeResponse
from server.models.settings import VimrcBody
from server.models.settings import VimrcResponse


class SettingsController(Controller):
    path = "/api/settings"

    @get("/vimrc")
    async def get_vimrc(self) -> VimrcResponse:
        return VimrcResponse(vimrc=get_setting("vimrc"))

    @put("/vimrc")
    async def save_vimrc(self, data: VimrcBody) -> OkResponse:
        set_setting("vimrc", data.vimrc)
        return OkResponse()

    @get("/me")
    async def get_me(self, config: Config) -> MeResponse:
        return MeResponse(displayName=config.owner_name)
