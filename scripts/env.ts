import { existsSync } from 'node:fs';

/** Scripts read the same .env file as the app. (Next.js loads it for the app itself.) */
if (existsSync('.env')) process.loadEnvFile('.env');
