from fastapi import FastAPI, File, Form, HTTPException, UploadFile
import cv2
import numpy as np
import tempfile
import base64
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

import uvicorn
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)