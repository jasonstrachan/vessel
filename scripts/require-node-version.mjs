import { readFileSync } from 'node:fs';

const expectedVersion = readFileSync('.nvmrc', 'utf8').trim();
const expectedMajor = expectedVersion.split('.')[0];
const actualVersion = process.versions.node;
const actualMajor = actualVersion.split('.')[0];

if (actualMajor !== expectedMajor) {
  console.error(
    `Vessel build requires Node ${expectedVersion} from .nvmrc; current Node is ${actualVersion}.`,
  );
  console.error('Run `nvm use` before building.');
  process.exit(1);
}
