import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { BOOT_MAX_MS, dismissBoot } from './boot.js';
import './styles/apple-hig-theme.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element missing from index.html');
}
window.setTimeout(dismissBoot, BOOT_MAX_MS);

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
