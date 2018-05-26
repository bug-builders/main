import { Router } from 'express';
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

export default () => {
  const route = Router();

  route.use((req, res, next) => {
    if(req.method === 'PUT' && req.originalUrl.startsWith('/customer/')){
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
  });

  route.post('/', (req, res) => {
    stripe.customers.create({metadata: {provider: req.member.description, status: 'pending'}})
      .then(customer => {
        res.json(customer);
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
        res.json({'ok': true})
      })
      .catch(err => {
        console.error(err);
        res.status(403).json({error: 'Customer not editable'});
      })
  })

  return route;
};
