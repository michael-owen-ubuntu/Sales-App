import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function copyText(value: string) {
  return isTauri() ? writeText(value) : navigator.clipboard.writeText(value);
}

export async function openExternal(value: string) {
  const url = new URL(value);
  if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported link.");
  }
  if (isTauri()) {
    await openUrl(url.href);
  } else if (url.protocol === "mailto:") {
    window.location.assign(url.href);
  } else {
    window.open(url.href, "_blank", "noopener,noreferrer");
  }
}
