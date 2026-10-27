import { useState } from 'react';
import App from './App';
import Inspect from './inspect/Inspect';

export default function WorldOS() {
  const [product,setProduct]=useState<'inspect'|'studio'>('inspect');
  return <><nav className="worldos-products" aria-label="WorldOS products"><span>WORLDOS <small>V0.8</small></span><button aria-pressed={product==='inspect'} onClick={()=>setProduct('inspect')}>WorldOS Inspect</button><button aria-pressed={product==='studio'} onClick={()=>setProduct('studio')}>Spatial Studio</button></nav><div hidden={product!=='inspect'}><Inspect/></div><div className="desk-view" hidden={product!=='studio'}><App/></div></>;
}
