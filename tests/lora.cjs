// Sequential offline codec tests. No radio, network, or media capture.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),{sdps,routes}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..');
const c={console,TextEncoder,TextDecoder,Uint8Array,BigInt,CompressionStream,DecompressionStream,Response,Blob,URL,btoa,atob,
  crypto:require('node:crypto').webcrypto,addEventListener(){},removeEventListener(){},clearTimeout,clearInterval};
c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'call/qrconnect.js'),'utf8'),c);
async function main(){
  let checks=0;
  for(const engine of Object.keys(sdps))for(const role of ['offer','answer'])for(const budget of [100,120,140]){
    const session=new c.QRConnect.Session({role:role==='offer'?'share':'join',lora:true,loraBudget:budget});
    const source=sdps[engine](role==='offer'?'actpass':'active');
    const encoded=await session.buildBlob({streamID:'qrc',session:'AbCdEf2345',description:{sdp:source}},routes(engine==='firefox'));
    const packets=[];session.on('packet',p=>packets.push(p.text));
    session.publishLoRaPackets(encoded.packets);session.publishLoRaCandidates(encoded.remaining);
    assert.ok(packets.every(p=>p.length<=budget && /^[A-Z2-7]+$/.test(p.slice(3)) && Buffer.byteLength(p)===p.length));
    const state={},payloads=[];
    // Later records and fragments must wait for the first fragment.
    for(const text of packets.slice(1).reverse()){
      const received=await c.QRConnect.receiveLoRaPacket(state,text);assert.equal(received.payloads.length,0);
    }
    const duplicate=await c.QRConnect.receiveLoRaPacket(state,packets[1]);assert.equal(duplicate.duplicate,true);
    payloads.push(...(await c.QRConnect.receiveLoRaPacket(state,packets[0])).payloads);
    assert.equal(payloads[0].role,role);
    assert.equal(payloads.reduce((n,p)=>n+p.candidates.length,0),10);
    assert.match(payloads[0].sdp,/a=sctp-port:5000/);
    const bad=packets[0].slice(0,-1)+(packets[0].endsWith('A')?'B':'A');
    await assert.rejects(c.QRConnect.receiveLoRaPacket({},bad),/damaged/);
    await assert.rejects(c.QRConnect.receiveLoRaPacket({id:'AAAAAAAA'},packets[0]),/another connection/);
    checks++;
  }
  // Unrecognized SDP that exceeds the old QR guard still travels as split L1.
  const description={streamID:'qrc',session:'AbCdEf2345',description:{sdp:sdps.chromium('actpass')+'a=x-meshcast-test:extra-description-data\r\n'}};
  await assert.rejects(new c.QRConnect.Session({role:'share'}).buildBlob(description,routes(false)),/118-character limit/);
  const large=await new c.QRConnect.Session({role:'share',lora:true}).buildBlob(description,routes(false));
  assert.ok(large.packets.length>1);
  const page=fs.readFileSync(path.join(root,'call/index.html'),'utf8');
  assert.match(page,/vdoBase: "https:\/\/vdo\.ninja\/"/);
  assert.doesNotMatch(page,/\bsrc="https:\/\/vdo\.ninja\/qr/);
  assert.match(page,/el\("lora-mode"\)\.checked = !params\.has\("qr"\)/);
  assert.doesNotMatch(page,/^\s*setupOfflineCache\(\);/m);
  for(const script of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
  console.log('Passed: '+checks+' L1 round trips, byte limits, retained routes, reorder/duplicates, missing/corrupt/mixed parts, oversized SDP and local iframe integration.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
