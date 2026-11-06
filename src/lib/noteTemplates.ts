import type { NoteKind } from "../types";

export interface NoteTemplate {
  templateId: string;
  name: string;
  description: string;
  icon: "qa" | "study" | "code" | "blank";
  fileExtension: "md";
  defaultTitle: string;
  initialContent: string;
  noteType: NoteKind;
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    templateId: "qa",
    name: "Q&A 笔记",
    description: "记录问题、答案和详细解释",
    icon: "qa",
    fileExtension: "md",
    defaultTitle: "新建问答",
    noteType: "qa",
    initialContent: `# 新建问答

## 问题

在这里记录你不理解的问题。

## 原始内容

可以粘贴代码、报错信息、文档片段或其他相关内容。

## 答案

在这里记录查询后得到的答案。

## 详细解释

在这里补充原理、实现过程和关键知识点。

## 补充记录

记录自己的理解、后续疑问或相关参考资料。
`,
  },
  {
    templateId: "study",
    name: "学习笔记",
    description: "整理学习内容、知识点和心得",
    icon: "study",
    fileExtension: "md",
    defaultTitle: "学习主题",
    noteType: "study",
    initialContent: `# 学习主题

## 学习目标

## 核心知识点

## 详细记录

## 学习总结

## 待解决的问题
`,
  },
  {
    templateId: "code",
    name: "代码笔记",
    description: "保存代码片段、实现思路和技术说明",
    icon: "code",
    fileExtension: "md",
    defaultTitle: "代码主题",
    noteType: "code",
    initialContent: `# 代码主题

## 使用场景

## 代码内容

## 实现思路

## 关键知识点

## 注意事项
`,
  },
  {
    templateId: "blank",
    name: "空白笔记",
    description: "创建普通 Markdown 笔记",
    icon: "blank",
    fileExtension: "md",
    defaultTitle: "Untitled",
    noteType: "markdown",
    initialContent: "",
  },
];

export function getNoteTemplate(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((template) => template.templateId === id);
}
