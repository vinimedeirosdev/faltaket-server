import express, { Application } from 'express';
import cors from 'cors';
import userRoutes from './routers';

const app: Application = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Rotas
app.use('/', userRoutes);

app.listen(port, () => {
    console.log(`🚀 Server listening at http://localhost:${port}`);
});
