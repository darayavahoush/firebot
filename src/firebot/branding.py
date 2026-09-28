"""Display name and startup banner. The Python package, CLI names (`firebot-*`), env vars
(`FIREBOT_*`) and DB names keep the `firebot` identifier on purpose -- renaming them would break
installs, stored runs and configs. Only what a person sees says NIRVANA."""
from __future__ import annotations

NAME = "NIRVANA"
TAGLINE = "The fire ends here."

_ART = r"""
███╗   ██╗██╗██████╗ ██╗   ██╗ █████╗ ███╗   ██╗ █████╗
████╗  ██║██║██╔══██╗██║   ██║██╔══██╗████╗  ██║██╔══██╗
██╔██╗ ██║██║██████╔╝██║   ██║███████║██╔██╗ ██║███████║
██║╚██╗██║██║██╔══██╗╚██╗ ██╔╝██╔══██║██║╚██╗██║██╔══██║
██║ ╚████║██║██║  ██║ ╚████╔╝ ██║  ██║██║ ╚████║██║  ██║
╚═╝  ╚═══╝╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝""".strip("\n")


def banner() -> str:
    return f"{_ART}\n  {TAGLINE}  ·  autonomous firefighting robot\n"
