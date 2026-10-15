"""PixAI Tagger v1.0 sidecar.

POST /tag (multipart `file`) -> every tag scoring above MIN_SCORE, with its category, so the
client can filter with sliders without re-running the model. Categories: general, character,
copyright, style (= artists), meta, rating.
"""
import io
import os
import threading
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError

MODEL_ID = "pixai-labs/pixai-tagger-v1.0"
MIN_SCORE = float(os.environ.get("TAGGER_MIN_SCORE", "0.05"))

SEG_REPO, SEG_FILE, SEG_SIZE = "skytnt/anime-seg", "isnetis.onnx", 1024
SEG_DIR = os.path.expanduser("~/models/anime-seg")
MAX_UPLOAD = 40 * 1024 * 1024

_pipe = None
_seg = None


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


def prepare(img: Image.Image):
    """Pad to a white square, resize to 1024 -> (NCHW float32 [0,1], content box in 1024 space)."""
    img = img.convert("RGB")
    w, h = img.size
    s = max(w, h)
    sq = Image.new("RGB", (s, s), "white")
    sq.paste(img, ((s - w) // 2, (s - h) // 2))
    k = SEG_SIZE / s
    nw, nh = round(w * k), round(h * k)
    l, t = (SEG_SIZE - nw) // 2, (SEG_SIZE - nh) // 2
    x = np.asarray(sq.resize((SEG_SIZE, SEG_SIZE), Image.BILINEAR), np.float32) / 255
    return x.transpose(2, 0, 1)[None], (l, t, l + nw, t + nh)


def mask_to_rgba(img: Image.Image, mask: np.ndarray) -> Image.Image:
    """2-D mask in [0,1] (any size) -> img as RGBA with the mask, resized to img, as alpha."""
    a = Image.fromarray((np.clip(mask, 0, 1) * 255).round().astype(np.uint8)).resize(img.size, Image.BILINEAR)
    out = img.convert("RGBA")
    out.putalpha(a)
    return out


def load_seg():
    global _seg
    if _seg is None:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(SEG_REPO, SEG_FILE, local_dir=SEG_DIR)
        _seg = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _seg


def _warm_seg():
    try:
        load_seg()
    except Exception as e:  # download failure only logs; /cutout retries on demand
        print(f"cutout model warm-up failed: {e}", flush=True)


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
        threading.Thread(target=_warm_seg, daemon=True).start()  # first /cutout shouldn't time out downloading the model
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


@app.post("/cutout")
async def cutout(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (40 MB max).")
    try:
        img = load_image(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    img = img.convert("RGB")
    x, (l, t, r, b) = prepare(img)
    sess = load_seg()
    mask = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0][t:b, l:r]
    buf = io.BytesIO()
    mask_to_rgba(img, mask).save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")
