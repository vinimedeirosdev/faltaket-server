import { Request, Response } from 'express';
import { db } from './firebaseConfig';

export const registerUser = async (req: Request, res: Response) => {
    const { name, user, password } = req.body;

    try {
        const newItem = { name, user, password };
        const userExists = await db.collection('users').where('user', '==', user).get();

        if (!userExists.empty) {
            res.status(200).json({ msg: 'Usuário já existe', success: false });
            return;
        }

        const docRef = await db.collection('users').add(newItem);
        res.status(200).json({ user: { id: docRef.id, ...newItem }, success: true });
    } catch (error) {
        console.error('Erro ao registrar usuário:', error);
        res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
};

export const loginUser = async (req: Request, res: Response) => {
    const { user, password } = req.body;

    try {
        const userSnapshot = await db.collection('users').where('user', '==', user).get();

        if (userSnapshot.empty) {
            res.status(200).json({ msg: 'Usuário não encontrado', success: false });
            return
        }

        const userDoc = userSnapshot.docs[0];
        const storedPassword = userDoc.data().password;

        if (storedPassword === password) {
            res.status(200).json({
                user: { ...userDoc.data(), id: userDoc.id },
                success: true
            });
            return
        }

        res.status(200).json({ msg: 'Senha incorreta', success: false });
    } catch (error) {
        console.error('Erro ao realizar login:', error);
        res.status(500).json({ error: 'Erro ao realizar login' });
    }
};

export const getMaterias = async (req: Request, res: Response) => {
    const { id_user } = req.body;

    try {
        const snapshot = await db.collection('materias').where('id_user', '==', id_user).get();
        const items = await Promise.all(snapshot.docs.map(async (doc) => {
            const subcollectionSnapshot = await db.collection('materias').doc(doc.id).collection('faltas').get();
            const faltas = subcollectionSnapshot.docs.map(subDoc => ({
                id: subDoc.id,
                ...subDoc.data()
            }));

            return { id: doc.id, ...doc.data(), faltas };
        }));

        res.json(items);
    } catch (error) {
        console.error('Erro ao buscar matérias:', error);
        res.status(500).json({ error: 'Erro ao buscar matérias' });
    }
};

export const editMateria = async (req: Request, res: Response) => {
    const { id_user, id_materia, nome, descricao } = req.body;

    try {
        const materiaRef = db.collection('materias').doc(id_materia);
        const materiaDoc = await materiaRef.get();

        if (!materiaDoc.exists) {
            return res.status(404).json({ msg: 'Matéria não encontrada', success: false });
        }

        await materiaRef.update({ nome, descricao });

        res.status(200).json({ msg: 'Matéria atualizada com sucesso', success: true });
    } catch (error) {
        console.error('Erro ao editar matéria:', error);
        res.status(500).json({ error: 'Erro ao editar matéria' });
    }
};

