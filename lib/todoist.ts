import { Section, Task, TodoistApi } from "@doist/todoist-api-typescript";
import axios from "axios";

export class TodoistClient {
  private readonly _api: TodoistApi;
  private readonly _token: string;

  public constructor(token: string) {
    this._token = token;
    this._api = new TodoistApi(token);
  }

  public async getSections(projectId: string): Promise<Section[]> {
    return await this._api.getSections(projectId);
  }

  public async getTasks(projectId: string): Promise<Task[]> {
    return await this._api.getTasks({ projectId });
  }

  public async getCompletedTasks(
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
