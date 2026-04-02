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
  const API_URL = import.meta.env.VITE_API_URL;

  const histogramOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#d1fae5",
            font: {
              weight: "500",
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 23, 40, 0.95)",
          borderColor: "rgba(45, 212, 191, 0.65)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Bubble Diameter (pixels)",
            color: "#ffffff",
            font: { weight: "500" },
          },
          ticks: { color: "#bfdbfe" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
        y: {
          title: {
            display: true,
            text: "Frequency",
            color: "#ffffff",
            font: { weight: "500" },
          },
          ticks: { color: "#bfdbfe" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    }),
    []
  );

  const scatterOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#ffffff",
            font: {
              weight: "500",
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 23, 40, 0.95)",
          borderColor: "rgba(45, 212, 191, 0.45)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Bubble Index",
            color: "#fff",
            font: { weight: "500" },
          },
          ticks: { color: "#bfdbfe" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
        y: {
          title: {
            display: true,
            text: "Diameter",
            color: "#fff",
            font: { weight: "500" },
          },
          ticks: { color: "#bfdbfe" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    }),
    []
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

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

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
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4/5 px-2 py-4 sm:px-1 lg:px-6">
        <header className="rounded-3xl border border-cyan-900/60 bg-slate-900/65 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-yellow-200">
                CV + Experimental Insights
              </p>
              <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                Microbubble Analysis Dashboard
              </h1>
            </div>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-cyan-900/60 bg-slate-900/70 p-6 shadow-xl backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-cyan-100">Upload Micrographic Image</h2>

            <label
              className={`mt-5 block cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
                dragActive
                  ? "border-emerald-300 bg-emerald-500/10"
                  : "border-cyan-700/60 bg-slate-800/40 hover:border-cyan-400 hover:bg-cyan-500/10"
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
              <p className="text-base font-medium text-cyan-100">
                {file ? file.name : "Drag and drop an image here"}
              </p>
              <p className="mt-2 text-sm text-slate-300">or click to browse</p>
            </label>

            {error && (
              <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                {error}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-linear-to-r from-emerald-500 to-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {loading ? "Processing Image..." : "Analyze Image"}
            </button>

            {result && (
              <div className="mt-5 rounded-2xl border border-cyan-900/60 bg-slate-800/40 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">Quick Metrics</h3>
                <div className="mt-3 space-y-3 text-md">
                  <div className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2">
                    <span className="text-slate-300">Bubble Count</span>
                    <span className="font-semibold text-yellow-200">{result.count}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2">
                    <span className="text-slate-300">Average Diameter</span>
                    <span className="font-semibold text-cyan-300">{result.avg.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2">
                    <span className="text-slate-300">Standard Deviation</span>
                    <span className="font-semibold text-emerald-300">{result.std.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-cyan-900/60 bg-slate-900/70 p-5 shadow-xl backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-cyan-100">Processed Image</h2>
            {result ? (
              <img
                className="mt-4 h-5/6 w-full object-contain"
                src={`data:image/jpeg;base64,${result.image}`}
                alt="Processed"
              />
            ) : (
              <div className="mt-4 flex h-5/6 items-center justify-center rounded-2xl border border-cyan-700/60 bg-slate-800/30 text-sm text-slate-300">
                Upload an image and run analysis.
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-cyan-900/60 bg-slate-900/60 p-5 shadow-xl backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-yellow-200">Bubble Size Distribution</h2>
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
                        backgroundColor: "rgba(16, 185, 129, 0.8)",
                        borderColor: "rgba(6, 182, 212, 0.9)",
                        borderWidth: 1,
                        borderRadius: 1,
                      },
                    ],
                  }}
                  options={histogramOptions}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-cyan-700/60 bg-slate-800/30 text-sm text-slate-300">
                  Histogram will appear after analysis.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-cyan-900/60 bg-slate-900/60 p-5 shadow-xl backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-yellow-200">Bubble Diameters</h2>
            <div className="mt-4 h-110">
              {result ? (
                <Scatter
                  key={"scatter"}
                  data={{
                    datasets: [
                      {
                        label: "Diameter",
                        data: result.diameters.map((diameter, index) => ({ x: index + 1, y: diameter })),
                        backgroundColor: "rgba(34, 211, 238, 0.9)",
                        borderColor: "rgba(16, 185, 129, 1)",
                        pointRadius: 4,
                      },
                    ],
                  }}
                  options={scatterOptions}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-cyan-700/60 bg-slate-800/30 text-sm text-slate-300">
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