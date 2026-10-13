"""PixAI Tagger v1.0 sidecar.

POST /tag (multipart `file`) -> every tag scoring above MIN_SCORE, with its category, so the
client can filter with sliders without re-running the model. Categories: general, character,
copyright, style (= artists), meta, rating.
"""
import io
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

MODEL_ID = "pixai-labs/pixai-tagger-v1.0"
MIN_SCORE = float(os.environ.get("TAGGER_MIN_SCORE", "0.05"))

_pipe = None


def flatten(results: dict[str, dict[str, float]]) -> list[dict]:
    """Pipeline output {category: {tag: score}} -> [{name, category, score}], best first."""
    out = [
        {"name": name, "category": cat, "score": round(score, 4)}
        for cat, tags in results.items()
        for name, score in tags.items()
    ]
    return sorted(out, key=lambda t: -t["score"])


def load_image(data: bytes) -> Image.Image:
    """Decode upload bytes; apply EXIF rotation (iPhone photos arrive sideways otherwise)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("Not a readable image.") from e
    return ImageOps.exif_transpose(img)


def load_pipe():
    global _pipe
    if _pipe is None:
        import torch
        from transformers import pipeline

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _pipe = pipeline(model=MODEL_ID, image_processor=MODEL_ID, trust_remote_code=True, device=device)
    return _pipe


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("TAGGER_PRELOAD", "1") == "1":
        load_pipe()  # ~10 s once; first /tag is then fast
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "loaded": _pipe is not None}


@app.post("/tag")
async def tag(file: UploadFile = File(...)):
    try:
        img = load_image(await file.read())
    except ValueError as e:
        raise HTTPException(422, str(e))
    t = time.perf_counter()
    pipe = load_pipe()
    results = pipe(img, threshold=MIN_SCORE)["results"]
    return {
        "tags": flatten(results),
        "thresholds": pipe.model.config.category_best_threshold,
        "ms": round((time.perf_counter() - t) * 1000),
    }
