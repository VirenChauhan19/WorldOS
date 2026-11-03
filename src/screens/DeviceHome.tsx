import { ArrowUpRight, Camera } from 'lucide-react';
import { navigate } from '../navigation';
import DeviceSpaces from '../device/DeviceSpaces';
import RecordedScene from '../showcase/RecordedScene';
import './device-home.css';

export default function DeviceHome({active=true}:{active?:boolean}) {
  return <div className="device-home">
    <section className="dh-dashboard" aria-labelledby="device-home-title">
      <div className="dh-main">
        <div className="dh-intro">
          <h1 id="device-home-title">Your space,<br/> in focus.</h1>
          <p>Get ready to work, make room to create, or return to a setup you love.</p>
          <div className="dh-start-actions">
            <button className="dh-primary" onClick={()=>navigate('prepare')}><Camera size={20} strokeWidth={1.6}/><span>Get my space ready</span></button>
            <button className="dh-example-button" onClick={()=>navigate('live')}>Open live camera</button>
            <button className="dh-example-button" onClick={()=>navigate('live',{demo:'1'})}>Try the camera example</button>
          </div>
        </div>

        <section className="dh-tools" aria-label="Room and setup tools">
          <button className="dh-tool" onClick={()=>navigate('room')}>
            <span className="dh-tool-copy"><strong>Plan a room</strong><span>Try furniture in your photo and compare saved layouts.</span></span>
            <ArrowUpRight size={21} strokeWidth={1.6}/>
          </button>
          <button className="dh-tool" onClick={()=>navigate('mission')}>
            <span className="dh-tool-copy"><strong>Save a setup</strong><span>Keep a photo, notes, and a checklist.</span></span>
            <ArrowUpRight size={21} strokeWidth={1.6}/>
          </button>
        </section>

        <section className="dh-recent" aria-label="Recent saved spaces">
          <h2>Recent spaces</h2>
          <DeviceSpaces active={active} compact/>
        </section>
        <p className="dh-storage-note">Saved work stays in this browser on this device.</p>
      </div>

      <aside className="dh-preview" aria-label="Camera example">
        <div className="dh-preview-heading"><h2>Recorded example</h2><span>Select an object to explore</span></div>
        <RecordedScene/>
        <p className="dh-preview-footnote">A saved camera scan. No camera access is needed.</p>
      </aside>
    </section>
  </div>;
}
