(function (root) {
  'use strict';
  const MAX_PARTS=12, MAX_INPUT=12000, LIFETIME=20*60;
  function base64(bytes) {let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function bytes(text) {
    if(!/^[A-Za-z0-9_-]+$/.test(text) || text.length%4===1)throw Error('Invalid payload encoding.');
    const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/'));
    const result=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(base64(result)!==text)throw Error('Non-canonical payload encoding.');
    return result;
  }
  async function checksum(data) {if(!root.crypto || !root.crypto.subtle)throw Error('Open Meshcast over HTTPS to use the handshake tool.');const digest=await root.crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,12);}
  async function pack(input,budget=140,now=Math.floor(Date.now()/1000)) {
    if(typeof input!=='string' || input.length>4000)throw Error('Paste one current VDO.Ninja code or link.');
    if(![100,120,140].includes(budget))throw Error('Choose a supported message size.');
    const code=root.QRConnect.extractCode(input);
    if(!code.startsWith('Y'))throw Error('Only the current Y-format VDO.Ninja code is supported. Generate a new code at /qr.');
    const decoded=await root.QRConnect.decodeBlob(code);
    const data=root.QRConnect.transportBytes(code), hash=await checksum(data), expires=now+LIFETIME;
    const payload=base64(data), expiry=expires.toString(36);
    // Reserve the longest index and count fields so every emitted part fits.
    const capacity=budget-('MC1|'+hash+'|'+expiry+'|12/12|').length;
    const total=Math.ceil(payload.length/capacity);
    if(total>MAX_PARTS)throw Error('This code needs too many radio messages. Generate a smaller connection code.');
    const parts=[];
    for(let i=0;i<total;i++)parts.push('MC1|'+hash+'|'+expiry+'|'+(i+1)+'/'+total+'|'+payload.slice(i*capacity,(i+1)*capacity));
    return {parts,expires,role:decoded.role,originalBytes:new TextEncoder().encode(code).length};
  }
  async function unpack(input,now=Math.floor(Date.now()/1000)) {
    if(typeof input!=='string' || input.length>MAX_INPUT)throw Error('Paste at most 12,000 characters of message bodies.');
    const lines=input.trim().split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    if(!lines.length || lines.length>100)throw Error('Paste one numbered MC1 message per line.');
    const parts=new Map();let expected=null;
    for(const line of lines) {
      if(line.length>140)throw Error('A part exceeds 140 bytes. Paste only the message body, one per line.');
      const match=/^MC1\|([a-f0-9]{12})\|([a-z0-9]{1,8})\|([1-9][0-9]?)\/([1-9][0-9]?)\|([A-Za-z0-9_-]+)$/.exec(line);
      if(!match)throw Error('A line is not a complete MC1 message. Remove sender names and timestamps.');
      const [,hash,expiry,indexText,totalText,payload]=match;
      const expires=parseInt(expiry,36), index=Number(indexText),total=Number(totalText);
      if(total>MAX_PARTS || index>total)throw Error('Invalid part count.');
      if(expires<=now)throw Error('These parts have expired. Ask the sender to make a fresh set while their connection is still open.');
      if(expires>now+LIFETIME+120)throw Error('The expiry is too far ahead. Check both computers’ clocks.');
      const group=hash+'|'+expiry+'|'+total;
      if(expected && expected.group!==group)throw Error('These parts belong to different sets. Combine one offer or answer at a time.');
      expected={group,hash,expires,total};
      if(parts.has(index) && parts.get(index)!==payload)throw Error('Two copies of the same part disagree. Ask for that part again.');
      parts.set(index,payload);
    }
    const missing=[];for(let i=1;i<=expected.total;i++)if(!parts.has(i))missing.push(i);
    if(missing.length)return {complete:false,missing,total:expected.total,received:parts.size};
    let joined='';for(let i=1;i<=expected.total;i++)joined+=parts.get(i);
    const data=bytes(joined);
    if(await checksum(data)!==expected.hash)throw Error('The integrity check failed. At least one part was changed or damaged.');
    const code=root.QRConnect.transportCode(data),decoded=await root.QRConnect.decodeBlob(code);
    return {complete:true,code,role:decoded.role,expires:expected.expires,total:expected.total};
  }
  const api={pack,unpack};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.MeshcastPackets=api;
})(typeof globalThis!=='undefined' ? globalThis : this);
