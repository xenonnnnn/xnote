import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

export default function TooltipButton({
  title,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onClick,
  onKeyDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!visible || !button.current || !tooltip.current) return;
    const anchor = button.current.getBoundingClientRect();
    const hint = tooltip.current.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        anchor.left + (anchor.width - hint.width) / 2,
        window.innerWidth - hint.width - 8,
      ),
    );
    const top =
      anchor.top - hint.height - 8 >= 8
        ? anchor.top - hint.height - 8
        : Math.min(anchor.bottom + 8, window.innerHeight - hint.height - 8);
    setPosition({ left, top });
    const hide = () => setVisible(false);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [visible, title]);

  return (
    <>
      <button
        {...props}
        ref={button}
        aria-describedby={
          visible
            ? [props["aria-describedby"], id].filter(Boolean).join(" ")
            : props["aria-describedby"]
        }
        onMouseEnter={(event) => {
          setVisible(true);
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          setVisible(false);
          onMouseLeave?.(event);
        }}
        onFocus={(event) => {
          setVisible(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setVisible(false);
          onBlur?.(event);
        }}
        onClick={(event) => {
          setVisible(false);
          onClick?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setVisible(false);
          onKeyDown?.(event);
        }}
      >
        {children}
      </button>
      {visible &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            role="tooltip"
            className="operation-tooltip"
            style={position}
          >
            {title}
          </span>,
          document.body,
        )}
    </>
  );
}
