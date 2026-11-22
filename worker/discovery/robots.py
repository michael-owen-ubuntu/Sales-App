"""Robots allow/disallow matching and per-agent delay extensions."""

import re
from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit

from .config import WorkerError


def normalized(value: str) -> str:
    def escape(match):
        character = chr(int(match[1], 16))
        return character if re.fullmatch(r"[A-Za-z0-9._~-]", character) else match[0].upper()

    encoded = quote(value, safe="/%:@!$&'()*+,;=?-._~")
    return re.sub(r"%([0-9a-fA-F]{2})", escape, encoded)


def matches(pattern: str, target: str) -> bool:
    anchored = pattern.endswith("$")
    parts = pattern.removesuffix("$").split("*")
    if not target.startswith(parts[0]):
        return False
    if len(parts) == 1:
        return not anchored or target == parts[0]
    cursor, end = len(parts[0]), len(target)
    if anchored:
        if not target.endswith(parts[-1]):
            return False
        end -= len(parts[-1])
        parts.pop()
        if cursor > end:
            return False
    for part in parts[1:]:
        start = target.find(part, cursor, end)
        if start < 0:
            return False
        cursor = start + len(part)
    return True


@dataclass
class Group:
    agents: list[str] = field(default_factory=list)
    rules: list[tuple[str, bool]] = field(default_factory=list)
    delays: list[float] = field(default_factory=list)
    has_directives: bool = False


class Robots:
    def __init__(self, body: bytes, agent: str):
        groups: list[Group] = []
        current = Group()
        count = 0
        for line in body.decode("utf-8-sig", errors="replace").splitlines():
            key, separator, value = line.split("#", 1)[0].partition(":")
            if not separator:
                continue
            key, value = key.strip().lower(), value.strip()
            if key == "user-agent" and value:
                if current.has_directives:
                    groups.append(current)
                    current = Group()
                current.agents.append(value.lower())
            elif key in ("allow", "disallow", "crawl-delay", "request-rate") and current.agents:
                current.has_directives = True
                count += 1
                if count > 4096:
                    raise WorkerError("Robots policy exceeded the rule limit.")
                if key in ("allow", "disallow") and value:
                    current.rules.append((normalized(value), key == "allow"))
                elif key == "crawl-delay" and re.fullmatch(r"[0-9]{1,8}(\.[0-9]{1,6})?", value):
                    current.delays.append(float(value))
                elif key == "request-rate" and (rate := re.fullmatch(r"([0-9]{1,8})/([0-9]{1,8})", value)):
                    if requests := int(rate[1]):
                        current.delays.append(int(rate[2]) / requests)
        groups.append(current)
        specific = [group for group in groups if agent.lower() in group.agents]
        applicable = specific or [group for group in groups if "*" in group.agents]
        self.rules = [rule for group in applicable for rule in group.rules]
        self.interval = max((delay for group in applicable for delay in group.delays), default=0)

    def can_fetch(self, url: str) -> bool:
        parts = urlsplit(url)
        target = normalized(parts.path + ("?" + parts.query if parts.query else ""))
        rules = ((len(pattern.removesuffix("$").replace("*", "")), allowed)
                 for pattern, allowed in self.rules if matches(pattern, target))
        return max(rules, default=(0, True))[1]
