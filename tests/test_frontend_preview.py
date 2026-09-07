import pytest

from scripts.smoke_frontend import validate_preview_url


@pytest.mark.parametrize("url", ["http://127.0.0.1:5173", "http://localhost:5174/"])
def test_preview_smoke_accepts_only_explicit_loopback_origins(url: str) -> None:
    assert validate_preview_url(url) == url.rstrip("/")


@pytest.mark.parametrize(
    "url",
    [
        "https://wplace.live/",
        "http://127.0.0.1.example/",
        "http://127.0.0.1@wplace.live/",
        "http://user:pass@localhost:5173/",
        "http://localhost:5173/data/config.json",
        "http://localhost:5173/?target=https://wplace.live",
        "http://localhost:0/",
    ],
)
def test_preview_smoke_rejects_nonlocal_or_ambiguous_targets(url: str) -> None:
    with pytest.raises(ValueError, match=r"loopback preview origin|Invalid preview port"):
        validate_preview_url(url)
