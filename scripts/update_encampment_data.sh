#!/usr/bin/env bash
set -euo pipefail

DATA_URL="https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/ES_Encampment_Cleaning_Tracking/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson"
OUTPUT_FILE="data/ES_Encampment_Cleaning_Tracking.geojson"

curl --fail --silent --show-error --location "$DATA_URL" -o "$OUTPUT_FILE"

python3 - <<'PY'
import json
from pathlib import Path

path = Path("data/ES_Encampment_Cleaning_Tracking.geojson")
with path.open("r", encoding="utf-8") as f:
    payload = json.load(f)

if payload.get("type") != "FeatureCollection":
    raise SystemExit("Downloaded file is not a GeoJSON FeatureCollection")

with path.open("w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

echo "Updated $OUTPUT_FILE"
