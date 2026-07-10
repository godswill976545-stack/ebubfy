import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export default function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region>
        <span className="titlebar-logo">ebubfy</span>
      </div>
      <div style={{ display: "flex" }}>
        <button className="titlebar-button" onClick={() => appWindow.minimize()}>
          <Minus size={12} />
        </button>
        <button className="titlebar-button" onClick={() => appWindow.toggleMaximize()}>
          <Square size={10} />
        </button>
        <button className="titlebar-button close" onClick={() => appWindow.close()}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
