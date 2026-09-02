import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "Inter, sans-serif",
            fontSize: "0.875rem",
            border: "1px solid hsl(220 14% 89%)",
            boxShadow: "0 4px 14px rgba(16,24,40,0.08)",
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
