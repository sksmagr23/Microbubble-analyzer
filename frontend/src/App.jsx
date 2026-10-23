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
  Legend
} from "chart.js";

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
import { Bar, Scatter, Line } from "react-chartjs-2";

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

  const [pH, setPh] = useState(7);
  const [stabilityResult, setStabilityResult] = useState(null);
  const [loadingStability, setLoadingStability] = useState(false);
  const [stabilityError, setStabilityError] = useState("");
  const [timeHorizon, setTimeHorizon] = useState("7d");

  const histogramOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#0f172a",
            font: {
              weight: "500",
            },
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
            font: {
              weight: "500",
            },
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

  const heightVsTimeOptions = useMemo(() => {
    let maxX = 48;
    let stepSize = 6;
    let xAxisTitle = "Time (hours)";
    let tickFormatter = (value) => {
      if (value === 0) return "0 h";
      if (value === 24) return "24 h (1d)";
      if (value === 48) return "48 h (2d)";
      return `${value} h`;
    };

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
      tickFormatter = (value) => {
        const days = Math.round(value / 24);
        return `Day ${days}`;
      };
    } else if (timeHorizon === "full") {
      maxX = stabilityResult?.full_horizon_hours || 168;
      stepSize = maxX > 200 ? 72 : 24;
      xAxisTitle = "Time (days / hours)";
      tickFormatter = (value) => {
        const days = Math.round((value / 24) * 10) / 10;
        return `${days}d (${value}h)`;
      };
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
            font: {
              weight: "500",
            },
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
              if (x === 0.5) return "Time: 30 minutes (0.5 h)";
              if (x === 24) return "Time: 24 hours (1 day)";
              if (x === 48) return "Time: 48 hours (2 days)";
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
        borderColor: "rgba(79, 2, 229, 1)",
        backgroundColor: "rgba(79, 2, 229, 0.08)",
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

  const onFileSelected = (nextFile) => {
    if (!nextFile) {
      return;
    }

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
                pH (0-14)
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
                {loadingStability ? "Predicting..." : "Predict Stability"}
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

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm col-span-1 xl:col-span-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Emulsion Stability Predictor</h2>
                <p className="text-xs text-slate-500">First-order decay model: h(t) = h₀ · e⁻ᵏᵗ</p>
              </div>
            </div>
            
            {stabilityError && (
              <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {stabilityError}
              </div>
            )}
            
            {stabilityResult && (
              <>
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
                      <span className="mt-1 text-lg font-semibold text-slate-900">{stabilityResult.stability_class}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                        Fitted Exponential Model
                      </span>
                      <p className="mt-0.5 text-base sm:text-lg font-bold font-mono text-indigo-950">
                        {stabilityResult.equation_days}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                        Initial Height h₀: <span className="font-semibold text-slate-900">{stabilityResult.initial_height?.toFixed(2)} cm</span>
                      </div>
                      <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                        Decay Constant k: <span className="font-semibold text-slate-900">{stabilityResult.decay_constant_per_day?.toFixed(3)} / day</span>
                      </div>
                      <div className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 border border-slate-200 shadow-xs">
                        Half-Life t₁/₂: <span className="font-semibold text-slate-900">{stabilityResult.half_life_days ? `${stabilityResult.half_life_days.toFixed(2)} days` : "Very long"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="mt-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Emulsion Height vs. Time (Exponential Decay)</h3>
                  <p className="text-xs text-slate-500">
                    Switch time windows to view the 2-day lab data or extended exponential curvature
                  </p>
                </div>
                {stabilityResult && (
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
                )}
              </div>

              <div className="mt-4 h-100">
                {heightVsTimeData ? (
                  <Line data={heightVsTimeData} options={heightVsTimeOptions} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-500">
                    Height vs. Time exponential decay curve will appear after predicting stability.
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}