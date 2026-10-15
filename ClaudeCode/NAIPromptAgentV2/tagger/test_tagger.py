import io

import pytest
from PIL import Image

from tagger import flatten, load_image


def test_flatten_sorts_by_score_and_keeps_category():
    out = flatten({"general": {"1girl": 0.99, "smile": 0.5}, "style": {"bkub": 0.7}})
    assert [t["name"] for t in out] == ["1girl", "bkub", "smile"]
    assert out[1] == {"name": "bkub", "category": "style", "score": 0.7}


def test_load_image_applies_exif_rotation():
    img = Image.new("RGB", (40, 20))
    exif = Image.Exif()
    exif[0x0112] = 6  # orientation: rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    assert load_image(buf.getvalue()).size == (20, 40)


@pytest.mark.parametrize("data", [b"", b"%PDF-1.7 not an image"])
def test_load_image_rejects_non_images(data):
    with pytest.raises(ValueError, match="Not a readable image"):
        load_image(data)


def test_prepare_pads_to_square_and_box_roundtrips():
    import numpy as np
    from tagger import prepare

    x, box = prepare(Image.new("RGB", (200, 100), "white"))
    assert x.shape == (1, 3, 1024, 1024) and x.dtype == np.float32
    l, t, r, b = box
    assert (r - l, b - t) == (1024, 512) and l == 0 and t == 256


def test_mask_to_rgba_keeps_size_and_sets_alpha():
    import numpy as np
    from tagger import mask_to_rgba

    out = mask_to_rgba(Image.new("RGB", (8, 4), "red"), np.full((16, 32), 0.5, np.float32))
    assert out.mode == "RGBA" and out.size == (8, 4)
    assert out.getpixel((0, 0)) == (255, 0, 0, 128)


def test_cutout_rejects_non_image_and_oversize_without_loading_model():
    from fastapi.testclient import TestClient
    import tagger

    c = TestClient(tagger.app)  # no `with`: lifespan (model preload) not run
    assert c.post("/cutout", files={"file": ("x.png", b"nope")}).status_code == 400
    big = b"0" * (tagger.MAX_UPLOAD + 1)
    assert c.post("/cutout", files={"file": ("x.png", big)}).status_code == 413
    assert tagger._seg is None
