import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import { db } from './firebaseConfig'; // Importando a configuração do Firestore

// Inicializando o servidor Express
const app = express();
const port = 3000;

// Middleware para parsear JSON
app.use(express.json());
app.use(cors());

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
app.post('/register', async (req: Request, res: Response) => {
    const { name, user, password } = req.body;
    try {
        const newItem = {
            name: name,
            user: user,
            password: password,
        };

        const userExists = await db.collection('users').where('user', '==', user).get();

        if (!userExists.empty) {
            res.status(201).json({
                msg: 'Usuário já existe',
                success: false,
            })
            return;
        }

        const docRef = await db.collection('users').add(newItem); // Adicionando item ao Firestore
        res.status(201).json({ user: { id: docRef.id, ...newItem }, success: true });
    } catch (error) {
        console.error('Erro ao adicionar item:', error);
        res.status(500).json({ error: 'Erro ao adicionar item' });
    }
});

app.post('/login', async (req: Request, res: Response) => {
    const { user, password } = req.body; // Pegando as credenciais do corpo da requisição
    try {
        // Buscando o usuário no Firestore com base no nome de usuário
        const userSnapshot = await db.collection('users').where('user', '==', user).get();

        if (userSnapshot.empty) {
            // Se não encontrar o usuário
            res.status(200).json({ msg: 'Usuário não encontrado', success: false });
            return;
        }

        // Pegando o primeiro usuário encontrado (assumindo que o nome de usuário é único)
        const userDoc = userSnapshot.docs[0];
        const storedPassword = userDoc.data().password;

        // Verificando se a senha fornecida é igual à armazenada no Firestore
        if (storedPassword === password) {
            // Se as senhas coincidirem, retorna sucesso (aqui você pode adicionar um token de sessão ou JWT, se necessário)
            res.status(200).json({
                user: {
                    ...userDoc.data()
                    , id: userDoc.id
                },
                success: true
            });
        } else {
            // Se as senhas não coincidirem
            res.status(200).json({ msg: 'Senha incorreta', successs: false });
        }
    } catch (error) {
        console.error('Erro ao realizar login:', error);
        res.status(500).json({ error: 'Erro ao realizar login' });
    }
});

// Iniciar o servidor
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
