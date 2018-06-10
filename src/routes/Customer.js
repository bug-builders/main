import { Router } from 'express';
import zlib from 'zlib';
import Joi from 'joi';
import stripePackage from 'stripe';
import utils from '../utils';


const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);

function validate(req, res, next){
  const schema = {
    name: Joi.string().trim().min(3).max(50).required(),
    email: Joi.string().trim().email().required(),
    VAT: Joi.string().trim().min(3).max(50).optional(),
    phone: Joi.string().trim().regex(/^[0-9+ ]+$/).optional(),
    country: Joi.string().trim().regex(/^[A-Z]{2}$/).required(),
    city: Joi.string().trim().required(),
    address1: Joi.string().trim().required(),
    address2: Joi.string().trim().optional(),
    pc: Joi.string().trim().required(),
    terms: Joi.string()
  }

  const result = Joi.validate(req.body, schema);
  if(result.error === null) {
    next();
  } else {
    res.status(400).json({error: result.error.message});
  }
}

function chunkString(str, length) {
  return str.match(new RegExp(`.{1,${length}}`, 'g'));
}

export default () => {
  const route = Router();

  route.use((req, res, next) => {
    if(
      (req.method === 'PUT' && req.originalUrl.startsWith('/customer/cus_'))
      || ((req.method === 'GET' || req.method === 'PUT') && req.originalUrl.startsWith('/customer/devis'))){
      next();
    } else {
      const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
      const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')
      stripe.customers.list()
        .then(customers => {
          req.member = customers.data.filter(customer => typeof(customer.metadata.membre) !== 'undefined').find(m => m.email === login);
          if(typeof(req.member) === 'undefined'){
            throw 'User not found';
          }
          const hashedPassword = utils.hash(`${req.member.metadata.salt}|||${password}`);
          if(hashedPassword === req.member.metadata.password){
            next();
          } else {
            throw 'Invalid password';
          }
        })
        .catch(err => {
          console.error(err);
          res.status(401).json({error: 'Authentication required.'});
        })
    }
  })

  route.get('/list', (req, res) => {
    stripe.customers.list()
      .then(customers => {
        const privateCustomers = customers.data.filter(customer => customer.metadata.provider === req.member.description);
        res.json(privateCustomers);
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.put('/use/:id', (req, res) => {
    stripe.subscriptionItems.retrieve(req.params.id)
      .then(rSubscriptionItem => {
        if(rSubscriptionItem.plan.metadata.provider === req.member.description) {
          const timestamp = Math.floor(Date.now() / 1000);
          if(req.body.quantity) {
            return stripe.usageRecords.create(req.params.id, {
              quantity: req.body.quantity,
              timestamp,
              action: 'set',
            })
          }
          return stripe.usageRecords.create(req.params.id, {
            quantity: 1,
            timestamp
          })
        }
        throw 'Not your subscription'
      })
      .then(() => {
        res.json({ok: true})
      })
      .catch(err => {
        console.error(err);
        res.status(401).json({error: 'Invalid id'})
      })
  })

  route.get('/devis/:id/:devis_id', (req, res) => {
    let customer;
    let plan;
    stripe.customers.retrieve(req.params.id)
      .then(rCustomer => {
        customer = rCustomer;
        return stripe.plans.retrieve(req.params.devis_id)
      })
      .then(rPlan => {
        plan = rPlan;
        return stripe.products.retrieve(plan.product);
      }).then(product => {
        const devis = {
          customer: {
            name: customer.description,
            address: customer.shipping.address,
          },
          amount: plan.amount,
          name: product.name,
          metadata: plan.metadata,
        }
        res.json(devis);
      })
      .catch(err => {
        console.error(err);
        res.status(401).json({error: 'Invalid id'});
      })
  });

  route.get('/devis/:id', (req, res) => {
    let customer;
    let plan;
    let subscription;
    stripe.subscriptions.retrieve(req.params.id)
      .then(rSubscription => {
        subscription = rSubscription;
        return stripe.customers.retrieve(subscription.customer)
      })
      .then(rCustomer => {
        customer = rCustomer;
        ({ plan } = subscription);
        return stripe.products.retrieve(plan.product);
      })
      .then(product => {
        const signatureLength = parseInt(subscription.metadata.signatureLength, 10);

        let signatureHex = '';

        for(let i = 0; i < signatureLength; i += 1) {
          signatureHex += subscription.metadata[`signature_${i}`];
        }
        const signatureGzip = Buffer.from(signatureHex, 'base64');

        const signature = zlib.gunzipSync(signatureGzip).toString();

        const devis = {
          customer: {
            name: customer.description,
            address: customer.shipping.address,
          },
          amount: plan.amount,
          name: product.name,
          metadata: plan.metadata,
          created: subscription.created,
          planned: subscription.metadata.planned,
          legalName: subscription.metadata.legalName,
          signature
        }
        res.json(devis);
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.put('/devis/:id/:devis_id', (req, res) => {
    const bufferSignature = Buffer.from(req.body.signature, 'utf-8');
    const zippedSignature = zlib.gzipSync(bufferSignature).toString('base64');
    const signature = chunkString(zippedSignature, 500);

    const metadata = {
      legalName: req.body.legalName,
      planned: req.body.planned,
      signatureLength: signature.length,
      signatureVersion: '1'
    };

    signature.forEach((sig, i) => {
      metadata[`signature_${i}`] = sig;
    })
    stripe.subscriptions.create({
      customer: req.params.id,
      tax_percent: 20.0,
      metadata,
      items: [
        {
          plan: req.params.devis_id,
        },
      ]
    })
      .then(subscription => {
        res.json({id: subscription.id});
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.post('/', (req, res) => {
    stripe.customers.create({metadata: {provider: req.member.description, status: 'pending'}})
      .then(customer => {
        res.json(customer);
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({error: 'Something goes wrong'});
      })
  });

  route.put('/:id', validate, (req, res) => {
    stripe.customers.retrieve(req.params.id)
      .then(customer => {
        if(customer.metadata.status === 'pending') {
          const updatedCustomer = {
            metadata: {
              status: 'complete',
            },
            description: req.body.name,
            email: req.body.email,
            business_vat_id: req.body.vat,
            shipping: {
              name: '',
              phone: req.body.phone,
              address: {
                city: req.body.city,
                country: req.body.country,
                line1: req.body.address1,
                line2: req.body.address2,
                postal_code: req.body.pc,
              },
            },
          };

          return stripe.customers.update(req.params.id, updatedCustomer);
        }
        throw `Not in pending status : ${JSON.stringify(customer.metadata)}`;
      })
      .then(() => {
        res.json({ok: true})
      })
      .catch(err => {
        console.error(err);
        res.status(403).json({error: 'Customer not editable'});
      })
  })

  return route;
};
