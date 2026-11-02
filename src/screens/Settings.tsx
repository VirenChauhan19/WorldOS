import { ArrowRight } from 'lucide-react';
import { navigate } from '../navigation';
import { useAuthenticationRequired } from '../access';
import { openPrivateWorkspace, useDeviceWorkspace } from '../device/context';
export default function Settings({reduced,onReduced}:{reduced:boolean;onReduced:(value:boolean)=>void}){
  const authenticated=useAuthenticationRequired();
  const device=useDeviceWorkspace();
  return <div className="consumer settings-simple"><h1>Settings</h1><p>Accessibility, storage, and workspace options.</p>
    <section><h2>Motion</h2><label className="setting-toggle"><span>Reduce motion</span><input type="checkbox" role="switch" aria-label="Reduce motion" checked={reduced} onChange={e=>onReduced(e.target.checked)}/></label><p className="quiet">WorldOS also follows your device’s motion preferences.</p></section>
    <section><h2>Install WorldOS</h2><p>Add WorldOS to your home screen to open it directly.</p><button className="secondary" onClick={()=>window.dispatchEvent(new Event('worldos:install'))}>Add to home screen</button></section>
    <section><h2>Photos and storage</h2>{device?<><p>Setups, photos, notes, and room layouts are saved in this browser. Live recognition runs on your device without uploading photos.</p><p>Export a backup from My Spaces to keep a copy or move a setup to another device. Clearing this site's data removes local saves.</p><button className="secondary" onClick={openPrivateWorkspace}>Open private workspace</button></>:<><p>Photos are stored with your workspace. Adding a photo to a guided check sends it for AI item recognition. Review and correct the results before saving a setup or checking for changes.</p><p>Free hosting uses temporary storage. Saved spaces, photos, drafts, and sessions may be lost after a restart or redeployment. Keep original photos and backups on your device.</p></>}</section>
    <button className="space-row" onClick={()=>navigate('advanced')}><span>Advanced<small>Spatial Studio, detailed review, and connection tools</small></span><ArrowRight size={20}/></button>
    {authenticated&&<button className="text-button" onClick={()=>window.dispatchEvent(new Event('worldos:sign-out'))}>Sign out</button>}<p className="quiet">WorldOS 1.3</p>
  </div>;
}
