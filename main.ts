import { createInterface } from "readline";
import fs from "fs";
import Big from "big.js";
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
import { env, loadConfig } from "./lib/config";
import { TodoistClient } from "./lib/todoist";

marked.setOptions({
  renderer: new TerminalRenderer(),
});

const groupTasksBySection = (
  sections: Section[],
  tasks: Task[]
): Record<string, Task[]> => {
  return sections.reduce<Record<string, Task[]>>(
    (prev, section) => {
      const sectionTasks = tasks.filter(
        (task) => task.sectionId === section.id
      );
      for (const task of sectionTasks) {
        const name = task.isCompleted ? "DONE" : section.name;
        if (prev[name] == null) {
          prev[name] = [];
        }
        prev[name].push(task);
      }

      return prev;
    },
    { DONE: [] }
  );
};

const readline = async (): Promise<string> => {
  const reader = createInterface({ input: process.stdin });

  return new Promise((resolve) => {
    reader.on("line", (line) => {
      reader.close();
      resolve(line);
    });
  });
};

const report = async () => {
  console.log("Please enter your weight.");
  const input = await readline();
  const weight = new Big(input);
  const prevWeightFile = `prev_weight.${env.ENV}`;

  const config = loadConfig();
  const targetWeight = new Big(config.report.target_weight);

  const prevWeight = (() => {
    if (!fs.existsSync(prevWeightFile)) {
      return weight;
    }
    return new Big(fs.readFileSync(prevWeightFile, "utf8").toString().trim());
  })();

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

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "DIET" },
  } as HeaderBlock);
  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*現在の体重*\n${weight}kg ( ${(() => {
          const diff = weight.minus(prevWeight);
          let op = "±";
          if (diff.lt(0)) {
            op = "-";
          } else if (diff.gt(0)) {
            op = "+";
          }
          return `${op}${diff.abs()}kg`;
        })()} )`,
      },
      {
        type: "mrkdwn",
        text: `*目標体重*\n${targetWeight}kg ( 残り${weight.minus(
          targetWeight
        )}kg )`,
      },
    ],
  } as SectionBlock);
  blocks.push({ type: "divider" } as DividerBlock);
  previewRows.push("# DIET");
  previewRows.push("*現在の体重*");
  previewRows.push(
    `${weight}kg ( 前日との差分: ${weight.minus(prevWeight)}kg )`
  );
  previewRows.push("*目標体重*");
  previewRows.push(`${targetWeight}kg`);

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

  fs.writeFileSync(prevWeightFile, weight.toString());
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
