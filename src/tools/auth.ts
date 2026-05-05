import { ScalekitClient } from '@scalekit-sdk/node';
import { ConnectorStatus } from '@scalekit-sdk/node/lib/pkg/grpc/scalekit/v1/connected_accounts/connected_accounts_pb.js';
import * as readline from 'readline';
import { log } from '../lib/log.js';

const CONNECTORS = ['gmail', 'github', 'slack'] as const;
type Connector = typeof CONNECTORS[number];

export function createScalekitClient(env: {
  SCALEKIT_ENV_URL: string;
  SCALEKIT_CLIENT_ID: string;
  SCALEKIT_CLIENT_SECRET: string;
}): ScalekitClient {
  return new ScalekitClient(env.SCALEKIT_ENV_URL, env.SCALEKIT_CLIENT_ID, env.SCALEKIT_CLIENT_SECRET);
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function ensureConnectorActive(
  client: ScalekitClient,
  connector: Connector,
  identifier: string,
): Promise<void> {
  const response = await client.connectedAccounts.getOrCreateConnectedAccount({
    connector,
    identifier,
  });

  if (response.connectedAccount?.status !== ConnectorStatus.ACTIVE) {
    const linkResponse = await client.connectedAccounts.getMagicLinkForConnectedAccount({
      connector,
      identifier,
    });
    log.info(`\nAuthorize ${connector} here:\n  ${linkResponse.link}\n`);
    await waitForEnter(`Press Enter after you have authorized ${connector}...\n`);

    // Verify it became active
    const check = await client.connectedAccounts.getOrCreateConnectedAccount({ connector, identifier });
    if (check.connectedAccount?.status !== ConnectorStatus.ACTIVE) {
      throw new Error(`${connector} connector is still not active after authorization`);
    }
  }

  log.info({ connector }, 'connector active');
}

export async function setupConnectors(client: ScalekitClient, identifier: string): Promise<void> {
  log.info('Checking connector authorization…');
  for (const connector of CONNECTORS) {
    await ensureConnectorActive(client, connector, identifier);
  }
  log.info('All connectors active.');
}
