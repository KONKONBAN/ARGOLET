import { mkdirSync } from 'node:fs';
import { loadConfig } from './config';
import { createRuntime } from './bootstrap';
import { buildServer } from './server';

async function main() {
  const config = loadConfig();
  if (config.databaseUrl.startsWith('pglite:') && config.databaseUrl !== 'pglite:memory') {
    mkdirSync(config.databaseUrl.slice('pglite:'.length), { recursive: true });
  }
  const { app, store } = await createRuntime(config);
  const server = await buildServer({ app, config, storeKind: store.kind, logger: true });
  const shutdown = async (signal: string) => {
    server.log.info(`${signal} received, shutting down`);
    await server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await server.listen({ port: config.port, host: config.host });
  server.log.info(
    `ARGOLET API on :${config.port} · store=${store.kind} · web=${config.webDist ?? 'none'} · assistant=${
      Object.values(app.deps.llms)
        .map((c) => c!.name)
        .join(', ') || 'rules'
    }`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
