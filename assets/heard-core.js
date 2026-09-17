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
    if (data.activity) {
      const a = data.activity;
      if (!Number.isInteger(a.through) || a.through % 3600 !== 0
          || (a.since !== null && (!Number.isInteger(a.since) || a.since > a.through))
          || !Array.isArray(a.hours) || a.hours.length > 8800) throw Error('Invalid activity');
      let previous = -1;
      for (const row of a.hours) {
        if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0])
            || row[0] % 3600 !== 0 || row[0] <= previous || row[0] > a.through
            || !Number.isSafeInteger(row[1]) || row[1] < 1) throw Error('Invalid activity hour');
        previous = row[0];
      }
    }
    if (data.locations && (!Number.isSafeInteger(data.locations.mapped) || data.locations.mapped !== data.nodes.length
        || !Number.isSafeInteger(data.locations.unknown) || data.locations.unknown < 0)) throw Error('Invalid location counts');
    if (data.arrivals) {
      if (!Array.isArray(data.arrivals) || data.arrivals.length > 6) throw Error('Invalid arrivals');
      for (const arrival of data.arrivals) {
        if (!Number.isFinite(arrival.first_seen) || !Array.isArray(arrival.position)
            || !data.nodes.some(n => n.name === arrival.name && n.position[0] === arrival.position[0]
              && n.position[1] === arrival.position[1])) throw Error('Invalid arrival');
      }
    }
    return data;
  }
  const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Toronto', year:'numeric', month:'2-digit', day:'2-digit'});
  function dayKey(stamp) { return dayFormat.format(new Date(stamp * 1000)); }
  function activityBins(activity, period) {
    if (!activity) return [];
    const counts = new Map(activity.hours), bins = [];
    if (period === '24h') {
      for (let i = 23; i >= 0; i--) {
        const stamp = activity.through - i * 3600;
        bins.push({stamp, label:i ? i + 'h ago' : 'This hour', count:counts.get(stamp) || 0,
          known:activity.since !== null && stamp >= activity.since, partial:i === 0 || stamp === activity.since});
      }
      return bins;
    }
    const days = period === '30d' ? 30 : 7;
    const today = dayKey(activity.through);
    const date = new Date(today + 'T12:00:00Z');
    const totals = new Map();
    for (const [stamp,count] of activity.hours) {
      const key = dayKey(stamp);
      totals.set(key, (totals.get(key) || 0) + count);
    }
    const firstDay = activity.since === null ? null : dayKey(activity.since);
    for (let i = days - 1; i >= 0; i--) {
      const stamp = date.getTime() / 1000 - i * 86400, key = dayKey(stamp);
      bins.push({stamp, label:i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Intl.DateTimeFormat('en-CA',
        {timeZone:'America/Toronto', weekday:'short', month:'short', day:'numeric'}).format(new Date(stamp * 1000)),
        count:totals.get(key) || 0, known:firstDay !== null && key >= firstDay, partial:key === today || key === firstDay});
    }
    return bins;
  }
  function color(name) {
    let hash = 2166136261;
    for (const c of name.normalize('NFKC').toLowerCase()) hash = Math.imul(hash ^ c.codePointAt(0), 16777619);
    hash >>>= 0;
    // Dark text on a pale background; many tones without low-contrast labels.
    return 'hsl(' + hash % 360 + ' ' + (35 + (hash >>> 9) % 31) + '% ' + (91 + (hash >>> 17) % 5) + '%)';
  }
  const api = {age, validate, color, activityBins};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MeshcastHeard = api;
})(typeof window !== 'undefined' ? window : globalThis);
