import axios from "axios";

// In dev, Vite's proxy forwards "/api" to localhost:5000, so the relative
// path works. In production the frontend (static site) and backend (web
// service) live on different Render domains, so we need the backend's full
// URL — supplied via VITE_API_URL at build time. Falls back to "/api" for
// local dev / same-origin setups.
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, "")}/api`
  : "/api";

const api = axios.create({
  baseURL,
});

export default api;