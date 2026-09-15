# VDO.Ninja integration

`index.html` embeds the upstream HTTPS QR page. Its wrapper and media iframe
remain on VDO.Ninja's origin, preserving its existing signalling, consent and
STUN/TURN configuration. No credentials or media server are hosted here.

`qrconnect.js` is a snapshot of Steve's VDO.Ninja source, taken September 14,
2026 (AGPL-3.0; see LICENSE-vdo.txt). The static packet tool uses its codec.
The only adaptation exposes the existing dense byte conversion as
`transportBytes` and `transportCode`. Upstream decoder validation still applies.
The qntm alphabet MIT notices are retained in the file.

Upstream: https://github.com/obsninja/obsninja

Meshcast adaptation source: https://github.com/steveseguin/oak
