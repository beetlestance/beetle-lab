// Shared Chart.js factory — same look across live and replay.
import { fmtSeconds } from "./api.js";

export function makeLineChart(canvasId, datasets, opts = {}) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280, easing: "easeOutQuart" },
      animations: { y: { duration: 280, easing: "easeOutQuart" } },
      parsing: false,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: {
            color: "#9ca3af",
            font: { size: 10, weight: "500" },
            boxWidth: 10,
            boxHeight: 10,
            // Force filled swatches — Chart.js draws outline-only boxes when
            // a dataset has no backgroundColor. We synthesize labels so every
            // legend marker is a solid square in the dataset's line color.
            generateLabels(chart) {
              return chart.data.datasets.map((ds, i) => ({
                text: ds.label,
                fillStyle: ds.borderColor,
                strokeStyle: ds.borderColor,
                lineWidth: 0,
                hidden: !chart.isDatasetVisible(i),
                index: i,
                datasetIndex: i,
              }));
            },
          },
          onClick(_e, item, legend) {
            const ci = legend.chart;
            ci.setDatasetVisibility(item.datasetIndex, !ci.isDatasetVisible(item.datasetIndex));
            ci.update();
          },
        },
        tooltip: {
          backgroundColor: "rgba(17,20,26,0.95)",
          borderColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          padding: 10,
          titleColor: "#e6edf3",
          bodyColor: "#e6edf3",
          titleFont: { size: 11, weight: "600" },
          bodyFont: { size: 11, family: "JetBrains Mono, ui-monospace, Menlo, monospace" },
          callbacks: {
            title: (items) => fmtSeconds(items[0].parsed.x) + " elapsed",
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: opts.xMax,
          ticks: {
            color: "#8a93a3",
            maxTicksLimit: 8,
            font: { size: 10 },
            callback: (v) => fmtSeconds(v),
          },
          grid: { color: "rgba(127,127,127,0.12)", drawTicks: false },
          border: { color: "rgba(127,127,127,0.18)" },
        },
        y: {
          ticks: { color: "#8a93a3", font: { size: 10 } },
          grid: { color: "rgba(127,127,127,0.10)", drawTicks: false },
          border: { display: false },
          beginAtZero: true,
        },
      },
      elements: {
        point: { radius: 0, hitRadius: 8 },
        line: { borderWidth: 1.8, tension: 0.3 },
      },
      interaction: { mode: "nearest", axis: "x", intersect: false },
    },
  });
}

export function setAxisMax(charts, xMax) {
  for (const c of Object.values(charts)) {
    c.options.scales.x.max = xMax || undefined;
  }
}
