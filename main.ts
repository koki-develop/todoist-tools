import fs from "fs";
import yesno from "yesno";
import { Section, Task } from "@doist/todoist-api-typescript";
import {
  Block,
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  WebClient,
} from "@slack/web-api";
import { Parser } from "json2csv";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import csvToMarkdown from "csv-to-markdown-table";
import { loadConfig } from "./lib/config";
import { TodoistClient } from "./lib/todoist";

marked.setOptions({
  renderer: new TerminalRenderer(),
});

const groupTasksBySection = (
  sections: Section[],
  tasks: Task[]
): Record<string, Task[]> => {
  return tasks.reduce<Record<string, Task[]>>((prev, task) => {
    const section = sections.find((section) => section.id === task.sectionId);
    if (!section) {
      return prev;
    }

    const name = task.isCompleted ? "DONE" : section.name;
    if (prev[name] == null) {
      prev[name] = [task];
      return prev;
    }

    prev[name].push(task);
    return prev;
  }, {});
};

const report = async () => {
  const config = loadConfig();
  const todoist = new TodoistClient(config.base.todoist_token);

  const sections = await todoist.getSections({
    projectId: config.base.todoist_project_id,
    names: config.report.todoist_section_names,
  });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 1);
  since.setUTCHours(15, 0, 0, 0);
  const tasks = await todoist.getTasks({
    projectId: config.base.todoist_project_id,
    completedSince: since,
    labels: config.report.todoist_label_names,
    sections,
  });

  const groupBySection = groupTasksBySection(sections, tasks);

  const previewRows = [];
  const blocks: Block[] = [];
  for (const [section, tasks] of Object.entries(groupBySection)) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: section },
    } as HeaderBlock);
    previewRows.push(`# ${section}`);

    const groupByLabel = config.report.todoist_label_names.reduce<
      Record<string, Task[]>
    >((prev, current) => {
      prev[current] = tasks.filter((task) => task.labels.includes(current));
      return prev;
    }, {});
    const rows: string[] = [];
    for (const [label, tasks] of Object.entries(groupByLabel)) {
      if (tasks.length === 0) {
        continue;
      }
      rows.push(`*${label}*`);
      previewRows.push(`*${label}*`);
      for (const task of tasks) {
        rows.push(`• ${task.content}`);
        previewRows.push(`• ${task.content}`);
      }
    }
    if (rows.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: rows.join("\n"),
        },
      } as SectionBlock);
    }
    blocks.push({ type: "divider" } as DividerBlock);
  }

  console.log(marked(previewRows.join("\n")));
  console.log("channel:", config.report.slack_channel);
  const ok = await yesno({
    question: "Continue?",
  });
  if (!ok) {
    return;
  }

  const slack = new WebClient(config.report.slack_token);
  await slack.chat.postMessage({
    channel: config.report.slack_channel,
    text: "デイリーレポート",
    blocks,
  });
};

const notionCsv = async () => {
  const config = loadConfig();
  const todoist = new TodoistClient(config.base.todoist_token);

  const sections = await todoist.getSections({
    projectId: config.base.todoist_project_id,
    names: config.notion_csv.todoist_section_names,
  });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 2);
  since.setUTCHours(15, 0, 0, 0);
  const tasks = await todoist.getTasks({
    projectId: config.base.todoist_project_id,
    completedSince: since,
    labels: config.notion_csv.todoist_label_names,
    sections,
  });

  const parser = new Parser({
    fields: [
      {
        label: "Title",
        value: "content",
      },
      {
        label: "Status",
        value: (task: Task) =>
          task.isCompleted
            ? "DONE"
            : sections.find((section) => section.id === task.sectionId)!.name,
      },
      {
        label: "Labels",
        value: (task: Task) => task.labels.join(","),
      },
      {
        label: "Order",
        value: "order",
      },
      {
        label: "Todoist Task Id",
        value: "id",
      },
    ],
  });
  const csv = parser.parse(tasks);
  console.log(marked(csvToMarkdown(csv, ",", true)));
  fs.writeFileSync(config.notion_csv.output_path, csv);
};

(async () => {
  const command = process.argv[2];
  switch (command) {
    case "report":
      await report();
      break;
    case "notion-csv":
      await notionCsv();
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
})();
