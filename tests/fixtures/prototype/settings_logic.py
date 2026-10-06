"""Account settings logic (production): pure functions over plain data."""

DEFAULTS = {"display_name": "", "email": "", "theme": "light", "digest": "weekly", "two_factor": False}


def load_settings() -> dict:
    """Stub data standing in for the account store."""
    return {**DEFAULTS, "display_name": "Ada Lovelace", "email": "ada@example.com",
            "theme": "dark", "digest": "daily", "two_factor": True}


def sections(settings: dict) -> list[tuple[str, list[tuple[str, str]]]]:
    """Group settings into titled sections of (label, value) rows, in display order."""
    return [
        ("Profile", [("Display name", settings["display_name"]), ("Email", settings["email"])]),
        ("Appearance", [("Theme", settings["theme"])]),
        ("Notifications", [("Email digest", settings["digest"])]),
        ("Security", [("Two-factor authentication", "on" if settings["two_factor"] else "off")]),
    ]


def security_warning(settings: dict) -> str | None:
    return None if settings["two_factor"] else "Turn on two-factor authentication."
