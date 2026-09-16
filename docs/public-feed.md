# Public map and messages

`heard.html` reads `data/heard.json` from this GitHub Pages site. No hosted API,
database, login, radio connection, geolocation request or local-network request
is needed. The existing homepage and antenna photo are preserved.

The default map center is the GTA, `[43.75, -79.45]`, zoom 9. Updates never
recenter a visitor's map. GTA resets the view; All nodes fits the filtered set.
Names can be searched or selected in the node list. Names and chat are rendered
as text, including strings that resemble HTML.

## Snapshot contract

Top-level fields: `version: 1`, `published_at` (Unix seconds), `nodes`, `messages`.

- A node contains only `name` and `position: [latitude, longitude]`.
- A message contains only `name`, `text`, `received_at` (Unix seconds, rounded
  down to a minute). This is local retrieval time, not a verified RF receipt or
  sender time. The visible ages use it directly.
- Locations must come from accepted radio advertisements in the last 7 days.
  Imported contacts, unresolved names and missing/invalid positions do not count.
- All owned radios, their saved aliases and the current receiving radio are
  excluded. No private location reference or receiver geometry is exported.
- Chat is only incoming MeshCore RF history on the default channel explicitly
  named Public. Private messages, outgoing messages and other channels are excluded.
- The latest 200 eligible messages from the past 24 hours are shown, newest first.
  Messages mentioning hops, SNR, RSSI, ACK reports, labeled routes/paths,
  coordinate pairs, full keys or MC1 connection packets are omitted entirely.
  Other message text is unchanged apart from length/control-character limits.
  Names on a public channel are self-reported, not authenticated identities.
- No keys, contact cards, hops, signal readings, distances, routes or receiver
  metadata are present, including in hidden fields. The browser never downloads
  a full private response and then hides fields.

The local publisher reads SQLite in read-only mode and constructs this small
allowlist. It does not use the private `/api/map` endpoint or connect to a radio.
Removing old items from the current snapshot does **not** erase prior Git
revisions: published snapshots remain in this public repository's history.

## Updating

The local Oak Mesh workspace supplies `scripts/publish_meshcast.py` and the
isolated privacy tests. Publishing runs every 15 minutes while Steve is signed
in, with at most one instance. It skips a dirty checkout, requires the existing
`main` branch and the expected origin, fast-forwards only, and never force-pushes.
If data is unchanged it makes no commit. The site checks for new snapshots once
per minute while visible. GitHub Pages deployment/caching adds some delay.

If the collector or publisher goes offline, the last published snapshot remains
available, with its age and a saved-snapshot label after an hour. Advertised
locations are not a claim that a radio is currently online.

## Map assets

Leaflet 1.9.4 is vendored under `assets/vendor`, with its BSD-2-Clause license.
The basemap uses ordinary browser requests to OpenStreetMap's standard HTTPS
tile endpoint, with visible attribution, origin referrers and normal browser
caching. No tile prefetch, bulk download, service worker or offline cache is used.
See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Third-party tiles are best effort; radio markers and the node list remain usable
if the background fails. This does not change the private local app's basemap.
