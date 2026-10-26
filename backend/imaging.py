"""Shared canonical image handling for uploads and provider-bound images."""
import base64
import binascii
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


def prepare_image(data: bytes):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as uploaded:
                if uploaded.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Use a JPEG, PNG, or WebP image.")
                if uploaded.width * uploaded.height > 24_000_000:
                    raise ValueError("Image exceeds 24 megapixels.")
                uploaded.load()
                oriented = ImageOps.exif_transpose(uploaded).convert("RGB")
                original_size = oriented.size
                oriented.thumbnail((1800, 1800))
                output = io.BytesIO()
                oriented.save(output, format="JPEG", quality=90)
        return {"width": oriented.width, "height": oriented.height, "original_width": original_size[0], "original_height": original_size[1],
                "image_url": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()}
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError("Image cannot be decoded or exceeds the 24 megapixel limit.") from None


def image_from_data_url(value: str):
    # Do not fetch arbitrary client URLs; the UI sends its canonical image inline.
    try:
        prefix, encoded = value.split(",", 1)
        if prefix not in {"data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"}:
            raise ValueError()
        data = base64.b64decode(encoded, validate=True)
        if len(data) > 12 * 1024 * 1024:
            raise ValueError()
        return prepare_image(data)
    except (ValueError, binascii.Error):
        raise ValueError("Send a valid JPEG, PNG, or WebP data URL under 12 MB; external URLs are not fetched.") from None
