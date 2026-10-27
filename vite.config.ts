import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'VITE_');
  const base=process.env.VITE_API_BASE_URL||env.VITE_API_BASE_URL;
  if(mode==='production'&&base){const url=new URL(base);if(url.protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Production backend URLs must be non-local HTTPS origins.');}
  if(process.env.VITE_NATIVE_BUILD==='1'&&!base)throw new Error('Native builds require VITE_API_BASE_URL.');
  return {
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
};});
