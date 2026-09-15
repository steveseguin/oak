'use strict';
const $=id=>document.getElementById(id);
let packRun=0,unpackRun=0,packExpires=0,restoredExpires=0;
const make=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls || '';if(text!==undefined)el.textContent=text;return el;};
async function copy(text,status) {try{await navigator.clipboard.writeText(text);status.textContent='Copied.';}catch(_){status.textContent='Clipboard unavailable. Select the text and copy it manually.';}}
function clearPack(){packRun++;packExpires=0;$('pack-result').replaceChildren();$('pack-status').textContent='';}
function clearUnpack(){unpackRun++;restoredExpires=0;$('unpack-result').hidden=true;$('restored-code').value='';$('unpack-status').textContent='';}
$('offer-code').addEventListener('input',clearPack);$('packet-budget').addEventListener('change',clearPack);$('received-parts').addEventListener('input',clearUnpack);
$('pack-form').addEventListener('submit',async event=>{
  event.preventDefault();clearPack();const run=packRun;$('pack-status').textContent='Checking and packing code…';
  try {
    const result=await MeshcastPackets.pack($('offer-code').value,Number($('packet-budget').value));if(run!==packRun)return;
    packExpires=result.expires;
    const nodes=result.parts.map((part,i)=>{
      const box=make('div','part'),head=make('div','part-head'),button=make('button','secondary','Copy part '+(i+1));button.type='button';
      head.append(make('strong','','Part '+(i+1)+' of '+result.parts.length+' · '+part.length+' bytes'),button);
      const text=make('textarea','mono');text.readOnly=true;text.value=part;text.setAttribute('aria-label','Radio message part '+(i+1));
      button.addEventListener('click',()=>{if(Date.now()/1000>=result.expires){$('pack-status').textContent='These parts expired. Pack the code again if your connection is still waiting.';return;}copy(part,$('pack-status'));});
      box.append(head,text);return box;
    });
    $('pack-result').replaceChildren(...nodes);$('pack-status').textContent='Ready: '+result.parts.length+' message'+(result.parts.length===1?'':'s')+' for this '+result.role+'. Expires at '+new Date(result.expires*1000).toLocaleTimeString()+'.';
  } catch(error){if(run===packRun)$('pack-status').textContent=error.message;}
});
$('unpack-form').addEventListener('submit',async event=>{
  event.preventDefault();clearUnpack();const run=unpackRun;$('unpack-status').textContent='Checking received parts…';
  try {
    const result=await MeshcastPackets.unpack($('received-parts').value);if(run!==unpackRun)return;
    if(!result.complete){$('unpack-status').textContent='Received '+result.received+' of '+result.total+'. Missing part'+(result.missing.length===1?'':'s')+': '+result.missing.join(', ')+'.';return;}
    restoredExpires=result.expires;$('restored-code').value=result.code;$('unpack-result').hidden=false;
    $('restored-role').textContent=result.role==='answer' ? 'This is an answer. Paste it into the original tab that created the offer.' : 'This is an offer. Paste it into a fresh connection tool to create an answer.';
    $('unpack-status').textContent='All '+result.total+' parts received. Integrity check passed; sender identity is not verified by this check.';
  } catch(error){if(run===unpackRun)$('unpack-status').textContent=error.message;}
});
$('copy-restored').addEventListener('click',()=>{if(Date.now()/1000>=restoredExpires){clearUnpack();$('unpack-status').textContent='This set expired. Ask the sender for fresh parts.';return;}copy($('restored-code').value,$('unpack-status'));});
setInterval(()=>{const now=Date.now()/1000;if(packExpires && now>=packExpires){clearPack();$('pack-status').textContent='Parts expired. Pack again if the original connection is still waiting.';}if(restoredExpires && now>=restoredExpires){clearUnpack();$('unpack-status').textContent='Restored code expired. Ask the sender for fresh parts.';}},1000);
