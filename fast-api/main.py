from fastapi import FastAPI, File, Form, HTTPException, UploadFile
import cv2
import numpy as np
import tempfile
import base64
import os
from sklearn.ensemble import GradientBoostingRegressor
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
    curve_48h = generate_curve_points(h0, k, max_hours=48.0, num_points=50)
    curve_7d = generate_curve_points(h0, k, max_hours=168.0, num_points=70)
    curve_14d = generate_curve_points(h0, k, max_hours=336.0, num_points=70)
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

# ---------------------------------------------------------------------------
# Multi-Parameter Comparative Stability Models & Route
# ---------------------------------------------------------------------------
class DataPoint(BaseModel):
    time: float
    height: float

class ParameterCondition(BaseModel):
    name: str
    points: list[DataPoint]

class MultiParameterRequest(BaseModel):
    parameter_name: str = "Homogenizer RPM"
    parameter_unit: str = "RPM"
    time_unit: str = "min"  # "min", "hours", "days"
    height_unit: str = "cm"  # "cm", "mm"
    conditions: list[ParameterCondition]

@app.post("/stability/multi-parameter")
async def stability_multi_parameter(req: MultiParameterRequest):
    time_unit = req.time_unit.lower().strip()
    multiplier = 1.0
    if time_unit in ["h", "hr", "hrs", "hour", "hours"]:
        multiplier = 60.0
    elif time_unit in ["d", "day", "days"]:
        multiplier = 1440.0

    series_results = []
    all_observed_hours = [0.5, 48.0]
    max_half_life_hours = 0.0

    for cond in req.conditions:
        valid_points = []
        for p in cond.points:
            t_val = float(p.time)
            h_val = float(p.height)
            if t_val >= 0 and h_val > 0:
                t_min = t_val * multiplier
                valid_points.append((t_min, t_val, h_val))
                all_observed_hours.append(t_min / 60.0)

        valid_points.sort(key=lambda x: x[0])

        if len(valid_points) < 2:
            h0 = valid_points[0][2] if valid_points else 0.0
            series_results.append({
                "name": cond.name,
                "initial_height": round(h0, 3),
                "final_height": round(h0, 3),
                "retention_pct": 100.0,
                "decay_constant": 0.0,
                "decay_constant_per_day": 0.0,
                "decay_constant_per_hour": 0.0,
                "half_life": None,
                "half_life_hours": None,
                "half_life_days": None,
                "stability_class": "Highly stable",
                "highly_stable": True,
                "r2": 1.0,
                "equation_days": f"h(t) = {h0:.2f} cm (Constant)",
                "experimental_points": [
                    {
                        "time_original": p[1],
                        "time_hours": round(p[0] / 60.0, 2),
                        "time_days": round(p[0] / 1440.0, 2),
                        "height": round(p[2], 3),
                    }
                    for p in valid_points
                ],
                "curves": {
                    "48h": generate_curve_points(h0, 0.0, 48.0, 40),
                    "7d": generate_curve_points(h0, 0.0, 168.0, 50),
                    "14d": generate_curve_points(h0, 0.0, 336.0, 50),
                    "full": generate_curve_points(h0, 0.0, 168.0, 50),
                }
            })
            continue

        t_min_arr = np.array([p[0] for p in valid_points])
        h_arr = np.array([p[2] for p in valid_points])

        if len(t_min_arr) == 2:
            if h_arr[1] >= h_arr[0]:
                k = 0.0
                h0 = float(h_arr[0])
                t_hl = None
                r2 = 1.0
            else:
                k = float(np.log(h_arr[0] / h_arr[1]) / (t_min_arr[1] - t_min_arr[0]))
                h0 = float(h_arr[0] * np.exp(k * t_min_arr[0]))
                t_hl = float(np.log(2) / k) if k > 0 else None
                r2 = 1.0
        else:
            ln_h = np.log(h_arr)
            slope, intercept = np.polyfit(t_min_arr, ln_h, 1)
            k = -slope
            h0 = float(np.exp(intercept))
            fit_ln = intercept + slope * t_min_arr
            ss_tot = np.sum((ln_h - np.mean(ln_h)) ** 2)
            ss_res = np.sum((ln_h - fit_ln) ** 2)
            r2 = max(0.0, min(1.0, 1.0 - (ss_res / ss_tot))) if ss_tot > 0 else 1.0

            if k <= 1e-7:
                k = 0.0
                h0 = float(np.mean(h_arr))
                t_hl = None
            else:
                t_hl = float(np.log(2) / k)

        k_day = k * 1440.0
        k_hr = k * 60.0
        hl_hours = (t_hl / 60.0) if t_hl else None
        hl_days = (t_hl / 1440.0) if t_hl else None
        if hl_hours and hl_hours > max_half_life_hours:
            max_half_life_hours = hl_hours

        stab_class = "Highly stable" if t_hl is None else describe_stability(t_hl)
        init_h = round(h0, 3)
        final_h = round(float(h_arr[-1]), 3)
        retention = round((final_h / init_h * 100.0), 1) if init_h > 0 else 0.0

        if t_hl is None or k <= 1e-7:
            eq_days = f"h(t) = {h0:.2f} cm (Constant / Highly stable)"
        else:
            eq_days = f"h(t) = {h0:.2f} · e^(-{k_day:.3f} · t)"

        full_hrs = min(max(48.0, (hl_hours * 2.0) if hl_hours else 336.0), 720.0)

        series_results.append({
            "name": cond.name,
            "initial_height": init_h,
            "final_height": final_h,
            "retention_pct": retention,
            "decay_constant": float(k),
            "decay_constant_per_hour": float(k_hr),
            "decay_constant_per_day": float(k_day),
            "half_life": float(t_hl) if t_hl else None,
            "half_life_hours": round(hl_hours, 2) if hl_hours else None,
            "half_life_days": round(hl_days, 2) if hl_days else None,
            "stability_class": stab_class,
            "highly_stable": t_hl is None,
            "r2": round(float(r2), 3),
            "equation_days": eq_days,
            "experimental_points": [
                {
                    "time_original": p[1],
                    "time_hours": round(p[0] / 60.0, 2),
                    "time_days": round(p[0] / 1440.0, 2),
                    "height": round(p[2], 3),
                }
                for p in valid_points
            ],
            "curves": {
                "48h": generate_curve_points(h0, k, 48.0, 50),
                "7d": generate_curve_points(h0, k, 168.0, 60),
                "14d": generate_curve_points(h0, k, 336.0, 60),
                "full": generate_curve_points(h0, k, full_hrs, 70),
            }
        })

    def rank_key(s):
        if s["highly_stable"]:
            return float("inf")
        return s["half_life_days"] or 0.0

    rankings = sorted(series_results, key=rank_key, reverse=True)
    best_condition = rankings[0]["name"] if rankings else None

    return {
        "parameter_name": req.parameter_name,
        "parameter_unit": req.parameter_unit,
        "time_unit": req.time_unit,
        "height_unit": req.height_unit,
        "series": series_results,
        "best_condition": best_condition,
        "max_observed_hours": max(all_observed_hours),
        "total_conditions": len(series_results),
    }

# ---------------------------------------------------------------------------
# 10. ML PREDICTED MICROSCOPIC IMAGE GENERATOR
# ---------------------------------------------------------------------------
def _build_ml_droplet_models():
    """Train GradientBoostingRegressor models on lab experimental RPM, Mixing Time, and pH data."""
    rpm_anchors = np.array([5000.0, 10000.0, 20000.0, 25000.0])
    dia_rpm_anchors = np.array([65.48, 33.06, 24.38, 23.53])
    std_rpm_anchors = np.array([14.69, 8.32, 11.49, 14.42])

    mix_anchors = np.array([1.0, 2.0, 3.0, 4.0])
    dia_mix_anchors = np.array([28.42, 20.53, 22.96, 22.91])
    std_mix_anchors = np.array([12.30, 8.14, 7.59, 10.55])

    X_rows = []
    y_mean = []
    y_std = []
    weights = []

    # Direct lab anchor observations from RPM_variation.png and mixing_time_variation.png
    for r_val, d_val, s_val in zip(rpm_anchors, dia_rpm_anchors, std_rpm_anchors):
        X_rows.append([r_val, 1.5, 7.0])
        y_mean.append(d_val)
        y_std.append(s_val)
        weights.append(12.0)

    for m_val, d_val, s_val in zip(mix_anchors, dia_mix_anchors, std_mix_anchors):
        X_rows.append([20000.0, m_val, 7.0])
        y_mean.append(d_val)
        y_std.append(s_val)
        weights.append(12.0)

    # Structured cross-parameter grid across RPM, Mixing Time, and pH
    rpm_grid = [3000.0, 5000.0, 7500.0, 10000.0, 15000.0, 20000.0, 25000.0]
    mix_grid = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]
    ph_grid = [1.5, 3.0, 5.0, 6.5, 7.0, 9.0, 11.5]

    for r_val in rpm_grid:
        r_clamped = float(np.clip(r_val, rpm_anchors[0], rpm_anchors[-1]))
        base_d = float(np.exp(np.interp(np.log(r_clamped), np.log(rpm_anchors), np.log(dia_rpm_anchors))))
        if r_val < rpm_anchors[0]:
            base_d *= (rpm_anchors[0] / max(r_val, 1000.0)) ** 0.45
        base_s = float(np.interp(r_clamped, rpm_anchors, std_rpm_anchors))

        for m_val in mix_grid:
            m_clamped = float(np.clip(m_val, mix_anchors[0], mix_anchors[-1]))
            mix_d_ratio = float(np.interp(m_clamped, mix_anchors, dia_mix_anchors)) / 24.475
            mix_s_ratio = float(np.interp(m_clamped, mix_anchors, std_mix_anchors)) / 10.22

            for ph_val in ph_grid:
                h1_i, h2_i = interpolated_heights(ph_val)
                retention = np.clip(h2_i / max(h1_i, 1e-6), 0.5, 1.0)
                coalescence_factor = 1.0 + 0.72 * (1.0 - retention)
                pdi_ph_boost = 1.0 + 0.90 * (1.0 - retention)

                d_est = float(np.clip(base_d * mix_d_ratio * coalescence_factor, 12.0, 120.0))
                s_est = float(np.clip(base_s * mix_s_ratio * pdi_ph_boost, 2.5, 55.0))

                X_rows.append([r_val, m_val, ph_val])
                y_mean.append(d_est)
                y_std.append(s_est)
                weights.append(1.0)

    X_arr = np.array(X_rows, dtype=np.float64)
    y_mean_arr = np.array(y_mean, dtype=np.float64)
    y_std_arr = np.array(y_std, dtype=np.float64)
    w_arr = np.array(weights, dtype=np.float64)

    mean_model = GradientBoostingRegressor(
        n_estimators=180, learning_rate=0.06, max_depth=4, random_state=42
    )
    std_model = GradientBoostingRegressor(
        n_estimators=180, learning_rate=0.06, max_depth=4, random_state=42
    )
    mean_model.fit(X_arr, y_mean_arr, sample_weight=w_arr)
    std_model.fit(X_arr, y_std_arr, sample_weight=w_arr)
    return mean_model, std_model


ML_MEAN_MODEL, ML_STD_MODEL = _build_ml_droplet_models()


def render_synthetic_micrograph(
    target_mean_px: float,
    target_pdi: float,
    rpm: float = 10000.0,
    mixing_time: float = 2.0,
    ph: float = 7.0,
    width: int = 1265,
    height: int = 902,
    seed: int = 42,
) -> tuple[np.ndarray, str, str]:
    """Generate a synthetic grayscale micrograph with bright droplets and save it automatically to project folders."""
    width = int(np.clip(width, 320, 1600))
    height = int(np.clip(height, 240, 1200))
    mean_px = float(np.clip(target_mean_px, 8.0, min(width, height) * 0.25))
    pdi = float(np.clip(target_pdi, 0.005, 1.2))

    rng = np.random.default_rng(int(seed))

    # Choose droplet count so total area stays packable (~32% coverage) without merging droplets
    approx_single_area = np.pi * ((mean_px / 2.0) ** 2) * (1.0 + min(pdi, 0.6))
    n_droplets = int(np.clip((0.32 * width * height) / max(approx_single_area, 1.0), 24, 240))

    # Calibrate finite-sample log-normal draws to match both target_mean_px and target_pdi
    z = rng.standard_normal(n_droplets)
    z = (z - np.mean(z)) / max(float(np.std(z)), 1e-6)
    sigma_ln = float(np.sqrt(np.log(1.0 + pdi)))
    for _ in range(8):
        raw = np.exp(sigma_ln * z)
        dias = np.clip(raw * (mean_px / np.mean(raw)), 5.0, min(width, height) * 0.34)
        cur_pdi = float((np.std(dias) / np.mean(dias)) ** 2)
        if cur_pdi > 1e-6:
            sigma_ln *= float(np.sqrt(pdi / cur_pdi))
            sigma_ln = float(np.clip(sigma_ln, 0.03, 1.35))

    raw = np.exp(sigma_ln * z)
    dias = np.clip(raw * (mean_px / np.mean(raw)), 5.0, min(width, height) * 0.34)
    dias = dias * (mean_px / np.mean(dias))
    dias_sorted = np.sort(dias)[::-1]

    # Place largest droplets first so large droplets are never rejected disproportionately
    placed = []
    gap = 4.5
    for d in dias_sorted:
        r = float(d) / 2.0
        margin = r + 4.0
        if margin * 2 >= width or margin * 2 >= height:
            continue
        for _ in range(450):
            cx = float(rng.uniform(margin, width - margin))
            cy = float(rng.uniform(margin, height - margin))
            collision = False
            for px, py, pr in placed:
                if (cx - px) ** 2 + (cy - py) ** 2 < (r + pr + gap) ** 2:
                    collision = True
                    break
            if not collision:
                placed.append((cx, cy, r))
                break

    # Dark microscopy background with subtle sensor noise
    img = rng.normal(18.0, 2.0, (height, width)).clip(10, 26).astype(np.uint8)

    # Render bright spherical droplets (intensity >= 148 inside r so Otsu cleanly recovers exact radius)
    for cx, cy, r in placed:
        x0 = max(0, int(np.floor(cx - r - 1)))
        x1 = min(width, int(np.ceil(cx + r + 2)))
        y0 = max(0, int(np.floor(cy - r - 1)))
        y1 = min(height, int(np.ceil(cy + r + 2)))

        yy, xx = np.ogrid[y0:y1, x0:x1]
        dist_sq = (xx - cx) ** 2 + (yy - cy) ** 2
        inside = dist_sq <= (r ** 2)

        hl_sq = (xx - (cx - 0.18 * r)) ** 2 + (yy - (cy - 0.18 * r)) ** 2
        norm_profile = np.sqrt(np.maximum(0.0, 1.0 - dist_sq / max(r ** 2, 1e-6)))
        spec_boost = 14.0 * np.exp(-hl_sq / max(0.35 * (r ** 2), 1.0))
        sphere_vals = np.clip(148.0 + 92.0 * norm_profile + spec_boost, 148.0, 252.0).astype(np.uint8)

        patch = img[y0:y1, x0:x1]
        patch[inside] = np.maximum(patch[inside], sphere_vals[inside])

    # Automatically save to project root AND generated_ml_images/ folder
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root_saved_path = os.path.join(project_root, "expected_microscopic_image.png")
    cv2.imwrite(root_saved_path, img)

    gen_dir = os.path.join(project_root, "generated_ml_images")
    os.makedirs(gen_dir, exist_ok=True)
    param_filename = f"ml_rpm{int(round(rpm))}_mix{mixing_time:g}min_ph{ph:g}.png"
    folder_saved_path = os.path.join(gen_dir, param_filename)
    cv2.imwrite(folder_saved_path, img)

    return img, root_saved_path, folder_saved_path


class GenerateMLImageRequest(BaseModel):
    rpm: float = 10000.0
    mixing_time: float = 2.0
    ph: float = 7.0
    scale_um_per_px: float = 0.5
    width: int = 1265
    height: int = 902
    seed: int = 42


@app.post("/generate-ml-image")
async def generate_ml_image(req: GenerateMLImageRequest):
    if req.scale_um_per_px <= 0:
        raise HTTPException(status_code=400, detail="Scale (µm/pixel) must be greater than 0.")

    features = np.array([[req.rpm, req.mixing_time, req.ph]], dtype=np.float64)
    pred_mean_um = float(np.clip(ML_MEAN_MODEL.predict(features)[0], 8.0, 140.0))
    pred_std_um = float(np.clip(ML_STD_MODEL.predict(features)[0], 2.0, 70.0))

    target_mean_px = pred_mean_um / req.scale_um_per_px
    target_std_px = pred_std_um / req.scale_um_per_px
    target_pdi = float((target_std_px / max(target_mean_px, 1e-6)) ** 2)

    img, root_saved_path, folder_saved_path = render_synthetic_micrograph(
        target_mean_px=target_mean_px,
        target_pdi=target_pdi,
        rpm=req.rpm,
        mixing_time=req.mixing_time,
        ph=req.ph,
        width=req.width,
        height=req.height,
        seed=req.seed,
    )

    _, buf = cv2.imencode(".png", img)
    img_b64 = base64.b64encode(buf).decode("utf-8")

    extracted_sizes = extract_diameters(root_saved_path, invert=False)
    extracted_pdi = calculate_pdi(extracted_sizes)

    return {
        "rpm": req.rpm,
        "mixing_time": req.mixing_time,
        "ph": req.ph,
        "scale_um_per_px": req.scale_um_per_px,
        "predicted_mean_um": round(pred_mean_um, 2),
        "predicted_std_um": round(pred_std_um, 2),
        "target_mean_px": round(target_mean_px, 2),
        "target_pdi": round(target_pdi, 4),
        "extracted_count": int(len(extracted_sizes)),
        "extracted_mean_px": round(float(np.mean(extracted_sizes)), 2) if len(extracted_sizes) else 0.0,
        "extracted_pdi": round(float(extracted_pdi), 4) if not np.isnan(extracted_pdi) else None,
        "saved_root_path": root_saved_path,
        "saved_folder_path": folder_saved_path,
        "saved_filename": os.path.basename(folder_saved_path),
        "predicted_image": img_b64,
    }


# ---------------------------------------------------------------------------
# ACTUAL VS PREDICTED IMAGE COMPARISON
# ---------------------------------------------------------------------------
def extract_diameters(image_path, invert=False):
    img = cv2.imread(
        image_path,
        cv2.IMREAD_GRAYSCALE
    )

    if img is None:
        raise ValueError("Image not found or invalid image format: " + image_path)

    # Otsu thresholding
    threshold_type = (
        cv2.THRESH_BINARY_INV
        if invert else cv2.THRESH_BINARY
    )

    _, binary = cv2.threshold(
        img,
        0,
        255,
        threshold_type + cv2.THRESH_OTSU
    )

    # Remove small noise
    kernel = np.ones((3, 3), np.uint8)

    binary = cv2.morphologyEx(
        binary,
        cv2.MORPH_OPEN,
        kernel
    )

    count, labels, stats, centroids = (
        cv2.connectedComponentsWithStats(binary)
    )

    diameters = []

    for i in range(1, count):
        area = stats[i, cv2.CC_STAT_AREA]
        if area > 8:
            diameter = np.sqrt(
                4 * area / np.pi
            )
            diameters.append(diameter)

    return np.array(diameters)


def calculate_pdi(diameters):
    if len(diameters) < 2:
        return np.nan

    return (
        np.std(diameters) /
        np.mean(diameters)
    ) ** 2


def encode_comparison_views(image_path, invert=False):
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Image not found or invalid image format: " + image_path)

    threshold_type = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
    _, binary = cv2.threshold(img, 0, 255, threshold_type + cv2.THRESH_OTSU)
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    _, gray_buf = cv2.imencode(".png", img)
    _, bin_buf = cv2.imencode(".png", binary)
    return (
        base64.b64encode(gray_buf).decode("utf-8"),
        base64.b64encode(bin_buf).decode("utf-8"),
    )


@app.post("/compare-images")
async def compare_images(
    actual_file: UploadFile = File(...),
    predicted_file: UploadFile = File(...),
    invert_actual: bool = Form(False),
    invert_predicted: bool = Form(False),
):
    actual_temp_path = None
    predicted_temp_path = None
    try:
        actual_ext = os.path.splitext(actual_file.filename or "")[1] or ".png"
        predicted_ext = os.path.splitext(predicted_file.filename or "")[1] or ".png"

        with tempfile.NamedTemporaryFile(delete=False, suffix=actual_ext) as actual_temp:
            actual_temp.write(await actual_file.read())
            actual_temp_path = actual_temp.name

        with tempfile.NamedTemporaryFile(delete=False, suffix=predicted_ext) as predicted_temp:
            predicted_temp.write(await predicted_file.read())
            predicted_temp_path = predicted_temp.name

        try:
            actual_sizes = extract_diameters(actual_temp_path, invert=invert_actual)
            predicted_sizes = extract_diameters(predicted_temp_path, invert=invert_predicted)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if len(actual_sizes) == 0:
            raise HTTPException(
                status_code=400,
                detail="No droplets were detected in the Actual Microscopic Image. Try enabling 'Dark droplets on a bright background'.",
            )
        if len(predicted_sizes) == 0:
            raise HTTPException(
                status_code=400,
                detail="No droplets were detected in the ML Predicted Image. Try enabling 'Dark droplets on a bright background'.",
            )

        actual_pdi = calculate_pdi(actual_sizes)
        predicted_pdi = calculate_pdi(predicted_sizes)

        actual_mean = float(np.mean(actual_sizes))
        predicted_mean = float(np.mean(predicted_sizes))

        actual_pdi_val = None if np.isnan(actual_pdi) else float(actual_pdi)
        predicted_pdi_val = None if np.isnan(predicted_pdi) else float(predicted_pdi)
        pdi_diff_val = (
            abs(actual_pdi_val - predicted_pdi_val)
            if (actual_pdi_val is not None and predicted_pdi_val is not None)
            else None
        )

        actual_gray_b64, actual_bin_b64 = encode_comparison_views(actual_temp_path, invert=invert_actual)
        predicted_gray_b64, predicted_bin_b64 = encode_comparison_views(predicted_temp_path, invert=invert_predicted)

        combined_sizes = np.concatenate([actual_sizes, predicted_sizes])
        _, bin_edges = np.histogram(combined_sizes, bins=15)
        actual_hist_counts, _ = np.histogram(actual_sizes, bins=bin_edges)
        predicted_hist_counts, _ = np.histogram(predicted_sizes, bins=bin_edges)

        actual_hist_pct = [
            round(float(c) / len(actual_sizes) * 100.0, 2) for c in actual_hist_counts
        ]
        predicted_hist_pct = [
            round(float(c) / len(predicted_sizes) * 100.0, 2) for c in predicted_hist_counts
        ]

        return {
            "actual_pdi": actual_pdi_val,
            "predicted_pdi": predicted_pdi_val,
            "pdi_difference": pdi_diff_val,
            "actual_mean": actual_mean,
            "predicted_mean": predicted_mean,
            "mean_difference": abs(actual_mean - predicted_mean),
            "actual_std": float(np.std(actual_sizes)),
            "predicted_std": float(np.std(predicted_sizes)),
            "actual_count": int(len(actual_sizes)),
            "predicted_count": int(len(predicted_sizes)),
            "invert_actual": invert_actual,
            "invert_predicted": invert_predicted,
            "actual_image": actual_gray_b64,
            "predicted_image": predicted_gray_b64,
            "actual_binary_image": actual_bin_b64,
            "predicted_binary_image": predicted_bin_b64,
            "bin_edges": [float(b) for b in bin_edges],
            "actual_hist_counts": actual_hist_counts.tolist(),
            "predicted_hist_counts": predicted_hist_counts.tolist(),
            "actual_hist_pct": actual_hist_pct,
            "predicted_hist_pct": predicted_hist_pct,
        }
    finally:
        if actual_temp_path and os.path.exists(actual_temp_path):
            os.remove(actual_temp_path)
        if predicted_temp_path and os.path.exists(predicted_temp_path):
            os.remove(predicted_temp_path)


import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
