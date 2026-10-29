import React from 'react';
import ReactDOM from 'react-dom/client';
import WorldOS from './WorldOS';
import MobileShell from './MobileShell';
import { registerServiceWorker } from './pwa';
import './styles.css';
import './inspect/styles.css';
import './mobile.css';
import './motion.css';
import './consumer.css';
import './spatial.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MobileShell><WorldOS/></MobileShell></React.StrictMode>);
registerServiceWorker();
