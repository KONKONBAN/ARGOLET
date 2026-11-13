/** Regenerates docs/database/data-dictionary.md from the migrations (embedded PostgreSQL). */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations, SCHEMA_VERSION } from '../src/db';
import { renderDataDictionary } from '../src/db/docs';

const driver = await pgliteDriver();
await runMigrations(driver);
const target = fileURLToPath(new URL('../../../docs/database/data-dictionary.md', import.meta.url));
writeFileSync(target, await renderDataDictionary(driver.client(), SCHEMA_VERSION));
await driver.close();
console.info(`wrote ${target}`);
