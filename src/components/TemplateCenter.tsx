import { BookOpen, Code2, FileText, MessagesSquare } from "lucide-react";
import { NOTE_TEMPLATES, type NoteTemplate } from "../lib/noteTemplates";
import "./templates.css";

const icons = {
  qa: MessagesSquare,
  study: BookOpen,
  code: Code2,
  blank: FileText,
};

export default function TemplateCenter({
  disabled,
  onUse,
}: {
  disabled: boolean;
  onUse: (template: NoteTemplate) => void;
}) {
  return (
    <section className="template-center" aria-labelledby="templates-title">
      <header className="template-header">
        <h1 id="templates-title">模板</h1>
        <p>选择一个模板，快速创建笔记。</p>
      </header>
      <div className="template-items" aria-label="内置模板">
        {NOTE_TEMPLATES.map((template) => {
          const Icon = icons[template.icon];
          return (
            <article className="template-item" key={template.templateId}>
              <Icon className="template-icon" size={20} aria-hidden="true" />
              <div className="template-description">
                <h2>{template.name}</h2>
                <p>{template.description}</p>
              </div>
              <button
                className="secondary-button"
                aria-label={`使用 ${template.name}模板`}
                disabled={disabled}
                onClick={() => onUse(template)}
              >
                使用模板
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
