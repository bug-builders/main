/* eslint-disable no-await-in-loop */
import { Router } from 'express';
import axios from 'axios';
import stripePackage from 'stripe';

import utils from '../utils';

const qontoSwitchAccountDate = '2020-10-19T16:05:24.433Z'

const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);
// const bugbuildersFees = 10/100;

axios.defaults.baseURL = 'https://thirdparty.qonto.com/v2/';
axios.defaults.headers.common.Authorization = `${process.env.BUGBUILDERS_QONTO_LOGIN}:${process.env.BUGBUILDERS_QONTO_SECRET}`;

function anon(label, members) {
  if(members.some(member => member.description === label)){
    return label;
  }
  return utils.encrypt(label);
}

const startYear = 2018;

const smic = 14729 * 2;

const taxRates = [
  { from: 0, to: 1000 * 100, rate: 0 },
  { from: 1000 * 100, to: 2000 * 100, rate: 10 },
  { from: 2000 * 100, to: 3000 * 100, rate: 15 },
  { from: 3000 * 100, to: 4000 * 100, rate: 20 },
  { from: 4000 * 100, to: 15000 * 100, rate: 25 },
  { from: 15000 * 100, to: 20000 * 100, rate: 40 },
  { from: 20000 * 100, to: 25000 * 100, rate: 55 },
  { from: 25000 * 100, to: smic * 2 * 100, rate: 75 },
  { from: smic * 2 * 100, to: 1000000 * 100, rate: 100 },
];

const getTaxableAmount = (totalIncome, taxRate) => {
  if (totalIncome < taxRate.from) return 0;
  const maxTaxableAmount = taxRate.to - taxRate.from;
  return Math.min(totalIncome - taxRate.from, maxTaxableAmount);
};

const getTaxAmount = totalIncome =>
  taxRates.reduce(
    (taxAmount, taxRate) =>
      taxAmount + Math.ceil(getTaxableAmount(totalIncome, taxRate) * (taxRate.rate / 100)),
    0,
  );

const getTaxAverage = (totalIncome, taxAmount) =>
  Math.ceil((parseFloat(taxAmount) / parseFloat(totalIncome)) * 100);


async function getAttachment(attachmentId) {
  const {data} = await axios.get(`/attachments/${attachmentId}`)
  return data

}

async function getBankTransactions() {
  const {data: organizations} = await axios.get(`/organizations/${process.env.BUGBUILDERS_QONTO_LOGIN}`)
  const transactions = [];
  let balance = 0;
  for(let i = 0; i < organizations.organization.bank_accounts.length; i+=1) {
    const bankAccount = organizations.organization.bank_accounts[i];
    let page = 1;
    let nextPage = true;
    while(nextPage !== null) {
      // eslint-disable-next-line
      const {data: transactionsResult} = await axios.get(`/transactions?page=${page}&bank_account_id=${bankAccount.id}&status[]=completed`);
      transactionsResult.transactions.forEach(t => transactions.push(t));
      nextPage = transactionsResult.meta.next_page;
      page += 1;
    }
    balance += bankAccount.balance_cents;
  }

  return {
    balance,
    transactions: transactions.sort((a,b) => a.settled_at < b.settled_at ? 1 : -1),
  }
}

function cleanTransactions(transactions, membersList = []) {
  return transactions.map(transaction => {
    let label;
    let tag = null;
    let note = null;
      try {
        note = JSON.parse(transaction.note);
      } catch (err) {
        note = null;
      }


    if(note) {
      label = note;
      if(typeof(label.label) === 'undefined'){
        label.label = transaction.label;
      }
      if(typeof(label.tag) !== 'undefined') {
        // eslint-disable-next-line
        tag = label.tag;
      }
    } else if (transaction.side === 'credit') {
      label = {label: anon(transaction.label, membersList)};
    } else {
      label = {label: transaction.label};
    }
    return {date: new Date(transaction.settled_at), label, amount: transaction.amount_cents, type: transaction.side, vat_amount: transaction.vat_amount_cents, tag};
  })
}

function getNet(invoice) {
  let net = invoice.subtotal;
  const fees = [];

  if(invoice.charge && invoice.charge.balance_transaction){
    fees.push({name: 'Stripe', amount: invoice.charge.balance_transaction.fee})
    // eslint-disable-next-line prefer-destructuring
    net = invoice.charge.balance_transaction.net
    if(typeof(invoice.metadata.failTVA) === 'undefined' && invoice.tax) {
      net -= invoice.tax;
    }
  }

  if(typeof(invoice.metadata.failTVA) === 'undefined' && invoice.tax){
    fees.push({name: 'TVA', amount: invoice.tax})
  }

  // if(invoice.metadata.provider) {
  //   const bbFees = Math.ceil(net*bugbuildersFees);
  //   fees.push({name: 'Bug Builders', amount: bbFees})
  //   net -= bbFees;
  // }

  return {fees, net};
}

export default () => {
  const route = Router();
  route.get('/attachments/:attachmentId', async (req, res) => {
    const {attachmentId} = req.params
    try {
      if(typeof attachmentId !== 'string') {
        throw new Error('Not valid attachmentId')
      }
      const attachment = await getAttachment(attachmentId)
      res.redirect(attachment.attachment.url)
    } catch(err) {
      console.error(err)
      res.status(500).json({error: 'Something goes wrong'})
    }
  });

  route.get('/', async (req, res) => {
    let membersList;
    stripe.customers.list({limit: 100})
      .then(customers => {
        membersList = customers.data.filter(customer => typeof(customer.metadata.membre) !== 'undefined');
        return getBankTransactions()
      })
      .then(async ({ balance, transactions }) => {
        const cleanedTransactions = cleanTransactions(transactions, membersList);
        for(let i = 0; i < cleanedTransactions.length; i+=1) {
          const transaction = transactions[i];
          const cleanedTransaction = cleanedTransactions[i];
          const attachmentId = transaction.attachment_ids && transaction.attachment_ids[0] ? transaction.attachment_ids[0] : null;
          if(!cleanedTransaction.label.proof && attachmentId) {
            cleanedTransaction.label = {label: cleanedTransaction.label.label || cleanedTransaction.label, proof: `/bank/attachments/${attachmentId}`}
          }
        }
        if(req.query.tag) {
          const filteredTransactions = cleanedTransactions.filter((t) => t.tag === req.query.tag)
          const filteredBalance = filteredTransactions.reduce((accu, transaction) => {
            if(transaction.type === 'credit') {
              return accu + (transaction.amount - transaction.vat_amount)
            }
            return accu - (transaction.amount - transaction.vat_amount)
          }, 0)
          res.json({balance: filteredBalance, transactions: filteredTransactions});
          return
        }

        res.json({balance, transactions: cleanedTransactions});
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.get('/rates', (req, res) => {
    res.json({rates: taxRates})
  })

  route.get('/asso', async (req, res) => {
    const invoices = await stripe.invoices.list({limit: 100, expand: ['data.charge', 'data.charge.balance_transaction']});
    const filteredInvoices = invoices.data.filter(
      ({total, paid, metadata}) => total !== 0 && paid && typeof(metadata.provider) === 'undefined'
    )

    const filteredProviderInvoices = invoices.data.filter(
      ({total, paid, metadata}) => total !== 0 && paid && typeof(metadata.provider) !== 'undefined'
    )

    const bbFeesProvider = {};

    filteredProviderInvoices.forEach(invoice => {
      if(typeof(bbFeesProvider[invoice.metadata.provider]) === 'undefined') {
        bbFeesProvider[invoice.metadata.provider] = {}
      }

      const invoiceYear = (new Date(invoice.date*1000)).getFullYear();
      if(typeof(bbFeesProvider[invoice.metadata.provider][invoiceYear]) === 'undefined') {
        bbFeesProvider[invoice.metadata.provider][invoiceYear] = {total: 0};
      }

      const {net} = getNet(invoice);
      bbFeesProvider[invoice.metadata.provider][invoiceYear].total += net
    })

    let bbFeeTotal = 0;
    let totalProvider = 0;
    const bbFees = {}

    Object.keys(bbFeesProvider).forEach(provider => {
      Object.keys(bbFeesProvider[provider]).forEach(year => {
        const bbFee = getTaxAmount(bbFeesProvider[provider][year].total);
        if(typeof(bbFees[year]) === 'undefined') {
          bbFees[year] = {bbFee: 0, total: 0}
        }
        bbFeeTotal += bbFee;
        totalProvider += bbFeesProvider[provider][year].total;
        bbFees[year].bbFee += bbFee;
        bbFees[year].total += bbFeesProvider[provider][year].total;
      })
    })

    const cleanedInvoices = filteredInvoices.map(invoice => {
      const {net} = getNet(invoice);
      if(invoice.metadata.cotisation) {
        return {date: new Date(invoice.date*1000), amount: net, label: `Cotisation ${invoice.metadata.cotisation}`, type: 'credit', fees: []}
      }
      return {date: new Date(invoice.date*1000), amount: net, label: invoice.number, type: 'credit', fees: []}
    })

    const resetInvoicesPreQontoSwitchAmount = cleanedInvoices.reduce((acc, invoice) => {
      if(invoice.date.toString() < qontoSwitchAccountDate) {
        return acc 
      }
      return acc + invoice.amount
    }, 0)

    console.log(resetInvoicesPreQontoSwitchAmount)

    const total = cleanedInvoices.reduce((accu, invoice) => accu + invoice.amount, 0)
    const bankTransactions = await getBankTransactions();
    const filteredTransactions = bankTransactions.transactions.filter(({side, note}) => {
      let ret = false;
      if(side === 'debit') {
        try {
          const noteObject = JSON.parse(note);
          if(typeof(noteObject.claimant) === 'undefined'){
            ret = true;
          }
        } catch (err) {
          ret = true;
        }
      }
      return ret;
    })
    const cleanedTransactions = cleanTransactions(filteredTransactions);

    const subTotal = cleanedTransactions.reduce((accu, transaction) => accu + transaction.amount, 0)
    const transactions = cleanedTransactions.concat(cleanedInvoices)
    res.json({balance: (total - subTotal + bbFeeTotal), bbFees, bbFeeAverage: getTaxAverage(totalProvider, bbFeeTotal), transactions: transactions.sort((a,b) => a.date>b.date ? -1 : 1)});
  })

  route.get('/:provider', async (req, res) => {
    const invoices = await stripe.invoices.list({limit: 300, expand: ['data.charge', 'data.charge.balance_transaction']});

    const filteredInvoices = invoices.data.filter(
      ({total, paid, metadata}) => total !== 0 && paid && metadata.provider === req.params.provider
    )
    const cleanedInvoices = filteredInvoices.map(invoice => {
      const {net, fees} = getNet(invoice);
      return {date: new Date(invoice.date*1000), amount: net, label: invoice.number, type: 'credit', fees}
    })

    const now = new Date();
    const bbFees = {}
    let total = 0;
    let bbFeeTotal = 0;

    for(let year = startYear; year <= now.getFullYear(); year += 1) {
      const yearFilteredInvoices = cleanedInvoices.filter(({date}) => date.getFullYear() === year);

      const yearTotal = yearFilteredInvoices.reduce((accu, invoice) => accu + invoice.amount, 0)
      total += yearTotal;
      const bbFee = getTaxAmount(yearTotal);
      bbFeeTotal += bbFee;
      bbFees[year] = {bbFee, total: yearTotal}
    }

    const bankTransactions = await getBankTransactions();
    const filteredTransactions = bankTransactions.transactions.filter(({note}) => {
      try {
        const noteObject = JSON.parse(note);
        return (noteObject && noteObject.claimant && noteObject.claimant === req.params.provider)
      } catch (err) {
        return false;
      }

    })

    const cleanedTransactions = cleanTransactions(filteredTransactions);
    const subTotal = cleanedTransactions.reduce((accu, transaction) => accu + transaction.amount, 0)
    const transactions = cleanedTransactions.concat(cleanedInvoices)
    res.json({balance: (total - subTotal - bbFeeTotal), bbFees, bbFeeAverage: getTaxAverage(total, bbFeeTotal), transactions: transactions.sort((a,b) => a.date>b.date ? -1 : 1)});
  })

  return route;
};
