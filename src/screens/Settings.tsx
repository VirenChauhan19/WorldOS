import { ArrowRight } from 'lucide-react';
import { navigate } from '../navigation';
import { useAuthenticationRequired } from '../access';
export default function Settings({reduced,onReduced}:{reduced:boolean;onReduced:(value:boolean)=>void}){
  const authenticated=useAuthenticationRequired();
  return <div className="consumer settings-simple"><h1>Settings</h1><p>Make WorldOS comfortable for you.</p>
    <section><h2>Motion</h2><label className="setting-toggle"><span>Reduce motion</span><input type="checkbox" role="switch" aria-label="Reduce motion" checked={reduced} onChange={e=>onReduced(e.target.checked)}/></label><p className="quiet">Your device’s accessibility settings are always respected.</p></section>
    <section><h2>Keep WorldOS handy</h2><p>Add it to your home screen for easy access to your spaces.</p><button className="secondary" onClick={()=>window.dispatchEvent(new Event('worldos:install'))}>Add to home screen</button></section>
    <section><h2>Your photos and privacy</h2><p>Your photos are stored with your workspace. Choosing a new photo in a guided check automatically sends it for AI item recognition. You can review and correct the results before saving a setup or checking for changes.</p><p>Free hosting is temporary: saved spaces, photos, drafts, and sessions may be lost after restarts or redeployments. Keep important originals on your device.</p></section>
    <button className="space-row" onClick={()=>navigate('advanced')}><span>Advanced<small>Spatial Studio, detailed review, and connection tools</small></span><ArrowRight size={20}/></button>
    {authenticated&&<button className="text-button" onClick={()=>window.dispatchEvent(new Event('worldos:sign-out'))}>Sign out</button>}<p className="quiet">WorldOS 1.3 · Made for the places you care about.</p>
  </div>;
}
