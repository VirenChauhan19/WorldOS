"""Shared canonical image handling for uploads and provider-bound images."""
import base64
import binascii
import io
import os
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


def same_photograph(first: str, second: str) -> bool:
    """Reject exact reuse, including the JPEG normalization used when saving.

    Different bytes do not prove a fresh physical capture. This is a negative
    evidence gate, never a freshness or physical-correction certificate.
    """
    if first == second:
        return True
    first_normalized = image_from_data_url(first)["image_url"]
    if first_normalized == second:
        return True
    second_normalized = image_from_data_url(second)["image_url"]
    return first == second_normalized or first_normalized == second_normalized


def prepare_image(data: bytes):
    max_pixels = int(os.getenv('WORLDOS_MAX_IMAGE_PIXELS', '24000000'))
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as uploaded:
                if uploaded.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Use a JPEG, PNG, or WebP image.")
                if uploaded.width * uploaded.height > max_pixels:
                    raise ValueError(f"Image exceeds {max_pixels / 1_000_000:g} megapixels. Resize it before uploading.")
                uploaded.load()
                oriented = ImageOps.exif_transpose(uploaded).convert("RGB")
                original_size = oriented.size
                oriented.thumbnail((1800, 1800))
                output = io.BytesIO()
                oriented.save(output, format="JPEG", quality=90)
        return {"width": oriented.width, "height": oriented.height, "original_width": original_size[0], "original_height": original_size[1],
                "image_url": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()}
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError(f"Image cannot be decoded or exceeds the {max_pixels / 1_000_000:g} megapixel limit.") from None


def image_from_data_url(value: str):
    max_mb = int(os.getenv('WORLDOS_MAX_UPLOAD_MB', '12'))
    # Do not fetch arbitrary client URLs; the UI sends its canonical image inline.
    try:
        prefix, encoded = value.split(",", 1)
        if prefix not in {"data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"}:
            raise ValueError()
        data = base64.b64decode(encoded, validate=True)
        if len(data) > max_mb * 1024 * 1024:
            raise ValueError()
        return prepare_image(data)
    except (ValueError, binascii.Error):
        raise ValueError(f"Send a valid JPEG, PNG, or WebP data URL under {max_mb} MB within the configured image pixel limit; external URLs are not fetched.") from None
