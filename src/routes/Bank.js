import { Router } from 'express';
import axios from 'axios';
import utils from '../utils';

axios.defaults.baseURL = 'https://thirdparty.qonto.eu/v2/';
axios.defaults.headers.common.Authorization = `${process.env.BUGBUILDERS_QONTO_LOGIN}:${process.env.BUGBUILDERS_QONTO_SECRET}`;

function anon(label){
  return utils.encrypt(label);
}

export default () => {
  const route = Router();
  route.get('/', (req, res) => {
    const ret = {transactions: []};
    axios.get(`/organizations/${process.env.BUGBUILDERS_QONTO_LOGIN}`)
    .then((response) => {
      const bankAccounts = response.data.organization.bank_accounts[0];
      ret.balance = bankAccounts.balance_cents;
      return axios.get(`/transactions?slug=${bankAccounts.slug}&iban=${bankAccounts.iban}`);
    })
    .then((response) => {
      response.data.transactions.forEach(transaction => {
        let label;
        if(transaction.side === 'credit') {
          label = anon(transaction.label);
        } else {
          ({label} = transaction);
        }

        ret.transactions.push({date: transaction.settled_at, label, amount: transaction.amount_cents, type: transaction.side})
      })
      res.json(ret);
    })
  });

  return route;
};
