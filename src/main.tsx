import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import SignedVaultApp from './signed-vault/SignedVaultApp.tsx';
import './index.css';
import './signed-vault-styles.css';

// /signed-vault mounts its own isolated app; everything else is the main NANZO site.
const mount = document.getElementById('root')!;
const isVault = window.location.pathname.startsWith('/signed-vault');

createRoot(mount).render(
  <StrictMode>
    {isVault ? <SignedVaultApp /> : <App />}
  </StrictMode>
);
