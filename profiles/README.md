# Meshcast node profiles, version 1

This opt-in static directory maps **full MeshCore public keys** to profile
metadata. It is not an Internet node scanner or an authenticated identity service.

- Index: `https://meshcast.ca/profiles/index.json`
- Record: `https://meshcast.ca/profiles/<64-lowercase-hex-public-key>.json`
- Schema: `https://meshcast.ca/profiles/schema.json`
- Human lookup: `https://meshcast.ca/profiles.html#<public-key>`

Records contain `schema_version`, `protocol`, `public_key`, `display_name`,
`bio`, `avatar_url`, `links`, `verification`, and `updated_at`.
`avatar_url` is null or a public HTTPS image URL. Social links are HTTPS URLs;
the directory does not scrape social platforms or synchronize avatars.
Apps fetch/cache avatars over the Internet; photographs do not travel over LoRa.

## Integrating an app

Validate the full key and schema before displaying a record. A missing profile
returns 404; treat it as normal and fall back to an icon. Keep local/known radio
identity distinct from this optional online enrichment. Render strings as text,
validate URLs, cache sensibly, and let users disable online avatar lookups.
Do not match by display name or short relay prefix. Public-channel names do not
authenticate senders and must not automatically acquire verified profile badges.

`unverified` is a submitted claim. `site-maintained` identifies a record maintained
by this site's operator; it is not cryptographic proof. No record may claim an
automatic radio/social ownership check. A future proof scheme needs an explicit
versioned design rather than silently assigning a new meaning to these statuses.

## Adding or updating a profile

Use the form at `profiles.html#create` to prepare JSON and open a GitHub issue,
or submit a pull request with the record and an index entry. Public-key filenames
must exactly match their record. Index entries contain public_key, display_name
and path. One key per record; a person may submit multiple radios.

Review authorization, public proof links where available, avatar reuse rights,
and all URLs before merging. Preserve `unverified` unless the operator actually
maintains that node. Never request private keys, channel secrets, login tokens,
precise private coordinates or confidential ownership evidence in public issues.
No script merges submissions or approves identity automatically.

For removal/correction, open an issue naming the public key and requested change.
Removing the active record cannot recall third-party caches or erase Git history.
For a locally hosted avatar, prefer reviewed PNG/JPEG/WebP data (no active SVG
uploads), reasonable dimensions and a small file. The shipped Meshcast icon is
site-authored SVG; the form does not accept image uploads.

Run `node tests/check.cjs` before merging. Publishing follows the repository's
existing GitHub Pages main-branch/root deployment; no API server is required.
