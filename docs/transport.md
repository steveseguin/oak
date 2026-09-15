# MC1: VDO.Ninja handshake over text messages

Experimental application-level transport, not a MeshCore firmware format.
Uses direct-message text bodies; no radio configuration or firmware changes.
No server, database, automatic transmissions or automatic retry loop.

## Encoding

1. Extract and structurally validate a current VDO.Ninja `Y` code with the
   vendored QRConnect decoder. Only this format is supported for packing.
2. Decode its base-30000 alphabet to the exact existing dense binary record.
3. Encode those bytes as unpadded base64url (ASCII).
4. Split into text messages with this envelope:

```text
MC1|<hash>|<expires>|<index>/<total>|<payload>
```

`hash`: first 12 lowercase hex characters of SHA-256 of the entire dense record.
`expires`: Unix seconds, base36, 20 minutes from packing.
`index` / `total`: decimal, one-based, at most 12 parts.
`payload`: a slice of the base64url text; concatenate before decoding.

The selected 100/120/140-byte budget includes the entire ASCII envelope. The
encoder reserves enough space for two-digit counts. Do not include a sender
prefix, timestamp, URL or emoji in these message bodies.

## Receiving

Accept lines in any order and identical duplicates. Require a matching hash,
expiry and total for every part. Reject conflicting duplicates, malformed
parts, parts longer than 140 bytes, expired sets, and expiry more than 22
minutes ahead of the receiver's clock. Report missing indexes without applying
a partial handshake. Bound input to 12,000 characters / 100 pasted lines.

After concatenating in index order, require canonical base64url, check the
complete hash, restore the Y code, and validate it with QRConnect again.
No offer/answer is applied automatically. The user pastes it into the appropriate
waiting VDO.Ninja tab. The browser connection may expire before the MC1 set.

This checksum detects accidental corruption, not a malicious sender. It is not
a signature or ownership proof. Use an authenticated DM relationship and confirm
the person before sharing media. Network routes and ICE credentials belong in
DMs, not a public channel. Media still requires an Internet or usable IP path;
STUN and TURN remain part of the upstream connection mechanism.

## Validation

`node tests/check.cjs` runs synthetic Chromium/Firefox-shaped offer and answer
fixtures with ten routes each at all three byte budgets. It verifies exact
round trips and preserves all routes. Also checks reorder, duplicate, missing,
mixed, corrupt and expired sets. These are offline codec tests, not browser
interoperability, NAT traversal or real-LoRa delivery tests.
