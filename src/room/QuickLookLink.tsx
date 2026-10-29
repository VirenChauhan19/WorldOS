import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Camera, LoaderCircle } from 'lucide-react';
import type { FurnitureItem, FurniturePlacement } from './layout';
import { buildFurnitureUSDZ } from './quickLook';

export function useQuickLookAsset(items: readonly FurnitureItem[], placements: readonly FurniturePlacement[], enabled: boolean) {
  const [generation,setGeneration]=useState(0);
  const retry=useCallback(()=>setGeneration(value=>value+1),[]);
  // Stable input prevents unrelated camera updates from rebuilding the package.
  const key = JSON.stringify([items, placements,generation]);
  const input = useMemo(() => ({items, placements}), [key]);
  const [asset, setAsset] = useState<{key: string; url: string; error: string}>({key:'',url:'',error:''});
  useEffect(() => {
    if (!enabled) { setAsset({key:'',url:'',error:''}); return; }
    let url = '';
    // Wait for dragging/typing to settle instead of exporting on every pointer move.
    const timer = window.setTimeout(() => {
      try {
        url = URL.createObjectURL(buildFurnitureUSDZ(input.items, input.placements));
        setAsset({key, url, error:''});
      } catch (error) {
        setAsset({key, url:'', error:error instanceof Error ? error.message : 'The AR preview could not be prepared.'});
      }
    }, 120);
    // Keep the blob alive while Apple's viewer is open. Release only on edit/unmount.
    return () => { window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [enabled, input, key]);
  return {...(enabled && asset.key === key ? asset : {url:'',error:''}),retry};
}

export function QuickLookLink({url, onOpen, className='', unavailableReason}: {url: string; onOpen: () => void; className?: string; unavailableReason?: string}) {
  if(unavailableReason)return <button className={`room-primary ${className}`} disabled><Camera size={17}/>{unavailableReason}</button>;
  if (!url) return <button className={`room-primary ${className}`} disabled><LoaderCircle size={17}/>Preparing AR preview…</button>;
  return <div className={`room-quick-look ${className}`}>
    {/* Safari requires a real rel=ar link with exactly one image child. */}
    <a rel="ar" href={`${url}#allowsContentScaling=0`} download="worldos-furniture.usdz" aria-label="View in my room" onClick={onOpen}>
      <img src="/icons/icon-192.png" alt="View furniture in your room"/>
    </a>
    <span aria-hidden="true"><Camera size={18}/><strong>View in my room</strong><ArrowUpRight size={18}/></span>
  </div>;
}
