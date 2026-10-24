import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MobileApp } from "./mobile/MobileApp";
import { isAndroid } from "./platform";

// macOS needs room for the traffic lights in the overlay title bar; Windows has its own title bar
document.documentElement.classList.add(
  isAndroid ? "platform-android" : navigator.userAgent.includes("Windows") ? "platform-win" : "platform-mac",
);
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles.css";
import "./mobile/mobile.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isAndroid ? <MobileApp /> : <App />}
  </React.StrictMode>,
);
