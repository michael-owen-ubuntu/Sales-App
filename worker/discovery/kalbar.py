"""Read approved provincial industrial-company open data."""

import hashlib
import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile

from .config import WorkerError
from .extract import Extracted, PROVIDER, normalized

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
HEADERS = ("Nama Perusahaan", "Alamat", "Desa/Kelurahan", "Kecamatan", "Kabupaten/Kota", "Jenis Usaha Industri")
PROVIDER_ACTIVITY = re.compile(r"\b(?:logistik|freight forwarding|pergudangan|angkutan barang|ekspedisi)\b", re.I)


def xml_part(archive, name):
    if archive.getinfo(name).file_size > 1_500_000:
        raise WorkerError("Industrial workbook part exceeded its byte limit.")
    with archive.open(name) as part:
        data = part.read(1_500_001)
    if len(data) > 1_500_000 or re.search(br"<!DOCTYPE|<!ENTITY|\x00", data, re.I):
        raise WorkerError("Unsupported industrial workbook XML.")
    return ET.fromstring(data)


def workbook_rows(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        if len(names) > 100 or len(set(names)) != len(names):
            raise WorkerError("Unsupported industrial workbook archive.")
        shared = []
        if "xl/sharedStrings.xml" in names:
            root = xml_part(archive, "xl/sharedStrings.xml")
            shared = ["".join(t.text or "" for t in item.iter(NS + "t")) for item in root]
        sheet = xml_part(archive, "xl/worksheets/sheet1.xml")
        for row in sheet.iter(NS + "row"):
            columns = {}
            for cell in row.findall(NS + "c"):
                match = re.fullmatch(r"([A-F])[0-9]+", cell.get("r", ""))
                if not match:
                    continue
                kind = cell.get("t")
                if cell.find(NS + "f") is not None:
                    continue
                value = cell.findtext(NS + "v", "")
                if kind == "s":
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = "".join(item.text or "" for item in cell.iter(NS + "t"))
                columns[match[1]] = value.strip()
            yield tuple(columns.get(letter, "") for letter in "ABCDEF")


def extract_workbook(payload, source, captured, exclude):
    candidates = []
    skipped = 0
    try:
        rows = workbook_rows(payload)
        if next(rows, ()) != HEADERS:
            raise WorkerError("The Kalimantan Barat directory columns changed.")
        for name, street, village, district, city, industry in rows:
            if not (name and city and industry and len(name) <= 200 and len(city) <= 100 and len(industry) <= 500):
                continue
            provider = bool(PROVIDER.search(industry) or PROVIDER_ACTIVITY.search(industry))
            if provider and exclude:
                skipped += 1
                continue
            address = ", ".join(dict.fromkeys(value for value in (street, village, district, city, "Kalimantan Barat", "Indonesia") if value))
            key = json.dumps([source.url, normalized(name), normalized(street), normalized(city)])
            candidates.append({
                "content_fingerprint": "sha256:" + hashlib.sha256(key.encode()).hexdigest(),
                "source_url": source.url, "source_name": source.name, "company_name": name, "website": "",
                "address": address, "industry": industry if len(industry) <= 100 else "", "city": city,
                "province": "Kalimantan Barat", "company_type": "",
                "country_code": "ID", "published_contacts": {}, "suggested_services": [],
                "reason": "Listed in the provincial industrial company directory. Confirm current operations and logistics needs.",
                "evidence": [{"url": source.url, "excerpt": industry, "captured_at": captured}],
                "confidence": "LOW", "is_logistics_provider": provider, "last_checked_at": captured,
            })
            if len(candidates) >= 500:
                break
    except (ET.ParseError, zipfile.BadZipFile, ValueError, KeyError, IndexError, RuntimeError) as error:
        raise WorkerError("Could not read the provincial industrial workbook.") from error
    return Extracted(candidates, [], skipped)
