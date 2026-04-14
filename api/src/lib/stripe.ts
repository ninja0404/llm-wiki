import Stripe from 'stripe';
import { logger } from './logger.js';

const stripeKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeKey
  ? new Stripe(stripeKey, { apiVersion: '2025-03-31.basil' as Stripe.LatestApiVersion })
  : null;

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || '',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || '',
} as const;

if (!stripeKey) {
  logger.warn('STRIPE_SECRET_KEY not set — billing features disabled');
}
