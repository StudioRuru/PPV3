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
