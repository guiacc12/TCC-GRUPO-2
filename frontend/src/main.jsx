import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { TemaProvider } from './contextos/TemaContexto.jsx';
import './estilos/global.css';

ReactDOM.createRoot(document.getElementById('raiz')).render(
  <React.StrictMode>
    <TemaProvider>
      <App />
    </TemaProvider>
  </React.StrictMode>
);
