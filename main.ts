import yesno from "yesno";
import { Task } from "@doist/todoist-api-typescript";
import {
  Block,
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  WebClient,
} from "@slack/web-api";
import { loadConfig } from "./lib/config";
import { TodoistClient } from "./lib/todoist";

(async () => {
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
    return [...activeTasks, ...completedTasks].filter((task) => !task.parentId);
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
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: rows.join("\n"),
      },
    } as SectionBlock);
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
})();
