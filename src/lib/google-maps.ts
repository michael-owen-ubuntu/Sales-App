type Location = { name: string; address?: string; city?: string; province?: string };

export function googleMapsSearch(location: Location, placeId?: string | null) {
  const parts = [location.name, location.address, location.city, location.province, "Indonesia"]
    .map((part) => part?.trim() ?? "").filter(Boolean);
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  if (placeId && validGooglePlaceId(placeId)) url.searchParams.set("query_place_id", placeId);
  const query = [...new Set(parts)].join(", ");
  let remaining = Array.from(query).slice(0, 600);
  url.searchParams.set("query", remaining.join(""));
  while (url.href.length > 2_048) {
    remaining = remaining.slice(0, -20);
    url.searchParams.set("query", remaining.join(""));
  }
  return url.href;
}

export function validGooglePlaceId(value: string) {
  return /^[A-Za-z0-9_-]{6,512}$/.test(value);
}
