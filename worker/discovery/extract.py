"""Extract bounded, evidence-backed organizations from public JSON-LD."""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

from .config import Source, public_url

VERDICTS = {"UNKNOWN", "PROSPECT", "LOGISTICS_PROVIDER"}
PERSONAL = re.compile(r"@|(?:\+?\d[ .()-]*){7,}|\b(?:call|contact|hubungi)\s+(?:mr\.?|mrs\.?|bapak|ibu)\b", re.I)
PROVIDER = re.compile(
    r"\b(?:freight forward(?:er|ing)|3pl|third[- ]party logistics|logistics provider|customs brok(?:er|erage)|trucking company|road freight carrier|"
    r"jasa (?:pengiriman|ekspedisi|logistik|angkutan)|penyedia (?:layanan|jasa) logistik)\b", re.I,
)
PROVIDER_OFFER = re.compile(
    r"\b(?:we (?:provide|offer|specialize in)|(?:kami|perusahaan ini) (?:menyediakan|menawarkan|merupakan)|"
    r"we are(?: an?)?|a leading)\s+[^.!?]{0,65}", re.I,
)
SIGNALS = (
    ("Customs clearance", re.compile(r"\b(?:imports?|imported|importing|impor|mengimpor|bahan baku impor|international sourcing)\b", re.I),
     "The source mentions imports or overseas sourcing. Ask about customs clearance needs."),
    ("Sea freight", re.compile(r"\b(?:exports?|exported|exporting|ekspor|mengekspor|overseas markets?)\b", re.I),
     "The source describes exports. Sea freight is a discussion point and transport mode is unconfirmed."),
    ("Domestic trucking", re.compile(r"\b(?:distributes?|distribution|distribusi|mendistribusikan|nationwide deliveries|pengiriman domestik)\b", re.I),
     "The source mentions distribution. Ask about delivery coverage and pickup requirements."),
    ("Warehousing", re.compile(r"\b(?:warehouse|warehouses|distribution cent(?:er|re)|gudang|pusat distribusi)\b", re.I),
     "The source mentions warehouse or distribution operations. Ask about storage needs."),
)
ORGANIZATIONS = {"Organization", "Corporation", "LocalBusiness", "Manufacturer", "Store", "WholesaleStore"}


class Classifier(Protocol):
    def classify(self, fingerprint: str) -> str: ...


class NoOpClassifier:
    def classify(self, fingerprint: str) -> str:
        return "UNKNOWN"


class HermesResults:
    """Read owner-reviewed Hermes judgments from a worker-owned file format."""

    def __init__(self, path: Path):
        if path.stat().st_size > 65536:
            raise ValueError("Classification results exceed 64 KiB.")
        results = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(results, dict) or any(
            not re.fullmatch(r"sha256:[a-f0-9]{64}", key) or not isinstance(value, str) or value not in VERDICTS
            for key, value in results.items()
        ):
            raise ValueError("Classification results must map fingerprints to supported labels.")
        self.results = results

    def classify(self, fingerprint: str) -> str:
        return self.results.get(fingerprint, "UNKNOWN")


class JsonLdParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.current: list[str] | None = None
        self.documents: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("type") == "application/ld+json" and len(self.documents) < 30:
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.documents.append("".join(self.current))
            self.current = None


@dataclass(frozen=True)
class Extracted:
    candidates: list[dict]
    ambiguities: list[dict]
    providers_skipped: int


def organizations(node):
    stack = [node]
    steps = 0
    while stack and steps < 1000:
        steps += 1
        current = stack.pop()
        if isinstance(current, list):
            stack.extend(reversed(current[:200]))
        elif isinstance(current, dict):
            kind = current.get("@type", [])
            kinds = kind if isinstance(kind, list) else [kind]
            if any(isinstance(item, str) and item.rsplit("/", 1)[-1] in ORGANIZATIONS for item in kinds):
                yield current
            stack.extend(current[key] for key in ("mainEntity", "item", "itemListElement", "@graph") if key in current)


def text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if PERSONAL.search(value) or any(char in value for char in "<>\x00") or len(value) > limit:
        return ""
    return value


def normalized(value: str) -> str:
    raw = unicodedata.normalize("NFKD", value).casefold()
    return " ".join(re.findall(r"[^\W_]+", "".join(char for char in raw if not unicodedata.combining(char))))


def identity(candidate: dict) -> tuple[str, str] | None:
    website = candidate.get("website")
    name = re.sub(r"^(?:pt|cv|ud|perseroan terbatas) ", "", normalized(candidate["company_name"]))
    name = re.sub(r" tbk$", "", name)
    if website and name:
        return ("domain:" + urlsplit(website).hostname.removeprefix("www."), name)
    first_component = normalized(candidate["address"].partition(",")[0])
    locality_components = {normalized(candidate[key]) for key in ("city", "province")} | {"indonesia", ""}
    if candidate["city"] and name and first_component not in locality_components and not first_component.isdecimal():
        return ("address:" + normalized(candidate["address"]) + ":" + normalized(candidate["city"]), name)
    return None


ROLE_TITLES = {
    "RECEPTIONIST": {"receptionist", "resepsionis", "front desk receptionist"},
    "LOGISTICS_PIC": {"logistics contact", "logistics pic", "pic logistik", "logistics manager",
                      "manajer logistik", "kepala logistik", "logistics coordinator", "koordinator logistik"},
}


def published_contacts(node: dict) -> dict:
    # Only use named employees whose role is explicitly published on the same business profile.
    employees = node.get("employee", [])
    if isinstance(employees, dict):
        employees = [employees]
    if not isinstance(employees, list):
        return {}
    matches = {role: {} for role in ROLE_TITLES}
    for employee in employees[:50]:
        if not isinstance(employee, dict) or employee.get("@type") not in ("Person", "https://schema.org/Person"):
            continue
        name = text(employee.get("name"), 200)
        title = normalized(text(employee.get("jobTitle"), 100))
        if not name:
            continue
        phone = employee.get("telephone", "")
        email = employee.get("email", "")
        phone = phone.strip() if isinstance(phone, str) else ""
        email = email.strip().removeprefix("mailto:") if isinstance(email, str) else ""
        if not re.fullmatch(r"\+?[0-9 ().-]{1,35}", phone) or not 7 <= len(re.sub(r"[^0-9]", "", phone)) <= 15:
            phone = ""
        if len(email) > 254 or not re.fullmatch(r"[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+", email):
            email = ""
        for role, titles in ROLE_TITLES.items():
            if title in titles:
                matches[role][(name, phone, email)] = {"name": name, "phone": phone, "email": email}
    return {role: next(iter(people.values())) for role, people in matches.items() if len(people) == 1}


def _convert(node: dict, source: Source, captured: str, classifier: Classifier, exclude: bool):
    address = node.get("address")
    if not isinstance(address, dict):
        return None, None, False
    country = address.get("addressCountry")
    if isinstance(country, dict):
        country = country.get("identifier") or country.get("name")
    if not isinstance(country, str) or country.strip().casefold() not in {"id", "idn", "indonesia"}:
        return None, None, False

    name = text(node.get("legalName") or node.get("name"), 200)
    if not name or not normalized(name):
        return None, None, False
    city = text(address.get("addressLocality"), 100)
    province = text(address.get("addressRegion"), 100)
    street = text(address.get("streetAddress"), 500)
    postcode = address.get("postalCode")
    postcode = postcode if isinstance(postcode, str) and re.fullmatch(r"[0-9]{5}", postcode) else ""
    full_address = ", ".join(dict.fromkeys(part for part in (street, city, province, postcode, "Indonesia") if part))
    if len(full_address) > 500:
        full_address = street
    industry = text(node.get("industry") or node.get("category"), 100)
    try:
        website = public_url(node.get("url"))
    except ValueError:
        website = ""
    item_id = text(node.get("@id"), 500)
    identity_fields = [source.url, item_id or [normalized(name), urlsplit(website).hostname if website else "", normalized(city)]]
    fingerprint = "sha256:" + hashlib.sha256(json.dumps(identity_fields, ensure_ascii=False).encode()).hexdigest()
    raw = node.get("description")
    snippets = [part.strip() for part in re.split(r"(?<=[.!?])\s+|[\r\n]+", raw[:8000])
                if text(part, 500)] if isinstance(raw, str) else []
    label = classifier.classify(fingerprint)
    provider_evidence = next((part for part in snippets if any(
        PROVIDER.search(offer.group()) for offer in PROVIDER_OFFER.finditer(part)
    )), "")
    provider = bool(provider_evidence or PROVIDER.search(industry) or label == "LOGISTICS_PROVIDER")
    if provider and exclude:
        return None, None, True

    evidence = []
    suggested = []
    def record(excerpt: str):
        if excerpt and not any(item["excerpt"] == excerpt for item in evidence):
            evidence.append({"url": source.url, "excerpt": excerpt, "captured_at": captured})

    if provider:
        reason = "The source or reviewed classification identifies a logistics service provider."
        record(provider_evidence or industry or (snippets[0] if snippets else name))
    else:
        for service, pattern, rationale in SIGNALS:
            match = next((part for part in snippets if pattern.search(part)), None)
            if match:
                record(match)
                suggested.append({"service": service, "reason": rationale, "evidence_url": source.url})
        reason = "The public company profile contains a potential logistics signal. Confirm requirements during review."
        if not suggested:
            if label != "PROSPECT":
                review = {"fingerprint": fingerprint, "company_name": name, "source_url": source.url,
                          "excerpt": snippets[0]} if snippets else None
                return None, review, False
            reason = "A reviewed classification identified a possible prospect. Logistics requirements are unconfirmed."
            record(snippets[0] if snippets else name)

    return {
        "content_fingerprint": fingerprint, "source_url": source.url, "source_name": source.name,
        "company_name": name, "website": website, "address": full_address, "industry": industry,
        "country_code": "ID", "published_contacts": published_contacts(node),
        "city": city, "province": province, "company_type": "Logistics provider" if provider else "",
        "suggested_services": suggested, "reason": reason, "evidence": evidence,
        "confidence": "MEDIUM" if suggested or provider_evidence else "LOW",
        "is_logistics_provider": provider, "last_checked_at": captured,
    }, None, False


def extract(html: str, source: Source, captured: str, classifier: Classifier, exclude: bool) -> Extracted:
    parser = JsonLdParser()
    parser.feed(html)
    parser.close()
    candidates, ambiguities = [], []
    providers_skipped = 0
    for document in parser.documents:
        try:
            node = json.loads(document)
        except (ValueError, RecursionError):
            continue
        for organization in organizations(node):
            candidate, ambiguity, skipped = _convert(organization, source, captured, classifier, exclude)
            if candidate:
                candidates.append(candidate)
            if ambiguity:
                ambiguities.append(ambiguity)
            providers_skipped += int(skipped)
            if len(candidates) + len(ambiguities) + providers_skipped >= 100:
                return Extracted(candidates, ambiguities, providers_skipped)
    return Extracted(candidates, ambiguities, providers_skipped)
