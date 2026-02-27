const ENCAMPMENT_FILE = "data/ES_Encampment_Cleaning_Tracking.geojson";
const REPORTS_311_FILE = "data/SeeClickFix_Requests.geojson";
const POLICE_BLOCKS_FILE = "data/Police_Reporting_Blocks.geojson";
const CITY_COUNCIL_FILE = "data/City_Council_Districts.geojson";
const NEIGHBORHOOD_COUNCIL_FILE = "data/Neighborhood_Council_Districts.geojson";

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
let policeBlocksData = null;
let policeBlocksLayer = null;
let cityCouncilData = null;
let cityCouncilLayer = null;
let neighborhoodCouncilData = null;
let neighborhoodCouncilLayer = null;
let hasFittedToData = false;
const policeBlockNamesById = new Map();
const councilDistrictNamesById = new Map();

function byId(id) {
  return document.getElementById(id);
}

function valueById(id, fallback = "") {
  const el = byId(id);
  return el ? el.value : fallback;
}

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


function summarizeFeatures(features, days = 30) {
  const now = Date.now();
  const windowStart = now - days * 24 * 60 * 60 * 1000;
  const sourceCounts = {
    encampment: 0,
    "311": 0,
  };

  let recentEncampmentCount = 0;

  for (const feature of features) {
    const source = feature.properties?._source || "encampment";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    if (source !== "encampment") continue;
    const time = new Date(feature.properties?._date).getTime();
    if (Number.isNaN(time)) continue;
    if (time >= windowStart && time <= now) {
      recentEncampmentCount += 1;
    }
  }

  return {
    total: features.length,
    sourceCounts,
    recentEncampmentCount,
    now,
    windowStart,
  };
}


function recentEncampmentCleanups(features, limit = 25) {
  return features
    .filter((feature) => feature.properties?._source === "encampment")
    .map((feature) => {
      const timestamp = new Date(feature.properties?._date).getTime();
      return {
        feature,
        timestamp,
      };
    })
    .filter((item) => !Number.isNaN(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((item) => item.feature);
}

function renderRecentCleanupTable(features) {
  const tbody = byId("recent-cleanups-body");
  if (!tbody) return;

  const cleanups = recentEncampmentCleanups(features);
  if (!cleanups.length) {
    tbody.innerHTML =
      '<tr><td colspan="7">No encampment cleanups for the current filter.</td></tr>';
    return;
  }

  tbody.innerHTML = cleanups
    .map((feature) => {
      const properties = feature.properties || {};
      const [lon, lat] = feature.geometry?.coordinates || [];
      const blockLabel =
        policeBlockNamesById.get(properties._blockObjectId) ||
        (properties._blockObjectId ? `Block ${properties._blockObjectId}` : "N/A");
      const districtLabel =
        councilDistrictNamesById.get(properties._councilObjectId) ||
        (properties._councilObjectId ? `District ${properties._councilObjectId}` : "N/A");
      return `
        <tr class="cleanup-row" data-lat="${lat}" data-lon="${lon}">
          <td>${toDate(properties._date)}</td>
          <td>${toDisplay(properties.type_of_cleanup)}</td>
          <td>${toDisplay(districtLabel)}</td>
          <td>${toDisplay(blockLabel)}</td>
          <td>${toDate(properties.created_date)}</td>
          <td>${toDisplay(properties.created_user)}</td>
          <td>${toDisplay(properties.untitled_question_2_other)}</td>
        </tr>
      `;
    })
    .join("");

  for (const row of tbody.querySelectorAll("tr.cleanup-row")) {
    row.addEventListener("click", () => {
      const lat = Number(row.dataset.lat);
      const lon = Number(row.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
    });
  }
}
function renderRecentCleanupCount(stats) {
  const recentEl = byId("recent-cleanups");
  if (!recentEl) return;

  recentEl.textContent = `Encampments cleaned in the past 30 days: ${stats.recentEncampmentCount.toLocaleString()}`;
}

function renderStats(total, sourceCounts) {
  const statsEl = byId("stats");
  if (!statsEl) return;
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
  const summaryEl = byId("filter-summary");
  if (!summaryEl) return;
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
  const startValue = valueById("filter-start", "");
  const endValue = valueById("filter-end", "");

  const startMs = startValue ? new Date(`${startValue}T00:00:00`).getTime() : null;
  const endMs = endValue ? new Date(`${endValue}T23:59:59.999`).getTime() : null;
  return { startValue, endValue, startMs, endMs };
}

function clearActiveLayers() {
  if (currentLayer) {
    clusters.removeLayer(currentLayer);
    currentLayer = null;
  }

  if (map.hasLayer(clusters)) {
    map.removeLayer(clusters);
  }

  if (policeBlocksLayer) {
    map.removeLayer(policeBlocksLayer);
    policeBlocksLayer = null;
  }

  if (cityCouncilLayer) {
    map.removeLayer(cityCouncilLayer);
    cityCouncilLayer = null;
  }

  if (neighborhoodCouncilLayer) {
    map.removeLayer(neighborhoodCouncilLayer);
    neighborhoodCouncilLayer = null;
  }
}

function renderEncampments(features) {
  clearActiveLayers();

  const stats = summarizeFeatures(features);

  currentLayer = L.geoJSON(
    { type: "FeatureCollection", features },
    {
      pointToLayer(feature, latlng) {
        const source = feature.properties?._source || "encampment";
        return L.circleMarker(latlng, markerForSource(source));
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(popupContent(feature.properties || {}));
      },
    }
  );

  clusters.addLayer(currentLayer);
  map.addLayer(clusters);

  renderStats(stats.total, stats.sourceCounts);
  renderRecentCleanupCount(stats);

  const bounds = currentLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function bboxFromCoordinates(coords, bbox = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (!Array.isArray(coords)) return bbox;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [x, y] = coords;
    if (x < bbox[0]) bbox[0] = x;
    if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x;
    if (y > bbox[3]) bbox[3] = y;
    return bbox;
  }

  for (const item of coords) {
    bboxFromCoordinates(item, bbox);
  }
  return bbox;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point, polygonCoords) {
  if (!polygonCoords.length) return false;
  if (!pointInRing(point, polygonCoords[0])) return false;

  for (let i = 1; i < polygonCoords.length; i += 1) {
    if (pointInRing(point, polygonCoords[i])) {
      return false;
    }
  }

  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;

  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates || []);
  }

  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates || []) {
      if (pointInPolygon(point, polygon)) return true;
    }
  }

  return false;
}

function getBlockFillColor(count, maxCount) {
  if (!count) return "#4b5f79";
  if (!maxCount) return "#4b5f79";

  const ratio = count / maxCount;
  if (ratio > 0.8) return "#ff8a80";
  if (ratio > 0.6) return "#ffab91";
  if (ratio > 0.4) return "#ffcc80";
  if (ratio > 0.2) return "#ffe082";
  return "#fff3bf";
}

function renderPoliceBlocks(features) {
  if (!policeBlocksData) return;

  clearActiveLayers();

  const stats = summarizeFeatures(features);
  const countsByBlockId = {};
  const areaStatsByBlockId = {};

  for (const feature of features) {
    const source = feature.properties?._source || "encampment";
    const blockId = feature.properties?._blockObjectId;
    if (!blockId) continue;

    countsByBlockId[blockId] = (countsByBlockId[blockId] || 0) + 1;

    if (!areaStatsByBlockId[blockId]) {
      areaStatsByBlockId[blockId] = { encampmentTotal: 0, encampmentRecent30: 0 };
    }

    if (source === "encampment") {
      areaStatsByBlockId[blockId].encampmentTotal += 1;
      const time = new Date(feature.properties?._date).getTime();
      if (!Number.isNaN(time) && time >= stats.windowStart && time <= stats.now) {
        areaStatsByBlockId[blockId].encampmentRecent30 += 1;
      }
    }
  }

  const maxCount = Math.max(0, ...Object.values(countsByBlockId));

  const decoratedBlocks = {
    type: "FeatureCollection",
    features: (policeBlocksData.features || []).map((feature) => {
      const blockId = feature.properties?.objectid;
      const count = countsByBlockId[blockId] || 0;
      const areaStats = areaStatsByBlockId[blockId] || { encampmentTotal: 0, encampmentRecent30: 0 };
      return {
        ...feature,
        properties: {
          ...feature.properties,
          _count: count,
          _encampmentTotal: areaStats.encampmentTotal,
          _encampmentRecent30: areaStats.encampmentRecent30,
        },
      };
    }),
  };

  policeBlocksLayer = L.geoJSON(decoratedBlocks, {
    style(feature) {
      const count = feature?.properties?._count || 0;
      return {
        color: "#8ea3bd",
        weight: 1,
        fillOpacity: count ? 0.58 : 0.14,
        fillColor: getBlockFillColor(count, maxCount),
      };
    },
    onEachFeature(feature, layer) {
      const props = feature.properties || {};
      layer.bindPopup(`
        <dl class="popup-grid">
          <dt>Reporting Block</dt><dd>${toDisplay(props.reportingblock)}</dd>
          <dt>Sector-Subsector</dt><dd>${toDisplay(props.sectorsubsectorstring)}</dd>
          <dt>Issues/Cleanups</dt><dd>${(props._count || 0).toLocaleString()}</dd>
          <dt>Encampments (30 days)</dt><dd>${(props._encampmentRecent30 || 0).toLocaleString()}</dd>
          <dt>Encampments (filtered)</dt><dd>${(props._encampmentTotal || 0).toLocaleString()}</dd>
        </dl>
      `);
    },
  });

  policeBlocksLayer.addTo(map);
  renderStats(stats.total, stats.sourceCounts);
  renderRecentCleanupCount(stats);

  const bounds = policeBlocksLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function renderCityCouncilDistricts(features) {
  if (!cityCouncilData) return;

  clearActiveLayers();

  const stats = summarizeFeatures(features);
  const countsByDistrictId = {};
  const areaStatsByDistrictId = {};

  for (const feature of features) {
    const source = feature.properties?._source || "encampment";
    const districtId = feature.properties?._councilObjectId;
    if (!districtId) continue;

    countsByDistrictId[districtId] = (countsByDistrictId[districtId] || 0) + 1;

    if (!areaStatsByDistrictId[districtId]) {
      areaStatsByDistrictId[districtId] = { encampmentTotal: 0, encampmentRecent30: 0 };
    }

    if (source === "encampment") {
      areaStatsByDistrictId[districtId].encampmentTotal += 1;
      const time = new Date(feature.properties?._date).getTime();
      if (!Number.isNaN(time) && time >= stats.windowStart && time <= stats.now) {
        areaStatsByDistrictId[districtId].encampmentRecent30 += 1;
      }
    }
  }

  const maxCount = Math.max(0, ...Object.values(countsByDistrictId));

  const decoratedDistricts = {
    type: "FeatureCollection",
    features: (cityCouncilData.features || []).map((feature) => {
      const districtId = feature.properties?.objectid;
      const count = countsByDistrictId[districtId] || 0;
      const areaStats = areaStatsByDistrictId[districtId] || { encampmentTotal: 0, encampmentRecent30: 0 };
      return {
        ...feature,
        properties: {
          ...feature.properties,
          _count: count,
          _encampmentTotal: areaStats.encampmentTotal,
          _encampmentRecent30: areaStats.encampmentRecent30,
        },
      };
    }),
  };

  cityCouncilLayer = L.geoJSON(decoratedDistricts, {
    style(feature) {
      const count = feature?.properties?._count || 0;
      return {
        color: "#8ea3bd",
        weight: 1.2,
        fillOpacity: count ? 0.58 : 0.14,
        fillColor: getBlockFillColor(count, maxCount),
      };
    },
    onEachFeature(feature, layer) {
      const props = feature.properties || {};
      layer.bindPopup(`
        <dl class="popup-grid">
          <dt>Council District</dt><dd>${toDisplay(props.district || props.district_text)}</dd>
          <dt>Councilmember</dt><dd>${toDisplay(props.councilmember)}</dd>
          <dt>Issues/Cleanups</dt><dd>${(props._count || 0).toLocaleString()}</dd>
          <dt>Encampments (30 days)</dt><dd>${(props._encampmentRecent30 || 0).toLocaleString()}</dd>
          <dt>Encampments (filtered)</dt><dd>${(props._encampmentTotal || 0).toLocaleString()}</dd>
        </dl>
      `);
    },
  });

  cityCouncilLayer.addTo(map);
  renderStats(stats.total, stats.sourceCounts);
  renderRecentCleanupCount(stats);

  const bounds = cityCouncilLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function renderNeighborhoodCouncilDistricts(features) {
  if (!neighborhoodCouncilData) return;

  clearActiveLayers();

  const stats = summarizeFeatures(features);
  const countsByNeighborhoodId = {};
  const areaStatsByNeighborhoodId = {};

  for (const feature of features) {
    const source = feature.properties?._source || "encampment";
    const neighborhoodId = feature.properties?._neighborhoodObjectId;
    if (!neighborhoodId) continue;

    countsByNeighborhoodId[neighborhoodId] = (countsByNeighborhoodId[neighborhoodId] || 0) + 1;

    if (!areaStatsByNeighborhoodId[neighborhoodId]) {
      areaStatsByNeighborhoodId[neighborhoodId] = { encampmentTotal: 0, encampmentRecent30: 0 };
    }

    if (source === "encampment") {
      areaStatsByNeighborhoodId[neighborhoodId].encampmentTotal += 1;
      const time = new Date(feature.properties?._date).getTime();
      if (!Number.isNaN(time) && time >= stats.windowStart && time <= stats.now) {
        areaStatsByNeighborhoodId[neighborhoodId].encampmentRecent30 += 1;
      }
    }
  }

  const maxCount = Math.max(0, ...Object.values(countsByNeighborhoodId));

  const decoratedNeighborhoods = {
    type: "FeatureCollection",
    features: (neighborhoodCouncilData.features || []).map((feature) => {
      const neighborhoodId = feature.properties?.objectid_1;
      const count = countsByNeighborhoodId[neighborhoodId] || 0;
      const areaStats = areaStatsByNeighborhoodId[neighborhoodId] || {
        encampmentTotal: 0,
        encampmentRecent30: 0,
      };
      return {
        ...feature,
        properties: {
          ...feature.properties,
          _count: count,
          _encampmentTotal: areaStats.encampmentTotal,
          _encampmentRecent30: areaStats.encampmentRecent30,
        },
      };
    }),
  };

  neighborhoodCouncilLayer = L.geoJSON(decoratedNeighborhoods, {
    style(feature) {
      const count = feature?.properties?._count || 0;
      return {
        color: "#8ea3bd",
        weight: 1.2,
        fillOpacity: count ? 0.58 : 0.14,
        fillColor: getBlockFillColor(count, maxCount),
      };
    },
    onEachFeature(feature, layer) {
      const props = feature.properties || {};
      layer.bindPopup(`
        <dl class="popup-grid">
          <dt>Neighborhood Council</dt><dd>${toDisplay(props.name)}</dd>
          <dt>District Name</dt><dd>${toDisplay(props.neighborhood)}</dd>
          <dt>Issues/Cleanups</dt><dd>${(props._count || 0).toLocaleString()}</dd>
          <dt>Encampments (30 days)</dt><dd>${(props._encampmentRecent30 || 0).toLocaleString()}</dd>
          <dt>Encampments (filtered)</dt><dd>${(props._encampmentTotal || 0).toLocaleString()}</dd>
        </dl>
      `);
    },
  });

  neighborhoodCouncilLayer.addTo(map);
  renderStats(stats.total, stats.sourceCounts);
  renderRecentCleanupCount(stats);

  const bounds = neighborhoodCouncilLayer.getBounds();
  if (!hasFittedToData && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
    hasFittedToData = true;
  }
}

function renderCurrentMap(filteredFeatures) {
  const mapType = valueById("map-type", "points");
  if (mapType === "police-blocks") {
    renderPoliceBlocks(filteredFeatures);
    return;
  }
  if (mapType === "city-council") {
    renderCityCouncilDistricts(filteredFeatures);
    return;
  }
  if (mapType === "neighborhood-council") {
    renderNeighborhoodCouncilDistricts(filteredFeatures);
    return;
  }

  renderEncampments(filteredFeatures);
}

function applyFilters() {
  const { startValue, endValue, startMs, endMs } = dateBoundsFromInputs();
  const sourceValue = valueById("filter-source", "both");
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

  renderCurrentMap(filtered);
  renderRecentCleanupTable(filtered);
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

  const themeDarkBtn = byId("theme-dark");
  const themeLightBtn = byId("theme-light");
  if (themeDarkBtn) themeDarkBtn.classList.toggle("is-active", isDark);
  if (themeLightBtn) themeLightBtn.classList.toggle("is-active", !isDark);
}

async function loadGeojson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
  const startInput = byId("filter-start");
  const endInput = byId("filter-end");
  if (!startInput || !endInput) return;
  startInput.min = minDate;
  startInput.max = maxDate;
  endInput.min = minDate;
  endInput.max = maxDate;
}

function assignBlocksToFeatures(features, blocksFeatureCollection) {
  const blocks = (blocksFeatureCollection.features || []).map((feature) => {
    const bbox = bboxFromCoordinates(feature.geometry?.coordinates || []);
    const objectId = feature.properties?.objectid;
    const blockName = feature.properties?.reportingblock || feature.properties?.sectorsubsectorstring;
    if (objectId) {
      policeBlockNamesById.set(objectId, blockName || `Block ${objectId}`);
    }
    return {
      objectId,
      geometry: feature.geometry,
      bbox,
    };
  });

  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const [lon, lat] = coords;
    let matchedBlockId = null;

    for (const block of blocks) {
      const [minX, minY, maxX, maxY] = block.bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (!pointInGeometry([lon, lat], block.geometry)) continue;
      matchedBlockId = block.objectId;
      break;
    }

    feature.properties._blockObjectId = matchedBlockId;
  }
}

function assignCouncilDistrictsToFeatures(features, councilFeatureCollection) {
  const districts = (councilFeatureCollection.features || []).map((feature) => {
    const bbox = bboxFromCoordinates(feature.geometry?.coordinates || []);
    const objectId = feature.properties?.objectid;
    const districtName = feature.properties?.district || feature.properties?.district_text;
    if (objectId) {
      councilDistrictNamesById.set(objectId, districtName || `District ${objectId}`);
    }
    return {
      objectId,
      geometry: feature.geometry,
      bbox,
    };
  });

  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const [lon, lat] = coords;
    let matchedDistrictId = null;

    for (const district of districts) {
      const [minX, minY, maxX, maxY] = district.bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (!pointInGeometry([lon, lat], district.geometry)) continue;
      matchedDistrictId = district.objectId;
      break;
    }

    feature.properties._councilObjectId = matchedDistrictId;
  }
}

function assignNeighborhoodDistrictsToFeatures(features, neighborhoodFeatureCollection) {
  const neighborhoods = (neighborhoodFeatureCollection.features || []).map((feature) => {
    const bbox = bboxFromCoordinates(feature.geometry?.coordinates || []);
    return {
      objectId: feature.properties?.objectid_1,
      geometry: feature.geometry,
      bbox,
    };
  });

  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const [lon, lat] = coords;
    let matchedNeighborhoodId = null;

    for (const neighborhood of neighborhoods) {
      const [minX, minY, maxX, maxY] = neighborhood.bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (!pointInGeometry([lon, lat], neighborhood.geometry)) continue;
      matchedNeighborhoodId = neighborhood.objectId;
      break;
    }

    feature.properties._neighborhoodObjectId = matchedNeighborhoodId;
  }
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

  const [blocksResult, councilResult, neighborhoodResult] = await Promise.allSettled([
    loadGeojson(POLICE_BLOCKS_FILE),
    loadGeojson(CITY_COUNCIL_FILE),
    loadGeojson(NEIGHBORHOOD_COUNCIL_FILE),
  ]);

  if (blocksResult.status === "fulfilled") {
    policeBlocksData = blocksResult.value;
    await yieldToBrowser();
    assignBlocksToFeatures(allFeatures, policeBlocksData);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`Unable to load police blocks layer: ${blocksResult.reason?.message || blocksResult.reason}`);
  }

  if (councilResult.status === "fulfilled") {
    cityCouncilData = councilResult.value;
    await yieldToBrowser();
    assignCouncilDistrictsToFeatures(allFeatures, cityCouncilData);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`Unable to load city council layer: ${councilResult.reason?.message || councilResult.reason}`);
  }

  if (neighborhoodResult.status === "fulfilled") {
    neighborhoodCouncilData = neighborhoodResult.value;
    await yieldToBrowser();
    assignNeighborhoodDistrictsToFeatures(allFeatures, neighborhoodCouncilData);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `Unable to load neighborhood council layer: ${neighborhoodResult.reason?.message || neighborhoodResult.reason}`
    );
  }

  applyFilters();
}

loadData().catch((err) => {
  const statsEl = byId("stats");
  if (statsEl) {
    statsEl.innerHTML = `<span class="chip">Failed to load data: ${err.message}</span>`;
  }
  // eslint-disable-next-line no-console
  console.error(err);
});

const themeDarkBtn = byId("theme-dark");
const themeLightBtn = byId("theme-light");
const applyDateBtn = byId("apply-date-filter");
const clearDateBtn = byId("clear-date-filter");
const filterStartInput = byId("filter-start");
const filterEndInput = byId("filter-end");
const filterSourceSelect = byId("filter-source");
const mapTypeSelect = byId("map-type");

if (themeDarkBtn) themeDarkBtn.addEventListener("click", () => setTheme("dark"));
if (themeLightBtn) themeLightBtn.addEventListener("click", () => setTheme("light"));
if (applyDateBtn) applyDateBtn.addEventListener("click", applyFilters);
if (clearDateBtn) {
  clearDateBtn.addEventListener("click", () => {
    if (filterStartInput) filterStartInput.value = "";
    if (filterEndInput) filterEndInput.value = "";
    applyFilters();
  });
}
if (filterStartInput) filterStartInput.addEventListener("change", applyFilters);
if (filterEndInput) filterEndInput.addEventListener("change", applyFilters);
if (filterSourceSelect) filterSourceSelect.addEventListener("change", applyFilters);
if (mapTypeSelect) mapTypeSelect.addEventListener("change", applyFilters);

setTheme("dark");
