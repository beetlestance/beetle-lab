import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionApp } from '../features/session/index.js';
import '../styles/tokens.css';
import '../styles/app.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root missing');
createRoot(element).render(<BrowserRouter><SessionApp baseUrl={window.location.origin} /></BrowserRouter>);
