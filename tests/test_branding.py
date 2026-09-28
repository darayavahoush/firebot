from firebot import branding


def test_banner_has_name_and_tagline():
    b = branding.banner()
    assert branding.TAGLINE in b and "firebot" not in b.lower().split("autonomous")[0]
    assert len(b.splitlines()) >= 6
