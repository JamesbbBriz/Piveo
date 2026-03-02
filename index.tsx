import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("未找到页面挂载节点 #root");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
