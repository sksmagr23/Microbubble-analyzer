import React, { useMemo, useState } from "react";
import axios from "axios";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Scatter, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const SERIES_COLORS = [
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#7c3aed", // violet-600
  "#d97706", // amber-600
  "#e11d48", // rose-600
  "#0891b2", // cyan-600
  "#db2777", // pink-600
  "#4f46e5", // indigo-600
  "#16a34a", // green-600
  "#ea580c", // orange-600
];

const PRESETS = {
  rpm: {
    name: "Homogenizer Speed",
    unit: "RPM",
    timeUnit: "min",
    heightUnit: "cm",
    timePoints: [30, 120, 1440, 2880],
    rows: [
      { id: "1", name: "5000 RPM", heights: ["2.20", "2.05", "1.65", "1.40"] },
      { id: "2", name: "10000 RPM", heights: ["2.22", "2.15", "1.85", "1.70"] },
      { id: "3", name: "15000 RPM", heights: ["2.24", "2.20", "2.05", "1.95"] },
      { id: "4", name: "20000 RPM", heights: ["2.25", "2.22", "2.18", "2.12"] },
    ],
  },
  mixing: {
    name: "Mixing Time",
    unit: "min",
    timeUnit: "min",
    heightUnit: "cm",
    timePoints: [30, 120, 1440, 2880],
    rows: [
      { id: "1", name: "1 min mixing", heights: ["2.18", "1.95", "1.50", "1.25"] },
      { id: "2", name: "2 min mixing", heights: ["2.21", "2.08", "1.75", "1.55"] },
      { id: "3", name: "3 min mixing", heights: ["2.23", "2.16", "1.92", "1.80"] },
      { id: "4", name: "4 min mixing", heights: ["2.25", "2.22", "2.10", "2.02"] },
    ],
  },
  ph: {
    name: "pH Variation",
    unit: "pH",
    timeUnit: "min",
    heightUnit: "cm",
    timePoints: [30, 2880],
    rows: [
      { id: "1", name: "pH 1.5", heights: ["2.23", "1.52"] },
      { id: "2", name: "pH 3.0", heights: ["2.17", "1.93"] },
      { id: "3", name: "pH 6.0", heights: ["2.20", "2.19"] },
      { id: "4", name: "pH 9.0", heights: ["2.19", "1.78"] },
      { id: "5", name: "pH 12.0", heights: ["2.20", "1.43"] },
    ],
  },
  custom: {
    name: "Custom Parameter",
    unit: "unit",
    timeUnit: "min",
    heightUnit: "cm",
    timePoints: [30, 60, 120, 240],
    rows: [
      { id: "1", name: "Condition 1", heights: ["2.20", "2.10", "1.90", "1.70"] },
      { id: "2", name: "Condition 2", heights: ["2.22", "2.18", "2.05", "1.95"] },
    ],
  },
};

export default function App() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState("1");
  const [unit, setUnit] = useState("um");
  const API_URL = import.meta.env.VITE_API_URL;
  const displayUnit = result?.unit || unit || "px";

  // Single pH Predictor States
  const [pH, setPh] = useState(7);
  const [stabilityResult, setStabilityResult] = useState(null);
  const [loadingStability, setLoadingStability] = useState(false);
  const [stabilityError, setStabilityError] = useState("");
  const [timeHorizon, setTimeHorizon] = useState("7d");

  // Tab State
  const [stabilityMode, setStabilityMode] = useState("multi"); // "multi" | "single"

  // Multi-Parameter Stability States
  const [paramPreset, setParamPreset] = useState("rpm");
  const [paramName, setParamName] = useState(PRESETS.rpm.name);
  const [paramUnit, setParamUnit] = useState(PRESETS.rpm.unit);
  const [timeUnit, setTimeUnit] = useState(PRESETS.rpm.timeUnit);
  const [heightUnit, setHeightUnit] = useState(PRESETS.rpm.heightUnit);
  const [timePoints, setTimePoints] = useState(PRESETS.rpm.timePoints);
  const [rows, setRows] = useState(PRESETS.rpm.rows);
  const [multiStabilityResult, setMultiStabilityResult] = useState(null);
  const [loadingMulti, setLoadingMulti] = useState(false);
  const [multiError, setMultiError] = useState("");
  const [multiTimeHorizon, setMultiTimeHorizon] = useState("7d");

  const histogramOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#0f172a",
            font: { weight: "500" },
          },
        },
        tooltip: {
          backgroundColor: "rgba(248, 250, 252, 0.95)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.7)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: `Bubble Diameter (${displayUnit})`,
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0)" },
        },
        y: {
          title: {
            display: true,
            text: "Frequency",
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0)" },
        },
      },
    }),
    [displayUnit]
  );

  const scatterOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#0f172a",
            font: { weight: "500" },
          },
        },
        tooltip: {
          backgroundColor: "rgba(248, 250, 252, 0.95)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.7)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Bubble Index",
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
        y: {
          title: {
            display: true,
            text: `Diameter (${displayUnit})`,
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
      },
    }),
    [displayUnit]
  );

  // Single-parameter height vs time options & data
  const heightVsTimeOptions = useMemo(() => {
    let maxX = 48;
    let stepSize = 6;
    let xAxisTitle = "Time (hours)";
    let tickFormatter = (value) => `${value} h`;

    if (timeHorizon === "7d") {
      maxX = 168;
      stepSize = 24;
      xAxisTitle = "Time (days / hours)";
      tickFormatter = (value) => {
        const days = Math.round(value / 24);
        if (value === 0) return "Day 0";
        if (value === 48) return "Day 2 (48h)";
        return `Day ${days} (${value}h)`;
      };
    } else if (timeHorizon === "14d") {
      maxX = 336;
      stepSize = 48;
      xAxisTitle = "Time (days)";
      tickFormatter = (value) => `Day ${Math.round(value / 24)}`;
    } else if (timeHorizon === "full") {
      maxX = stabilityResult?.full_horizon_hours || 168;
      stepSize = maxX > 200 ? 72 : 24;
      xAxisTitle = "Time (days / hours)";
      tickFormatter = (value) => `${Math.round(value / 24)}d (${value}h)`;
    }

    const maxY = Math.ceil(((stabilityResult?.initial_height || 2.25) * 1.15) * 10) / 10;

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            color: "#0f172a",
            font: { weight: "500" },
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: "rgba(248, 250, 252, 0.95)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.7)",
          borderWidth: 1,
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const x = items[0].parsed.x;
              const days = (x / 24).toFixed(1);
              return `Time: ${x} hours (~${days} days)`;
            },
            label: (item) => {
              const y = item.parsed.y;
              const dsLabel = item.dataset.label || "Value";
              return ` ${dsLabel}: ${y.toFixed(2)} cm`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: xAxisTitle,
            color: "#0f172a",
            font: { weight: "500" },
          },
          min: 0,
          max: maxX,
          ticks: {
            color: "#334155",
            stepSize,
            callback: tickFormatter,
          },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
        y: {
          min: 0,
          max: maxY,
          title: {
            display: true,
            text: "Emulsion Height (cm)",
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
      },
    };
  }, [timeHorizon, stabilityResult]);

  const heightVsTimeData = useMemo(() => {
    if (!stabilityResult) return null;
    const activeCurve = stabilityResult?.curves?.[timeHorizon] || stabilityResult?.curve || [];
    if (!activeCurve.length) return null;

    let maxX = 48;
    if (timeHorizon === "7d") maxX = 168;
    if (timeHorizon === "14d") maxX = 336;
    if (timeHorizon === "full") maxX = stabilityResult?.full_horizon_hours || 168;

    const datasets = [
      {
        type: "line",
        label: "Exponential Decay Curve h(t) = h₀ · e⁻ᵏᵗ",
        data: activeCurve.map((pt) => ({ x: pt.time_hours, y: pt.height })),
        borderColor: "rgba(79, 70, 229, 1)",
        backgroundColor: "rgba(79, 70, 229, 0.08)",
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.25,
        fill: true,
      },
      {
        type: "line",
        label: "Experimental Measurements",
        data: (stabilityResult.experimental_points || [])
          .filter((pt) => pt.time_hours <= maxX)
          .map((pt) => ({
            x: pt.time_hours,
            y: pt.height,
          })),
        borderColor: "rgba(225, 29, 72, 1)",
        backgroundColor: "rgba(225, 29, 72, 1)",
        pointRadius: 6,
        pointHoverRadius: 8,
        pointStyle: "circle",
        showLine: false,
      },
    ];

    if (stabilityResult?.half_height && !stabilityResult.highly_stable) {
      datasets.push({
        type: "line",
        label: `Half-Life Level (h₀ / 2 = ${stabilityResult.half_height.toFixed(2)} cm)`,
        data: [
          { x: 0, y: stabilityResult.half_height },
          { x: maxX, y: stabilityResult.half_height },
        ],
        borderColor: "rgba(234, 88, 12, 0.8)",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
      });
    }

    return { datasets };
  }, [stabilityResult, timeHorizon]);

  // Multi-parameter Height vs Time chart options & data
  const multiHeightVsTimeOptions = useMemo(() => {
    let maxX = 48;
    let stepSize = 6;
    let xAxisTitle = "Time (hours)";
    let tickFormatter = (value) => `${value} h`;

    if (multiTimeHorizon === "7d") {
      maxX = 168;
      stepSize = 24;
      xAxisTitle = "Time (days / hours)";
      tickFormatter = (value) => {
        const days = Math.round(value / 24);
        if (value === 0) return "Day 0";
        return `Day ${days} (${value}h)`;
      };
    } else if (multiTimeHorizon === "14d") {
      maxX = 336;
      stepSize = 48;
      xAxisTitle = "Time (days)";
      tickFormatter = (value) => `Day ${Math.round(value / 24)}`;
    } else if (multiTimeHorizon === "full") {
      const maxObs = multiStabilityResult?.max_observed_hours || 48;
      maxX = Math.max(168, Math.min(Math.round(maxObs * 2.5), 720));
      stepSize = maxX > 250 ? 72 : 24;
      xAxisTitle = "Time (days / hours)";
      tickFormatter = (value) => `${Math.round(value / 24)}d`;
    }

    let maxHeight = 2.5;
    if (multiStabilityResult?.series) {
      multiStabilityResult.series.forEach((s) => {
        if (s.initial_height > maxHeight) maxHeight = s.initial_height;
      });
    }
    const maxY = Math.ceil((maxHeight * 1.15) * 10) / 10;

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            color: "#0f172a",
            font: { weight: "500", size: 12 },
            usePointStyle: true,
            boxWidth: 8,
            filter: (item) => !item.text.endsWith("(Data)"),
          },
        },
        tooltip: {
          backgroundColor: "rgba(248, 250, 252, 0.98)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.7)",
          borderWidth: 1,
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const x = items[0].parsed.x;
              const days = (x / 24).toFixed(1);
              return `Time: ${x} hours (~${days} days)`;
            },
            label: (item) => {
              const y = item.parsed.y;
              const cleanLabel = item.dataset.label.replace(" (Fit)", "").replace(" (Data)", "");
              return ` ${cleanLabel}: ${y.toFixed(2)} ${multiStabilityResult?.height_unit || "cm"}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: xAxisTitle,
            color: "#0f172a",
            font: { weight: "500" },
          },
          min: 0,
          max: maxX,
          ticks: {
            color: "#334155",
            stepSize,
            callback: tickFormatter,
          },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
        y: {
          min: 0,
          max: maxY,
          title: {
            display: true,
            text: `Emulsion Height (${multiStabilityResult?.height_unit || "cm"})`,
            color: "#0f172a",
            font: { weight: "500" },
          },
          ticks: { color: "#334155" },
          grid: { color: "rgba(148, 163, 184, 0.35)" },
        },
      },
    };
  }, [multiTimeHorizon, multiStabilityResult]);

  const multiHeightVsTimeData = useMemo(() => {
    if (!multiStabilityResult?.series?.length) return null;
    const datasets = [];

    multiStabilityResult.series.forEach((s, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const curvePoints = s.curves?.[multiTimeHorizon] || s.curves?.["7d"] || [];

      // 1. Fitted Curve Line
      datasets.push({
        type: "line",
        label: `${s.name} (Fit)`,
        data: curvePoints.map((p) => ({ x: p.time_hours, y: p.height })),
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.25,
        fill: false,
      });

      // 2. Experimental Data Markers
      datasets.push({
        type: "line",
        label: `${s.name} (Data)`,
        data: (s.experimental_points || []).map((p) => ({ x: p.time_hours, y: p.height })),
        borderColor: color,
        backgroundColor: color,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointStyle: "circle",
        showLine: false,
      });
    });

    return { datasets };
  }, [multiStabilityResult, multiTimeHorizon]);

  const onFileSelected = (nextFile) => {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("Please upload a valid image file.");
      return;
    }
    setError("");
    setFile(nextFile);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    onFileSelected(event.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Select an image before running analysis.");
      return;
    }

    const parsedScale = Number.parseFloat(scale);
    if (Number.isNaN(parsedScale) || parsedScale <= 0) {
      setError("Scale must be a number greater than 0.");
      return;
    }

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("scale", String(parsedScale));
    formData.append("unit", unit.trim() || "px");

    try {
      const res = await axios.post(`${API_URL}/analyze`, formData);
      setResult(res.data);
    } catch {
      setError("Upload failed. Ensure that Fast API is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleStabilityAnalysis = async () => {
    setLoadingStability(true);
    setStabilityError("");
    setStabilityResult(null);
    try {
      const res = await axios.post(`${API_URL}/stability`, { pH: Number.parseFloat(pH) });
      setStabilityResult(res.data);
    } catch {
      setStabilityError("Failed to fetch stability analysis. Ensure FastAPI is running.");
    } finally {
      setLoadingStability(false);
    }
  };

  // Multi-parameter Excel Table Handlers
  const handleLoadPreset = (presetKey) => {
    const p = PRESETS[presetKey];
    if (!p) return;
    setParamPreset(presetKey);
    setParamName(p.name);
    setParamUnit(p.unit);
    setTimeUnit(p.timeUnit);
    setHeightUnit(p.heightUnit);
    setTimePoints([...p.timePoints]);
    setRows(p.rows.map((r) => ({ ...r, heights: [...r.heights] })));
    setMultiStabilityResult(null);
    setMultiError("");
  };

  const handleAddTimePoint = () => {
    const last = timePoints.length > 0 ? timePoints[timePoints.length - 1] : 0;
    const nextVal = last === 0 ? 30 : last * 2;
    setTimePoints([...timePoints, nextVal]);
    setRows(rows.map((r) => ({ ...r, heights: [...r.heights, ""] })));
  };

  const handleDeleteTimePoint = (colIdx) => {
    if (timePoints.length <= 2) {
      setMultiError("At least 2 time periods are required to calculate decay kinetics.");
      return;
    }
    setMultiError("");
    setTimePoints(timePoints.filter((_, idx) => idx !== colIdx));
    setRows(rows.map((r) => ({ ...r, heights: r.heights.filter((_, idx) => idx !== colIdx) })));
  };

  const handleUpdateTimePoint = (colIdx, value) => {
    const valNum = Number.parseFloat(value);
    const updated = [...timePoints];
    updated[colIdx] = Number.isNaN(valNum) ? 0 : valNum;
    setTimePoints(updated);
  };

  const handleAddConditionRow = () => {
    const newId = String(Date.now());
    const newRow = {
      id: newId,
      name: `${paramName || "Condition"} ${rows.length + 1}`,
      heights: new Array(timePoints.length).fill(""),
    };
    setRows([...rows, newRow]);
  };

  const handleDeleteConditionRow = (rowIdx) => {
    if (rows.length <= 1) {
      setMultiError("At least 1 condition is required.");
      return;
    }
    setMultiError("");
    setRows(rows.filter((_, idx) => idx !== rowIdx));
  };

  const handleUpdateRowName = (rowIdx, newName) => {
    const updated = [...rows];
    updated[rowIdx].name = newName;
    setRows(updated);
  };

  const handleUpdateHeight = (rowIdx, colIdx, value) => {
    const updated = [...rows];
    updated[rowIdx].heights[colIdx] = value;
    setRows(updated);
  };

  const handleMultiStabilityAnalysis = async () => {
    setLoadingMulti(true);
    setMultiError("");
    setMultiStabilityResult(null);

    // Validate inputs
    const conditionsPayload = [];
    for (const r of rows) {
      const validPoints = [];
      r.heights.forEach((hStr, colIdx) => {
        const hVal = Number.parseFloat(hStr);
        const tVal = timePoints[colIdx];
        if (!Number.isNaN(hVal) && hVal > 0 && tVal !== undefined && tVal >= 0) {
          validPoints.push({ time: tVal, height: hVal });
        }
      });
      if (validPoints.length < 2) {
        setMultiError(`Condition "${r.name}" needs at least 2 valid height entries.`);
        setLoadingMulti(false);
        return;
      }
      conditionsPayload.push({
        name: r.name.trim() || `Condition ${conditionsPayload.length + 1}`,
        points: validPoints,
      });
    }

    if (conditionsPayload.length === 0) {
      setMultiError("Please enter valid height vs time data before analyzing.");
      setLoadingMulti(false);
      return;
    }

    const payload = {
      parameter_name: paramName || "Parameter",
      parameter_unit: paramUnit || "",
      time_unit: timeUnit || "min",
      height_unit: heightUnit || "cm",
      conditions: conditionsPayload,
    };

    try {
      const res = await axios.post(`${API_URL}/stability/multi-parameter`, payload);
      setMultiStabilityResult(res.data);
    } catch {
      setMultiError("Failed to calculate multi-parameter stability. Ensure FastAPI is running.");
    } finally {
      setLoadingMulti(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-200 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
                CV + Experimental Insights
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
                Microbubble Analysis Dashboard
              </h1>
            </div>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Top Section 1: Upload & Parameters */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Upload Micrographic Image</h2>

            <label
              className={`mt-5 block cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
                dragActive
                  ? "border-slate-500 bg-slate-100"
                  : "border-slate-300 bg-slate-50 hover:border-slate-400"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => onFileSelected(event.target.files?.[0])}
              />
              <p className="text-base font-medium text-slate-800">
                {file ? file.name : "Drag and drop an image here"}
              </p>
              <p className="mt-2 text-sm text-slate-500">or click to browse</p>
            </label>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-700">
                Scale (unit per pixel)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={scale}
                  onChange={(event) => setScale(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
                  placeholder="Example: 0.5"
                />
              </label>

              <label className="text-sm text-slate-700">
                Output Unit
                <select
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
                >
                  <option value="um">um</option>
                  <option value="nm">nm</option>
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                  <option value="px">px</option>
                </select>
              </label>

              <label className="text-sm text-slate-700">
                Quick pH (0-14)
                <input
                  type="number"
                  min="0"
                  max="14"
                  step="0.1"
                  value={pH}
                  onChange={(e) => setPh(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
                  placeholder="Example: 7.0"
                />
              </label>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={handleUpload}
                disabled={loading}
                className="w-full cursor-pointer rounded-lg bg-slate-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Processing Image..." : "Analyze Image"}
              </button>
              <button
                onClick={handleStabilityAnalysis}
                disabled={loadingStability}
                className="w-full cursor-pointer rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingStability ? "Predicting..." : "Predict Quick pH Stability"}
              </button>
            </div>

            {result && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">Quick Metrics</h3>
                <div className="mt-3 space-y-3 text-md">
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-slate-200">
                    <span className="text-slate-600">Bubble Count</span>
                    <span className="font-semibold text-slate-900">{result.count}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-slate-200">
                    <span className="text-slate-600">Average Diameter</span>
                    <span className="font-semibold text-slate-900">
                      {result.avg.toFixed(2)} {displayUnit}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-slate-200">
                    <span className="text-slate-600">Standard Deviation</span>
                    <span className="font-semibold text-slate-900">
                      {result.std.toFixed(2)} {displayUnit}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Top Section 2: Processed Image */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Processed Image</h2>
            {result ? (
              <img
                className="mt-4 h-5/6 w-full object-contain"
                src={`data:image/jpeg;base64,${result.image}`}
                alt="Processed"
              />
            ) : (
              <div className="mt-4 flex h-5/6 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                Upload an image and run analysis.
              </div>
            )}
          </section>

          {/* Bubble Size Distribution */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Bubble Size Distribution</h2>
            <div className="mt-4 h-110">
              {result ? (
                <Bar
                  key={"hist"}
                  data={{
                    labels: result.bin_edges.slice(0, -1).map((value) => value.toFixed(1)),
                    datasets: [
                      {
                        label: "Frequency",
                        data: result.hist_counts,
                        backgroundColor: "rgba(37, 99, 235, 0.8)",
                        borderColor: "rgba(30, 64, 175, 1)",
                        borderWidth: 0,
                        borderRadius: 0,
                        categoryPercentage: 1.0,
                        barPercentage: 1.0,
                      },
                    ],
                  }}
                  options={histogramOptions}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                  Histogram will appear after analysis.
                </div>
              )}
            </div>
          </section>

          {/* Bubble Diameters */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Bubble Diameters</h2>
            <div className="mt-4 h-110">
              {result ? (
                <Scatter
                  key={"scatter"}
                  data={{
                    datasets: [
                      {
                        label: `Diameter (${displayUnit})`,
                        data: result.diameters.map((diameter, index) => ({ x: index + 1, y: diameter })),
                        backgroundColor: "rgba(30, 64, 175, 0.9)",
                        borderColor: "rgba(15, 23, 42, 1)",
                        pointRadius: 4,
                      },
                    ],
                  }}
                  options={scatterOptions}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                  Scatter plot will appear after analysis.
                </div>
              )}
            </div>
          </section>

          {/* Comprehensive Stability Section with Tabs */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm col-span-1 xl:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Emulsion Stability Analysis & Modeling</h2>
                <p className="text-xs text-slate-500">
                  Study Height vs. Time decay curves across parameter variations or single pH values
                </p>
              </div>

              {/* Tab Selector */}
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setStabilityMode("multi")}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                    stabilityMode === "multi"
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Multi-Parameter Grid
                </button>
                <button
                  type="button"
                  onClick={() => setStabilityMode("single")}
                  className={`px-4 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                    stabilityMode === "single"
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Quick pH Predictor
                </button>
              </div>
            </div>

            {/* TAB 1: Multi-Parameter Comparative Grid */}
            {stabilityMode === "multi" && (
              <div className="mt-5 space-y-6">
                {/* Control bar: Presets & Parameter definition */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Select Parameter to Vary
                      </span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {[
                          { id: "rpm", label: "Homogenizer RPM" },
                          { id: "mixing", label: "Mixing Time" },
                          { id: "ph", label: "pH Levels" },
                          { id: "custom", label: "Custom Parameter" },
                        ].map((btn) => (
                          <button
                            key={btn.id}
                            type="button"
                            onClick={() => handleLoadPreset(btn.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition cursor-pointer ${
                              paramPreset === btn.id
                                ? "bg-indigo-600 text-white border-indigo-600 font-semibold shadow-xs"
                                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Parameter Name</label>
                        <input
                          type="text"
                          value={paramName}
                          onChange={(e) => setParamName(e.target.value)}
                          className="mt-0.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 outline-none w-36"
                          placeholder="e.g. RPM"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Param Unit</label>
                        <input
                          type="text"
                          value={paramUnit}
                          onChange={(e) => setParamUnit(e.target.value)}
                          className="mt-0.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 outline-none w-20"
                          placeholder="e.g. rpm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Time Unit</label>
                        <select
                          value={timeUnit}
                          onChange={(e) => setTimeUnit(e.target.value)}
                          className="mt-0.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 outline-none"
                        >
                          <option value="min">Minutes (min)</option>
                          <option value="hours">Hours (h)</option>
                          <option value="days">Days (d)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Height Unit</label>
                        <select
                          value={heightUnit}
                          onChange={(e) => setHeightUnit(e.target.value)}
                          className="mt-0.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 outline-none"
                        >
                          <option value="cm">cm</option>
                          <option value="mm">mm</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Excel-Style Grid Table */}
                <div className="rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden">
                  <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Spreadsheet Entry: Emulsion Height ({heightUnit}) vs. Time ({timeUnit})
                      </h3>
                      <p className="text-xs text-slate-500">
                        Enter condition values in rows and measured heights at each time period in columns
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddTimePoint}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                      >
                        + Add Time Column
                      </button>
                      <button
                        type="button"
                        onClick={handleAddConditionRow}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                      >
                        + Add Condition Row
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-150">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                          <th className="py-2.5 px-3 w-48 border-r border-slate-200">
                            {paramName || "Condition"} ({paramUnit || "level"})
                          </th>
                          {timePoints.map((tp, colIdx) => (
                            <th key={colIdx} className="py-2 px-3 border-r border-slate-200 min-w-27.5">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-slate-500">t{colIdx + 1}:</span>
                                <input
                                  type="number"
                                  value={tp}
                                  onChange={(e) => handleUpdateTimePoint(colIdx, e.target.value)}
                                  className="w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 font-mono text-center outline-none focus:border-indigo-500"
                                />
                                <span className="text-slate-400 text-[10px]">{timeUnit}</span>
                                <button
                                  type="button"
                                  title="Remove time column"
                                  onClick={() => handleDeleteTimePoint(colIdx)}
                                  className="text-slate-400 hover:text-rose-600 text-xs font-bold px-1 transition cursor-pointer"
                                >
                                  ×
                                </button>
                              </div>
                            </th>
                          ))}
                          <th className="py-2.5 px-3 text-center w-12">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {rows.map((row, rowIdx) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-2 px-3 border-r border-slate-200">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => handleUpdateRowName(rowIdx, e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 font-semibold focus:border-indigo-500 outline-none"
                                placeholder={`Condition ${rowIdx + 1}`}
                              />
                            </td>
                            {timePoints.map((_, colIdx) => (
                              <td key={colIdx} className="py-2 px-3 border-r border-slate-200">
                                <input
                                  type="number"
                                  step="any"
                                  value={row.heights[colIdx] ?? ""}
                                  onChange={(e) => handleUpdateHeight(rowIdx, colIdx, e.target.value)}
                                  placeholder="0.00"
                                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 font-mono text-center focus:border-indigo-500 outline-none"
                                />
                              </td>
                            ))}
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                title="Remove condition row"
                                onClick={() => handleDeleteConditionRow(rowIdx)}
                                className="text-slate-400 hover:text-rose-600 text-base font-bold transition cursor-pointer"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-slate-50 p-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddConditionRow}
                        className="text-xs font-medium text-indigo-700 hover:text-indigo-900 transition cursor-pointer flex items-center gap-1"
                      >
                        + Add New Row
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={handleAddTimePoint}
                        className="text-xs font-medium text-indigo-700 hover:text-indigo-900 transition cursor-pointer flex items-center gap-1"
                      >
                        + Add New Time Column
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleMultiStabilityAnalysis}
                      disabled={loadingMulti}
                      className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition cursor-pointer disabled:opacity-60"
                    >
                      {loadingMulti ? "Analyzing Kinetics..." : "📈 Analyze & Compare Stability"}
                    </button>
                  </div>
                </div>

                {multiError && (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 font-medium">
                    {multiError}
                  </div>
                )}

                {/* RESULTS: Comparison Graph & Metrics */}
                {multiStabilityResult && (
                  <div className="space-y-6 pt-2">
                    {/* Best Condition Banner */}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                          Stability Optimization Result
                        </span>
                        <h4 className="mt-0.5 text-lg font-bold text-emerald-950">
                          Best Condition: {multiStabilityResult.best_condition}
                        </h4>
                        <p className="text-xs text-emerald-700">
                          Demonstrated the longest half-life and greatest resistance to creaming/phase separation.
                        </p>
                      </div>
                      <div className="text-xs bg-white border border-emerald-200 px-3 py-1.5 rounded-lg font-medium text-emerald-900 shadow-xs">
                        {multiStabilityResult.total_conditions} conditions compared simultaneously
                      </div>
                    </div>

                    {/* Combined Height vs. Time Chart */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">
                            Comparative Height vs. Time Decay Curves
                          </h3>
                          <p className="text-xs text-slate-500">
                            Fitted first-order exponential curves: h(t) = h₀ · e⁻ᵏᵗ for each {paramName} condition
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 self-start sm:self-auto">
                          {[
                            { id: "48h", label: "48 Hours" },
                            { id: "7d", label: "7 Days" },
                            { id: "14d", label: "14 Days" },
                            { id: "full", label: "Full Horizon" },
                          ].map((btn) => (
                            <button
                              key={btn.id}
                              type="button"
                              onClick={() => setMultiTimeHorizon(btn.id)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
                                multiTimeHorizon === btn.id
                                  ? "bg-white text-indigo-700 shadow-xs font-semibold"
                                  : "text-slate-600 hover:text-slate-900"
                              }`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 h-110">
                        {multiHeightVsTimeData ? (
                          <Line data={multiHeightVsTimeData} options={multiHeightVsTimeOptions} />
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                            Plot will appear after analysis.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Comparative Ranking Table */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-lg font-semibold text-slate-900 mb-3">
                        Kinetic Parameters & Stability Ranking
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                              <th className="py-2.5 px-3">Condition</th>
                              <th className="py-2.5 px-3">Initial h₀</th>
                              <th className="py-2.5 px-3">Final Height</th>
                              <th className="py-2.5 px-3">Retention %</th>
                              <th className="py-2.5 px-3">Decay Constant (k/day)</th>
                              <th className="py-2.5 px-3">Half-Life (t₁/₂)</th>
                              <th className="py-2.5 px-3">Fit R²</th>
                              <th className="py-2.5 px-3">Stability Class</th>
                              <th className="py-2.5 px-3">Fitted Equation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {multiStabilityResult.series.map((s, idx) => {
                              const color = SERIES_COLORS[idx % SERIES_COLORS.length];
                              const isBest = s.name === multiStabilityResult.best_condition;
                              return (
                                <tr
                                  key={idx}
                                  className={`hover:bg-slate-50/70 transition ${
                                    isBest ? "bg-emerald-50/30 font-medium" : ""
                                  }`}
                                >
                                  <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-2">
                                    <span
                                      className="w-3 h-3 rounded-full inline-block shrink-0"
                                      style={{ backgroundColor: color }}
                                    />
                                    {s.name}
                                    {isBest && (
                                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-md">
                                        Top
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono">
                                    {s.initial_height.toFixed(2)} {multiStabilityResult.height_unit}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono">
                                    {s.final_height.toFixed(2)} {multiStabilityResult.height_unit}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-slate-700">{s.retention_pct}%</span>
                                      <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div
                                          className="bg-indigo-600 h-1.5 rounded-full"
                                          style={{ width: `${Math.min(s.retention_pct, 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-700">
                                    {s.decay_constant_per_day.toFixed(3)} / d
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                                    {s.highly_stable
                                      ? "Very long (>10 d)"
                                      : `${s.half_life_days ? s.half_life_days.toFixed(1) : 0} days`}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-500">{s.r2}</td>
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                        s.stability_class === "Highly stable"
                                          ? "bg-emerald-100 text-emerald-800"
                                          : s.stability_class === "Moderately stable"
                                          ? "bg-blue-100 text-blue-800"
                                          : s.stability_class === "Low stability"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-rose-100 text-rose-800"
                                      }`}
                                    >
                                      {s.stability_class}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px]">
                                    {s.equation_days}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Single Quick pH Predictor */}
            {stabilityMode === "single" && (
              <div className="mt-5 space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="text-sm text-slate-700 flex-1">
                    pH of the emulsion (0-14)
                    <input
                      type="number"
                      min="0"
                      max="14"
                      step="0.1"
                      value={pH}
                      onChange={(e) => setPh(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-500"
                    />
                  </label>
                  <button
                    onClick={handleStabilityAnalysis}
                    disabled={loadingStability}
                    className="w-full sm:w-auto cursor-pointer rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 shadow-xs"
                  >
                    {loadingStability ? "Analyzing..." : "Predict Quick pH Stability"}
                  </button>
                </div>

                {stabilityError && (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {stabilityError}
                  </div>
                )}

                {stabilityResult && (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col rounded-lg bg-white px-4 py-3 border border-slate-200">
                          <span className="text-sm text-slate-500">Estimated Half-life</span>
                          <span className="mt-1 text-lg font-semibold text-slate-900">
                            {stabilityResult.highly_stable ? "Very long" : `${stabilityResult.half_life.toFixed(0)} min`}
                          </span>
                          {!stabilityResult.highly_stable && (
                            <span className="mt-1 text-xs text-slate-500">
                              (~{(stabilityResult.half_life / 60).toFixed(1)} h / ~{(stabilityResult.half_life / 1440).toFixed(2)} days)
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col rounded-lg bg-white px-4 py-3 border border-slate-200">
                          <span className="text-sm text-slate-500">Stability Class</span>
                          <span className="mt-1 text-lg font-semibold text-slate-900">
                            {stabilityResult.stability_class}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                            Fitted Exponential Decay Model
                          </span>
                          <p className="mt-0.5 text-base sm:text-lg font-bold font-mono text-indigo-950">
                            {stabilityResult.equation_days}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                            Initial Height h₀:{" "}
                            <span className="font-semibold text-slate-900">
                              {stabilityResult.initial_height?.toFixed(2)} cm
                            </span>
                          </div>
                          <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                            Decay Constant k:{" "}
                            <span className="font-semibold text-slate-900">
                              {stabilityResult.decay_constant_per_day?.toFixed(3)} / day
                            </span>
                          </div>
                          <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                            Half-Life t₁/₂:{" "}
                            <span className="font-semibold text-slate-900">
                              {stabilityResult.half_life_days
                                ? `${stabilityResult.half_life_days.toFixed(2)} days`
                                : "Very long"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">
                            Single pH Height vs. Time (Exponential Decay)
                          </h3>
                          <p className="text-xs text-slate-500">
                            Switch time windows to view the 2-day lab data or extended exponential curvature
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 self-start sm:self-auto">
                          {[
                            { id: "48h", label: "48 Hours" },
                            { id: "7d", label: "7 Days" },
                            { id: "14d", label: "14 Days" },
                            { id: "full", label: "Full Decay" },
                          ].map((btn) => (
                            <button
                              key={btn.id}
                              type="button"
                              onClick={() => setTimeHorizon(btn.id)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
                                timeHorizon === btn.id
                                  ? "bg-white text-indigo-700 shadow-xs font-semibold"
                                  : "text-slate-600 hover:text-slate-900"
                              }`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 h-100">
                        {heightVsTimeData ? (
                          <Line data={heightVsTimeData} options={heightVsTimeOptions} />
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                            Height vs. Time decay curve will appear after predicting stability.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
