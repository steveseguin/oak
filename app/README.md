# Oak Mesh browser interface

This folder contains generic static application assets. Messages, radio
identities, credentials, block lists and private locations are supplied only by
the chosen radio, this browser's private storage, or an authenticated server.
They are not bundled here or submitted to Meshcast's public feed.

Choose Server, Bluetooth, or USB Serial at `index.html`. Direct radio access needs
compatible companion firmware and a browser exposing the chosen device API.
Android Chrome supports Bluetooth; desktop Chrome/Edge also offer USB Serial.
An iPhone browser without those APIs needs the Server option instead.

Server mode accepts an HTTPS server, or HTTP loopback on the same computer.
The server must explicitly authorize the exact Meshcast origin with a temporary
access key. The key is kept in browser-tab storage, never in URLs. Change
connection clears it. Closing the page does not stop a server's collector.

Direct mode stores history in IndexedDB per radio. Keep the page open to listen;
phones may suspend background connections. Radio sends are manual and never
automatically retried. Connecting does not advertise a location or change RF
configuration. Map lines require captured adjacency evidence; direct mode does
not manufacture routes from a hop count.

Source assets are maintained in the local Oak Mesh workspace and copied with
`scripts/build_meshcast_app.py`. Third-party MeshCore protocol modules are pinned
to commit `9e76c51409c13c3ed0183ee1e9c1b380e671a038` and retain their MIT license.
Leaflet and the fixed map imagery retain their existing attribution.
