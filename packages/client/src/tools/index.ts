/**
 * Tool registry. To add a tool, create it with `defineTool` and list it here;
 * it automatically gets a toolbar button and its hotkey.
 */
import { pingTool } from './pingTool';
import { rulerTool } from './rulerTool';
import { selectTool } from './selectTool';
import type { Tool } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: Tool<any>[] = [selectTool, rulerTool, pingTool];

export function getTool(id: string): Tool<unknown> {
  return tools.find((t) => t.id === id) ?? selectTool;
}
