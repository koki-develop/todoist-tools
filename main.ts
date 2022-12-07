import axios from "axios";
import fs from "fs";
import yesno from "yesno";
import { Task, TodoistApi } from "@doist/todoist-api-typescript";
import {
  Block,
  DividerBlock,
  HeaderBlock,
  SectionBlock,
  WebClient,
} from "@slack/web-api";

type Config = {
  base: {
    todoist_token: string;
    todoist_project_id: string;
  };
  report: {
    todoist_section_names: string[];
    todoist_label_names: string[];
    slack_token: string;
    slack_channel: string;
  };
};

(async () => {
  const configJson = fs
    .readFileSync(`config.${process.env.ENV}.json`)
    .toString();
  const config = JSON.parse(configJson) as Config;

  const todoist = new TodoistApi(config.base.todoist_token);

  const sections = await todoist.getSections(config.base.todoist_project_id);

  const activeTasks = await todoist.getTasks({
    projectId: config.base.todoist_project_id,
  });
  const filteredActiveTasks = activeTasks.filter((task) => {
    if (task.parentId != null) {
      return false;
    }
    if (
      !config.report.todoist_label_names.some((label) =>
        task.labels.includes(label)
      )
    ) {
      return false;
    }
    return true;
  });

  const since = new Date();
  since.setUTCHours(0);
  since.setUTCMinutes(0);
  since.setUTCSeconds(0);
  since.setUTCMilliseconds(0);
  since.setUTCHours(since.getUTCHours() - 9);
  const {
    data: { items: completedItems },
  } = await axios.get<{ items: { task_id: string }[] }>(
    "https://api.todoist.com/sync/v9/completed/get_all",
    {
      params: {
        project_id: config.base.todoist_project_id,
        since: since.toISOString(),
      },
      headers: {
        authorization: `Bearer ${config.base.todoist_token}`,
      },
    }
  );
  const completedTasks = await Promise.all(
    completedItems.map(async (item) => {
      return todoist.getTask(item.task_id);
    })
  );

  const group = config.report.todoist_section_names.reduce<
    Record<string, Task[]>
  >((prev, current) => {
    const section = sections.find((section) => section.name === current);
    if (!section) {
      return prev;
    }
    if (prev[section.name] == undefined) {
      prev[section.name] = [];
    }
    const tasks = filteredActiveTasks.filter(
      (task) => task.sectionId === section.id
    );
    prev[section.name] = tasks;
    return prev;
  }, {});

  const blocks: Block[] = [];
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "DONE",
    },
  } as HeaderBlock);
  (() => {
    const groupByLabel = config.report.todoist_label_names.reduce<
      Record<string, Task[]>
    >((prev, current) => {
      prev[current] = completedTasks.filter((task) => {
        return task.labels.some((label) => label === current);
      });
      return prev;
    }, {});

    const rows: string[] = [];
    for (const [label, tasks] of Object.entries(groupByLabel)) {
      if (tasks.length === 0) continue;
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

    blocks.push({
      type: "divider",
    } as DividerBlock);
  })();

  for (const [section, tasks] of Object.entries(group)) {
    const groupByLabel = config.report.todoist_label_names.reduce<
      Record<string, Task[]>
    >((prev, current) => {
      prev[current] = tasks.filter((task) => {
        return task.labels.some((label) => label === current);
      });
      return prev;
    }, {});

    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: section,
      },
    } as HeaderBlock);

    const rows: string[] = [];
    for (const [label, tasks] of Object.entries(groupByLabel)) {
      if (tasks.length === 0) continue;
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

    blocks.push({
      type: "divider",
    } as DividerBlock);
  }

  console.log("blocks:", blocks);
  console.log("channel:", config.report.slack_channel);

  const ok = await yesno({
    question: "continue?",
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
