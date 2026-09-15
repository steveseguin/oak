# Meshcast

Static GitHub Pages website for Oak Roof and MeshCore tools. Published from
`main`, repository root, with the existing `meshcast.ca` CNAME. No build step,
hosted API, database, login service, cloud worker or radio gateway.

## Pages

- `index.html`: Oak Roof, Heltec V4, Barracuda 915 MHz 8 dBi omni, current
  configured GTA MeshCore radio profile. No live-status or fixed-range claim.
- `profiles.html`: full-key lookup and opt-in profile submission generator.
  Generates JSON and a GitHub issue draft; it never posts or publishes for users.
- `connect.html`: validate, pack and reassemble current VDO.Ninja Y codes as
  byte-bounded MC1 messages. Runs locally, does not send to radios or servers.
- `call/`: embeds the upstream VDO.Ninja QR tool on its original origin so its
  iframe and STUN/TURN handling remain intact. Includes a direct-open fallback.
- `radio.html`: links to the MeshCore browser client and an existing local
  Oak Mesh installation. There is no public copy of Steve's private collector.

## Data and privacy

Only Oak Roof's intended public identity is seeded. No household channel keys,
private identities, Bluetooth PINs, private radio history or home coordinates
are included. Profile lookup is explicitly opt-in. Profile fields and radio
codes are rendered as text; links must be HTTPS without embedded credentials.

Profiles and avatars are public Internet data. Third-party avatar servers can
receive image requests; image elements use `referrerpolicy="no-referrer"`.
Profiles are claims, not authenticated public-channel sender identities. See
[profile format and maintenance](profiles/README.md) and [schema](profiles/schema.json).

The connection packer keeps codes in the current page only, with no persistence
or automatic signalling. MC1 handles byte budgets, missing/reordered/duplicate
parts, integrity checks and 20-minute expiry. See [transport](docs/transport.md).
Video still uses an IP path and may use STUN/TURN; this site runs no relay.

The embedded video page contacts VDO.Ninja only when opened. Its source/codec
license and Meshcast modifications are documented in [call/README.md](call/README.md).
Meshcast's copy of QRConnect is only used for conversion and validation; the
VDO.Ninja repository and hosted implementation are unchanged.

## Validation and publishing

Run sequential offline checks with Node 22+:

```sh
node tests/check.cjs
node --check assets/profile-core.js
node --check assets/profiles.js
node --check assets/mesh-packets.js
node --check assets/connect.js
```

The tests cover exact synthetic offer/answer round trips, preservation of ten
IPv4/IPv6 UDP/TCP routes, all three text budgets, malformed/corrupt/mixed/expired
sets, order/duplicates/missing parts, profile validation, directory consistency,
and local page links. No test uses Bluetooth or transmits RF messages.

Visual browser verification, embedded-camera behavior and end-to-end LoRa/WebRTC
delivery remain unverified. The codec tests alone do not prove those paths.

Push reviewed files to `main` to use the existing GitHub Pages deployment.
`.nojekyll` keeps these plain static assets intact. No hosting or DNS changes are
required. To preview locally, use a static server serving this directory; that
is a development convenience, not a production requirement.
