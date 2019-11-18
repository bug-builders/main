import {} from 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';

import ping from './routes/Ping';
import bank from './routes/Bank';
import customer from './routes/Customer';
import invoices from './routes/Invoices';

const app = express();
app.server = http.createServer(app);

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));

app.use('/ping', ping());
app.use('/bank', bank());
app.use('/customer', customer());
app.use('/invoices', invoices());

app.server.listen(process.env.BUGBUILDERS_SERVER_PORT || 3000, process.env.BUGBUILDERS_SERVER_PORT || '127.0.0.1');
export default app;
