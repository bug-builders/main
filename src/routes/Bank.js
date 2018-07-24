import { Router } from 'express';
import axios from 'axios';
import stripePackage from 'stripe';

import utils from '../utils';

const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);
const bugbuildersFees = 10/100;

axios.defaults.baseURL = 'https://thirdparty.qonto.eu/v2/';
axios.defaults.headers.common.Authorization = `${process.env.BUGBUILDERS_QONTO_LOGIN}:${process.env.BUGBUILDERS_QONTO_SECRET}`;

function anon(label, members) {
  if(members.some(member => member.description === label)){
    return label;
  }
  return utils.encrypt(label);
}

async function getBankTransactions() {
  const {data: organizations} = await axios.get(`/organizations/${process.env.BUGBUILDERS_QONTO_LOGIN}`)
  const bankAccount = organizations.organization.bank_accounts[0];
  const {data: transactions} = await axios.get(`/transactions?slug=${bankAccount.slug}&iban=${bankAccount.iban}`);
  return {
    balance: bankAccount.balance_cents,
    transactions: transactions.transactions,
  }
}

function getNet(invoice) {
  let net = invoice.subtotal;
  const fees = [];

  if(invoice.charge && invoice.charge.balance_transaction){
    net -= invoice.charge.balance_transaction.fee;
    fees.push({name: 'Stripe', amount: invoice.charge.balance_transaction.fee})
  }

  if(invoice.tax){
    fees.push({name: 'TVA', amount: invoice.tax})
  }

  if(invoice.metadata.provider) {
    const bbFees = Math.ceil(net*bugbuildersFees);
    fees.push({name: 'Bug Builders', amount: bbFees})
    net -= bbFees;
  }

  return {fees, net};
}

export default () => {
  const route = Router();
  route.get('/', (req, res) => {
    let membersList;
    stripe.customers.list({limit: 100})
      .then(customers => {
        membersList = customers.data.filter(customer => typeof(customer.metadata.membre) !== 'undefined');
        return getBankTransactions()
      })
      .then(({ balance, transactions }) => {
        const ret = {
          balance,
          transactions: [],
        };

        transactions.forEach(transaction => {
          let label;
          if(transaction.side === 'credit') {
            label = anon(transaction.label, membersList);
          } else {
            let note = '';
            try {
              note = JSON.parse(transaction.note);
            } catch (err) {
              note = '';
            }
            if(note) {
              label = note;
            } else {
              ({label} = transaction)
            }
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

  route.get('/asso', async (req, res) => {
    const invoices = await stripe.invoices.list({limit: 100, expand: ['data.charge', 'data.charge.balance_transaction']});
    const filteredInvoices = invoices.data.filter(
      ({total, paid}) => total !== 0 && paid
    )
    const cleanedInvoices = filteredInvoices.map(invoice => {
      const {net, fees} = getNet(invoice);
      if(invoice.metadata.provider) {
        const bbFee = fees.find(fee => fee.name === 'Bug Builders')
        return {date: new Date(invoice.date*1000), amount: bbFee.amount, label: invoice.number, type: 'credit', fees: [{name: invoice.metadata.provider, amount: net}]}
      }
      if(invoice.metadata.cotisation) {
        return {date: new Date(invoice.date*1000), amount: net, label: `Cotisation ${invoice.metadata.cotisation}`, type: 'credit', fees: []}
      }
      return {date: new Date(invoice.date*1000), amount: net, label: invoice.number, type: 'credit', fees: []}
    })

    const total = cleanedInvoices.reduce((accu, invoice) => accu + invoice.amount, 0)
    const bankTransactions = await getBankTransactions();
    const filteredTransactions = bankTransactions.transactions.filter(({side, note}) => side === 'debit' && note === null)
    const cleanedTransactions = filteredTransactions.map(transaction =>
      ({date: transaction.settled_at, label: transaction.label, amount: transaction.amount_cents, type: transaction.side})
    )

    const subTotal = cleanedTransactions.reduce((accu, transaction) => accu + transaction.amount, 0)
    res.json({balance: (total - subTotal), transactions: cleanedTransactions.concat(cleanedInvoices)});
  })

  route.get('/:provider', async (req, res) => {
    const invoices = await stripe.invoices.list({limit: 100, expand: ['data.charge', 'data.charge.balance_transaction']});

    const filteredInvoices = invoices.data.filter(
      ({total, paid, metadata}) => total !== 0 && paid && metadata.provider === req.params.provider
    )
    const cleanedInvoices = filteredInvoices.map(invoice => {
      const {net, fees} = getNet(invoice);
      return {date: new Date(invoice.date*1000), amount: net, label: invoice.number, type: 'credit', fees}
    })

    const total = cleanedInvoices.reduce((accu, invoice) => accu + invoice.amount, 0)

    const bankTransactions = await getBankTransactions();
    const filteredTransactions = bankTransactions.transactions.filter(({note}) => {
      try {
        const noteObject = JSON.parse(note);
        return (noteObject && noteObject.claimant && noteObject.claimant === req.params.provider)
      } catch (err) {
        return false;
      }

    })

    const cleanedTransactions = filteredTransactions.map(transaction => {
      let note = '';
      let label;
      try {
        note = JSON.parse(transaction.note)
      } catch (err) {
        note = '';
      }
      if(note) {
        label = note;
      } else {
        ({label} = transaction)
      }

      return {date: transaction.settled_at, label, amount: transaction.amount_cents, type: transaction.side}
    })

    const subTotal = cleanedTransactions.reduce((accu, transaction) => accu + transaction.amount, 0)
    res.json({balance: (total - subTotal), transactions: cleanedTransactions.concat(cleanedInvoices)});
  })

  return route;
};
