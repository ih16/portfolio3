import { Redis } from '@upstash/redis';

// Server-side only. Vercel injects credentials; local tools load .env explicitly.
export const redis = Redis.fromEnv();
