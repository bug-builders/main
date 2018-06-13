import { Router } from 'express';
import axios from 'axios';
import stripePackage from 'stripe';

import utils from '../utils';

const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);
const bugbuildersFee = 10/100;

axios.defaults.baseURL = 'https://thirdparty.qonto.eu/v2/';
axios.defaults.headers.common.Authorization = `${process.env.BUGBUILDERS_QONTO_LOGIN}:${process.env.BUGBUILDERS_QONTO_SECRET}`;

function anon(label, members) {
  if(members.some(member => member.description === label)){
    return label;
  }
  return utils.encrypt(label);
}

export default () => {
  const route = Router();
  route.get('/', (req, res) => {
    const ret = {transactions: []};
    let membersList;
    stripe.customers.list()
      .then(customers => {
        membersList = customers.data.filter(customer => typeof(customer.metadata.membre) !== 'undefined');
        return axios.get(`/organizations/${process.env.BUGBUILDERS_QONTO_LOGIN}`)
      })
      .then(response => {
        const bankAccounts = response.data.organization.bank_accounts[0];
        ret.balance = bankAccounts.balance_cents;
        return axios.get(`/transactions?slug=${bankAccounts.slug}&iban=${bankAccounts.iban}`);
      })
      .then(response => {
        response.data.transactions.forEach(transaction => {
          let label;
          if(transaction.side === 'credit') {
            label = anon(transaction.label, membersList);
          } else {
            ({label} = transaction);
          }

          ret.transactions.push({date: transaction.settled_at, label, amount: transaction.amount_cents, type: transaction.side})
        })
        res.json(ret);
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.get('/asso', (req, res) => {
    stripe.invoices.list({limit: 100})
      .then(invoices => {
        const filteredInvoices = invoices.data.filter(
          ({total, paid}) => total !== 0 && paid
        )
        const total = filteredInvoices.reduce((accu, invoice) => {
          if(invoice.metadata.provider) {
            return accu + invoice.subtotal*bugbuildersFee
          }
          return accu + invoice.subtotal;
        }, 0)
        res.json({total});
      })
  })

  route.get('/:provider', (req, res) => {
    stripe.invoices.list({limit: 100})
      .then(invoices => {
        const filteredInvoices = invoices.data.filter(
          ({total, paid, metadata}) => total !== 0 && paid && metadata.provider === req.params.provider
        )
        const total = filteredInvoices.reduce((accu, invoice) => accu + invoice.subtotal*(1-bugbuildersFee), 0)
        res.json({total});
      })
  })

  return route;
};
