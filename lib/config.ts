import fs from "fs";
import { bool, cleanEnv, str } from "envalid";

export const env = cleanEnv(process.env, {
  ENV: str({ default: "dev" }),
  ONLY_WEIGHT: bool({ default: false }),
});

export type Config = {
  base: {
    todoist_token: string;
    todoist_project_id: string;
  };
  report: {
    target_weight: number;
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
