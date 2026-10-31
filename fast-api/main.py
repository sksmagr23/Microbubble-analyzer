from fastapi import FastAPI, File, Form, HTTPException, UploadFile
import cv2
import numpy as np
import tempfile
import base64
import re
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
# Stability Model (Single pH Reference)
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
# Interfacial Tension Physics & Synthetic Optical Micrograph Engine
# ---------------------------------------------------------------------------
def extract_numeric_value(name: str, explicit_val: float | None, fallback_idx: int) -> float:
    if explicit_val is not None and not np.isnan(explicit_val):
        return float(explicit_val)
    match = re.search(r"[-+]?\d*\.?\d+", name or "")
    if match:
        try:
            return float(match.group(0))
        except ValueError:
            pass
    return float(fallback_idx)


def get_time_multiplier(time_unit: str) -> float:
    tu = (time_unit or "min").lower().strip()
    if tu in ["h", "hr", "hrs", "hour", "hours"]:
        return 60.0
    if tu in ["d", "day", "days"]:
        return 1440.0
    return 1.0


def is_rpm_parameter(param_name: str, param_unit: str) -> bool:
    combined = f"{param_name or ''} {param_unit or ''}".lower()
    return "rpm" in combined or "speed" in combined or "rotation" in combined


def fit_kinetic_series(valid_points: list[tuple[float, float, float]], height_unit: str = "cm") -> dict:
    """Fit first-order exponential decay h(t) = h0 * exp(-k * t) to sorted (t_min, t_orig, height) tuples."""
    if len(valid_points) < 2:
        h0 = float(valid_points[0][2]) if valid_points else 0.0
        return {
            "initial_height": round(h0, 3),
            "final_height": round(h0, 3),
            "half_height": round(h0 / 2.0, 3),
            "retention_pct": 100.0,
            "decay_constant": 0.0,
            "decay_constant_per_hour": 0.0,
            "decay_constant_per_day": 0.0,
            "half_life": None,
            "half_life_hours": None,
            "half_life_days": None,
            "stability_class": "Highly stable",
            "highly_stable": True,
            "r2": 1.0,
            "equation_hours": f"h(t) = {h0:.2f} {height_unit} (Constant)",
            "equation_days": f"h(t) = {h0:.2f} {height_unit} (Constant)",
            "full_horizon_hours": 168.0,
            "curves": {
                "48h": generate_curve_points(h0, 0.0, 48.0, 40),
                "7d": generate_curve_points(h0, 0.0, 168.0, 50),
                "14d": generate_curve_points(h0, 0.0, 336.0, 50),
                "full": generate_curve_points(h0, 0.0, 168.0, 50),
            },
        }

    t_min_arr = np.array([p[0] for p in valid_points], dtype=np.float64)
    h_arr = np.array([p[2] for p in valid_points], dtype=np.float64)

    if len(t_min_arr) == 2:
        dt = t_min_arr[1] - t_min_arr[0]
        if h_arr[1] >= h_arr[0] or dt <= 0:
            k = 0.0
            h0 = float(h_arr[0])
            t_hl = None
            r2 = 1.0
        else:
            k = float(np.log(h_arr[0] / h_arr[1]) / dt)
            h0 = float(h_arr[0] * np.exp(k * t_min_arr[0]))
            t_hl = float(np.log(2) / k) if k > 0 else None
            r2 = 1.0
    else:
        ln_h = np.log(h_arr)
        slope, intercept = np.polyfit(t_min_arr, ln_h, 1)
        k = float(-slope)
        h0 = float(np.exp(intercept))
        fit_ln = intercept + slope * t_min_arr
        ss_tot = float(np.sum((ln_h - np.mean(ln_h)) ** 2))
        ss_res = float(np.sum((ln_h - fit_ln) ** 2))
        r2 = max(0.0, min(1.0, 1.0 - (ss_res / ss_tot))) if ss_tot > 0 else 1.0

        if k <= 1e-7:
            k = 0.0
            h0 = float(np.mean(h_arr))
            t_hl = None
        else:
            t_hl = float(np.log(2) / k)

    k_hr = k * 60.0
    k_day = k * 1440.0
    hl_hours = (t_hl / 60.0) if t_hl else None
    hl_days = (t_hl / 1440.0) if t_hl else None
    stab_class = "Highly stable" if t_hl is None else describe_stability(t_hl)

    init_h = round(h0, 3)
    final_h = round(float(h_arr[-1]), 3)
    retention = round((final_h / init_h * 100.0), 1) if init_h > 0 else 0.0

    if t_hl is None or k <= 1e-7:
        eq_hours = f"h(t) = {h0:.2f} {height_unit} (Constant / Highly stable)"
        eq_days = f"h(t) = {h0:.2f} {height_unit} (Constant / Highly stable)"
    else:
        eq_hours = f"h(t) = {h0:.2f} · e^(-{k_hr:.4f} · t)"
        eq_days = f"h(t) = {h0:.2f} · e^(-{k_day:.3f} · t)"

    full_hrs = min(max(48.0, (hl_hours * 2.0) if hl_hours else 336.0), 720.0)

    return {
        "initial_height": init_h,
        "final_height": final_h,
        "half_height": round(h0 / 2.0, 3),
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
        "equation_hours": eq_hours,
        "equation_days": eq_days,
        "full_horizon_hours": full_hrs,
        "curves": {
            "48h": generate_curve_points(h0, k, 48.0, 50),
            "7d": generate_curve_points(h0, k, 168.0, 60),
            "14d": generate_curve_points(h0, k, 336.0, 60),
            "full": generate_curve_points(h0, k, full_hrs, 70),
        },
    }


def compute_interfacial_tension(
    avg_dia_um: float,
    effective_rpm: float,
    rotor_diameter_mm: float = 12.7,
    density_kg_m3: float = 1000.0,
    d_floor_um: float = 14.5,
    c_hk: float = 0.18,
) -> dict:
    """
    Calculate effective interfacial tension (gamma, mN/m), Laplace pressure (kPa),
    and turbulent Weber number using the modified Hinze-Kolmogorov rotor-stator breakup model:
        d - d_inf = C_HK * D^(-4/5) * (gamma / rho_c)^(3/5) * N^(-6/5)
    """
    rpm_safe = max(float(effective_rpm), 300.0)
    n_rps = rpm_safe / 60.0
    d_rotor_m = max(float(rotor_diameter_mm), 2.0) * 1e-3
    rho = max(float(density_kg_m3), 200.0)
    d_um_safe = max(float(avg_dia_um), 5.0)

    # Smooth softplus breakup excess above viscous/coalescence floor d_floor_um
    delta_s = 2.5
    x_soft = (d_um_safe - d_floor_um) / delta_s
    if x_soft > 30.0:
        d_eff_um = d_um_safe - d_floor_um
    else:
        d_eff_um = delta_s * float(np.log1p(np.exp(x_soft)))

    d_eff_m = d_eff_um * 1e-6
    numerator = d_eff_m * (n_rps ** 1.2)
    denom = c_hk * (d_rotor_m ** -0.8)
    gamma_n_m = rho * ((numerator / denom) ** (5.0 / 3.0))
    # Clamp to physically realistic gas/oil-water interfacial tension bounds (0.5 .. 75 mN/m)
    gamma_n_m = float(np.clip(gamma_n_m, 0.0005, 0.075))
    gamma_mn_m = gamma_n_m * 1000.0

    # Young-Laplace internal capillary pressure: Delta P = 4 * gamma / d
    d_m = d_um_safe * 1e-6
    laplace_pa = 4.0 * gamma_n_m / d_m
    laplace_kpa = laplace_pa / 1000.0

    # Rotor-stator Weber number: We = rho * N^2 * D^3 / gamma
    weber = (rho * (n_rps ** 2) * (d_rotor_m ** 3)) / max(gamma_n_m, 1e-6)
    # Turbulent energy dissipation rate in rotor tip zone: eps ~ 0.4 * N^3 * D^2
    eps_w_kg = 0.4 * (n_rps ** 3) * (d_rotor_m ** 2)

    return {
        "interfacial_tension_mN_m": round(gamma_mn_m, 2),
        "interfacial_tension_N_m": round(gamma_n_m, 5),
        "laplace_pressure_kPa": round(laplace_kpa, 2),
        "weber_number": round(float(weber), 1),
        "energy_dissipation_W_kg": round(float(eps_w_kg), 1),
        "effective_rpm": round(rpm_safe, 0),
        "rotor_diameter_mm": round(float(rotor_diameter_mm), 2),
        "density_kg_m3": round(rho, 1),
    }


def render_bubble_patch(radius_px: int, rng: np.random.Generator, thick_rim: bool = False):
    """Render a realistic brightfield optical microbubble patch (BGR + alpha mask)."""
    pad = 2
    size = 2 * (radius_px + pad) + 1
    cy = cx = radius_px + pad
    yy, xx = np.ogrid[:size, :size]
    dx = (xx - cx) / max(radius_px, 1.0)
    dy = (yy - cy) / max(radius_px, 1.0)
    r = np.sqrt(dx * dx + dy * dy)

    light_dx = dx + 0.14
    light_dy = dy + 0.14
    r_light = np.sqrt(light_dx * light_dx + light_dy * light_dy)

    patch = np.zeros((size, size, 3), dtype=np.float32)
    alpha = np.zeros((size, size), dtype=np.float32)

    inside = r <= 1.06
    rim_start = 0.66 if thick_rim else (0.74 if radius_px < 10 else 0.79)
    rim_min = rng.uniform(16.0, 30.0) if thick_rim else rng.uniform(24.0, 44.0)
    core_peak = rng.uniform(245.0, 255.0)

    intensity = np.zeros_like(r, dtype=np.float32)
    core_mask = r < rim_start
    t_core = np.clip(r[core_mask] / rim_start, 0.0, 1.0)
    intensity[core_mask] = core_peak - (core_peak - 135.0) * (t_core ** 3.2)

    caustic = np.exp(-(r_light ** 2) / 0.35) * 14.0
    intensity = np.clip(intensity + caustic, 0.0, 255.0)

    rim_mask = (r >= rim_start) & (r <= 0.97)
    t_rim = (r[rim_mask] - rim_start) / max(0.97 - rim_start, 1e-4)
    dip = np.sin(np.clip(t_rim, 0.0, 1.0) * np.pi * 0.90)
    base_rim = 135.0 * (1.0 - t_rim) + 52.0 * t_rim
    intensity[rim_mask] = base_rim - (base_rim - rim_min) * (dip ** 0.75)

    edge_mask = (r > 0.97) & inside
    t_edge = (r[edge_mask] - 0.97) / 0.09
    intensity[edge_mask] = 52.0 * (1.0 - t_edge) + 205.0 * t_edge

    # Subtle optical chromatic dispersion at meniscus (matching brightfield objective refraction)
    disp_strength = (5.0 if radius_px < 10 else 13.0) * np.exp(-((r - 0.87) ** 2) / 0.012)
    angle_proj = 0.72 * dx + 0.69 * dy
    b_shift = disp_strength * (0.55 - 0.85 * angle_proj)
    g_shift = disp_strength * (-0.28 + 0.25 * angle_proj)
    r_shift = disp_strength * (0.38 + 0.65 * angle_proj)

    patch[..., 0] = np.clip(intensity + b_shift, 0.0, 255.0)
    patch[..., 1] = np.clip(intensity + g_shift, 0.0, 255.0)
    patch[..., 2] = np.clip(intensity + r_shift, 0.0, 255.0)

    alpha[r <= 0.97] = 1.0
    aa_zone = (r > 0.97) & (r <= 1.06)
    alpha[aa_zone] = np.clip(1.0 - (r[aa_zone] - 0.97) / 0.09, 0.0, 1.0)

    return patch, alpha


def generate_synthetic_micrograph(avg_dia_um: float, std_dia_um: float, seed: int | None = None) -> dict:
    """
    Synthesize a calibrated 10x brightfield optical micrograph matching target avg_dia_um +/- std_dia_um,
    including packed/flocculated spatial morphology and 100 um calibration scale bar.
    """
    if seed is None:
        seed = int(round(avg_dia_um * 137 + std_dia_um * 53)) % 999983
    rng = np.random.default_rng(seed)

    H, W = 440, 660
    scale_um_per_px = 1.65  # 10x objective: FOV = 1089 x 726 um

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xx - W * 0.55) / (W * 0.72)
    ny = (yy - H * 0.46) / (H * 0.72)
    vignette = 1.0 - 0.055 * (nx * nx + ny * ny)
    canvas = np.zeros((H, W, 3), dtype=np.float32)
    canvas[..., 0] = 235.0 * vignette
    canvas[..., 1] = 234.0 * vignette
    canvas[..., 2] = 232.0 * vignette

    floc_strength = float(np.clip((35.0 - avg_dia_um) / 13.0, 0.0, 1.0))

    density_map = np.ones((H, W), dtype=np.float32)
    if floc_strength > 0.12:
        coarse_noise = rng.normal(0.0, 1.0, (H // 22, W // 22)).astype(np.float32)
        coarse_field = cv2.resize(coarse_noise, (W, H), interpolation=cv2.INTER_CUBIC)
        coarse_field = cv2.GaussianBlur(coarse_field, (0, 0), 26.0)
        coarse_field = (coarse_field - coarse_field.min()) / max(coarse_field.max() - coarse_field.min(), 1e-5)

        fine_noise = rng.normal(0.0, 1.0, (H // 7, W // 7)).astype(np.float32)
        fine_field = cv2.resize(fine_noise, (W, H), interpolation=cv2.INTER_CUBIC)
        fine_field = (fine_field - fine_field.min()) / max(fine_field.max() - fine_field.min(), 1e-5)

        cluster_mask = np.clip(0.70 * coarse_field + 0.30 * fine_field, 0.0, 1.0)
        density_map = (1.0 - floc_strength) * 1.0 + floc_strength * np.where(
            cluster_mask > 0.30, cluster_mask ** 1.4, 0.015
        )

        if floc_strength > 0.30:
            core_zone = np.clip((cluster_mask - 0.38) / 0.48, 0.0, 1.0) * floc_strength
            grain1 = cv2.resize(rng.normal(0.0, 1.0, (H // 2, W // 2)).astype(np.float32), (W, H))
            grain2 = cv2.resize(rng.normal(0.0, 1.0, (H // 5, W // 5)).astype(np.float32), (W, H))
            speckle = np.clip(104.0 + 28.0 * grain1 + 22.0 * grain2, 48.0, 205.0)
            blend = 0.78 * (core_zone ** 1.15)
            for c in range(3):
                tint = -2.0 if c == 0 else (2.0 if c == 2 else 0.0)
                canvas[..., c] = canvas[..., c] * (1.0 - blend) + (speckle + tint) * blend

            n_micro = int(950 * floc_strength)
            flat_prob = (core_zone ** 1.2).ravel().astype(np.float64)
            prob_sum = flat_prob.sum()
            if prob_sum > 0:
                cdf_micro = np.cumsum(flat_prob / prob_sum)
                chosen_idx = np.searchsorted(cdf_micro, rng.random(size=n_micro))
                chosen_idx = np.clip(chosen_idx, 0, H * W - 1)
                for idx in chosen_idx:
                    my, mx = divmod(int(idx), W)
                    mr = int(rng.integers(2, 5))
                    cv2.circle(canvas, (mx, my), mr, (62, 64, 66), -1, lineType=cv2.LINE_AA)
                    if mr >= 3:
                        cv2.circle(canvas, (mx, my), mr - 1, (228, 229, 231), -1, lineType=cv2.LINE_AA)

    elif avg_dia_um < 46.0:
        wave = 34.0 + 18.0 * np.sin(np.linspace(0, 2.8 * np.pi, W) + rng.uniform(0, 3.14))
        for x in range(W):
            density_map[: int(max(0, wave[x])), x] = 0.01

    if avg_dia_um >= 45.0:
        target_coverage = 0.76
    elif avg_dia_um >= 30.0:
        target_coverage = 0.68
    else:
        target_coverage = 0.46

    cv_ratio = float(np.clip(std_dia_um / max(avg_dia_um, 1.0), 0.10, 0.65))
    sigma_ln = np.sqrt(np.log(1.0 + cv_ratio * cv_ratio))
    mu_ln = np.log(max(avg_dia_um, 6.0)) - 0.5 * sigma_ln * sigma_ln

    mean_d2_um2 = avg_dia_um ** 2 + std_dia_um ** 2
    mean_area_px = np.pi * 0.25 * (mean_d2_um2 / (scale_um_per_px ** 2))
    target_n = int(np.clip((H * W * target_coverage) / max(mean_area_px, 16.0), 90, 500))

    raw_dias_um = rng.lognormal(mean=mu_ln, sigma=sigma_ln, size=target_n)
    raw_dias_um = np.clip(raw_dias_um, max(8.0, avg_dia_um * 0.28), min(145.0, avg_dia_um + 3.2 * std_dia_um))
    if len(raw_dias_um) > 5 and np.std(raw_dias_um) > 1e-3:
        raw_dias_um = (raw_dias_um - np.mean(raw_dias_um)) * (std_dia_um / np.std(raw_dias_um)) + avg_dia_um
        raw_dias_um = np.clip(raw_dias_um, 8.5, 145.0)

    batch_dias_um = np.sort(raw_dias_um)[::-1]

    # Precompute CDF once for fast O(log N) vectorized candidate sampling (~40x faster!)
    flat_weights = np.maximum(density_map.ravel().astype(np.float64), 1e-5)
    cdf = np.cumsum(flat_weights / flat_weights.sum())
    n_cand = 85
    all_rand = rng.random(size=(len(batch_dias_um), n_cand))
    all_cand_indices = np.clip(np.searchsorted(cdf, all_rand), 0, H * W - 1)

    placed_x = np.empty(0, dtype=np.float32)
    placed_y = np.empty(0, dtype=np.float32)
    placed_r = np.empty(0, dtype=np.float32)
    placed_dias_um = []

    for b_idx, d_um in enumerate(batch_dias_um):
        r_px = float((d_um / scale_um_per_px) * 0.5)
        if r_px < 2.5:
            continue

        cand_indices = all_cand_indices[b_idx]
        cand_y, cand_x = np.divmod(cand_indices, W)
        cand_x = cand_x.astype(np.float32)
        cand_y = cand_y.astype(np.float32)

        placed = False
        if len(placed_x) == 0:
            cx, cy = float(cand_x[0]), float(cand_y[0])
            placed = True
        else:
            dx_mat = cand_x[:, None] - placed_x[None, :]
            dy_mat = cand_y[:, None] - placed_y[None, :]
            dist_mat = np.sqrt(dx_mat * dx_mat + dy_mat * dy_mat)
            overlap_mat = (r_px + placed_r[None, :]) * 0.92 - dist_mat
            max_overlaps = overlap_mat.max(axis=1)

            valid_mask = max_overlaps <= 0.0
            if np.any(valid_mask):
                nearest_gap = -max_overlaps[valid_mask]
                best_local = (
                    int(np.argmin(nearest_gap))
                    if rng.random() < 0.84
                    else int(rng.integers(0, int(np.sum(valid_mask))))
                )
                valid_indices = np.flatnonzero(valid_mask)
                chosen = valid_indices[best_local]
                cx, cy = float(cand_x[chosen]), float(cand_y[chosen])
                placed = True

        if placed:
            placed_x = np.append(placed_x, cx)
            placed_y = np.append(placed_y, cy)
            placed_r = np.append(placed_r, r_px)
            placed_dias_um.append(float(d_um))

    order = np.argsort(placed_r)
    for idx in order:
        cx, cy = int(round(placed_x[idx])), int(round(placed_y[idx]))
        r_px = max(3, int(round(placed_r[idx])))
        thick = (r_px > (avg_dia_um / scale_um_per_px) * 1.15) and (avg_dia_um < 38.0)
        patch, alpha = render_bubble_patch(r_px, rng, thick_rim=thick)
        ph, pw = patch.shape[:2]
        y0, x0 = cy - ph // 2, cx - pw // 2
        y1, x1 = y0 + ph, x0 + pw

        cy0, cy1 = max(0, y0), min(H, y1)
        cx0, cx1 = max(0, x0), min(W, x1)
        if cy0 >= cy1 or cx0 >= cx1:
            continue
        py0, py1 = cy0 - y0, ph - (y1 - cy1)
        px0, px1 = cx0 - x0, pw - (x1 - cx1)

        a = alpha[py0:py1, px0:px1, None]
        canvas[cy0:cy1, cx0:cx1] = canvas[cy0:cy1, cx0:cx1] * (1.0 - a) + patch[py0:py1, px0:px1] * a

    canvas = cv2.GaussianBlur(canvas, (3, 3), 0.55)
    sensor_noise = rng.normal(0.0, 2.0, canvas.shape).astype(np.float32)
    canvas = np.clip(canvas + sensor_noise, 0, 255).astype(np.uint8)

    # Yellow 100 um calibration scale bar at bottom-right matching lab micrographs
    bar_um = 100.0
    bar_px = int(round(bar_um / scale_um_per_px))
    bx1 = W - 36
    bx0 = bx1 - bar_px
    by = H - 26
    cv2.line(canvas, (bx0, by), (bx1, by), (25, 212, 242), 2, lineType=cv2.LINE_AA)

    _, buffer = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 93])
    img_b64 = base64.b64encode(buffer).decode("utf-8")

    hist_counts, bin_edges = (
        np.histogram(placed_dias_um, bins=14)
        if placed_dias_um
        else (np.zeros(14, dtype=int), np.linspace(0, 50, 15))
    )

    return {
        "image": img_b64,
        "scale_um_per_px": scale_um_per_px,
        "scale_bar_um": bar_um,
        "fov_width_um": round(W * scale_um_per_px, 1),
        "fov_height_um": round(H * scale_um_per_px, 1),
        "simulated_count": len(placed_dias_um),
        "simulated_avg_um": round(float(np.mean(placed_dias_um)), 2) if placed_dias_um else round(avg_dia_um, 2),
        "simulated_std_um": round(float(np.std(placed_dias_um)), 2) if placed_dias_um else round(std_dia_um, 2),
        "hist_counts": hist_counts.tolist(),
        "bin_edges": [round(float(b), 2) for b in bin_edges.tolist()],
    }


# ---------------------------------------------------------------------------
# Multi-Parameter Comparative Stability & Data-Fed Predictive Models
# ---------------------------------------------------------------------------
class DataPoint(BaseModel):
    time: float
    height: float

class ParameterCondition(BaseModel):
    name: str
    param_value: float | None = None
    avg_diameter_um: float | None = None
    std_diameter_um: float | None = None
    points: list[DataPoint]

class MultiParameterRequest(BaseModel):
    parameter_name: str = "Homogenizer RPM"
    parameter_unit: str = "RPM"
    time_unit: str = "min"  # "min", "hours", "days"
    height_unit: str = "cm"  # "cm", "mm"
    reference_rpm: float = 18000.0
    rotor_diameter_mm: float = 12.7
    density_kg_m3: float = 1000.0
    conditions: list[ParameterCondition]

class PredictParameterRequest(BaseModel):
    parameter_name: str = "Homogenizer Speed"
    parameter_unit: str = "RPM"
    time_unit: str = "min"
    height_unit: str = "cm"
    target_value: float
    reference_rpm: float = 18000.0
    rotor_diameter_mm: float = 12.7
    density_kg_m3: float = 1000.0
    seed: int | None = None
    conditions: list[ParameterCondition]


@app.post("/stability/multi-parameter")
async def stability_multi_parameter(req: MultiParameterRequest):
    multiplier = get_time_multiplier(req.time_unit)
    rpm_mode = is_rpm_parameter(req.parameter_name, req.parameter_unit)

    series_results = []
    all_observed_hours = [0.5, 48.0]

    for idx, cond in enumerate(req.conditions):
        p_val = extract_numeric_value(cond.name, cond.param_value, idx + 1)
        valid_points = []
        for p in cond.points:
            t_val = float(p.time)
            h_val = float(p.height)
            if t_val >= 0 and h_val > 0:
                t_min = t_val * multiplier
                valid_points.append((t_min, t_val, h_val))
                all_observed_hours.append(t_min / 60.0)

        valid_points.sort(key=lambda x: x[0])
        kinetics = fit_kinetic_series(valid_points, req.height_unit)

        avg_d = float(cond.avg_diameter_um) if (cond.avg_diameter_um and cond.avg_diameter_um > 0) else None
        std_d = float(cond.std_diameter_um) if (cond.std_diameter_um and cond.std_diameter_um > 0) else None
        ift_info = None
        if avg_d is not None:
            eff_rpm = p_val if (rpm_mode and p_val > 100) else req.reference_rpm
            ift_info = compute_interfacial_tension(
                avg_dia_um=avg_d,
                effective_rpm=eff_rpm,
                rotor_diameter_mm=req.rotor_diameter_mm,
                density_kg_m3=req.density_kg_m3,
            )

        series_results.append({
            "name": cond.name,
            "param_value": p_val,
            "avg_diameter_um": round(avg_d, 2) if avg_d is not None else None,
            "std_diameter_um": round(std_d, 2) if std_d is not None else None,
            "interfacial_tension_mN_m": ift_info["interfacial_tension_mN_m"] if ift_info else None,
            "laplace_pressure_kPa": ift_info["laplace_pressure_kPa"] if ift_info else None,
            "weber_number": ift_info["weber_number"] if ift_info else None,
            **kinetics,
            "experimental_points": [
                {
                    "time_original": p[1],
                    "time_hours": round(p[0] / 60.0, 2),
                    "time_days": round(p[0] / 1440.0, 2),
                    "height": round(p[2], 3),
                }
                for p in valid_points
            ],
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


@app.post("/stability/predict-parameter")
async def predict_parameter_model(req: PredictParameterRequest):
    if not req.conditions:
        raise HTTPException(status_code=400, detail="At least one experimental condition is required.")

    multiplier = get_time_multiplier(req.time_unit)
    rpm_mode = is_rpm_parameter(req.parameter_name, req.parameter_unit)

    parsed_conditions = []
    all_t_min_set = set()

    for idx, cond in enumerate(req.conditions):
        p_val = extract_numeric_value(cond.name, cond.param_value, idx + 1)
        valid_pts = []
        for p in cond.points:
            t_val = float(p.time)
            h_val = float(p.height)
            if t_val >= 0 and h_val > 0:
                t_min = round(t_val * multiplier, 4)
                valid_pts.append((t_min, t_val, h_val))
                all_t_min_set.add(t_min)
        valid_pts.sort(key=lambda x: x[0])
        if len(valid_pts) < 2:
            continue

        kinetics = fit_kinetic_series(valid_pts, req.height_unit)
        parsed_conditions.append({
            "name": cond.name,
            "param_value": p_val,
            "points": valid_pts,
            "h0": kinetics["initial_height"],
            "k": kinetics["decay_constant"],
            "avg_diameter_um": float(cond.avg_diameter_um) if (cond.avg_diameter_um and cond.avg_diameter_um > 0) else None,
            "std_diameter_um": float(cond.std_diameter_um) if (cond.std_diameter_um and cond.std_diameter_um > 0) else None,
        })

    if not parsed_conditions:
        raise HTTPException(status_code=400, detail="Each condition needs at least 2 valid Height vs. Time entries.")

    # Sort conditions by numeric parameter value and merge any duplicate parameter entries
    parsed_conditions.sort(key=lambda c: c["param_value"])
    x_min = parsed_conditions[0]["param_value"]
    x_max = parsed_conditions[-1]["param_value"]
    x_clamped = float(np.clip(req.target_value, x_min, x_max))
    is_clamped = bool(req.target_value < x_min or req.target_value > x_max)

    # Evaluate each condition's height at common sorted time grid and interpolate across parameter X
    common_t_min = sorted(list(all_t_min_set))
    x_arr = np.array([c["param_value"] for c in parsed_conditions], dtype=np.float64)
    unique_x, inv_idx = np.unique(x_arr, return_inverse=True)

    interpolated_valid_points = []
    for t_min in common_t_min:
        cond_heights = []
        for c in parsed_conditions:
            pt_map = {p[0]: p[2] for p in c["points"]}
            if t_min in pt_map:
                cond_heights.append(pt_map[t_min])
            else:
                t_pts = np.array([p[0] for p in c["points"]], dtype=np.float64)
                h_pts = np.array([p[2] for p in c["points"]], dtype=np.float64)
                if t_pts[0] <= t_min <= t_pts[-1]:
                    cond_heights.append(float(np.interp(t_min, t_pts, h_pts)))
                else:
                    cond_heights.append(float(c["h0"] * np.exp(-c["k"] * t_min)))

        # Average heights for any duplicate X values before 1D interpolation
        grouped_h = np.zeros(len(unique_x), dtype=np.float64)
        counts = np.zeros(len(unique_x), dtype=np.float64)
        for c_i, h_v in enumerate(cond_heights):
            grouped_h[inv_idx[c_i]] += h_v
            counts[inv_idx[c_i]] += 1.0
        grouped_h /= np.maximum(counts, 1.0)

        h_pred = float(np.interp(x_clamped, unique_x, grouped_h))
        t_orig = round(t_min / multiplier, 3)
        interpolated_valid_points.append((t_min, t_orig, h_pred))

    pred_kinetics = fit_kinetic_series(interpolated_valid_points, req.height_unit)

    # 2. Predict Droplet Diameter (avg_diameter_um +/- std_diameter_um)
    dia_conds = [c for c in parsed_conditions if c["avg_diameter_um"] is not None]
    if len(dia_conds) >= 2:
        xd_raw = np.array([c["param_value"] for c in dia_conds], dtype=np.float64)
        d_raw = np.array([c["avg_diameter_um"] for c in dia_conds], dtype=np.float64)
        s_raw = np.array(
            [c["std_diameter_um"] if c["std_diameter_um"] is not None else 0.28 * c["avg_diameter_um"] for c in dia_conds],
            dtype=np.float64,
        )
        ux_d, inv_d = np.unique(xd_raw, return_inverse=True)
        ud_avg = np.zeros(len(ux_d), dtype=np.float64)
        ud_std = np.zeros(len(ux_d), dtype=np.float64)
        cnt_d = np.zeros(len(ux_d), dtype=np.float64)
        for i in range(len(xd_raw)):
            ud_avg[inv_d[i]] += d_raw[i]
            ud_std[inv_d[i]] += s_raw[i]
            cnt_d[inv_d[i]] += 1.0
        ud_avg /= np.maximum(cnt_d, 1.0)
        ud_std /= np.maximum(cnt_d, 1.0)

        xd_eval = float(np.clip(req.target_value, ux_d[0], ux_d[-1]))
        if rpm_mode and ux_d[0] > 0 and len(ux_d) >= 2:
            # Power-law / log-log interpolation for turbulent shear breakup (exact at all lab RPMs)
            pred_avg_dia = float(np.exp(np.interp(np.log(xd_eval), np.log(ux_d), np.log(ud_avg))))
        else:
            pred_avg_dia = float(np.interp(xd_eval, ux_d, ud_avg))
        pred_std_dia = float(np.interp(xd_eval, ux_d, ud_std))
        diameter_source = "interpolated_from_data"
    elif len(dia_conds) == 1:
        ref_c = dia_conds[0]
        k_ref = max(ref_c["k"] * 1440.0, 0.01)
        k_cur = max(pred_kinetics["decay_constant_per_day"], 0.01)
        pred_avg_dia = float(np.clip(ref_c["avg_diameter_um"] * np.sqrt(k_cur / k_ref), 14.0, 110.0))
        pred_std_dia = float(
            (ref_c["std_diameter_um"] or 0.28 * ref_c["avg_diameter_um"]) * (pred_avg_dia / ref_c["avg_diameter_um"])
        )
        diameter_source = "scaled_from_reference_stokes"
    else:
        # Stokes creaming estimation when user feeds custom Height vs. Time data without microscopy diameters
        k_day_eff = max(pred_kinetics["decay_constant_per_day"], 0.008)
        pred_avg_dia = float(np.clip(16.0 + 92.0 * np.sqrt(k_day_eff), 16.0, 95.0))
        pred_std_dia = round(0.28 * pred_avg_dia, 2)
        diameter_source = "estimated_from_stokes_kinetics"

    pred_avg_dia = round(pred_avg_dia, 2)
    pred_std_dia = round(max(1.5, pred_std_dia), 2)

    # 3. Calculate Interfacial Tension, Laplace Pressure & Weber Number
    eff_rpm = float(req.target_value) if (rpm_mode and req.target_value > 100) else float(req.reference_rpm)
    ift_metrics = compute_interfacial_tension(
        avg_dia_um=pred_avg_dia,
        effective_rpm=eff_rpm,
        rotor_diameter_mm=req.rotor_diameter_mm,
        density_kg_m3=req.density_kg_m3,
    )

    # Optional global Hinze-Kolmogorov equilibrium interfacial tension fit when varying RPM
    system_eq_gamma = None
    if rpm_mode and len(dia_conds) >= 3:
        n_arr = np.array([max(c["param_value"], 300.0) / 60.0 for c in dia_conds], dtype=np.float64)
        d_arr_m = np.array([c["avg_diameter_um"] * 1e-6 for c in dia_conds], dtype=np.float64)
        x_hk = n_arr ** -1.2
        if np.std(x_hk) > 1e-9:
            slope_a, intercept_d_inf = np.polyfit(x_hk, d_arr_m, 1)
            if slope_a > 0:
                d_rotor_m = max(req.rotor_diameter_mm, 2.0) * 1e-3
                rho = max(req.density_kg_m3, 200.0)
                gamma_eq = rho * ((slope_a / (0.18 * (d_rotor_m ** -0.8))) ** (5.0 / 3.0)) * 1000.0
                system_eq_gamma = round(float(np.clip(gamma_eq, 0.5, 75.0)), 2)

    # 4. Generate Synthetic Brightfield Micrograph
    micrograph = generate_synthetic_micrograph(
        avg_dia_um=pred_avg_dia,
        std_dia_um=pred_std_dia,
        seed=req.seed,
    )

    unit_suffix = f" {req.parameter_unit}".rstrip()
    target_label = f"{req.target_value:g}{unit_suffix}"

    return {
        "parameter_name": req.parameter_name,
        "parameter_unit": req.parameter_unit,
        "time_unit": req.time_unit,
        "height_unit": req.height_unit,
        "target_value": req.target_value,
        "evaluated_value": round(x_clamped, 4),
        "is_clamped_to_range": is_clamped,
        "tested_range": [round(x_min, 4), round(x_max, 4)],
        "target_label": target_label,
        **pred_kinetics,
        "interpolated_points": [
            {
                "time_original": p[1],
                "time_hours": round(p[0] / 60.0, 2),
                "time_days": round(p[0] / 1440.0, 2),
                "height": round(p[2], 3),
            }
            for p in interpolated_valid_points
        ],
        "predicted_diameter_um": pred_avg_dia,
        "predicted_std_um": pred_std_dia,
        "diameter_source": diameter_source,
        "interfacial_tension": {
            **ift_metrics,
            "system_equilibrium_gamma_mN_m": system_eq_gamma,
        },
        "micrograph": micrograph,
    }


import uvicorn
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
