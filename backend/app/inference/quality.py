"""Pre-flight photo quality checks — purely informational warnings surfaced
to the user (see CountResponse.warnings), never anything that changes
detection or filtering. A blurry or badly-lit photo won't be silently
mis-counted differently; the user just gets told the photo itself might be
the problem, before they trust whatever number comes back.
"""

import cv2
import numpy as np

# Laplacian variance scales with image resolution (more pixels captures more
# high-frequency detail even at the same physical sharpness), so it's
# computed against a fixed 1000px-max-dimension resize, not the original —
# otherwise the same threshold means something different on a 1600px photo
# vs a 6000px one. At that normalized scale, real sharp phone photos of a
# tray measured 475-1070 in testing; an artificially heavily-blurred version
# of the same photos measured 2-4 — a huge margin, so this threshold is
# tuned loose (low) on purpose: a false "looks blurry" warning is just noise
# the user ignores, a missed one means a legitimately unusable photo went
# unflagged.
BLUR_CHECK_MAX_DIM = 1000
BLUR_VARIANCE_THRESHOLD = 40.0
DARK_MEAN_THRESHOLD = 40.0
BRIGHT_MEAN_THRESHOLD = 235.0


def assess_image_quality(image: np.ndarray) -> list[str]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    warnings = []

    height, width = gray.shape
    scale = BLUR_CHECK_MAX_DIM / max(height, width)
    blur_input = cv2.resize(gray, (int(width * scale), int(height * scale))) if scale < 1 else gray
    blur_variance = float(cv2.Laplacian(blur_input, cv2.CV_64F).var())
    if blur_variance < BLUR_VARIANCE_THRESHOLD:
        warnings.append("Photo looks blurry — consider retaking for a more accurate count.")

    mean_brightness = float(gray.mean())
    if mean_brightness < DARK_MEAN_THRESHOLD:
        warnings.append("Photo looks very dark — consider retaking with better lighting.")
    elif mean_brightness > BRIGHT_MEAN_THRESHOLD:
        warnings.append("Photo looks overexposed/washed out — consider retaking with less glare.")

    return warnings
