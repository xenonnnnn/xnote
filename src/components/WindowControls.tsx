import { Maximize2, Minus, X } from "lucide-react";
import "./window-controls.css";

export default function WindowControls() {
  const controls = window.xnote?.windowControls;
  if (!controls) return null;
  return (
    <div className="window-controls no-drag" role="group" aria-label="窗口控制">
      <button
        className="window-control window-close"
        aria-label="关闭窗口"
        title="关闭窗口"
        onClick={() => void controls.perform("close")}
      >
        <X size={8} />
      </button>
      <button
        className="window-control window-minimize"
        aria-label="最小化窗口"
        title="最小化窗口"
        onClick={() => void controls.perform("minimize")}
      >
        <Minus size={8} />
      </button>
      <button
        className="window-control window-fullscreen"
        aria-label="切换全屏"
        title="切换全屏（⌥ 点击缩放窗口）"
        onClick={(event) =>
          void controls.perform(event.altKey ? "zoom" : "fullscreen")
        }
      >
        <Maximize2 size={8} />
      </button>
    </div>
  );
}
