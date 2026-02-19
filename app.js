const ENCAMPMENT_FILE = "ES_Encampment_Cleaning_Tracking_-6983636614921870482.geojson";
const REPORTS_311_FILE = "SeeClickFix_Requests_-6061433369715674122.geojson";

const sourcePalette = {
  encampment: "#00d1ff",
  "311": "#ff7f50",
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

function toInputDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function markerForSource(source) {
  const color = sourcePalette[source] || "#ffd166";
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
  if (properties._source === "311") {
    return `
      <dl class="popup-grid">
        <dt>Source</dt><dd>311</dd>
        <dt>Created</dt><dd>${toDate(properties._date)}</dd>
        <dt>Status</dt><dd>${toDisplay(properties.status)}</dd>
        <dt>Category</dt><dd>${toDisplay(properties.category)}</dd>
        <dt>Address</dt><dd>${toDisplay(properties.address)}</dd>
        <dt>Agency</dt><dd>${toDisplay(properties.agency)}</dd>
        <dt>Report ID</dt><dd>${toDisplay(properties.id)}</dd>
      </dl>
    `;
  }

  return `
    <dl class="popup-grid">
      <dt>Source</dt><dd>Encampment Cleaning</dd>
      <dt>Submitted</dt><dd>${toDate(properties._date)}</dd>
      <dt>Cleanup Type</dt><dd>${toDisplay(properties.type_of_cleanup)}</dd>
      <dt>Created</dt><dd>${toDate(properties.created_date)}</dd>
      <dt>Created User</dt><dd>${toDisplay(properties.created_user)}</dd>
      <dt>Other Notes</dt><dd>${toDisplay(properties.untitled_question_2_other)}</dd>
      <dt>Object ID</dt><dd>${toDisplay(properties.OBJECTID)}</dd>
    </dl>
  `;
}

function renderStats(total, sourceCounts) {
  const statsEl = document.getElementById("stats");
  const fragments = [
    `<span class="chip"><span class="dot" style="background:#8ab4f8"></span>Total: ${total.toLocaleString()}</span>`,
    `<span class="chip"><span class="dot" style="background:${sourcePalette.encampment}"></span>Encampment Cleaning: ${(sourceCounts.encampment || 0).toLocaleString()}</span>`,
    `<span class="chip"><span class="dot" style="background:${sourcePalette["311"]}"></span>311: ${(sourceCounts["311"] || 0).toLocaleString()}</span>`,
  ];

  if (!total) {
    fragments.push(`<span class="chip">No points in selected filter range</span>`);
  }

  statsEl.innerHTML = fragments.join("");
}

function setFilterSummary(startValue, endValue, sourceValue) {
  const summaryEl = document.getElementById("filter-summary");
  const sourceLabel =
    sourceValue === "encampment"
      ? "Encampment Cleaning"
      : sourceValue === "311"
        ? "311"
        : "Both sources";

  if (!startValue && !endValue) {
    summaryEl.textContent = `${sourceLabel} | All dates`;
    return;
  }

  if (startValue && endValue) {
    summaryEl.textContent = `${sourceLabel} | ${startValue} to ${endValue}`;
    return;
  }

  if (startValue) {
    summaryEl.textContent = `${sourceLabel} | From ${startValue}`;
    return;
  }

  summaryEl.textContent = `${sourceLabel} | Up to ${endValue}`;
}

function dateBoundsFromInputs() {
  const startValue = document.getElementById("filter-start").value;
  const endValue = document.getElementById("filter-end").value;

  const startMs = startValue ? new Date(`${startValue}T00:00:00`).getTime() : null;
  const endMs = endValue ? new Date(`${endValue}T23:59:59.999`).getTime() : null;
  return { startValue, endValue, startMs, endMs };
}

function renderEncampments(features) {
  if (currentLayer) {
    clusters.removeLayer(currentLayer);
  }

  const sourceCounts = {
    encampment: 0,
    "311": 0,
  };

  currentLayer = L.geoJSON(
    { type: "FeatureCollection", features },
    {
      pointToLayer(feature, latlng) {
        const source = feature.properties?._source || "encampment";
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
        return L.circleMarker(latlng, markerForSource(source));
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

  renderStats(features.length, sourceCounts);

  const bounds = currentLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function applyFilters() {
  const { startValue, endValue, startMs, endMs } = dateBoundsFromInputs();
  const sourceValue = document.getElementById("filter-source").value;
  const normalizedStart = startMs !== null && endMs !== null && startMs > endMs ? endMs : startMs;
  const normalizedEnd = startMs !== null && endMs !== null && startMs > endMs ? startMs : endMs;

  const filtered = allFeatures.filter((feature) => {
    const source = feature.properties?._source;
    if (sourceValue !== "both" && source !== sourceValue) {
      return false;
    }

    const featureTime = new Date(feature.properties?._date).getTime();
    if (Number.isNaN(featureTime)) return false;
    if (normalizedStart !== null && featureTime < normalizedStart) return false;
    if (normalizedEnd !== null && featureTime > normalizedEnd) return false;
    return true;
  });

  renderEncampments(filtered);
  if (startMs !== null && endMs !== null && startMs > endMs) {
    setFilterSummary(endValue, startValue, sourceValue);
  } else {
    setFilterSummary(startValue, endValue, sourceValue);
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

async function loadGeojson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeEncampmentFeature(feature) {
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      _source: "encampment",
      _date: feature.properties?.work_submitted_date,
    },
  };
}

function normalize311Feature(feature) {
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      _source: "311",
      _date: feature.properties?.created_at,
    },
  };
}

function updateDateInputBounds(features) {
  const dates = features
    .map((feature) => toInputDate(feature.properties?._date))
    .filter(Boolean)
    .sort();

  if (!dates.length) return;

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const startInput = document.getElementById("filter-start");
  const endInput = document.getElementById("filter-end");
  startInput.min = minDate;
  startInput.max = maxDate;
  endInput.min = minDate;
  endInput.max = maxDate;
}

async function loadData() {
  const [encampmentData, reportsData] = await Promise.all([
    loadGeojson(ENCAMPMENT_FILE),
    loadGeojson(REPORTS_311_FILE),
  ]);

  const encampmentFeatures = (encampmentData.features || []).map(normalizeEncampmentFeature);
  const reportsFeatures = (reportsData.features || []).map(normalize311Feature);
  allFeatures = [...encampmentFeatures, ...reportsFeatures];

  updateDateInputBounds(allFeatures);
  applyFilters();
}

loadData().catch((err) => {
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = `<span class="chip">Failed to load data: ${err.message}</span>`;
  // eslint-disable-next-line no-console
  console.error(err);
});

document.getElementById("theme-dark").addEventListener("click", () => setTheme("dark"));
document.getElementById("theme-light").addEventListener("click", () => setTheme("light"));
document.getElementById("apply-date-filter").addEventListener("click", applyFilters);
document.getElementById("clear-date-filter").addEventListener("click", () => {
  document.getElementById("filter-start").value = "";
  document.getElementById("filter-end").value = "";
  applyFilters();
});
document.getElementById("filter-start").addEventListener("change", applyFilters);
document.getElementById("filter-end").addEventListener("change", applyFilters);
document.getElementById("filter-source").addEventListener("change", applyFilters);

setTheme("dark");
