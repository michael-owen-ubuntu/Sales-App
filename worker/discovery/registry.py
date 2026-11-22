"""Persistent local queue for validated discovery payloads."""

import hashlib
import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime

from .config import public_url
from .extract import identity

SERVICES = {"Air freight", "Sea freight", "Customs clearance", "Domestic trucking", "Warehousing", "Integrated logistics"}
TEXT_LIMITS = {"source_name": 200, "company_name": 200, "address": 500, "industry": 100,
               "city": 100, "province": 100, "company_type": 100, "reason": 1000}


def clean_text(value, limit, required=False):
    if not isinstance(value, str):
        raise ValueError("Expected text.")
    value = value.strip()
    if len(value) > limit or required and not value or re.search(r"[<>\x00-\x08\x0e-\x1f]", value):
        raise ValueError("Invalid text.")
    return value


def stamp(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Expected a time zone.")
    return parsed.isoformat(timespec="milliseconds")


def sanitize(draft):
    if draft.get("country_code") != "ID" or type(draft.get("is_logistics_provider")) is not bool:
        raise ValueError("An Indonesian address and provider classification are required.")
    fingerprint = draft["content_fingerprint"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", fingerprint):
        raise ValueError("Invalid discovery fingerprint.")
    clean = {field: clean_text(draft[field], limit, field in ("source_name", "company_name", "reason"))
             for field, limit in TEXT_LIMITS.items()}
    evidence = [{"url": public_url(item["url"]), "excerpt": clean_text(item["excerpt"], 500, True),
                 "captured_at": stamp(item["captured_at"])} for item in draft["evidence"]]
    if not 1 <= len(evidence) <= 10 or len(draft["suggested_services"]) > 6:
        raise ValueError("Invalid evidence count.")
    links = {item["url"] for item in evidence}
    suggestions = []
    for service in draft["suggested_services"]:
        source = public_url(service["evidence_url"])
        if service["service"] not in SERVICES or source not in links:
            raise ValueError("Service suggestions require evidence.")
        suggestions.append({"service": service["service"], "reason": clean_text(service["reason"], 500, True), "evidence_url": source})
    contacts = {}
    for role, person in draft["published_contacts"].items():
        if role not in ("RECEPTIONIST", "LOGISTICS_PIC"):
            raise ValueError("Unknown contact role.")
        phone, email = clean_text(person["phone"], 35), clean_text(person["email"], 254)
        if phone and (not re.fullmatch(r"\+?[0-9 ().-]+", phone) or not 7 <= len(re.sub(r"[^0-9]", "", phone)) <= 15):
            raise ValueError("Invalid contact phone.")
        if email and not re.fullmatch(r"[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+", email):
            raise ValueError("Invalid contact email.")
        contacts[role] = {"name": clean_text(person["name"], 200, True), "phone": phone, "email": email}
    if draft["confidence"] not in ("LOW", "MEDIUM", "HIGH"):
        raise ValueError("Invalid confidence.")
    return {**clean, "content_fingerprint": fingerprint, "country_code": "ID",
            "source_url": public_url(draft["source_url"]), "website": public_url(draft["website"]) if draft["website"] else "",
            "evidence": evidence, "suggested_services": suggestions, "published_contacts": contacts,
            "confidence": draft["confidence"], "is_logistics_provider": draft["is_logistics_provider"],
            "last_checked_at": stamp(draft["last_checked_at"])}


def score(company):
    if company["is_logistics_provider"]:
        return 0
    contact = company["published_contacts"].get("LOGISTICS_PIC", {})
    return (min(45, 15 * len({item["service"] for item in company["suggested_services"]}))
            + 10 * bool(company["website"]) + 10 * bool(company["city"])
            + {"LOW": 5, "MEDIUM": 10, "HIGH": 15}[company["confidence"]]
            + 10 * bool(contact.get("name")) + 10 * bool(contact.get("phone") or contact.get("email")))


class Registry:
    def __init__(self, path, namespace):
        self.path = path
        if os.name == "posix":
            path.touch(mode=0o600, exist_ok=True)
            path.chmod(0o600)
        self.namespace = hashlib.sha256(namespace.encode()).hexdigest()
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("""
                create table if not exists candidates (
                    namespace text not null, fingerprint text not null, identity_key text, source_id text not null,
                    payload text not null, score integer not null, uploaded integer not null default 0,
                    primary key (namespace, fingerprint), unique (namespace, identity_key)
                );
                create table if not exists profile_checks (
                    namespace text not null, fingerprint text not null, checked_at integer not null,
                    primary key (namespace, fingerprint)
                );
                create index if not exists discovery_queue on candidates (namespace, uploaded, score desc);
            """)

    def remember(self, source, candidate):
        key = identity(candidate)
        with closing(sqlite3.connect(self.path)) as db, db:
            row = db.execute("""select fingerprint, payload from candidates where namespace = ? and
                (fingerprint = ? or identity_key = ?)""", (self.namespace, candidate["content_fingerprint"], json.dumps(key) if key else None)).fetchone()
            if row is not None:
                if row[0] == candidate["content_fingerprint"] and score(candidate) > score(json.loads(row[1])):
                    db.execute("update candidates set payload = ?, score = ?, uploaded = 0 where namespace = ? and fingerprint = ?",
                               (json.dumps(candidate), score(candidate), self.namespace, row[0]))
                    return True
                return False
            db.execute("insert into candidates values (?, ?, ?, ?, ?, ?, 0)", (self.namespace, candidate["content_fingerprint"],
                json.dumps(key) if key else None, source, json.dumps(candidate), score(candidate)))
            return True

    def profile_due(self, fingerprint):
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("select 1 from profile_checks where namespace = ? and fingerprint = ? and checked_at > unixepoch() - 1209600",
                             (self.namespace, fingerprint)).fetchone()
            return row is None

    def mark_profile_checked(self, fingerprint):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("insert or replace into profile_checks values (?, ?, unixepoch())", (self.namespace, fingerprint))

    def pending(self, limit, sources):
        with closing(sqlite3.connect(self.path)) as db:
            placeholders = ",".join("(?, ?)" for _ in sources)
            bindings = [value for source in sources for value in source]
            rows = db.execute(f"""select payload from candidates where namespace = ? and uploaded = 0
                and (source_id, json_extract(payload, '$.source_url')) in (values {placeholders})
                order by score desc, rowid limit ?""", (self.namespace, *bindings, limit))
            return [json.loads(payload) for (payload,) in rows]

    def mark_uploaded(self, fingerprint):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("update candidates set uploaded = 1 where namespace = ? and fingerprint = ?", (self.namespace, fingerprint))
