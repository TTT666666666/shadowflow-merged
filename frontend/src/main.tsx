import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyPrefs } from "./settings-prefs";

// 首帧之前先把本机偏好落到 <html>（缩放 / 强调色 / 密度 / 动效 / lang），
// 否则会先按默认值渲染一帧再跳变。
applyPrefs();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
