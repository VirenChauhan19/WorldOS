// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { loadRoomDraft, roomDraftKey } from './roomDraft';
afterEach(()=>localStorage.clear());
it('restores the furniture even when a dimension was left unfinished',()=>{
  localStorage.setItem(roomDraftKey,JSON.stringify({source:'entered',roomFields:{width:'4.2',depth:'5.1',height:''},gap:'.3',manual:null,items:[{id:'desk-1',kind:'desk',label:'My desk',color:'#b59a73',width:NaN,depth:.6,height:.75}]}));
  const draft=loadRoomDraft();expect(draft?.roomFields.width).toBe('4.2');expect(draft?.items[0].label).toBe('My desk');expect(draft?.items[0].width).toBeNaN();
});
it('ignores malformed room drafts',()=>{
  localStorage.setItem(roomDraftKey,'{invalid');expect(loadRoomDraft()).toBeNull();
  localStorage.setItem(roomDraftKey,JSON.stringify({source:'entered',roomFields:{other:'4',unused:'5',unknown:''},items:[],gap:'.3',manual:null}));expect(loadRoomDraft()).toBeNull();
});
