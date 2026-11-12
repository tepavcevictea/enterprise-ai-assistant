import type { PlanTask } from "./plan";
import type { TaskResult } from "./schedule";

export const OUTSIDE_SCOPE =
  "I can help with Northstar IT and HR questions: service status, troubleshooting, a simulated password reset, company policy, leave, and equipment. I don't have a source for that question.";

export function composeReply(tasks: PlanTask[], results: TaskResult[]): string {
  const byId = new Map(results.map((result) => [result.taskId, result]));
  const groups = new Map<number, PlanTask[]>();
  for (const task of tasks) {
    const group = groups.get(task.order) ?? [];
    group.push(task);
    groups.set(task.order, group);
  }
  const sections: string[] = [];
  for (const order of [...groups.keys()].sort((left, right) => left - right)) {
    const group = groups.get(order) ?? [];
    const supplierIds = new Set(group.flatMap((task) => task.dependsOn.map((dependency) => dependency.taskId)));
    const suppliers = group.filter((task) => {
      if (!supplierIds.has(task.id) || byId.get(task.id)?.outcome !== "success") return false;
      const dependents = group.filter((other) => other.dependsOn.some((dependency) => dependency.taskId === task.id));
      return dependents.length > 0 && dependents.every((other) => byId.get(other.id)?.outcome === "success");
    });
    const visible = group.filter((task) => !suppliers.some((supplier) => supplier.id === task.id));
    const paragraphs = visible.map((task) => userText(byId.get(task.id))).filter((text) => text !== "");
    for (const fact of suppliers.flatMap((task) => factValues(byId.get(task.id)?.handoff?.value))) {
      if (!paragraphs.some((paragraph) => paragraph.includes(fact))) paragraphs.push(fact);
    }
    if (paragraphs.length > 0) sections.push(paragraphs.join("\n\n"));
  }
  return sections.join("\n\n");
}

function userText(result: TaskResult | undefined): string {
  if (result === undefined) return "";
  if (result.outcome !== "success") return (result.report ?? result.text).trim();
  if (result.specialist === "it") {
    const text = result.text.trim();
    const detail = result.handoff?.value?.trim() ?? "";
    const statusDetail = detail !== "" && !detail.includes("=");
    if (!statusDetail) return text;
    if (text === "" || text === "Status checked.") return detail;
    return includeDetailOnce(text, detail);
  }
  return (result.report ?? result.text).trim();
}

function includeDetailOnce(text: string, detail: string): string {
  const parts = text.split(detail);
  if (parts.length === 1) return `${text}\n\n${detail}`;
  if (parts.length === 2) return text;
  const extra = parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
  return extra === "" ? detail : `${detail}\n\n${extra}`;
}

function factValues(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "" || value === "none") return [];
  return value.split("\n").flatMap((line) => {
    const index = line.indexOf("=");
    if (index <= 0) return [];
    const fact = line.slice(index + 1).trim();
    return fact === "" ? [] : [fact];
  });
}
