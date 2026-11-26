import { Fragment, type ReactNode } from "react";
import guide from "../../../docs/GUIA.md?raw";

/** La guía de docs/GUIA.md dentro del programa: así sirve sin internet. Solo
 *  entiende lo que esa guía usa: títulos, párrafos, listas, negritas y casillas. */
export function GuideView() {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-6">
      <article className="mx-auto flex max-w-3xl flex-col gap-3 text-sm leading-relaxed text-text-secondary">
        {blocks(guide)}
      </article>
    </div>
  );
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") ? (
      <strong key={i} className="text-text-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function blocks(markdown: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3}) (.*)/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const classes = ["text-2xl font-semibold", "mt-4 text-lg font-semibold", "font-semibold"][level - 1];
      const Tag = (["h1", "h2", "h3"] as const)[level - 1];
      out.push(
        <Tag key={i} className={`${classes} text-text-primary`}>
          {heading[2]}
        </Tag>,
      );
      i++;
      continue;
    }
    const list = /^(\d+\.|-) /.exec(line);
    if (list) {
      const ordered = list[1] !== "-";
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.|-) /.test(lines[i])) items.push(lines[i++].replace(/^(\d+\.|-) /, ""));
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={i} className={`flex flex-col gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => {
            const box = /^\[( |x)\] (.*)/.exec(item);
            return (
              <li key={n} className={box ? "list-none -ml-5" : undefined}>
                {box ? (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" defaultChecked={box[1] === "x"} className="mt-1 accent-accent" />
                    <span>{inline(box[2])}</span>
                  </label>
                ) : (
                  inline(item)
                )}
              </li>
            );
          })}
        </Tag>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\d+\. |- )/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(<p key={i}>{inline(paragraph.join(" "))}</p>);
  }
  return out;
}
