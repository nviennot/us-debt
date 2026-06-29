import React from "react";
import ReactDOM from "react-dom/client";
import App, { loadResults } from "./App.jsx";
import "./index.css";

loadResults().then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
