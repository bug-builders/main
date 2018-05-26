import crypto from 'crypto';

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

const utils = {
  encrypt,
  decrypt,
  hash
}

export default utils;

if(process.argv.length === 4) {
  if(process.argv[2].startsWith('e')){
    console.log(encrypt(process.argv[3]))
  } else if(process.argv[2].startsWith('d')){
    console.log(decrypt(process.argv[3]))
  }
}
