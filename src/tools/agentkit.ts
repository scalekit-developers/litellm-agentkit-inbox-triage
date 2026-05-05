import { ScalekitClient } from '@scalekit-sdk/node';

export async function callTool(
  client: ScalekitClient,
  connector: string,
  toolName: string,
  params: Record<string, unknown>,
  identifier: string,
): Promise<unknown> {
  const result = await client.actions.executeTool({
    toolName,
    toolInput: params,
    identifier,
    connector,
  });
  // executeTool returns a google.protobuf.Struct in .data — already a plain JS object
  return (result as any).data ?? {};
}
