import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import UpdateToast from './components/UpdateToast.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <UpdateToast />
  </React.StrictMode>,
);
