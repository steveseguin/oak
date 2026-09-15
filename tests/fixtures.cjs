// Synthetic WebRTC descriptions/routes from VDO.Ninja QR budget fixtures. No real addresses or credentials.
const crlf = "\r\n";
		const fingerprint = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0:01";
		const sdps = {
			chromium: setup => ["v=0", "o=- 1234567890123456789 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0", "a=extmap-allow-mixed", "a=msid-semantic: WMS", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0", "a=ice-ufrag:Ab+9", "a=ice-pwd:AbCdEfGhIjKlMnOpQrStUv+/", "a=ice-options:trickle", "a=fingerprint:sha-256 " + fingerprint, "a=setup:" + setup, "a=mid:0", "a=sctp-port:5000", "a=max-message-size:262144", ""].join(crlf),
			firefox: setup => ["v=0", "o=mozilla...THIS_IS_SDPARTA-99.0 1234567890123456789 0 IN IP4 0.0.0.0", "s=-", "t=0 0", "a=sendrecv", "a=fingerprint:sha-256 " + fingerprint, "a=group:BUNDLE 0", "a=ice-options:trickle", "a=msid-semantic:WMS *", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0", "a=sendrecv", "a=extmap-allow-mixed", "a=ice-pwd:0123456789abcdef0123456789abcdef", "a=ice-ufrag:0123abcd", "a=mid:0", "a=setup:" + setup, "a=sctp-port:5000", "a=max-message-size:1073741823", ""].join(crlf)
		};
		function candidate(index, transport, address, port, type) {
			return {
				candidate: "candidate:" + index + " 1 " + transport + " " + (2122260223 - index) + " " + address + " " + port + " typ " + type + (type === "host" ? "" : " raddr 0.0.0.0 rport 0") + (transport === "tcp" ? " tcptype passive" : ""),
				sdpMid: "0",
				sdpMLineIndex: 0
			};
		}
		function routes(mdns) {
			const host = mdns ? ["11111111-1111-4111-8111-111111111111.local", "22222222-2222-4222-9222-222222222222.local"] : ["192.168.1.10", "2001:db8:1:2:3:4:5:6"];
			return [candidate(1, "udp", host[0], 49157, "host"), candidate(2, "udp", host[1], 1029, "host"), candidate(3, "tcp", host[0], 65003, "host"), candidate(4, "tcp", host[1], 22111, "host"), candidate(5, "udp", "198.51.100.10", 34567, "srflx"), candidate(6, "udp", "2001:db8:10:20:30:40:50:60", 60001, "srflx"), candidate(7, "udp", "203.0.113.20", 12345, "relay"), candidate(8, "tcp", "192.0.2.20", 54321, "relay"), candidate(9, "udp", "2a00:1450:12:22:32:42:52:62", 23456, "relay"), candidate(10, "tcp", "2404:6800:12:22:32:42:52:62", 45678, "relay")];
		}

module.exports={sdps,routes};
