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
  function color(name, dark = false) {
    let hash = 2166136261;
    for (const c of name.normalize('NFKC').toLowerCase()) hash = Math.imul(hash ^ c.codePointAt(0), 16777619);
    hash >>>= 0;
    // Keep each sender's hue, using a background suited to the theme's text.
    if (dark) return 'hsl(' + hash % 360 + ' ' + (22 + (hash >>> 9) % 17) + '% ' + (16 + (hash >>> 17) % 7) + '%)';
    return 'hsl(' + hash % 360 + ' ' + (35 + (hash >>> 9) % 31) + '% ' + (91 + (hash >>> 17) % 5) + '%)';
  }
  // Find the most points inside a fixed-size viewport, without changing scale.
  // For equally populated windows, keep the center closest to the reference.
  function bestMapCenter(points, size, preferred) {
    const width = Math.max(1, size.x), height = Math.max(1, size.y);
    const ordered = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a,b) => a.y - b.y);
    const leftEdges = [...new Set(ordered.map(p => p.x))];
    let best = {x:preferred.x, y:preferred.y}, bestCount = 0, bestDistance = Infinity;
    for (const left of leftEdges) {
      const column = ordered.filter(p => p.x >= left && p.x <= left + width);
      let end = 0;
      for (let start = 0; start < column.length; start++) {
        while (end < column.length && column[end].y <= column[start].y + height) end++;
        const count = end - start;
        if (count < bestCount) continue;
        let minX = Infinity, maxX = -Infinity;
        for (let i = start; i < end; i++) { minX = Math.min(minX, column[i].x); maxX = Math.max(maxX, column[i].x); }
        const x = Math.max(maxX - width/2, Math.min(minX + width/2, preferred.x));
        const y = Math.max(column[end-1].y - height/2, Math.min(column[start].y + height/2, preferred.y));
        const distance = (x-preferred.x)**2 + (y-preferred.y)**2;
        if (count > bestCount || distance < bestDistance) {
          best = {x,y}; bestCount = count; bestDistance = distance;
        }
      }
    }
    return best;
  }
  const api = {age, validate, color, activityBins, bestMapCenter};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MeshcastHeard = api;
})(typeof window !== 'undefined' ? window : globalThis);
