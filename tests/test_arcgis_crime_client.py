import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from arcgis_crime_client import ArcGISCrimeClient, SpatialMode


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status = status

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class ArcGISCrimeClientTests(unittest.TestCase):
    def setUp(self):
        self.client = ArcGISCrimeClient(
            base_url="https://example.com/query",
            metadata_url="https://example.com/meta",
            max_retries=0,
        )

    def test_bbox_from_point(self):
        bbox = self.client.bbox_from_point(47.25, -122.44, 1000)
        self.assertLess(bbox["min_lat"], 47.25)
        self.assertGreater(bbox["max_lat"], 47.25)
        self.assertLess(bbox["min_lng"], -122.44)
        self.assertGreater(bbox["max_lng"], -122.44)

    def test_epoch_ms_conversion(self):
        dt = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(self.client.to_epoch_ms(dt), 1735689600000)

    def test_where_clause_composition_and_escaping(self):
        where = self.client.build_where_filters(
            offense_categories=["Assault", "Kid's Crime"],
            premise_types=["Home"],
            gang_related=True,
            hate_bias=False,
        )
        self.assertIn("Offense_Category IN ('Assault', 'Kid''s Crime')", where)
        self.assertIn("Premise_Type IN ('Home')", where)
        self.assertIn("Gang_Related = 1", where)
        self.assertIn("Hate_Bias = 0", where)

    def test_query_records_pagination(self):
        calls = []

        def fake_urlopen(req, timeout=0):
            url = req.full_url
            calls.append(url)
            if "meta" in url:
                return FakeResponse({"maxRecordCount": 2, "fields": []})
            if "resultOffset=0" in url:
                return FakeResponse(
                    {
                        "features": [
                            {"attributes": {"CaseNo": "1"}},
                            {"attributes": {"CaseNo": "2"}},
                        ]
                    }
                )
            if "resultOffset=2" in url:
                return FakeResponse({"features": [{"attributes": {"CaseNo": "3"}}]})
            return FakeResponse({"features": []})

        with patch("arcgis_crime_client.request.urlopen", side_effect=fake_urlopen):
            records = self.client.query_records(
                where="1=1",
                center_lat=47.2,
                center_lng=-122.4,
                radius_ft=1000,
                mode=SpatialMode.CIRCLE,
                page_size=2,
            )

        self.assertEqual(len(records), 3)
        self.assertTrue(any("resultOffset=0" in c for c in calls))
        self.assertTrue(any("resultOffset=2" in c for c in calls))


if __name__ == "__main__":
    unittest.main()
