"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firebaseConfig_1 = require("./firebaseConfig"); // Importando a configuração do Firestore
// Inicializando o servidor Express
const app = (0, express_1.default)();
const port = 3000;
// Middleware para parsear JSON
app.use(express_1.default.json());
// Rota GET para listar os itens
app.get('/items', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const snapshot = yield firebaseConfig_1.db.collection('items').get(); // Obtendo todos os itens
        const items = snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        res.json(items);
    }
    catch (error) {
        console.error('Erro ao buscar itens:', error);
        res.status(500).json({ error: 'Erro ao buscar itens' });
    }
}));
// Rota DELETE para remover um item pelo ID
app.delete('/items/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const itemRef = firebaseConfig_1.db.collection('items').doc(id); // Referência ao documento
        yield itemRef.delete(); // Deletando o item
        res.status(204).send(); // Retorna status 204 (No Content) após a exclusão
    }
    catch (error) {
        console.error('Erro ao excluir item:', error);
        res.status(500).json({ error: 'Erro ao excluir item' });
    }
}));
// Rota POST para adicionar um novo item
app.post('/items', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { name } = req.body;
    try {
        const newItem = {
            name,
        };
        const docRef = yield firebaseConfig_1.db.collection('items').add(newItem); // Adicionando item ao Firestore
        res.status(201).json(Object.assign({ id: docRef.id }, newItem));
    }
    catch (error) {
        console.error('Erro ao adicionar item:', error);
        res.status(500).json({ error: 'Erro ao adicionar item' });
    }
}));
// Iniciar o servidor
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
