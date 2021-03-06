import crypto from 'crypto';
import stripePackage from 'stripe';

const stripe = stripePackage(process.env.BUGBUILDERS_STRIPE_KEY);

function hash(str, output = 'hex') {
  const hashFunc = crypto.createHash('sha256');
  hashFunc.update(str);

  return hashFunc.digest(output)
}

const key = hash(process.env.BUGBUILDERS_SECRET_KEY, null);

function encrypt(str) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes256', key, iv);
  let encrypted = cipher.update(str, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}${encrypted}`;
}

function decrypt(encrypted) {
  const iv = Buffer.from(encrypted.substr(0, 32), 'hex')
  const cipher = crypto.createDecipheriv('aes256', key, iv);

  let decrypted = cipher.update(encrypted.substr(32), 'hex', 'utf8');
  decrypted += cipher.final('utf8');

  return decrypted;
}

function authenticate(req, res, next) {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')
  stripe.customers.list({limit: 100})
    .then(customers => {
      req.member = customers.data.filter(customer => typeof(customer.metadata.membre) !== 'undefined').find(m => m.email === login);
      if(typeof(req.member) === 'undefined'){
        throw 'User not found';
      }
      const hashedPassword = hash(`${req.member.metadata.salt}|||${password}`);
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

const utils = {
  encrypt,
  decrypt,
  hash,
  authenticate
}

export default utils;

if(process.argv.length === 4) {
  if(process.argv[2].startsWith('e')){
    console.log(encrypt(process.argv[3]))
  } else if(process.argv[2].startsWith('d')){
    console.log(decrypt(process.argv[3]))
  }
}
