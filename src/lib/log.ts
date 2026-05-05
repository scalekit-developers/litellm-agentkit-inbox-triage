import pino from 'pino';

export const log = pino({
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  level: process.env.LOG_LEVEL ?? 'info',
});
