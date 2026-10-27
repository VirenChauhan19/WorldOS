import { spawnSync } from 'node:child_process';

// Backend URL is public configuration, never a provider key. Do not silently ship
// a native app that points at the device's own loopback interface.
const value=process.env.VITE_API_BASE_URL;
let url;
try{url=new URL(value);}catch{throw new Error('Set VITE_API_BASE_URL to your deployed HTTPS backend origin before building native assets.');}
if(url.protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Native release builds require a non-local HTTPS backend origin, without credentials or paths.');
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{stdio:'inherit',env:{...process.env,VITE_NATIVE_BUILD:'1'},shell:process.platform==='win32'});
process.exit(result.status??1);
