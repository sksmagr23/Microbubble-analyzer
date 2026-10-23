from fastapi import FastAPI, File, Form, HTTPException, UploadFile
import cv2
import numpy as np
import tempfile
import base64
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Stability Model
# ---------------------------------------------------------------------------
t1 = 30
t2 = 2 * 24 * 60

pH_data = [1.5, 3, 6, 9, 12]
h1_data = [2.23, 2.17, 2.20, 2.19, 2.20]
h2_data = [1.52, 1.93, 2.19, 1.78, 1.43]

def interpolated_heights(pH):
    pH_clamped = max(min(pH, max(pH_data)), min(pH_data))
    h1 = np.interp(pH_clamped, pH_data, h1_data)
    h2 = np.interp(pH_clamped, pH_data, h2_data)
    return float(h1), float(h2)

def half_life(pH):
    h1, h2 = interpolated_heights(pH)
    if h2 >= h1:
        return None, h1, h2
    k = np.log(h1 / h2) / (t2 - t1)
    t_hl = np.log(2) / k
    return float(t_hl), h1, h2

def describe_stability(t_hl_minutes):
    days = t_hl_minutes / 1440
    if days > 10:
        return "Highly stable"
    elif days > 5:
        return "Moderately stable"
    elif days > 2:
        return "Low stability"
    else:
        return "Unstable / breaks down quickly"

class StabilityRequest(BaseModel):
    pH: float


def process_image(path, scale, unit):
    # ----------- LOAD IMAGE -----------
    img = cv2.imread(path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # ----------- PREPROCESSING -----------
    blur = cv2.GaussianBlur(gray, (7,7), 0)
    # Otsu Threshold (auto)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # ----------- NOISE REMOVAL -----------
    kernel = np.ones((3,3), np.uint8)
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)

    # ----------- SURE BACKGROUND -----------
    sure_bg = cv2.dilate(opening, kernel, iterations=3)

    # ----------- DISTANCE TRANSFORM -----------
    dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)

    # ----------- SURE FOREGROUND -----------
    _, sure_fg = cv2.threshold(dist_transform, 0.5 * dist_transform.max(), 255, 0)
    sure_fg = np.uint8(sure_fg)

    # ----------- UNKNOWN REGION -----------
    unknown = cv2.subtract(sure_bg, sure_fg)

    # ----------- MARKERS -----------
    _, markers = cv2.connectedComponents(sure_fg)

    markers = markers + 1
    markers[unknown == 255] = 0

    # ----------- WATERSHED -----------
    markers = cv2.watershed(img, markers)

    # ----------- EXTRACT BUBBLES -----------
    diameters = []

    output = img.copy()

    for label in np.unique(markers):
        if label <= 1:
            continue

        mask = np.zeros(gray.shape, dtype="uint8")
        mask[markers == label] = 255

        # Find contour
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if contours:
            c = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(c)

            # Filter noise
            if area < 200:
                continue

            # Equivalent diameter
            diameter = np.sqrt(4 * area / np.pi)
            diameters.append(float(diameter))
             
            # Draw contour 
            cv2.drawContours(output, [c], -1, (0,255,0), 2)

    # Encode image to base64
    _, buffer = cv2.imencode('.jpg', output)
    img_str = base64.b64encode(buffer).decode('utf-8')

    # Convert diameter values from pixels into selected unit.
    scaled_diameters = [value * scale for value in diameters]

    # ----------- HISTOGRAM -----------
    hist_counts, bin_edges = np.histogram(scaled_diameters, bins=15)
    
    # ----------- SCATTER -----------
    indices = list(range(len(scaled_diameters)))

    return {
    "count": len(scaled_diameters),
    "avg": float(np.mean(scaled_diameters)) if scaled_diameters else 0,
    "std": float(np.std(scaled_diameters)) if scaled_diameters else 0,
    "diameters": scaled_diameters,
    "hist_counts": hist_counts.tolist(),
    "bin_edges": bin_edges.tolist(),
    "indices": indices,
    "scale": scale,
    "unit": unit,
    "image": img_str
}

@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    scale: float = Form(1.0),
    unit: str = Form("px"),
):
    if scale <= 0:
        raise HTTPException(status_code=400, detail="Scale must be greater than 0.")

    normalized_unit = unit.strip() or "px"

    with tempfile.NamedTemporaryFile(delete=False) as temp:
        temp.write(await file.read())
        result = process_image(temp.name, scale, normalized_unit)
    return result

def generate_curve_points(h0: float, k: float, max_hours: float, num_points: int = 60):
    times = np.linspace(0, max_hours, num_points)
    key_points = [0.0]
    if max_hours >= 0.5:
        key_points.append(0.5)
    if max_hours >= 48.0:
        key_points.append(48.0)
    all_times = sorted(list(set(np.round(np.concatenate([times, key_points]), 2))))
    return [
        {
            "time_hours": float(t),
            "time_days": round(float(t) / 24.0, 2),
            "time_minutes": round(float(t) * 60.0, 1),
            "height": round(float(h0 * np.exp(-k * t * 60.0)), 3),
        }
        for t in all_times
    ]

@app.post("/stability")
async def stability(req: StabilityRequest):
    pH = req.pH
    t_hl, h1, h2 = half_life(pH)
    stability_class = "Highly stable" if t_hl is None else describe_stability(t_hl)

    if h2 >= h1:
        k = 0.0
        h0 = h1
        equation_hours = f"h(t) = {h0:.2f} cm (Constant / No Decay)"
        equation_days = f"h(t) = {h0:.2f} cm (Constant / No Decay)"
    else:
        k = float(np.log(h1 / h2) / (t2 - t1))
        h0 = float(h1 * np.exp(k * t1))
        k_hr = k * 60.0
        k_day = k * 1440.0
        equation_hours = f"h(t) = {h0:.2f} · e^(-{k_hr:.4f} · t)"
        equation_days = f"h(t) = {h0:.2f} · e^(-{k_day:.3f} · t)"

    # Compute exponential curves for multiple horizons:
    # 48 hours (experimental observation period)
    curve_48h = generate_curve_points(h0, k, max_hours=48.0, num_points=50)
    # 7 days (168 hours)
    curve_7d = generate_curve_points(h0, k, max_hours=168.0, num_points=70)
    # 14 days (336 hours)
    curve_14d = generate_curve_points(h0, k, max_hours=336.0, num_points=70)
    # Full horizon: 2x half-life or 30 days (max 720 hours = 30 days)
    full_horizon_hours = min(max(48.0, (t_hl / 60.0 * 2.0) if t_hl else 336.0), 720.0)
    curve_full = generate_curve_points(h0, k, max_hours=full_horizon_hours, num_points=80)

    experimental_points = [
        {
            "time_hours": 0.5,
            "time_days": round(0.5 / 24.0, 3),
            "time_minutes": 30.0,
            "time_label": "30 min (0.5 h)",
            "height": round(h1, 3),
        },
        {
            "time_hours": 48.0,
            "time_days": 2.0,
            "time_minutes": 2880.0,
            "time_label": "2 days (48 h)",
            "height": round(h2, 3),
        },
    ]

    half_life_hours = (t_hl / 60.0) if t_hl else None
    half_life_days = (t_hl / 1440.0) if t_hl else None

    return {
        "h1": h1,
        "h2": h2,
        "half_life": t_hl,
        "half_life_hours": half_life_hours,
        "half_life_days": half_life_days,
        "stability_class": stability_class,
        "highly_stable": t_hl is None,
        "decay_constant": k,
        "decay_constant_per_hour": k * 60.0,
        "decay_constant_per_day": k * 1440.0,
        "initial_height": round(h0, 3),
        "half_height": round(h0 / 2.0, 3),
        "equation_hours": equation_hours,
        "equation_days": equation_days,
        "curve": curve_48h,
        "curves": {
            "48h": curve_48h,
            "7d": curve_7d,
            "14d": curve_14d,
            "full": curve_full,
        },
        "full_horizon_hours": full_horizon_hours,
        "experimental_points": experimental_points,
    }

import uvicorn
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)