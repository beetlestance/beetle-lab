import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { createApiClient } from '@beetle/contracts/api';
import { App } from './App.js';
import '../styles/tokens.css';
import '../styles/app.css';

const element = document.getElementById('root');
if (!element) throw new Error('Application root missing');
const apiClient = createApiClient({ baseUrl: window.location.origin });
createRoot(element).render(<BrowserRouter><App apiClient={apiClient} /></BrowserRouter>);
