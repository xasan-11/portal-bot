import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import AccessGate from "./components/AccessGate";
import "./index.css";

(window as any).Telegram?.WebApp?.ready?.();
(window as any).Telegram?.WebApp?.expand?.();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AccessGate>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AccessGate>
    </BrowserRouter>
  </React.StrictMode>
);
