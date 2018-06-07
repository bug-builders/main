import { Router } from 'express';
import stripePackage from 'stripe';

const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);
const stripeAccount = process.env.BUGBUILDERS_STRIPE_ACCOUNT;

export default () => {
  const route = Router();
  route.get('/', (req, res) => {
    stripe.accounts.retrieve(stripeAccount)
      .then(rAccount => {
        const account = {
          name: rAccount.business_name,
          url: rAccount.business_url,
          address: rAccount.support_address
        }
        res.json(account);
      })

  });

  return route;
};
