"""Extract company cards from Bekasi Regency's industrial tourism directory."""

import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from .config import WorkerError, public_url
from .extract import Extracted, PROVIDER, text


class CompanyCards(HTMLParser):
    def __init__(self):
        super().__init__()
        self.card = None
        self.depth = 0
        self.field = None
        self.cards = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            if self.card is None and "box_list" in attrs.get("class", "").split():
                self.card = {"h3": [], "span": [], "detail": ""}
                self.depth = 0
            if self.card is not None:
                self.depth += 1
        if self.card is None:
            return
        if tag in ("h3", "span") and (tag == "h3" or self.card["h3"]) and not self.card[tag]:
            self.field = tag
        if tag == "a" and "/industri/detail_industri/" in attrs.get("href", "") and not self.card["detail"]:
            self.card["detail"] = attrs["href"]

    def handle_data(self, data):
        if self.card is not None and self.field:
            self.card[self.field].append(data)

    def handle_endtag(self, tag):
        if self.card is None:
            return
        if tag == self.field:
            self.field = None
        if tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.cards.append(self.card)
                self.card = None
                self.field = None


def extract_bekasi(html, source, captured, exclude):
    parser = CompanyCards()
    parser.feed(html)
    parser.close()
    if not parser.cards:
        raise WorkerError("The Bekasi directory returned no recognizable company cards.")
    results = []
    skipped = 0
    for card in parser.cards[:100]:
        name = text(" ".join("".join(card["h3"]).split()), 200)
        address = text(" ".join("".join(card["span"]).split()), 480)
        if not name or not address or not re.search(r"\b(?:Bekasi|Cikarang|Cibitung|Tambun)\b", address, re.I):
            continue
        try:
            detail = public_url(urljoin(source.url, card["detail"]))
        except ValueError:
            continue
        if urlsplit(detail).hostname != urlsplit(source.url).hostname or "/industri/detail_industri/" not in urlsplit(detail).path:
            continue
        provider = bool(PROVIDER.search(name) or re.search(r"\b(?:logistik|ekspedisi|transport|trucking)\b", name, re.I))
        if provider and exclude:
            skipped += 1
            continue
        results.append({
            "content_fingerprint": "sha256:" + hashlib.sha256(detail.encode()).hexdigest(),
            "source_url": source.url, "source_name": source.name, "company_name": name, "website": "",
            "address": f"{address}, Indonesia", "city": "Kabupaten Bekasi", "province": "Jawa Barat",
            "industry": "", "company_type": "", "country_code": "ID", "published_contacts": {},
            "suggested_services": [], "reason": "Listed in Bekasi Regency’s industrial directory. Confirm current operations and logistics needs.",
            "evidence": [{"url": detail, "excerpt": address, "captured_at": captured}],
            "confidence": "LOW", "is_logistics_provider": provider, "last_checked_at": captured,
        })
    return Extracted(results, [], skipped)


class CompanyProfile(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.heading = []
        self.block = None
        self.parts = []
        self.links = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            if self.depth or "post-content" in (attrs.get("class") or "").split():
                self.depth += 1
        if tag == "h1" or self.depth and tag in ("p", "li"):
            if self.block is None:
                self.block, self.parts, self.links = tag, [], []
        if tag == "a" and self.block and attrs.get("href"):
            self.links.append(attrs["href"])

    def handle_data(self, data):
        if self.block:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == self.block:
            value = " ".join("".join(self.parts).split())
            if tag == "h1":
                self.heading.append(value)
            elif value:
                self.rows.append((value, self.links))
            self.block = None
        if tag == "div" and self.depth:
            self.depth -= 1


WEBSITE_LABEL = re.compile(r"^(?:situs\s+(?:web\s+)?(?:resmi|perusahaan)|website(?:\s+(?:resmi|perusahaan))?|media social yang digunakan oleh perusahaan)\s*:", re.I)
SOCIAL_DOMAINS = ("facebook.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "google.com",
                  "maps.app.goo.gl", "x.com", "twitter.com", "whatsapp.com", "wa.me")


def enrich_profile(candidate, html, profile_url, captured):
    from .extract import SIGNALS, normalized

    parser = CompanyProfile()
    parser.feed(html)
    parser.close()
    if normalized(candidate["company_name"]) not in {normalized(value) for value in parser.heading}:
        raise WorkerError("Directory profile name did not match the company.")
    websites = {}
    suggestions = {}
    additional = {}

    for value, links in parser.rows[:100]:
        if WEBSITE_LABEL.match(value):
            for raw in links[:10]:
                try:
                    url = public_url(raw)
                except ValueError:
                    continue
                domain = urlsplit(url).hostname
                if domain != urlsplit(profile_url).hostname and not any(domain == social or domain.endswith("." + social) for social in SOCIAL_DOMAINS):
                    websites[domain.removeprefix("www.")] = (url, value)
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", value):
            if not text(sentence, 500) or re.search(r"\b(?:tidak|bukan|belum|not|never|no)\b", sentence, re.I):
                continue
            if re.search(r"\b(?:kunjungan|visitor|pelajar|persyaratan)\b", sentence, re.I):
                continue
            for service, pattern, rationale in SIGNALS:
                if service not in suggestions and pattern.search(sentence):
                    suggestions[service] = {"service": service, "reason": rationale, "evidence_url": profile_url}
                    additional[sentence] = {"url": profile_url, "excerpt": sentence, "captured_at": captured}
    website = candidate["website"]
    if not website and len(websites) == 1:
        url, excerpt = next(iter(websites.values()))
        if text(excerpt, 500):
            website = url
            additional[excerpt] = {"url": profile_url, "excerpt": excerpt, "captured_at": captured}
    if not additional:
        return candidate
    return {**candidate, "website": website, "evidence": [*candidate["evidence"], *additional.values()][:10],
            "suggested_services": list(suggestions.values()), "last_checked_at": captured,
            "confidence": "MEDIUM" if suggestions else candidate["confidence"]}
