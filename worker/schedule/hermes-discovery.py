"""Hermes script-only job for the GPI discovery worker."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=30, choices=range(1, 101), metavar="1-100")
args = parser.parse_args()

repo = Path.home() / "Projects" / "Sales-App"
settings = Path.home() / ".config" / "gpi-sales-discovery"
sources = settings / "sources.json"
auth = settings / "worker-auth.json"
if not sources.is_file() or not auth.is_file():
    sys.exit("Discovery needs an approved sources.json and a private worker-auth.json.")
if os.name == "posix" and auth.stat().st_mode & 0o077:
    sys.exit("Set worker-auth.json permissions to 600.")
try:
    credentials = json.loads(auth.read_text(encoding="utf-8"))
    values = {}
    for line in (repo / ".env.local").read_text(encoding="utf-8").splitlines():
        key, delimiter, value = line.partition("=")
        if delimiter and key.strip() in {"VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"}:
            values[key.strip()] = value.strip().strip("\"'")
    env = {**os.environ, "DISCOVERY_SUPABASE_URL": values["VITE_SUPABASE_URL"],
           "DISCOVERY_SUPABASE_PUBLISHABLE_KEY": values["VITE_SUPABASE_PUBLISHABLE_KEY"],
           "DISCOVERY_EMAIL": credentials["email"], "DISCOVERY_PASSWORD": credentials["password"]}
except (OSError, ValueError, KeyError, TypeError):
    sys.exit("Could not read discovery connection settings.")
raise SystemExit(subprocess.call([sys.executable, "-m", "discovery", "--config", str(sources), "--limit", str(args.limit)],
                                  cwd=repo / "worker", env=env))
