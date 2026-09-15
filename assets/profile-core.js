(function (root) {
  'use strict';
  function key(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(text)) throw new Error('Enter the full 64-character MeshCore public key.');
    return text;
  }
  function https(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 1000) throw new Error('Use a public HTTPS URL of at most 1,000 characters.');
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('Enter a complete HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Links must use HTTPS and cannot contain login credentials.');
    return url.href;
  }
  function create(input) {
    const name = String(input.name || '').trim(), bio = String(input.bio || '').trim();
    if (!name || name.length > 60) throw new Error('Use a display name of 1–60 characters.');
    if (bio.length > 240) throw new Error('Keep the bio to 240 characters.');
    const urls = String(input.links || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    if (urls.length > 6) throw new Error('Use up to six website or social links.');
    return {schema_version:1,protocol:'meshcore',public_key:key(input.key),display_name:name,bio,
      avatar_url:input.avatar ? https(input.avatar) : null,
      links:urls.map(v => {const url=https(v);return {label:new URL(url).hostname.replace(/^www\./,''),url};}),
      verification:{status:'unverified',note:'User-submitted. Radio and social account ownership have not been independently verified.'},
      updated_at:new Date().toISOString().slice(0,10)};
  }
  function validate(record, expectedKey) {
    if (!record || record.schema_version !== 1 || record.protocol !== 'meshcore' || key(record.public_key) !== key(expectedKey)) throw new Error('The profile does not match this key or schema.');
    if (!Array.isArray(record.links)) throw new Error('Invalid profile links.');
    // Apply the same content limits to published and submitted profiles.
    create({key:record.public_key,name:record.display_name,bio:record.bio,avatar:record.avatar_url,links:record.links.map(link=>link.url).join('\n')});
    return record;
  }
  const api = {key,https,create,validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MeshcastProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
