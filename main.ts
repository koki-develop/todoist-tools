import fs from "fs";
import yesno from "yesno";
import { Task } from "@doist/todoist-api-typescript";
import {
  Block,
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  WebClient,
} from "@slack/web-api";
import { Parser } from "json2csv";
import { loadConfig } from "./lib/config";
import { TodoistClient } from "./lib/todoist";

const report = async () => {
  const config = loadConfig();
  const todoist = new TodoistClient(config.base.todoist_token);

  const sections = await (async () => {
    const sections = await todoist.getSections(config.base.todoist_project_id);
    return sections.filter((section) =>
      config.report.todoist_section_names.includes(section.name)
    );
  })();

  const tasks = await (async () => {
    const activeTasks = await todoist.getTasks(config.base.todoist_project_id);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 1);
    since.setUTCHours(15, 0, 0, 0);
    const completedTasks = await todoist.getCompletedTasks(
      config.base.todoist_project_id,
      since
    );
    return [...activeTasks, ...completedTasks].filter(
      (task) =>
        !task.parentId &&
        sections.some((section) => section.id === task.sectionId)
    );
  })();

  const groupBySection = config.report.todoist_section_names.reduce<
    Record<string, Task[]>
  >(
    (prev, current) => {
      const section = sections.find((section) => section.name === current);
      if (!section) {
        return prev;
      }
      const sectionTasks = tasks.filter(
        (task) => task.sectionId === section.id
      );
      if (prev[section.name] == null) {
        prev[section.name] = [];
      }
      prev[section.name] = sectionTasks.filter((task) => !task.isCompleted);
      prev["DONE"].push(...sectionTasks.filter((task) => task.isCompleted));
      return prev;
    },
    { DONE: [] }
  );

  const blocks: Block[] = [];
  for (const [section, tasks] of Object.entries(groupBySection)) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: section },
    } as HeaderBlock);
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
      for (const task of tasks) {
        rows.push(`• ${task.content}`);
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

  console.log("blocks:", blocks);
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

  const sections = await (async () => {
    const sections = await todoist.getSections(config.base.todoist_project_id);
    return sections.filter((section) =>
      config.notion_csv.todoist_section_names.includes(section.name)
    );
  })();

  const tasks = await (async () => {
    const activeTasks = await todoist.getTasks(config.base.todoist_project_id);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 2);
    since.setUTCHours(15, 0, 0, 0);
    const completedTasks = await todoist.getCompletedTasks(
      config.base.todoist_project_id,
      since
    );
    return [...activeTasks, ...completedTasks].filter(
      (task) =>
        !task.parentId &&
        sections.some((section) => section.id === task.sectionId) &&
        config.notion_csv.todoist_label_names.some((label) =>
          task.labels.includes(label)
        )
    );
  })();

  const parser = new Parser({
    fields: [
      {
        label: "Title",
        value: "content",
      },
      {
        label: "Status",
        value: (row: Task) =>
          sections.find((section) => section.id === row.sectionId)!.name,
      },
      {
        label: "Labels",
        value: (row: Task) => row.labels.join(","),
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
