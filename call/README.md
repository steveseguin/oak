# Meshcast connection tool

`index.html` and `qrconnect.js` are the local QR files supplied by Steve on
September 16, 2026, adapted from `meshtastic/qr/` (AGPL-3.0; see LICENSE-vdo.txt).
Meshcast serves the controls and handshake codec. Only the media iframe loads
`https://vdo.ninja/`, using its existing bypass/routeMessage iframe API.
No VDO.Ninja source, radio firmware, or radio configuration is changed.

LoRa mode is enabled by default. It emits L1 ASCII messages of at most the
selected 40-140 bytes, and accepts them directly in the same waiting tab.
Missing and duplicate parts are handled by the supplied codec. Its split
bootstrap avoids the separate QR mode's 118-character limit. Sending is manual.
Use DMs: handshake messages include temporary network routes and credentials.
The checksum detects damage, not sender identity. L1 and legacy MC1 are distinct
formats; the MC1 helper remains under Older MC1 messages on `connect.html`.

The local page defaults to a readable light theme. The upstream offline worker
is not installed: VDO.Ninja's cross-origin iframe still needs network access.
QR drawing and scanning libraries are vendored with their license notices.
The existing `transportBytes` / `transportCode` exports preserve MC1 support.

Validation: `node tests/check.cjs` and `node tests/lora.cjs`. Two Chrome tabs
also completed a real L1 offer/answer and exchanged chat in both directions
through the cross-origin VDO.Ninja iframe. This test did not use RF, camera,
microphone, or separate Internet networks; NAT traversal and media permissions
on other devices remain field-test work.

Upstream: https://github.com/obsninja/obsninja

Meshcast adaptation source: https://github.com/steveseguin/oak
