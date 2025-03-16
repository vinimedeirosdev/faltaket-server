import express, { Request, Response } from 'express';
import { db } from './firebaseConfig'; // Importando a configuração do Firestore

// Inicializando o servidor Express
const app = express();
const port = 3000;

// Middleware para parsear JSON
app.use(express.json());

// Rota GET para listar os itens
app.get('/items', async (req: Request, res: Response) => {
    try {
        const snapshot = await db.collection('items').get(); // Obtendo todos os itens
        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.json(items);
    } catch (error) {
        console.error('Erro ao buscar itens:', error);
        res.status(500).json({ error: 'Erro ao buscar itens' });
    }
});

// Rota DELETE para remover um item pelo ID
app.delete('/items/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const itemRef = db.collection('items').doc(id); // Referência ao documento
        await itemRef.delete(); // Deletando o item
        res.status(204).send(); // Retorna status 204 (No Content) após a exclusão
    } catch (error) {
        console.error('Erro ao excluir item:', error);
        res.status(500).json({ error: 'Erro ao excluir item' });
    }
});

// Rota POST para adicionar um novo item
app.post('/items', async (req: Request, res: Response) => {
    const { name } = req.body;
    try {
        const newItem = {
            name,
        };
        const docRef = await db.collection('items').add(newItem); // Adicionando item ao Firestore
        res.status(201).json({ id: docRef.id, ...newItem });
    } catch (error) {
        console.error('Erro ao adicionar item:', error);
        res.status(500).json({ error: 'Erro ao adicionar item' });
    }
});

// Iniciar o servidor
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
