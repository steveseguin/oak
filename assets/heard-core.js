(function (root) {
  'use strict';
  function age(stamp, now) {
    const minutes = Math.max(0, Math.floor(((now || Date.now()) / 1000 - stamp) / 60));
    if (minutes < 1) return 'now';
    if (minutes < 60) return minutes + 'm';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h';
    return Math.floor(minutes / 1440) + 'd';
  }
  function validate(data) {
    if (!data || data.version !== 1 || !Number.isFinite(data.published_at)
        || !Array.isArray(data.nodes) || !Array.isArray(data.messages)
        || data.nodes.length > 10000 || data.messages.length > 200) throw Error('Invalid snapshot');
    for (const node of data.nodes) {
      if (!node || typeof node.name !== 'string' || !node.name || node.name.length > 200
          || !Array.isArray(node.position) || node.position.length !== 2
          || !node.position.every(Number.isFinite) || Math.abs(node.position[0]) > 90
          || Math.abs(node.position[1]) > 180) throw Error('Invalid node');
    }
    for (const message of data.messages) {
      if (!message || typeof message.name !== 'string' || typeof message.text !== 'string'
          || message.name.length > 200 || message.text.length > 2000
          || !Number.isFinite(message.received_at)) throw Error('Invalid message');
    }
    return data;
  }
  function color(name) {
    let hash = 2166136261;
    for (const c of name.normalize('NFKC').toLowerCase()) hash = Math.imul(hash ^ c.codePointAt(0), 16777619);
    hash >>>= 0;
    // Dark text on a pale background; many tones without low-contrast labels.
    return 'hsl(' + hash % 360 + ' ' + (35 + (hash >>> 9) % 31) + '% ' + (91 + (hash >>> 17) % 5) + '%)';
  }
  const api = {age, validate, color};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MeshcastHeard = api;
})(typeof window !== 'undefined' ? window : globalThis);
