# Tacoma Encampment Cleanup Map

This repo serves a static Leaflet map using:

- `data/ES_Encampment_Cleaning_Tracking.geojson`
- `data/SeeClickFix_Requests.geojson`

## Run locally with Docker

```bash
docker compose up --build
```

Open:

- http://localhost:8080

Stop:

```bash
docker compose down
```


## Data refresh automation

The `data/ES_Encampment_Cleaning_Tracking.geojson` file is refreshed from the City of Tacoma ArcGIS endpoint using `scripts/update_encampment_data.sh`.

A GitHub Actions workflow (`.github/workflows/update-encampment-data.yml`) runs:

- Daily at 08:00 UTC
- On pushes to `main` (including merges)
- On manual trigger (`workflow_dispatch`)

When source data changes, the workflow commits the updated GeoJSON back to the repository automatically.
