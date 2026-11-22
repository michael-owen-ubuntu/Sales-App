"""Find possible Google Place IDs from a known public business name and address."""

import argparse
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from .upload import NoRedirects


def lookup(name, address, key):
    request = Request("https://places.googleapis.com/v1/places:searchText", method="POST",
                      headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                               "X-Goog-FieldMask": "places.id"},
                      data=json.dumps({"textQuery": f"{name}, {address}, Indonesia", "regionCode": "ID", "pageSize": 5}).encode())
    with build_opener(NoRedirects()).open(request, timeout=8) as response:
        body = response.read(32769)
    if len(body) > 32768:
        raise ValueError("Google Places returned an oversized response.")
    return [p["id"] for p in json.loads(body).get("places", [])[:5] if re.fullmatch(r"[A-Za-z0-9_-]{6,512}", p.get("id", ""))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("company")
    parser.add_argument("address")
    args = parser.parse_args()
    key = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
    if not key or not args.company.strip() or not args.address.strip() or len(args.company) + len(args.address) > 500:
        parser.error("Set GOOGLE_PLACES_API_KEY and provide a public company name and address.")
    try:
        ids = lookup(args.company, args.address, key)
    except HTTPError as error:
        sys.exit(f"Google Places request failed (HTTP {error.code}).")
    except (URLError, ValueError, TimeoutError, OSError):
        sys.exit("Google Places lookup failed.")
    for place_id in ids:
        from urllib.parse import urlencode
        print(place_id, "https://www.google.com/maps/search/?" + urlencode(
            {"api": 1, "query": f"{args.company}, {args.address}, Indonesia", "query_place_id": place_id},
        ))
    if not ids:
        print("No possible matches returned.")


if __name__ == "__main__":
    main()
