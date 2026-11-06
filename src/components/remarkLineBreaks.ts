import type { Parent, Root, Text, Break } from "mdast";

/** Preserve soft line breaks in preview without modifying the Markdown file. */
export default function remarkLineBreaks() {
  return (tree: Root) => {
    const visit = (parent: Parent) => {
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (node.type === "text" && /[\r\n]/.test(node.value)) {
          const lines = node.value.split(/\r\n|[\r\n]/);
          const replacement: (Text | Break)[] = [];
          lines.forEach((value, line) => {
            if (line) replacement.push({ type: "break" });
            if (value) replacement.push({ type: "text", value });
          });
          parent.children.splice(index, 1, ...replacement);
          index += replacement.length - 1;
        } else if ("children" in node) {
          visit(node);
        }
      }
    };
    visit(tree);
  };
}
