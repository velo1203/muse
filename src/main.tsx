import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// macOS needs room for the traffic lights in the overlay title bar; Windows has its own title bar
document.documentElement.classList.add(navigator.userAgent.includes("Windows") ? "platform-win" : "platform-mac");
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
