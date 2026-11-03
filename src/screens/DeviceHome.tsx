import { ArrowRight, ArrowUpRight, MoveUpRight, Play, Sparkles } from 'lucide-react';
import WorldIcon from '../ui/WorldIcon';
import { navigate } from '../navigation';
import DeviceSpaces from '../device/DeviceSpaces';
import RecordedScene from '../showcase/RecordedScene';
import './device-home.css';

export default function DeviceHome({active=true}:{active?:boolean}) {
  return <div className="device-home">
    <header className="dh-page-heading">
      <div><h1 id="device-home-title">Your space, in focus.</h1><p>A fresh perspective on the places you live, work, and create.</p></div>
      <span className="dh-page-note"><Sparkles size={15} aria-hidden="true"/>A little space. A lot of possibility.</span>
    </header>

    <section className="dh-dashboard" aria-labelledby="dh-hero-title">
      <div className="dh-hero-orbit" aria-hidden="true"/>
      <div className="dh-intro">
        <span className="dh-eyebrow"><WorldIcon name="scan" size={16}/>YOUR EVERYDAY, REIMAGINED</span>
        <h2 id="dh-hero-title">See your space.<br/><span>Find its potential.</span></h2>
        <p>Turn the room in front of you into a place that works for you. Explore what’s there, try a new layout, and keep what feels right.</p>
        <div className="dh-start-actions">
          <button className="dh-primary" onClick={()=>navigate('prepare')}><WorldIcon name="scan" size={20}/><span>Get my space ready</span><ArrowUpRight size={17} aria-hidden="true"/></button>
          <button className="dh-example-button" onClick={()=>navigate('live')}><WorldIcon name="camera" size={19}/>Open live camera</button>
          <button className="dh-example-button" onClick={()=>navigate('live',{demo:'1'})}><span className="dh-play-icon"><Play size={12} fill="currentColor" aria-hidden="true"/></span>Try the camera example</button>
        </div>
        <p className="dh-start-note">No account needed. Start with what’s around you.</p>
        <div className="dh-hero-process" aria-label="See, plan, and save your space">
          <span><WorldIcon name="scan" size={18}/>See it</span><ArrowRight size={13} aria-hidden="true"/><span><WorldIcon name="room" size={18}/>Shape it</span><ArrowRight size={13} aria-hidden="true"/><span><WorldIcon name="spaces" size={18}/>Save it</span>
        </div>
      </div>

      <aside className="dh-preview" aria-label="Camera example">
        <div className="dh-preview-heading"><h3><span/>Recorded example</h3><span>Go ahead. Select an object.</span></div>
        <RecordedScene/>
        <p className="dh-preview-footnote"><WorldIcon name="scan" size={15}/>Recorded with Muse Spark + SAM 3.1. No camera needed.</p>
      </aside>
    </section>

    <section className="dh-ar-entry" aria-labelledby="dh-ar-title">
      <span className="dh-ar-icon" aria-hidden="true"><WorldIcon name="scan" size={29}/></span>
      <div><span className="dh-ar-eyebrow">AR INTERIOR STUDIO</span><h2 id="dh-ar-title">Your next idea, in 3D.</h2><p>Arrange furniture, explore finishes, and preview a scene in your space.</p></div>
      <button onClick={()=>navigate('ar',{workspace:''})}>Open AR studio<ArrowUpRight size={18} aria-hidden="true"/></button>
    </section>

    <section className="dh-tools-section" aria-labelledby="dh-tools-title">
      <div className="dh-section-heading"><h2 id="dh-tools-title">Make it your space.</h2><p>Three ways to get started.</p></div>
      <div className="dh-tools" aria-label="Room and setup tools">
        <button className="dh-tool dh-discover" aria-label="Explore your space" onClick={()=>navigate('live')}>
          <span className="dh-card-top"><span>01 / DISCOVER</span><span className="dh-card-arrow"><ArrowUpRight size={18}/></span></span>
          <span className="dh-art dh-feature-art" aria-hidden="true"><span className="dh-feature-icon"><WorldIcon name="camera" size={50}/></span></span>
          <span className="dh-tool-copy"><strong>Explore your space</strong><span>Point your camera. Get a new perspective on the things around you.</span></span>
          <span className="dh-tool-action">Open camera<ArrowRight size={16}/></span>
        </button>
        <button className="dh-tool dh-reimagine" aria-label="Plan a room" onClick={()=>navigate('room')}>
          <span className="dh-card-top"><span>02 / REIMAGINE</span><span className="dh-card-arrow"><ArrowUpRight size={18}/></span></span>
          <span className="dh-art dh-feature-art" aria-hidden="true"><span className="dh-feature-icon"><WorldIcon name="room" size={50}/></span></span>
          <span className="dh-tool-copy"><strong>Plan a room</strong><span>Try furniture in your photo and compare saved layouts before moving a thing.</span></span>
          <span className="dh-tool-action">Start planning<ArrowRight size={16}/></span>
        </button>
        <button className="dh-tool dh-remember" aria-label="Save a setup" onClick={()=>navigate('mission')}>
          <span className="dh-card-top"><span>03 / REMEMBER</span><span className="dh-card-arrow"><ArrowUpRight size={18}/></span></span>
          <span className="dh-art dh-feature-art" aria-hidden="true"><span className="dh-feature-icon"><WorldIcon name="spaces" size={50}/></span></span>
          <span className="dh-tool-copy"><strong>Save a setup</strong><span>Keep the photos, little details, and checklists that make it yours.</span></span>
          <span className="dh-tool-action">Create a setup<ArrowRight size={16}/></span>
        </button>
      </div>
    </section>

    <section className="dh-recent" aria-label="Recent saved spaces"><div className="dh-section-heading"><h2>Pick up where you left off.</h2><span>Saved on this device</span></div><DeviceSpaces active={active} compact/></section>

    <footer className="dh-footer"><span><WorldIcon name="privacy" size={17}/>Your saved spaces stay on this device.</span><button onClick={()=>navigate('history')}>View your saved spaces<MoveUpRight size={14} aria-hidden="true"/></button></footer>
  </div>;
}
