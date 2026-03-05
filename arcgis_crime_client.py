from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta, timezone
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional
from urllib import error, parse, request


class SpatialMode(str, Enum):
    CIRCLE = "circle"
    BBOX = "bbox"
    AUTO = "auto"


DEFAULT_OUT_FIELDS = [
    "NCD_neighborhood",
    "Description",
    "CaseNo",
    "Division",
    "Latitude",
    "Longitude",
    "Offense_Category",
    "OffenseCode",
    "IBR_OffenseCode",
    "sec_subsector",
    "Sector",
    "Subsector",
    "Address",
    "DateOccurred",
    "Approximate_Time",
    "Crimes_Against",
    "Premise_Type",
    "Gang_Related",
    "Hate_Bias",
    "TPD_District",
    "TPD_Reporting_Block",
    "NCD_name",
    "NBD_name",
]


@dataclass
class QueryFilters:
    offense_categories: Optional[List[str]] = None
    premise_types: Optional[List[str]] = None
    gang_related: Optional[bool] = None
    hate_bias: Optional[bool] = None


class ArcGISCrimeClient:
    def __init__(
        self,
        base_url: str,
        metadata_url: str,
        default_out_fields: Optional[List[str]] = None,
        default_out_sr: int = 4326,
        timeout: float = 20.0,
        max_retries: int = 3,
        retry_backoff_seconds: float = 0.5,
    ) -> None:
        self.base_url = base_url
        self.metadata_url = metadata_url
        self.default_out_fields = default_out_fields or DEFAULT_OUT_FIELDS
        self.default_out_sr = default_out_sr
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff_seconds = retry_backoff_seconds
        self._metadata_cache: Optional[Dict[str, Any]] = None

    def get_layer_metadata(self, refresh: bool = False) -> Dict[str, Any]:
        if self._metadata_cache is not None and not refresh:
            return self._metadata_cache
        self._metadata_cache = self._request_json(self.metadata_url, {"f": "pjson"})
        return self._metadata_cache

    @staticmethod
    def to_epoch_ms(value: datetime) -> int:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return int(value.timestamp() * 1000)

    @staticmethod
    def bbox_from_point(center_lat: float, center_lng: float, radius_ft: int) -> Dict[str, float]:
        lat_delta = radius_ft / 364000.0
        cos_lat = math.cos(math.radians(center_lat))
        if abs(cos_lat) < 1e-8:
            cos_lat = 1e-8
        lon_delta = radius_ft / (364000.0 * cos_lat)
        return {
            "min_lat": center_lat - lat_delta,
            "max_lat": center_lat + lat_delta,
            "min_lng": center_lng - lon_delta,
            "max_lng": center_lng + lon_delta,
        }

    def _resolve_date_field(self) -> str:
        metadata = self.get_layer_metadata()
        fields = metadata.get("fields", [])
        preferred = next((f for f in fields if f.get("name") == "DateOccurred"), None)
        if preferred and preferred.get("type") == "esriFieldTypeDate":
            return preferred["name"]
        for field in fields:
            if field.get("type") == "esriFieldTypeDate":
                return field["name"]
        return "DateOccurred"

    def build_where_date_range(self, start_dt: datetime, end_dt: datetime) -> str:
        date_field = self._resolve_date_field()
        start_ms = self.to_epoch_ms(start_dt)
        end_ms = self.to_epoch_ms(end_dt)
        where = f"{date_field} >= {start_ms} AND {date_field} < {end_ms}"
        self._validate_where(where)
        return where

    @staticmethod
    def _sql_escape(value: str) -> str:
        return value.replace("'", "''")

    def build_where_filters(
        self,
        offense_categories: Optional[Iterable[str]] = None,
        premise_types: Optional[Iterable[str]] = None,
        gang_related: Optional[bool] = None,
        hate_bias: Optional[bool] = None,
    ) -> str:
        clauses: List[str] = []

        def in_clause(field: str, values: Optional[Iterable[str]]) -> None:
            if not values:
                return
            items = [v for v in values if v is not None and str(v).strip() != ""]
            if not items:
                return
            escaped = ", ".join(f"'{self._sql_escape(str(v))}'" for v in items)
            clauses.append(f"{field} IN ({escaped})")

        in_clause("Offense_Category", offense_categories)
        in_clause("Premise_Type", premise_types)

        if gang_related is not None:
            clauses.append(f"Gang_Related = {'1' if gang_related else '0'}")
        if hate_bias is not None:
            clauses.append(f"Hate_Bias = {'1' if hate_bias else '0'}")

        return " AND ".join(clauses)

    def _build_spatial(self, center_lat: float, center_lng: float, radius_ft: int, mode: SpatialMode) -> Dict[str, str]:
        if mode == SpatialMode.CIRCLE:
            return {
                "geometry": f"{center_lng},{center_lat}",
                "geometryType": "esriGeometryPoint",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "distance": str(radius_ft * 0.3048),
                "units": "esriSRUnit_Meter",
            }
        if mode == SpatialMode.BBOX:
            bbox = self.bbox_from_point(center_lat, center_lng, radius_ft)
            clause = (
                f"Latitude >= {bbox['min_lat']} AND Latitude <= {bbox['max_lat']} AND "
                f"Longitude >= {bbox['min_lng']} AND Longitude <= {bbox['max_lng']}"
            )
            return {"bbox_where": clause}
        raise ValueError(f"Unsupported spatial mode: {mode}")

    def _compose_where(self, *clauses: str) -> str:
        active = [f"({c})" for c in clauses if c]
        return " AND ".join(active) if active else "1=1"

    def query_count(
        self,
        where: str,
        center_lat: float,
        center_lng: float,
        radius_ft: int,
        mode: SpatialMode,
        timeout: Optional[float] = None,
    ) -> int:
        spatial = self._build_spatial(center_lat, center_lng, radius_ft, mode)
        final_where = self._compose_where(where, spatial.pop("bbox_where", ""))
        params = {
            "where": final_where,
            "returnCountOnly": "true",
            "f": "json",
        }
        params.update(spatial)
        payload = self._request_json(self.base_url, params, timeout=timeout)
        if "count" not in payload:
            raise ValueError(f"ArcGIS count response missing 'count': {payload}")
        return int(payload["count"])

    def query_records(
        self,
        where: str,
        center_lat: float,
        center_lng: float,
        radius_ft: int,
        mode: SpatialMode,
        out_fields: Optional[List[str]] = None,
        page_size: Optional[int] = None,
        timeout: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        out_fields = out_fields or self.default_out_fields
        metadata = self.get_layer_metadata()
        max_record_count = int(metadata.get("maxRecordCount") or 2000)
        page_size = page_size or max_record_count
        page_size = min(page_size, max_record_count)

        spatial = self._build_spatial(center_lat, center_lng, radius_ft, mode)
        final_where = self._compose_where(where, spatial.pop("bbox_where", ""))

        results: List[Dict[str, Any]] = []
        offset = 0

        while True:
            params = {
                "where": final_where,
                "outFields": ",".join(out_fields),
                "outSR": str(self.default_out_sr),
                "returnGeometry": "false",
                "resultOffset": str(offset),
                "resultRecordCount": str(page_size),
                "f": "json",
            }
            params.update(spatial)
            payload = self._request_json(self.base_url, params, timeout=timeout)
            features = payload.get("features", [])
            attrs = [f.get("attributes", f) for f in features]
            results.extend(attrs)
            if len(features) < page_size:
                break
            offset += page_size

        return results

    def query_window_pair(
        self,
        center_lat: float,
        center_lng: float,
        radius_ft: int,
        chosen_date: date,
        mode: SpatialMode = SpatialMode.AUTO,
        include_records: bool = True,
        filters: Optional[QueryFilters] = None,
        out_fields: Optional[List[str]] = None,
        page_size: Optional[int] = None,
        timeout: Optional[float] = None,
        request_debug: bool = False,
    ) -> Dict[str, Any]:
        filters = filters or QueryFilters()
        start_before = datetime.combine(chosen_date - timedelta(days=30), dt_time.min)
        split = datetime.combine(chosen_date, dt_time.min)
        end_after = datetime.combine(chosen_date + timedelta(days=30), dt_time.min)

        base_filters = self.build_where_filters(
            offense_categories=filters.offense_categories,
            premise_types=filters.premise_types,
            gang_related=filters.gang_related,
            hate_bias=filters.hate_bias,
        )

        where_before = self._compose_where(self.build_where_date_range(start_before, split), base_filters)
        where_after = self._compose_where(self.build_where_date_range(split, end_after), base_filters)

        mode_used = mode
        debug: Dict[str, Any] = {}

        if mode == SpatialMode.AUTO:
            mode_used = SpatialMode.CIRCLE
            try:
                cb = self.query_count(where_before, center_lat, center_lng, radius_ft, SpatialMode.CIRCLE, timeout)
                ca = self.query_count(where_after, center_lat, center_lng, radius_ft, SpatialMode.CIRCLE, timeout)
                if cb + ca == 0:
                    bb = self.query_count(where_before, center_lat, center_lng, radius_ft, SpatialMode.BBOX, timeout)
                    ba = self.query_count(where_after, center_lat, center_lng, radius_ft, SpatialMode.BBOX, timeout)
                    if bb + ba > 0:
                        mode_used = SpatialMode.BBOX
                    debug["auto_probe"] = {"circle": cb + ca, "bbox": bb + ba}
            except Exception as exc:
                debug["auto_error"] = str(exc)
                mode_used = SpatialMode.BBOX

        before_count = self.query_count(where_before, center_lat, center_lng, radius_ft, mode_used, timeout)
        after_count = self.query_count(where_after, center_lat, center_lng, radius_ft, mode_used, timeout)

        before_records: List[Dict[str, Any]] = []
        after_records: List[Dict[str, Any]] = []
        if include_records:
            before_records = self.query_records(
                where_before,
                center_lat,
                center_lng,
                radius_ft,
                mode_used,
                out_fields=out_fields,
                page_size=page_size,
                timeout=timeout,
            )
            after_records = self.query_records(
                where_after,
                center_lat,
                center_lng,
                radius_ft,
                mode_used,
                out_fields=out_fields,
                page_size=page_size,
                timeout=timeout,
            )

        return {
            "meta": {
                "mode_used": mode_used.value,
                "page_size": page_size,
                "total_fetched": len(before_records) + len(after_records),
                "request_debug": debug if request_debug else None,
            },
            "before": {
                "start": start_before.date().isoformat(),
                "end": split.date().isoformat(),
                "count": before_count,
                "records": before_records,
            },
            "after": {
                "start": split.date().isoformat(),
                "end": end_after.date().isoformat(),
                "count": after_count,
                "records": after_records,
            },
            "aggregates": self.aggregate_records(before_records, after_records),
        }

    def aggregate_records(
        self,
        before_records: List[Dict[str, Any]],
        after_records: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        after_records = after_records or []

        def summarize(field_getter):
            before_map: Dict[str, int] = {}
            after_map: Dict[str, int] = {}

            for rec in before_records:
                key = field_getter(rec)
                before_map[key] = before_map.get(key, 0) + 1
            for rec in after_records:
                key = field_getter(rec)
                after_map[key] = after_map.get(key, 0) + 1

            all_keys = set(before_map) | set(after_map)
            return {
                key: {
                    "before": before_map.get(key, 0),
                    "after": after_map.get(key, 0),
                    "delta": after_map.get(key, 0) - before_map.get(key, 0),
                }
                for key in sorted(all_keys)
            }

        return {
            "by_offense_category": summarize(lambda r: str(r.get("Offense_Category") or "Unknown")),
            "by_premise_type": summarize(lambda r: str(r.get("Premise_Type") or "Unknown")),
            "by_sector_subsector": summarize(
                lambda r: f"{r.get('Sector') or 'Unknown'}/{r.get('Subsector') or r.get('sec_subsector') or 'Unknown'}"
            ),
            "by_ncd": summarize(lambda r: str(r.get("NCD_name") or r.get("NCD_neighborhood") or "Unknown")),
        }

    def _validate_where(self, where: str) -> None:
        params = {
            "where": where,
            "returnCountOnly": "true",
            "f": "json",
        }
        try:
            self._request_json(self.base_url, params)
        except ValueError as exc:
            raise ValueError(f"Date where validation failed: {exc}") from exc

    def _request_json(
        self,
        url: str,
        params: Dict[str, str],
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        timeout = timeout or self.timeout
        full_url = f"{url}?{parse.urlencode(params)}"

        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                req = request.Request(full_url)
                with request.urlopen(req, timeout=timeout) as resp:
                    status = getattr(resp, "status", 200)
                    body = resp.read().decode("utf-8")
                if status in (429, 500, 502, 503, 504):
                    raise error.HTTPError(full_url, status, "Transient", hdrs=None, fp=None)
                payload = json.loads(body)
                if "error" in payload:
                    detail = payload["error"]
                    raise ValueError(f"ArcGIS error: {detail}")
                return payload
            except (error.HTTPError, error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                status = getattr(exc, "code", None)
                retriable = isinstance(exc, (error.URLError, TimeoutError, json.JSONDecodeError)) or status in {
                    429,
                    500,
                    502,
                    503,
                    504,
                }
                if attempt >= self.max_retries or not retriable:
                    break
                time.sleep(self.retry_backoff_seconds * (2**attempt))

        raise RuntimeError(f"Request failed for {url} params={params}: {last_error}")
