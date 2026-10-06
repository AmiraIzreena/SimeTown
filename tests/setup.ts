// Environment for the test run. Real secrets never appear here: these are throwaway values.
process.env.APP_ENV = 'development';
process.env.APP_URL = 'http://kita.test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'pglite://memory';
process.env.CRON_SECRET = 'test-cron-secret-0123456789-abcdefghij';
process.env.SENSOR_INGEST_TOKEN = 'test-sensor-token-0123456789-abcdefghi';
process.env.LOG_LEVEL = 'error';
process.env.SESSION_TTL_HOURS = '2000'; // tests move the clock by weeks
