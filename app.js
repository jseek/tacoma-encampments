const GEOJSON_FILE = "ES_Encampment_Cleaning_Tracking_-6983636614921870482.geojson";

const palette = {
  Maintenance: "#00d1ff",
  Removal: "#ff6b6b",
  Unknown: "#ffd166",
};

const map = L.map("map", {
  preferCanvas: true,
}).setView([47.2529, -122.4443], 12);

const darkTiles = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }
);

const lightTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
});

darkTiles.addTo(map);

const clusters = L.markerClusterGroup({
  showCoverageOnHover: false,
  disableClusteringAtZoom: 16,
  maxClusterRadius: 45,
});

let allFeatures = [];
let currentLayer = null;
let hasFittedToData = false;

function toDisplay(value) {
  return value === null || value === undefined || value === "" ? "N/A" : value;
}

function toDate(value) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function markerForType(type) {
  const color = palette[type] || palette.Unknown;
  return {
    radius: 6,
    weight: 2,
    opacity: 1,
    color: "#f4f8ff",
    fillColor: color,
    fillOpacity: 0.92,
  };
}

function popupContent(properties) {
  return `
    <dl class="popup-grid">
      <dt>Cleanup Type</dt><dd>${toDisplay(properties.type_of_cleanup)}</dd>
      <dt>Submitted</dt><dd>${toDate(properties.work_submitted_date)}</dd>
      <dt>Created</dt><dd>${toDate(properties.created_date)}</dd>
      <dt>Created User</dt><dd>${toDisplay(properties.created_user)}</dd>
      <dt>Other Notes</dt><dd>${toDisplay(properties.untitled_question_2_other)}</dd>
      <dt>Object ID</dt><dd>${toDisplay(properties.OBJECTID)}</dd>
    </dl>
  `;
}

function renderStats(stats, total) {
  const statsEl = document.getElementById("stats");
  const fragments = [
    `<span class="chip"><span class="dot" style="background:#8ab4f8"></span>Total: ${total.toLocaleString()}</span>`,
  ];

  Object.keys(stats)
    .sort((a, b) => stats[b] - stats[a])
    .forEach((type) => {
      const color = palette[type] || palette.Unknown;
      fragments.push(
        `<span class="chip"><span class="dot" style="background:${color}"></span>${type}: ${stats[type].toLocaleString()}</span>`
      );
    });

  if (!total) {
    fragments.push(`<span class="chip">No points in selected date range</span>`);
  }

  statsEl.innerHTML = fragments.join("");
}

function toInputDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateBoundsFromInputs() {
  const startValue = document.getElementById("filter-start").value;
  const endValue = document.getElementById("filter-end").value;

  const startMs = startValue ? new Date(`${startValue}T00:00:00`).getTime() : null;
  const endMs = endValue ? new Date(`${endValue}T23:59:59.999`).getTime() : null;
  return { startValue, endValue, startMs, endMs };
}

function setFilterSummary(startValue, endValue) {
  const summaryEl = document.getElementById("filter-summary");
  if (!startValue && !endValue) {
    summaryEl.textContent = "All dates";
    return;
  }

  if (startValue && endValue) {
    summaryEl.textContent = `${startValue} to ${endValue}`;
    return;
  }

  if (startValue) {
    summaryEl.textContent = `From ${startValue}`;
    return;
  }

  summaryEl.textContent = `Up to ${endValue}`;
}

function applyDateFilter() {
  const { startValue, endValue, startMs, endMs } = dateBoundsFromInputs();
  const normalizedStart = startMs !== null && endMs !== null && startMs > endMs ? endMs : startMs;
  const normalizedEnd = startMs !== null && endMs !== null && startMs > endMs ? startMs : endMs;

  const filtered = allFeatures.filter((feature) => {
    const rawDate = feature.properties?.work_submitted_date;
    const featureTime = new Date(rawDate).getTime();
    if (Number.isNaN(featureTime)) return false;
    if (normalizedStart !== null && featureTime < normalizedStart) return false;
    if (normalizedEnd !== null && featureTime > normalizedEnd) return false;
    return true;
  });

  renderEncampments(filtered);
  if (startMs !== null && endMs !== null && startMs > endMs) {
    setFilterSummary(endValue, startValue);
  } else {
    setFilterSummary(startValue, endValue);
  }
}

function renderEncampments(features) {
  if (currentLayer) {
    clusters.removeLayer(currentLayer);
  }

  const stats = {};
  let pointCount = 0;

  currentLayer = L.geoJSON(
    { type: "FeatureCollection", features },
    {
      pointToLayer(feature, latlng) {
        const type = feature.properties?.type_of_cleanup || "Unknown";
        stats[type] = (stats[type] || 0) + 1;
        pointCount += 1;
        return L.circleMarker(latlng, markerForType(type));
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(popupContent(feature.properties || {}));
      },
    }
  );

  clusters.addLayer(currentLayer);
  if (!map.hasLayer(clusters)) {
    map.addLayer(clusters);
  }

  renderStats(stats, pointCount);

  const bounds = currentLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function setTheme(theme) {
  const isDark = theme !== "light";
  document.body.classList.toggle("theme-light", !isDark);
  document.body.classList.toggle("theme-dark", isDark);

  if (isDark) {
    if (map.hasLayer(lightTiles)) map.removeLayer(lightTiles);
    if (!map.hasLayer(darkTiles)) darkTiles.addTo(map);
  } else {
    if (map.hasLayer(darkTiles)) map.removeLayer(darkTiles);
    if (!map.hasLayer(lightTiles)) lightTiles.addTo(map);
  }

  document.getElementById("theme-dark").classList.toggle("is-active", isDark);
  document.getElementById("theme-light").classList.toggle("is-active", !isDark);
}

async function loadEncampments() {
  const response = await fetch(GEOJSON_FILE);
  if (!response.ok) {
    throw new Error(`Unable to load ${GEOJSON_FILE}: HTTP ${response.status}`);
  }

  const data = await response.json();
  allFeatures = data.features || [];
  renderEncampments(allFeatures);

  const dates = allFeatures
    .map((feature) => toInputDate(feature.properties?.work_submitted_date))
    .filter(Boolean)
    .sort();

  if (dates.length) {
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const startInput = document.getElementById("filter-start");
    const endInput = document.getElementById("filter-end");
    startInput.min = minDate;
    startInput.max = maxDate;
    endInput.min = minDate;
    endInput.max = maxDate;
  }
}

loadEncampments().catch((err) => {
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = `<span class="chip">Failed to load data: ${err.message}</span>`;
  // eslint-disable-next-line no-console
  console.error(err);
});

document.getElementById("theme-dark").addEventListener("click", () => setTheme("dark"));
document.getElementById("theme-light").addEventListener("click", () => setTheme("light"));
document.getElementById("apply-date-filter").addEventListener("click", applyDateFilter);
document.getElementById("clear-date-filter").addEventListener("click", () => {
  document.getElementById("filter-start").value = "";
  document.getElementById("filter-end").value = "";
  applyDateFilter();
});
document.getElementById("filter-start").addEventListener("change", applyDateFilter);
document.getElementById("filter-end").addEventListener("change", applyDateFilter);

setTheme("dark");
