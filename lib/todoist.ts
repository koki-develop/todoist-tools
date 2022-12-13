import { Section, Task, TodoistApi } from "@doist/todoist-api-typescript";
import axios from "axios";

export class TodoistClient {
  private readonly _api: TodoistApi;
  private readonly _token: string;

  public constructor(token: string) {
    this._token = token;
    this._api = new TodoistApi(token);
  }

  public async getSections(params: {
    projectId: string;
    names: string[];
  }): Promise<Section[]> {
    const sections = await this._api.getSections(params.projectId);
    return sections.filter((section) => params.names.includes(section.name));
  }

  public async getTasks(params: {
    projectId: string;
    sections: Section[];
    labels: string[];
    completedSince: Date;
  }): Promise<Task[]> {
    const activeTasks = await this._api.getTasks({
      projectId: params.projectId,
    });
    const completedTasks = await this._getCompletedTasks(
      params.projectId,
      params.completedSince
    );
    return [...activeTasks, ...completedTasks].filter((task) => {
      if (task.parentId) return false;
      if (!params.sections.some((section) => task.sectionId === section.id))
        return false;
      if (!params.labels.some((label) => task.labels.includes(label)))
        return false;
      return true;
    });
  }

  private async _getCompletedTasks(
    projectId: string,
    since: Date
  ): Promise<Task[]> {
    const {
      data: { items },
    } = await axios.get<{ items: { task_id: string }[] }>(
      "https://api.todoist.com/sync/v9/completed/get_all",
      {
        params: {
          project_id: projectId,
          since: since.toISOString(),
        },
        headers: {
          authorization: `Bearer ${this._token}`,
        },
      }
    );

    return await Promise.all(
      items.map(async (item) => {
        return await this._api.getTask(item.task_id);
      })
    );
  }
}
