import { Router } from 'express';
import axios from 'axios';

export default () => {
  const route = Router();
  route.get('/scaleway', (req, res) => {
    axios.get(`https://billing.scaleway.com/invoices`, {headers: {'X-Auth-Token' : process.env.BUGBUILDERS_SCALEWAY_KEY}})
    .then(response => {
      const invoices = response.data.invoices.map(invoice => ({
          total: {
            ht: parseFloat(invoice.total_untaxed),
            tax: parseFloat(invoice.total_tax),
            ttc: parseFloat(invoice.total_taxed),
          },
          state: invoice.state,
          currency: invoice.currency,
          number: invoice.number,
          id: invoice.id,
          issued: invoice.issued_date,
          organization: {
            name: invoice.organization_name,
            id: invoice.organization_id
          }
        })
      );
      res.json(invoices);
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({error: 'Something goes wrong'});
    })
  });

  return route;
};
