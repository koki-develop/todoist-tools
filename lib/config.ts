import fs from "fs";
import { cleanEnv, str } from "envalid";

const env = cleanEnv(process.env, {
  ENV: str({ default: "dev" }),
});

export type Config = {
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
  notion_csv: {
    todoist_section_names: string[];
    todoist_label_names: string[];
    output_path: string;
  };
};

export const loadConfig = (): Config => {
  const json = fs.readFileSync(`config.${env.ENV}.json`).toString();
  return JSON.parse(json) as Config;
};
