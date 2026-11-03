import React from 'react';
import ReactDOM from 'react-dom/client';
import AppEntry from './AppEntry';
import { registerServiceWorker } from './pwa';
import './styles.css';
import './inspect/styles.css';
import './mobile.css';
import './motion.css';
import './consumer.css';
import './spatial.css';
import './consumer-app.css';
import './design-system.css';
import './room/workspace.css';
import './workspace-polish.css';
import './ui/world-icons.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppEntry/></React.StrictMode>);
registerServiceWorker();
