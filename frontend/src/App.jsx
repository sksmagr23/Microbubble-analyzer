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
import { Bar } from "react-chartjs-2";
import { Scatter } from "react-chartjs-2";

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

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={loading}
              className="mt-5 w-full cursor-pointer rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Processing Image..." : "Analyze Image"}
            </button>

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
        </main>
      </div>
    </div>
  );
}