// Task Provider for SimplicityHL.
// Integrates with VSCode's "Tasks: Run Task" command for build automation.

import * as vscode from "vscode";
import { getSimcPath } from "./compile";
import { compilerFeatureArguments } from "./features";
import { getExperimentalFeatures } from "./settings";

// Task definition schema - matches taskDefinitions in package.json
export interface SimplicityHLTaskDefinition extends vscode.TaskDefinition {
  type: "simplicityhl";
  command: "compile" | "compile-debug" | "compile-with-witness";
  file?: string;        // Override file to compile (defaults to ${file})
  witnessFile?: string; // Witness file for compile-with-witness
}

// Provides tasks to VSCode's task system
export class SimplicityHLTaskProvider implements vscode.TaskProvider {
  static TaskType = "simplicityhl";

  // Called by VSCode to get list of available tasks
  public async provideTasks(): Promise<vscode.Task[]> {
    try {
      const simcPath = getSimcPath();
      const featureArgs = compilerFeatureArguments(getExperimentalFeatures());
      const commands = ["compile", "compile-debug", "compile-with-witness"] as const;
      return commands.map((command) => this.createTask(
        { type: "simplicityhl", command },
        simcPath,
        featureArgs,
      ));
    } catch (error) {
      showTaskError(error);
      return [];
    }
  }

  // Called when user runs a task from tasks.json
  public async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    const definition = task.definition as SimplicityHLTaskDefinition;
    if (definition.type === SimplicityHLTaskProvider.TaskType) {
      try {
        return this.createTask(
          definition,
          getSimcPath(),
          compilerFeatureArguments(getExperimentalFeatures()),
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
    featureArgs: string[],
  ): vscode.Task {
    let args: string[] = [];
    let taskName: string;

    // Build command line based on task type
    switch (definition.command) {
      case "compile":
        taskName = "Compile SimplicityHL";
        args = [definition.file || "${file}", ...featureArgs];
        break;
      case "compile-debug":
        taskName = "Compile SimplicityHL (Debug)";
        args = [definition.file || "${file}", ...featureArgs, "--debug"];
        break;
      case "compile-with-witness":
        taskName = "Compile with Witness";
        args = [definition.file || "${file}", ...featureArgs];
        args.push("-w");
        if (definition.witnessFile) {
          args.push(definition.witnessFile);
        } else {
          // Default: replace .simf with .wit
          args.push("${file/.simf/.wit/}");
        }
        break;
    }

    const execution = new vscode.ShellExecution(simcPath, args);

    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      taskName,
      "simplicityhl",
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
  const taskProvider = vscode.tasks.registerTaskProvider(
    SimplicityHLTaskProvider.TaskType,
    new SimplicityHLTaskProvider()
  );

  context.subscriptions.push(taskProvider);
}
