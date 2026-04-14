import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { db } from './db.js';
import { config } from './config.js';

export const auth = betterAuth({
  baseURL: config.baseUrl,
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: config.betterAuthSecret,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
    }),
  ],
  trustedOrigins: config.trustedOrigins,
});
