import { expect, it } from "vitest";
import { googleMapsSearch } from "./google-maps";

it("opens a name-and-address search or a confirmed place ID", () => {
  const location = { name: "PT A & B", city: "Bekasi" };
  const search = new URL(googleMapsSearch(location));
  expect(search.searchParams.get("api")).toBe("1");
  expect(search.searchParams.get("query")).toBe("PT A & B, Bekasi, Indonesia");
  expect(search.searchParams.has("query_place_id")).toBe(false);
  expect(new URL(googleMapsSearch(location, "ChIJ-example_123")).searchParams.get("query_place_id")).toBe("ChIJ-example_123");
  expect(new URL(googleMapsSearch(location, "invalid&query=other")).searchParams.has("query_place_id")).toBe(false);
});
