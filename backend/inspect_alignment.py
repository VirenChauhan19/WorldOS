"""Similarity alignment, with reviewable ORB/RANSAC suggestions and coverage gates."""
import base64
import io
from math import atan2, cos, degrees, hypot, radians, sin

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageStat

from .imaging import image_from_data_url
from .inspect_models import Alignment


def decode(url):
    canonical = image_from_data_url(url)
    image = Image.open(io.BytesIO(base64.b64decode(canonical["image_url"].split(",", 1)[1]))).convert("RGB")
    return image


def encode(image):
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return {"image_url": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode(), "width": image.width, "height": image.height}


def inverse_coefficients(reference_size, current_size, alignment):
    rw, rh = reference_size
    cw, ch = current_size
    factor = alignment.scale * rw/cw
    c, s = cos(radians(alignment.rotation)), sin(radians(alignment.rotation))
    a, b = c/factor, s/factor
    d, e = -s/factor, c/factor
    cx, cy = rw*(.5+alignment.tx), rh*(.5+alignment.ty)
    return a, b, cw/2-a*cx-b*cy, d, e, ch/2-d*cx-e*cy


def align_scene(template, image_url, alignment):
    reference, current = decode(template["reference_image_url"]), decode(image_url)
    inverse = inverse_coefficients(reference.size, current.size, alignment)
    aligned = current.transform(reference.size, Image.Transform.AFFINE, inverse, Image.Resampling.BICUBIC)
    mask = Image.new("L", current.size, 255).transform(reference.size, Image.Transform.AFFINE, inverse, Image.Resampling.NEAREST)
    w = template["workspace"]
    crop = (int(w["x"]*reference.width), int(w["y"]*reference.height),
            max(1, round((w["x"]+w["width"])*reference.width)), max(1, round((w["y"]+w["height"])*reference.height)))
    coverage = ImageStat.Stat(mask.crop(crop)).mean[0]/255
    warnings = []
    if abs(reference.width/reference.height/(current.width/current.height)-1) > .05:
        warnings.append("Photo aspect ratios differ significantly. Confirm scale and full workspace coverage; recapture if perspective changed.")
    if abs(alignment.rotation) > 10 or not .8 <= alignment.scale <= 1.25 or max(abs(alignment.tx), abs(alignment.ty)) > .15:
        warnings.append("Large framing adjustment. A similarity transform cannot correct perspective or object depth; recapture if surface features do not align.")
    if coverage < .98:
        warnings.append("The inspection photo does not cover at least 98% of the reference workspace. Recapture with a wider view; position comparison is blocked.")
    if not alignment.confirmed:
        warnings.append("Check the transparent overlay against stationary surface features, then confirm alignment before inspection.")
    return {**encode(aligned), "alignment": alignment.model_dump(), "workspace_coverage": round(coverage, 5),
            "comparison_allowed": alignment.confirmed and coverage >= .98, "warnings": warnings,
            "method": "user_confirmed_similarity" if alignment.confirmed else "unconfirmed_similarity"}


def suggest_alignment(template, image_url):
    """Only static-background features may support a registration suggestion.

    This is a fit-quality gate, not a calibrated alignment probability. A human
    still confirms the overlay, including when these checks pass.
    """
    reference, current = decode(template["reference_image_url"]), decode(image_url)
    def small(image):
        factor = min(1, 900/max(image.size))
        return np.asarray(image.resize((round(image.width*factor), round(image.height*factor)))).copy()
    ref, cur = small(reference), small(current)
    mask = Image.new("L", (ref.shape[1], ref.shape[0]), 0)
    draw = ImageDraw.Draw(mask)
    w = template["workspace"]
    draw.rectangle((w["x"]*ref.shape[1], w["y"]*ref.shape[0], (w["x"]+w["width"])*ref.shape[1], (w["y"]+w["height"])*ref.shape[0]), fill=255)
    for obj in template["objects"]:
        b = obj["box"]
        draw.rectangle(((b["x"]-.015)*ref.shape[1], (b["y"]-.015)*ref.shape[0],
                        (b["x"]+b["width"]+.015)*ref.shape[1], (b["y"]+b["height"]+.015)*ref.shape[0]), fill=0)
    orb = cv2.ORB_create(nfeatures=1800)
    kr, dr = orb.detectAndCompute(cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY), np.asarray(mask))
    kc, dc = orb.detectAndCompute(cv2.cvtColor(cur, cv2.COLOR_RGB2GRAY), None)
    rejected = {"status": "needs_manual_alignment", "alignment": None,
                "message": "Static surface features did not support reliable registration. Adjust the overlay manually or recapture.", "fit": None}
    if dr is None or dc is None or len(kr) < 18 or len(kc) < 18:
        return rejected
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    forward = [pair[0] for pair in matcher.knnMatch(dc, dr, k=2) if len(pair) == 2 and pair[0].distance < .72*pair[1].distance]
    reverse = {(pair[0].trainIdx, pair[0].queryIdx) for pair in matcher.knnMatch(dr, dc, k=2) if len(pair) == 2 and pair[0].distance < .72*pair[1].distance}
    good = [m for m in forward if (m.queryIdx, m.trainIdx) in reverse]
    if len(good) < 18:
        return rejected
    source = np.float32([kc[m.queryIdx].pt for m in good])
    target = np.float32([kr[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.estimateAffinePartial2D(source, target, method=cv2.RANSAC, ransacReprojThreshold=3, maxIters=2000, confidence=.99, refineIters=10)
    if matrix is None or inliers is None:
        return rejected
    selected = inliers.ravel().astype(bool)
    residual = float(np.sqrt(np.mean(np.sum((source[selected] @ matrix[:, :2].T + matrix[:, 2] - target[selected])**2, axis=1))))
    count = int(selected.sum())
    fit = {"matches": len(good), "inliers": count, "inlier_ratio": count/len(good), "rms_error_pixels_at_900": round(residual, 3)}
    rejected["fit"] = fit
    def spread(points, width, height):
        cells = {(int(x >= width/2), int(y >= height/2)) for x, y in points}
        return len(cells) >= 3 and np.ptp(points[:, 0]) > .35*width and np.ptp(points[:, 1]) > .35*height
    if count < 14 or count/len(good) < .65 or residual > 3 or not spread(target[selected], ref.shape[1], ref.shape[0]) or not spread(source[selected], cur.shape[1], cur.shape[0]):
        return rejected
    # Convert the small-image pixel transform back to full canonical pixels.
    full = np.diag([reference.width/ref.shape[1], reference.height/ref.shape[0]]) @ matrix @ np.diag([cur.shape[1]/current.width, cur.shape[0]/current.height, 1])
    scale = hypot(full[0, 0], full[1, 0])*current.width/reference.width
    rotation = degrees(atan2(full[1, 0], full[0, 0]))
    mapped_center = full @ np.array([current.width/2, current.height/2, 1])
    tx, ty = mapped_center[0]/reference.width-.5, mapped_center[1]/reference.height-.5
    if not .7 <= scale <= 1.4 or abs(rotation) > 15 or max(abs(tx), abs(ty)) > .2:
        return rejected
    alignment = Alignment(tx=float(tx), ty=float(ty), scale=float(scale), rotation=float(rotation))
    return {"status": "suggestion", "alignment": alignment.model_dump(), "fit": fit,
            "message": "Static-background registration passed the fit checks. Inspect the overlay and confirm alignment; perspective changes are not corrected automatically."}
