// Sequential, offline checks. No browser, radio connection, or RF transmission.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), {sdps,routes}=require('./fixtures.cjs');
const context={console,TextEncoder,TextDecoder,Uint8Array,BigInt,CompressionStream,DecompressionStream,Response,Blob,URL,btoa,atob,
  crypto:require('node:crypto').webcrypto,addEventListener(){},removeEventListener(){},clearTimeout,clearInterval};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'call/qrconnect.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/mesh-packets.js'),'utf8'),context);
const profiles=require('../assets/profile-core.js'),packets=context.MeshcastPackets;
async function main() {
  let sets=0;const results=[];
  for(const engine of Object.keys(sdps))for(const role of ['offer','answer'])for(const budget of [100,120,140]) {
    const session=new context.QRConnect.Session({role:role==='offer'?'share':'join'});
    const encoded=await session.buildBlob({streamID:'qrc',session:'AbCdEf2345',description:{sdp:sdps[engine](role==='offer'?'actpass':'active')}},routes(engine==='firefox'));
    const result=await packets.pack(encoded.text,budget,2000000000);
    assert.ok(result.parts.every(p=>Buffer.byteLength(p)===p.length && p.length<=budget));
    const combined=await packets.unpack([...result.parts].reverse().concat(result.parts[0]).join('\n'),2000000001);
    assert.equal(combined.code,encoded.text);assert.equal(combined.role,role);
    const decoded=await context.QRConnect.decodeBlob(combined.code);assert.equal(decoded.candidates.length,10);
    const partial=await packets.unpack(result.parts.slice(1).join('\n'),2000000001);
    assert.equal(partial.complete,false);assert.deepEqual(Array.from(partial.missing),[1]);
    await assert.rejects(packets.unpack(result.parts.join('\n'),result.expires),/expired/);
    await assert.rejects(packets.unpack(result.parts.join('\n'),1999990000),/clocks/);
    const damaged=result.parts.slice();damaged[0]=damaged[0].slice(0,-1)+(damaged[0].endsWith('A')?'B':'A');
    await assert.rejects(packets.unpack(damaged.join('\n'),2000000001),/integrity|encoding/);
    await assert.rejects(packets.unpack([result.parts[0],damaged[0]].join('\n'),2000000001),/disagree/);
    await assert.rejects(packets.unpack([result.parts[0],result.parts[1].replace('MC1|','MC1|000000000000|')].join('\n'),2000000001));
    const other=await packets.pack(encoded.text,budget,2000000002);
    await assert.rejects(packets.unpack([result.parts[0],other.parts[1]].join('\n'),2000000003),/different sets/);
    const link=await packets.pack('https://vdo.ninja/qr#'+encodeURIComponent(encoded.text),budget,2000000000);
    assert.deepEqual(Array.from(link.parts),Array.from(result.parts));
    results.push({engine,role,budget,parts:result.parts.length,largest:Math.max(...result.parts.map(p=>p.length))});sets++;
  }
  for(const bad of ['', 'MC1|nonsense', 'x'.repeat(12001)])await assert.rejects(packets.unpack(bad));
  await assert.rejects(packets.pack('Ybad'));
  await assert.rejects(packets.pack('Ytest',141),/size/);
  const key='ab'.repeat(32), basic={key,name:'Peer',bio:'<img src=x onerror=alert(1)>',links:'https://github.com/example'};
  const made=profiles.create(basic);assert.equal(made.public_key,key);assert.equal(made.verification.status,'unverified');
  assert.equal(made.bio,basic.bio);assert.equal(profiles.key(key.toUpperCase()),key);
  for(const bad of ['ab','../index','ab'.repeat(33)])assert.throws(()=>profiles.key(bad));
  for(const bad of ['javascript:alert(1)','data:image/svg+xml,test','http://example.com/','https://name:password@example.com/'])assert.throws(()=>profiles.https(bad));
  assert.throws(()=>profiles.create({...basic,links:Array(7).fill('https://example.com/').join('\n')}));
  assert.throws(()=>profiles.create({...basic,name:'x'.repeat(61)}));
  assert.throws(()=>profiles.validate(made,'cd'.repeat(32)));
  const index=JSON.parse(fs.readFileSync(path.join(root,'profiles/index.json'))), seen=new Set();
  for(const entry of index.profiles) {
    assert.equal(seen.has(entry.public_key),false);seen.add(entry.public_key);
    assert.equal(entry.path,entry.public_key+'.json');
    const record=JSON.parse(fs.readFileSync(path.join(root,'profiles',entry.path)));
    profiles.validate(record,entry.public_key);
  }
  // Check every authored page's local assets and link targets, including anchors.
  const pages=['index.html','profiles.html','connect.html','radio.html','call/index.html'];
  for(const file of pages) {
    const text=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(text,/Oakridge|Meshtastic|906\.875|ESP32 V3/);
    assert.match(text,/<meta name="viewport"/);
    const ids=[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
    for(const match of text.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const value=match[1];if(!value || /^(https?:|data:)/.test(value))continue;
      const [pathname,hash]=value.split('#'),target=path.resolve(root,path.dirname(file),pathname || path.basename(file));
      const actual=fs.existsSync(target) && fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;
      assert.ok(fs.existsSync(actual),file+' missing '+value);
      if(hash && !/^[a-f0-9]{64}$/.test(hash))assert.ok(fs.readFileSync(actual,'utf8').includes('id="'+hash+'"'),file+' missing anchor '+value);
    }
  }
  console.log('Passed: '+sets+' handshake round trips, byte budgets, route preservation, reorder/duplicates, missing/corrupt/mixed/expired parts, profile validation and static page links.');
  console.log(JSON.stringify(results.filter(r=>r.budget===140)));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
