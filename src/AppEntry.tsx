import { useEffect, useState } from 'react';
import WorldOS from './WorldOS';
import MobileShell from './MobileShell';
import { setAccessToken } from './backend';
import { DeviceWorkspaceContext } from './device/context';
import { navigate } from './navigation';
import Dialog from './ui/Dialog';
import './device/device.css';

/** The device workspace never waits for the private server or starts a session. */
export default function AppEntry() {
  const [privateWorkspace, setPrivateWorkspace] = useState(false);
  const [installHelp,setInstallHelp]=useState(false),[installPrompt,setInstallPrompt]=useState<(Event & {prompt:()=>Promise<void>})|null>(null);
  useEffect(() => {
    const open = () => { navigate('home'); setPrivateWorkspace(true); };
    window.addEventListener('worldos:open-private', open);
    return () => window.removeEventListener('worldos:open-private', open);
  }, []);
  useEffect(()=>{
    if(privateWorkspace)return;
    const help=()=>setInstallHelp(true);
    const prompt=(event:Event)=>{event.preventDefault();setInstallPrompt(event as Event & {prompt:()=>Promise<void>});};
    window.addEventListener('worldos:install',help);window.addEventListener('beforeinstallprompt',prompt);
    return()=>{window.removeEventListener('worldos:install',help);window.removeEventListener('beforeinstallprompt',prompt);};
  },[privateWorkspace]);
  function returnToDevice() {
    setAccessToken('');
    navigate('home');
    setPrivateWorkspace(false);
  }
  return <>
    {privateWorkspace&&<div className="device-bar"><span>Private workspace</span><button onClick={returnToDevice}>Back to device workspace</button></div>}
    {privateWorkspace ? <MobileShell><WorldOS/></MobileShell> : <DeviceWorkspaceContext.Provider value={true}><WorldOS/></DeviceWorkspaceContext.Provider>}
    <Dialog open={installHelp&&!privateWorkspace} onClose={()=>setInstallHelp(false)} title="Add WorldOS to your home screen"><div className="consumer"><p>On iPhone, open WorldOS in Safari, tap Share, then Add to Home Screen. On Android, choose Install app or Add to Home screen in your browser menu.</p><p>Export your device setups before switching browsers or installing so you have a backup if the installed app uses separate storage.</p>{installPrompt&&<button className="primary" onClick={()=>void installPrompt.prompt().then(()=>{setInstallPrompt(null);setInstallHelp(false);}).catch(()=>setInstallPrompt(null))}>Install WorldOS</button>}</div></Dialog>
  </>;
}
