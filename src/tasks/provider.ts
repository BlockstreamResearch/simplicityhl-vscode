// Task Provider for SimplicityHL.
// Integrates with VSCode's "Tasks: Run Task" command for build automation.

import * as vscode from "vscode";
import { getSimcPath } from "../compiler";
import { taskCompilerArguments } from "../compiler/args";
import {
  TASK_COMMANDS,
  TASK_TYPE,
  type TaskCommand,
} from "../contracts";
import { getExperimentalFeatures } from "../settings";

// Task definition schema - matches taskDefinitions in package.json
export interface SimplicityHLTaskDefinition extends vscode.TaskDefinition {
  type: typeof TASK_TYPE;
  command: TaskCommand;
  file?: string;        // Override file to compile (defaults to ${file})
  witnessFile?: string; // Witness file for compile-with-witness
}

// Provides tasks to VSCode's task system
export class SimplicityHLTaskProvider implements vscode.TaskProvider {
  // Called by VSCode to get list of available tasks
  public async provideTasks(): Promise<vscode.Task[]> {
    try {
      const simcPath = getSimcPath();
      const features = getExperimentalFeatures();
      return TASK_COMMANDS.map((command) => this.createTask(
        { type: TASK_TYPE, command },
        simcPath,
        features,
      ));
    } catch (error) {
      showTaskError(error);
      return [];
    }
  }

  // Called when user runs a task from tasks.json
  public async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    const definition = task.definition as SimplicityHLTaskDefinition;
    if (definition.type === TASK_TYPE) {
      try {
        return this.createTask(
          definition,
          getSimcPath(),
          getExperimentalFeatures(),
        );
      } catch (error) {
        showTaskError(error);
      }
    }
    return undefined;
  }

  // Create a VSCode task from our definition
  private createTask(
    definition: SimplicityHLTaskDefinition,
    simcPath: string,
    features: ReturnType<typeof getExperimentalFeatures>,
  ): vscode.Task {
    const taskNames: Record<TaskCommand, string> = {
      compile: "Compile SimplicityHL",
      "compile-debug": "Compile SimplicityHL (Debug)",
      "compile-with-witness": "Compile with Witness",
    };
    const args = taskCompilerArguments(
      definition.command,
      definition.file || "${file}",
      definition.witnessFile,
      features,
    );

    const execution = new vscode.ProcessExecution(simcPath, args);

    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      taskNames[definition.command],
      TASK_TYPE,
      execution,
      "$simplicityhl" // Problem matcher name from package.json
    );

    // Mark as build task so it appears in build task list
    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
    };

    return task;
  }

}

function showTaskError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(
    `Unable to prepare SimplicityHL task: ${message}`,
  );
}

// Register the task provider with VSCode
export function registerTaskProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.tasks.registerTaskProvider(
    TASK_TYPE,
    new SimplicityHLTaskProvider(),
  ));
}
