import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { detectBackend, type Backend } from './api/backend';
import { BackendProvider } from './api/hooks';
import { App } from './app/App';
import logo from './assets/logo.jpg';

function Boot() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    detectBackend().then(setBackend, (e: unknown) => setError(e instanceof Error ? e.message : 'Không khởi động được ứng dụng'));
  }, []);
  if (error) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 16 }}>
          <img src={logo} alt="ARGOLET" style={{ width: 160, margin: '0 auto 20px' }} />
          <p className="strong">Không thể khởi động ARGOLET</p>
          <p className="muted mt-8">{error}</p>
          <button className="btn btn-primary mt-16" onClick={() => window.location.reload()}>
            Thử lại
          </button>
        </div>
      </div>
    );
  }
  if (!backend) {
    return (
      <div className="center-screen" aria-busy="true">
        <div style={{ textAlign: 'center' }}>
          <img src={logo} alt="ARGOLET" style={{ width: 180, margin: '0 auto 20px' }} />
          <span className="spinner dark" style={{ display: 'inline-block' }} />
          <p className="muted small mt-8">Đang khởi động…</p>
        </div>
      </div>
    );
  }
  return (
    <BackendProvider backend={backend}>
      <App />
    </BackendProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
