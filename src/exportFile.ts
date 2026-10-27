import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportJSON(value:unknown,name:string) {
  const content=JSON.stringify(value,null,2);
  if(Capacitor.isNativePlatform()){
    const path=`worldos-export-${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    try{
      const file=await Filesystem.writeFile({path,data:content,directory:Directory.Cache,encoding:Encoding.UTF8});
      await Share.share({title:'WorldOS inspection report',files:[file.uri],dialogTitle:'Save or share your WorldOS report'});
    }finally{await Filesystem.deleteFile({path,directory:Directory.Cache}).catch(()=>{});}
    return;
  }
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
