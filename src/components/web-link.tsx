import { Fragment, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ExternalLink } from "lucide-react";
import { safeWebsite } from "@/features/companies/model";
import { openExternal } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export function WebLink({ value, label, className, onError, icon = true }: {
  value: string;
  label?: string;
  className?: string;
  onError?: () => void;
  icon?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = safeWebsite(value.trim());
  if (!url) return <>{label ? "—" : value || "—"}</>;

  const open = () => {
    setFailed(false);
    void openExternal(url).catch(() => {
      if (onError) onError();
      else setFailed(true);
    });
  };

  return <>
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={cn("wrap-anywhere font-medium text-primary underline underline-offset-4", className)}
      onClick={(event) => { if (isTauri()) { event.preventDefault(); open(); } }}
      onAuxClick={(event) => { if (event.button === 1 && isTauri()) { event.preventDefault(); open(); } }}>
      {label ?? url}
      {icon && <ExternalLink size={13} className="ml-1 inline align-baseline" aria-hidden="true" />}
    </a>
    {failed && <span role="alert" className="block text-xs text-destructive">Could not open this link.</span>}
  </>;
}

export function LinkedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"'[\]{}]+)/gi).map((part, index) => {
    if (index % 2 === 0) return part;
    let url = part.replace(/[.,;!?]+$/, "");
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
      url = url.slice(0, -1);
    }
    return <Fragment key={index}><WebLink value={url} icon={false} />{part.slice(url.length)}</Fragment>;
  })}</>;
}
