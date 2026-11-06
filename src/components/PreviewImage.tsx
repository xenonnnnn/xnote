import { useEffect, useState } from "react";

/** Resolve POSIX Markdown image paths without granting access outside the notes root. */
export function resolvePreviewAsset(
  folder: string,
  url: string,
): string | null {
  let path: string;
  try {
    path = decodeURIComponent(url.trim().split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  if (
    !path ||
    /[\\\x00-\x1f\x7f]/.test(path) ||
    path.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  )
    return null;
  const parts = folder ? folder.split("/") : [];
  if (
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part),
    )
  )
    return null;
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      if (part.includes(":")) return null;
      parts.push(part);
    }
  }
  return parts.length ? parts.join("/") : null;
}

/** Only custom image rendering can consume relative paths; links remain web-only. */
export function previewImageUrl(folder: string, url: string): string {
  const source = url.trim();
  if (/^https?:\/\//i.test(source)) return source;
  return resolvePreviewAsset(folder, source) === null ? "" : source;
}

interface ImageState {
  key: string;
  data: string | null;
  error: string | null;
}
export default function PreviewImage({
  folder,
  source,
  alt,
}: {
  folder: string;
  source?: string;
  alt?: string;
}) {
  const src = source || "";
  const key = `${folder}\0${src}`;
  const remote = /^https?:\/\//i.test(src);
  const [image, setImage] = useState<ImageState>({
    key: "",
    data: null,
    error: null,
  });
  const [failedRemote, setFailedRemote] = useState("");

  useEffect(() => {
    if (remote) return;
    const path = resolvePreviewAsset(folder, src);
    let alive = true;
    setImage({ key, data: null, error: null });
    if (path === null) {
      setImage({
        key,
        data: null,
        error:
          "图片路径不可用。请使用笔记目录内的相对路径或 HTTP(S) 图片链接。",
      });
      return;
    }
    // Import lazily so the URL resolver remains usable in filesystem-only tests.
    void import("../lib/api")
      .then(({ api }) => api.readAsset(path))
      .then((data) => {
        if (alive) setImage({ key, data, error: null });
      })
      .catch(() => {
        if (alive)
          setImage({
            key,
            data: null,
            error:
              "无法读取图片。请检查文件是否存在、格式是否受支持，且大小不超过 10 MB。",
          });
      });
    return () => {
      alive = false;
    };
  }, [folder, src, remote, key]);

  if (remote && failedRemote !== key) {
    return (
      <img
        src={src}
        alt={alt || "图片"}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedRemote(key)}
      />
    );
  }
  if (!remote && image.key === key && image.data && !image.error) {
    return (
      <img
        src={image.data}
        alt={alt || "图片"}
        onError={() =>
          setImage({
            key,
            data: null,
            error: "图片无法解码，文件可能已损坏或格式不受支持。",
          })
        }
      />
    );
  }
  const error = remote
    ? "图片加载失败，请检查网络连接或图片地址。"
    : image.key === key
      ? image.error
      : null;
  return (
    <span
      className={`unavailable-image${error ? " has-error" : ""}`}
      role="status"
    >
      {alt && <span className="preview-image-alt">{alt}</span>}
      <span>{error || "正在读取图片…"}</span>
    </span>
  );
}
