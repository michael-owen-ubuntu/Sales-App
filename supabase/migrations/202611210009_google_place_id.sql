alter table public.companies
  add column google_place_id text
  check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{6,512}$');
